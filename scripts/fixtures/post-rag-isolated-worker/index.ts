import { createHash, timingSafeEqual, randomUUID } from 'node:crypto'
import https from 'node:https'
import cloud from 'wx-server-sdk'

import * as db from '../../../cloud/lib/db'
import { buildPostRagSourceProjection } from '../../../cloud/lib/post-rag-indexing'
import {
  processPostRagJobV2Batch,
} from '../../../cloud/lib/post-rag-job-processor'
import {
  claimPostRagJob,
  completePostRagJob,
  failPostRagJob,
  getPostRagJob,
  renewPostRagJobLease,
} from '../../../cloud/lib/post-rag-jobs'
import {
  claimPostRagOutboxEvent,
  materializeClaimedPostRagOutboxEvent,
  validateStoredPostRagOutboxDocument,
} from '../../../cloud/lib/post-rag-outbox-materializer'
import {
  cleanupPostRagReleaseProbe,
  createPostRagReleaseProbe,
  readPostRagReleaseProbeStatus,
} from '../../../cloud/lib/post-rag-release-probe'
import { createPostRagV2RuntimeFromEnv } from '../../../cloud/lib/post-rag-v2-runtime'
import { createPostSemanticSearchServiceFromEnv } from '../../../cloud/lib/post-semantic-search'
import { assertPostRagWorkerAuthorized } from '../../../cloud/lib/rag-worker-auth'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const SAFE_ERROR_CODES = new Set([
  'MAX_ATTEMPTS', 'SOURCE_NOT_FOUND', 'SOURCE_SUPERSEDED', 'VALIDATION_FAILED', 'EMBEDDING_FAILED',
  'ES_UNAVAILABLE', 'ES_WRITE_FAILED', 'MIRROR_WRITE_FAILED', 'TIMEOUT', 'INTERNAL_ERROR',
])
const SAFE_ERROR_STAGES = new Set([
  'claim', 'load_source', 'chunk', 'embedding', 'es_write', 'mirror_write', 'activate', 'cleanup',
])

type Probe = {
  _id?: string
  runId: string
  status?: string
  communityId: string
  sectionId: string
  postId: string
  outboxId: string
  cleanupOutboxId?: string | null
}

type HandlerDependencies = {
  diagnoseEs(): Promise<{ statusClass: string }>
  diagnoseSearchDsl(): Promise<{ probes: Array<{ name: string; statusClass: string; errorType: string | null }> }>
  searchProbe(probe: Probe): Promise<any>
  countEsDocuments(probe: Probe): Promise<{ count: number }>
  create(input: { runId: string; communityId: string }): Promise<any>
  status(input: any): Promise<any>
  cleanup(input: any): Promise<any>
  readProbe(runId: string): Promise<Probe | null>
  readOutbox(outboxId: string): Promise<any>
  readOutboxOptional(outboxId: string): Promise<any | null>
  materializeExact(outboxId: string, workerId: string): Promise<{ jobId: string | null; materializedByThisInvocation: boolean }>
  readJob(jobId: string): Promise<any>
  processExactJob(jobId: string, workerId: string): Promise<any>
  recordTimerEvidence(runId: string, field: 'timerEvidenceCreate' | 'timerEvidenceCleanup', evidence: any): Promise<void>
}

type HandlerEnvironment = { validationToken: string; timerToken: string; now?: () => string | number | Date }

function validRunId(value: unknown) {
  const runId = String(value || '')
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(runId)) throw new Error('validation runId is invalid')
  return runId
}

function fixtureIds(runId: string) {
  const suffix = createHash('sha256').update(runId).digest('hex').slice(0, 24)
  return { sectionId: `rag_timer_section_${suffix}`, postId: `rag_timer_post_${suffix}` }
}

function tokenMatches(actual: unknown, expected: string) {
  const actualText = typeof actual === 'string' ? actual : ''
  const left = createHash('sha256').update(actualText).digest()
  const right = createHash('sha256').update(expected).digest()
  return timingSafeEqual(left, right) && actualText.length === expected.length
}

function assertIndependentTokens(environment: HandlerEnvironment) {
  if (typeof environment?.validationToken !== 'string' || environment.validationToken.length < 16
    || typeof environment?.timerToken !== 'string' || environment.timerToken.length < 16) {
    throw new Error('validation credentials are invalid')
  }
  if (tokenMatches(environment.validationToken, environment.timerToken)) {
    throw new Error('validation credentials must be independent')
  }
}

function validCommunityId(value: unknown) {
  const id = String(value || '')
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) throw new Error('validation communityId is invalid')
  return id
}

function parseAuthenticTimer(event: any, environment: HandlerEnvironment) {
  if (['workerToken', 'postRagWorkerToken', 'POST_RAG_WORKER_TOKEN', 'timerToken', 'validationToken', 'action', 'runId']
    .some(key => Object.prototype.hasOwnProperty.call(event || {}, key))) throw new Error('isolated validation unauthorized')
  try {
    assertPostRagWorkerAuthorized(event, {
      POST_RAG_TIMER_TOKEN: environment.timerToken,
      POST_RAG_TIMER_TRIGGER_NAME: 'post-rag-worker-every-minute',
    } as NodeJS.ProcessEnv, { now: environment.now || Date.now })
  } catch { throw new Error('isolated validation unauthorized') }
  if (event?.Type !== 'Timer' || typeof event.Message !== 'string' || event.Message.length > 4096) {
    throw new Error('isolated validation unauthorized')
  }
  let message: any
  try { message = JSON.parse(event.Message) } catch { throw new Error('isolated validation unauthorized') }
  if (!message || typeof message !== 'object' || Array.isArray(message)
    || Object.getPrototypeOf(message) !== Object.prototype
    || JSON.stringify(Object.keys(message).sort()) !== JSON.stringify(['runId', 'timerToken'])) {
    throw new Error('isolated validation unauthorized')
  }
  return { runId: validRunId(message.runId), eventTime: String(event.Time), triggerName: String(event.TriggerName) }
}

function assertProbeBinding(probe: Probe, runId: string) {
  const expected = fixtureIds(runId)
  if (!probe || String(probe._id || probe.runId) !== runId || probe.runId !== runId
    || probe.postId !== expected.postId || probe.sectionId !== expected.sectionId
    || !probe.communityId || !probe.outboxId) throw new Error('validation probe binding mismatch')
}

function assertOutboxBinding(outbox: any, outboxId: string, probe: Probe) {
  if (!outbox || outbox._id !== outboxId || outbox.aggregateId !== probe.postId
    || outbox.communityId !== probe.communityId) throw new Error('validation outbox binding mismatch')
}

function assertJobBinding(job: any, jobId: string, probe: Probe) {
  if (!job || job._id !== jobId || job.postId !== probe.postId
    || job.communityId !== probe.communityId) throw new Error('validation job binding mismatch')
}

const defaultDependencies: HandlerDependencies = {
  async searchProbe(probe) {
    return createPostSemanticSearchServiceFromEnv().search({
      communityId: probe.communityId, query: `probe-${probe.runId}`, includeMemberOnly: false, limit: 5,
    })
  },
  async countEsDocuments(probe) {
    const endpoint = new URL(String(process.env.TENCENT_RAG_ES_ENDPOINT || ''))
    const indexName = String(process.env.TENCENT_RAG_INDEX_NAME || '')
    const authorization = `Basic ${Buffer.from(`${process.env.TENCENT_RAG_ES_USERNAME || ''}:${process.env.TENCENT_RAG_ES_PASSWORD || ''}`).toString('base64')}`
    const payload = Buffer.from(JSON.stringify({ query: { term: { postId: probe.postId } } }))
    return new Promise((resolve, reject) => {
      const req = https.request(new URL(`${indexName}/_count`, `${endpoint.toString().replace(/\/+$/, '')}/`), {
        method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json', 'Content-Length': payload.length }, timeout: 10_000,
      }, res => {
        const chunks: Buffer[] = []; let size = 0
        res.on('data', chunk => { size += chunk.length; if (size <= 65_536) chunks.push(Buffer.from(chunk)) })
        res.once('end', () => {
          if ((res.statusCode || 500) < 200 || (res.statusCode || 500) >= 300 || size > 65_536) return reject(new Error('ES physical count failed'))
          let parsed: any
          try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return reject(new Error('ES physical count failed')) }
          if (!Number.isSafeInteger(parsed?.count) || parsed.count < 0) return reject(new Error('ES physical count failed'))
          resolve({ count: parsed.count })
        })
      })
      req.once('timeout', () => { req.destroy(); reject(new Error('ES physical count failed')) })
      req.once('error', () => reject(new Error('ES physical count failed')))
      req.end(payload)
    })
  },
  async diagnoseEs() {
    const endpoint = new URL(String(process.env.TENCENT_RAG_ES_ENDPOINT || ''))
    const indexName = String(process.env.TENCENT_RAG_INDEX_NAME || '')
    const authorization = `Basic ${Buffer.from(`${process.env.TENCENT_RAG_ES_USERNAME || ''}:${process.env.TENCENT_RAG_ES_PASSWORD || ''}`).toString('base64')}`
    return new Promise(resolve => {
      const req = https.request(new URL(`${indexName}/_mapping`, `${endpoint.toString().replace(/\/+$/, '')}/`), {
        method: 'GET', headers: { Authorization: authorization }, timeout: 10_000,
      }, res => { res.resume(); res.once('end', () => resolve({ statusClass: `${Math.floor((res.statusCode || 500) / 100)}xx` })) })
      const fail = (statusClass: string) => resolve({ statusClass })
      req.once('timeout', () => { req.destroy(); fail('timeout') })
      req.once('error', () => fail('network'))
      req.end()
    })
  },
  async diagnoseSearchDsl() {
    const endpoint = new URL(String(process.env.TENCENT_RAG_ES_ENDPOINT || ''))
    const indexName = String(process.env.TENCENT_RAG_INDEX_NAME || '')
    const vectorField = String(process.env.TENCENT_RAG_VECTOR_FIELD || 'embedding')
    const authorization = `Basic ${Buffer.from(`${process.env.TENCENT_RAG_ES_USERNAME || ''}:${process.env.TENCENT_RAG_ES_PASSWORD || ''}`).toString('base64')}`
    const vector = [1, ...Array.from({ length: 767 }, () => 0)]
    const query = { match_all: {} }
    const knn = { field: vectorField, query_vector: vector, k: 1, num_candidates: 10 }
    const request = (body: any) => new Promise<{ statusClass: string; errorType: string | null }>(resolve => {
      const payload = Buffer.from(JSON.stringify(body))
      const req = https.request(new URL(`${indexName}/_search`, `${endpoint.toString().replace(/\/+$/, '')}/`), {
        method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json', 'Content-Length': payload.length }, timeout: 10_000,
      }, res => {
        const chunks: Buffer[] = []; let size = 0
        res.on('data', chunk => { size += chunk.length; if (size <= 65_536) chunks.push(Buffer.from(chunk)) })
        res.once('end', () => {
          let errorType: string | null = null
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            const candidate = parsed?.error?.type || parsed?.error?.root_cause?.[0]?.type
            if (typeof candidate === 'string' && /^[a-z0-9_]{1,64}$/.test(candidate)) errorType = candidate
          } catch { /* diagnostics intentionally omit provider text */ }
          resolve({ statusClass: `${Math.floor((res.statusCode || 500) / 100)}xx`, errorType })
        })
      })
      const fail = (statusClass: string) => resolve({ statusClass, errorType: null })
      req.once('timeout', () => { req.destroy(); fail('timeout') })
      req.once('error', () => fail('network'))
      req.end(payload)
    })
    const definitions = [
      ['lexical', { size: 1, _source: false, query }],
      ['topLevelKnn', { size: 1, _source: false, knn }],
      ['queryKnn', { size: 1, _source: false, query: { knn } }],
      ['fieldKnn', { size: 1, _source: false, query: { knn: { [vectorField]: { vector, k: 1 } } } }],
      ['scriptScore', { size: 1, _source: false, query: { script_score: { query, script: {
        source: `cosineSimilarity(params.query_vector, '${vectorField}') + 1.0`, params: { query_vector: vector },
      } } } }],
    ] as const
    const probes = []
    for (const [name, body] of definitions) probes.push({ name, ...await request(body) })
    return { probes }
  },
  create: createPostRagReleaseProbe,
  status: readPostRagReleaseProbeStatus,
  cleanup: cleanupPostRagReleaseProbe,
  readProbe: (runId) => db.getByIdOrNull('post_rag_release_probes', runId) as Promise<Probe | null>,
  async readOutbox(outboxId) {
    const outbox = await db.getById('post_rag_outbox', outboxId)
    validateStoredPostRagOutboxDocument(outbox, outboxId)
    return outbox
  },
  async readOutboxOptional(outboxId) {
    const outbox = await db.getByIdOrNull('post_rag_outbox', outboxId)
    if (outbox) validateStoredPostRagOutboxDocument(outbox, outboxId)
    return outbox
  },
  async materializeExact(outboxId, workerId) {
    const now = new Date().toISOString()
    const claimed = await claimPostRagOutboxEvent(outboxId, { workerId, now })
    if (claimed) {
      const result = await materializeClaimedPostRagOutboxEvent(outboxId, {
        workerId, leaseToken: String(claimed.leaseToken || ''), now: new Date().toISOString(),
      })
      return { jobId: String(result?.job?._id || result?.outbox?.materializedJobId || '') || null, materializedByThisInvocation: true }
    }
    const current = await db.getById('post_rag_outbox', outboxId) as any
    return { jobId: current?.status === 'completed' ? String(current.materializedJobId || '') || null : null, materializedByThisInvocation: false }
  },
  readJob: getPostRagJob,
  async processExactJob(jobId, workerId) {
    const { sink } = createPostRagV2RuntimeFromEnv()
    return processPostRagJobV2Batch({ limit: 1, workerId, sink }, {
      sink,
      loadPost: (postId) => db.getByIdOrNull('posts', postId),
      loadSection: (sectionId) => db.getByIdOrNull('sections', sectionId),
      buildProjection: buildPostRagSourceProjection,
      readJob: getPostRagJob,
      complete: completePostRagJob,
      fail: failPostRagJob,
      renew: renewPostRagJobLease,
      listCandidates: async () => [jobId],
      claim: claimPostRagJob,
    })
  },
  async recordTimerEvidence(runId, field, evidence) {
    await db.updateById('post_rag_release_probes', runId, { [field]: evidence })
  },
}

export function createExactIdValidationHandler(
  injectedDependencies: Partial<HandlerDependencies> = {},
  environment: HandlerEnvironment = {
    validationToken: String(process.env.RAG_VALIDATION_TOKEN || ''),
    timerToken: String(process.env.POST_RAG_TIMER_TOKEN || ''),
  },
) {
  assertIndependentTokens(environment)
  const dependencies = { ...defaultDependencies, ...injectedDependencies }
  const inspect = async (runId: string) => {
    const probe = await dependencies.readProbe(runId)
    if (!probe) return { exists: false, runId }
    assertProbeBinding(probe, runId)
    const phase = probe.status === 'active' ? 'create' : 'cleanup'
    const outboxId = phase === 'create' ? probe.outboxId : probe.cleanupOutboxId
    let outbox: any = null
    let job: any = null
    if (outboxId) {
      outbox = probe.status === 'finalizing' || probe.status === 'cleaned'
        ? await dependencies.readOutboxOptional(outboxId)
        : await dependencies.readOutbox(outboxId)
      if (outbox) assertOutboxBinding(outbox, outboxId, probe)
      if (outbox.materializedJobId) {
        job = await dependencies.readJob(String(outbox.materializedJobId))
        assertJobBinding(job, String(outbox.materializedJobId), probe)
      }
    }
    return {
      exists: true, runId, communityId: probe.communityId, sectionId: probe.sectionId, postId: probe.postId,
      status: probe.status, outboxId: outboxId || null,
      job: job ? { jobId: job._id, status: job.status, outcome: job.outcome || null } : null,
      timerEvidence: phase === 'create' ? (probe as any).timerEvidenceCreate || null : (probe as any).timerEvidenceCleanup || null,
    }
  }
  const processBound = async (runId: string, authenticTimer?: { triggerName: string; eventTime: string }) => {
    const probe = await dependencies.readProbe(runId)
    if (!probe) throw new Error('validation probe binding not found')
    assertProbeBinding(probe, runId)
    const phase = probe.status === 'active' ? 'create' : 'cleanup'
    const outboxId = phase === 'create' ? probe.outboxId : probe.cleanupOutboxId
    if (!outboxId) throw new Error('validation exact outbox binding not found')
    const outbox = await dependencies.readOutbox(outboxId)
    assertOutboxBinding(outbox, outboxId, probe)
    const workerId = `rag-validation:${randomUUID()}`
    const materialized = await dependencies.materializeExact(outboxId, workerId)
    const jobId = String(materialized?.jobId || '')
    let jobCompletedByThisInvocation = false
    let result: any = { runId, postId: probe.postId, outboxId, jobId: null, candidateCount: 0, completedCount: 0, outcome: null }
    if (jobId) {
      const job = await dependencies.readJob(jobId)
      assertJobBinding(job, jobId, probe)
      if (job.status === 'completed' && ['indexed', 'removed', 'superseded'].includes(job.outcome)) {
        result = { runId, postId: probe.postId, outboxId, jobId, candidateCount: 1, completedCount: 1, outcome: job.outcome }
      } else {
        const batch = await dependencies.processExactJob(jobId, workerId)
        const exactFailed = Array.isArray(batch?.results)
          ? batch.results.find((row: any) => row?.jobId === jobId && row?.status === 'failed')
          : null
        const safeFailure = SAFE_ERROR_CODES.has(exactFailed?.errorCode) && SAFE_ERROR_STAGES.has(exactFailed?.errorStage)
          ? { errorCode: exactFailed.errorCode, errorStage: exactFailed.errorStage }
          : {}
        const exactCompleted = Array.isArray(batch?.results)
          && batch.results.filter((row: any) => row?.jobId === jobId && row?.status === 'completed').length === 1
        const stored = await dependencies.readJob(jobId)
        assertJobBinding(stored, jobId, probe)
        const completed = stored.status === 'completed' && ['indexed', 'removed', 'superseded'].includes(stored.outcome)
          ? stored : null
        jobCompletedByThisInvocation = Boolean(exactCompleted && completed)
        result = {
          runId, postId: probe.postId, outboxId, jobId,
          candidateCount: Number(batch?.candidateCount || 0),
          completedCount: completed ? 1 : 0,
          outcome: completed?.outcome || null,
          ...safeFailure,
        }
      }
    }
    if (authenticTimer) {
      const prior = phase === 'create' ? (probe as any).timerEvidenceCreate : (probe as any).timerEvidenceCleanup
      const evidence = {
        triggerName: authenticTimer.triggerName, eventTime: authenticTimer.eventTime,
        invokedAt: new Date(environment.now ? environment.now() : Date.now()).toISOString(),
        outboxId, jobId: result.jobId, outcome: result.outcome, phase,
        outboxMaterializedByTimer: prior?.outboxMaterializedByTimer === true || materialized.materializedByThisInvocation === true,
        jobCompletedByTimer: prior?.jobCompletedByTimer === true || jobCompletedByThisInvocation,
        ...(result.errorCode && result.errorStage ? { errorCode: result.errorCode, errorStage: result.errorStage } : {}),
      }
      await dependencies.recordTimerEvidence(runId, phase === 'create' ? 'timerEvidenceCreate' : 'timerEvidenceCleanup', evidence)
    }
    return result
  }
  return async (event: any = {}) => {
    if (event?.Type === 'Timer') {
      const timer = parseAuthenticTimer(event, environment)
      return processBound(timer.runId, timer)
    }
    const runId = validRunId(event.runId)
    if (!tokenMatches(event.validationToken, environment.validationToken)) throw new Error('isolated validation unauthorized')

    if (event.action === 'create') {
      const created = await dependencies.create({ runId, communityId: validCommunityId(event.communityId) })
      assertProbeBinding(created, runId)
      return created
    }
    if (event.action === 'status') return dependencies.status(event)
    if (event.action === 'diagnoseEs') {
      const diagnostic = await dependencies.diagnoseEs()
      const statusClass = ['2xx', '3xx', '4xx', '5xx', 'timeout', 'network'].includes(diagnostic?.statusClass)
        ? diagnostic.statusClass : 'unknown'
      return { statusClass }
    }
    if (event.action === 'diagnoseSearchDsl') {
      const diagnostic = await dependencies.diagnoseSearchDsl()
      const names = new Set(['lexical', 'topLevelKnn', 'queryKnn', 'fieldKnn', 'scriptScore'])
      const statusClasses = new Set(['2xx', '3xx', '4xx', '5xx', 'timeout', 'network', 'unknown'])
      return { probes: (diagnostic?.probes || []).filter(item => names.has(item?.name)).slice(0, 5).map(item => ({
        name: item.name,
        statusClass: statusClasses.has(item?.statusClass) ? item.statusClass : 'unknown',
        errorType: typeof item?.errorType === 'string' && /^[a-z0-9_]{1,64}$/.test(item.errorType) ? item.errorType : null,
      })) }
    }
    if (event.action === 'searchProbe') {
      const probe = await dependencies.readProbe(runId)
      if (!probe) throw new Error('validation probe binding not found')
      assertProbeBinding(probe, runId)
      return dependencies.searchProbe(probe)
    }
    if (event.action === 'countEsDocuments') {
      const probe = await dependencies.readProbe(runId)
      if (!probe) throw new Error('validation probe binding not found')
      assertProbeBinding(probe, runId)
      const result = await dependencies.countEsDocuments(probe)
      if (!Number.isSafeInteger(result?.count) || result.count < 0) throw new Error('ES physical count failed')
      return { count: result.count }
    }
    if (event.action === 'cleanup') return dependencies.cleanup(event)
    if (event.action === 'inspect') return inspect(runId)
    if (event.action === 'processExact') return processBound(runId)
    throw new Error('isolated validation action is invalid')
  }
}

let handler: ReturnType<typeof createExactIdValidationHandler> | null = null

export const main = async (event: any = {}) => {
  handler ||= createExactIdValidationHandler()
  return handler(event)
}
