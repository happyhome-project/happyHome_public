import { createHash, timingSafeEqual, randomUUID } from 'node:crypto'
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

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

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
  create(runId: string): Promise<any>
  status(input: any): Promise<any>
  cleanup(input: any): Promise<any>
  readProbe(runId: string): Promise<Probe | null>
  readOutbox(outboxId: string): Promise<any>
  materializeExact(outboxId: string, workerId: string): Promise<{ jobId: string | null }>
  readJob(jobId: string): Promise<any>
  processExactJob(jobId: string, workerId: string): Promise<any>
}

type HandlerEnvironment = { validationToken: string; timerToken: string }

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
  create: createPostRagReleaseProbe,
  status: readPostRagReleaseProbeStatus,
  cleanup: cleanupPostRagReleaseProbe,
  readProbe: (runId) => db.getByIdOrNull('post_rag_release_probes', runId) as Promise<Probe | null>,
  async readOutbox(outboxId) {
    const outbox = await db.getById('post_rag_outbox', outboxId)
    validateStoredPostRagOutboxDocument(outbox, outboxId)
    return outbox
  },
  async materializeExact(outboxId, workerId) {
    const now = new Date().toISOString()
    const claimed = await claimPostRagOutboxEvent(outboxId, { workerId, now })
    if (claimed) {
      const result = await materializeClaimedPostRagOutboxEvent(outboxId, {
        workerId, leaseToken: String(claimed.leaseToken || ''), now: new Date().toISOString(),
      })
      return { jobId: String(result?.job?._id || result?.outbox?.materializedJobId || '') || null }
    }
    const current = await db.getById('post_rag_outbox', outboxId) as any
    return { jobId: current?.status === 'completed' ? String(current.materializedJobId || '') || null : null }
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
  return async (event: any = {}) => {
    const runId = validRunId(event.runId)
    const timer = event.action === 'timer' || Boolean(event.TriggerName)
    const authorized = timer
      ? tokenMatches(event.timerToken, environment.timerToken)
      : tokenMatches(event.validationToken, environment.validationToken)
    if (!authorized) throw new Error('isolated validation unauthorized')

    if (event.action === 'create') {
      const created = await dependencies.create(runId)
      assertProbeBinding(created, runId)
      return created
    }
    if (event.action === 'status') return dependencies.status(event)
    if (event.action === 'cleanup') return dependencies.cleanup(event)
    if (!timer) throw new Error('isolated validation action is invalid')

    const probe = await dependencies.readProbe(runId)
    if (!probe) throw new Error('validation probe binding not found')
    assertProbeBinding(probe, runId)
    const outboxId = probe.status === 'active' ? probe.outboxId : probe.cleanupOutboxId
    if (!outboxId) throw new Error('validation exact outbox binding not found')
    const outbox = await dependencies.readOutbox(outboxId)
    assertOutboxBinding(outbox, outboxId, probe)
    const workerId = `rag-validation:${randomUUID()}`
    const materialized = await dependencies.materializeExact(outboxId, workerId)
    const jobId = String(materialized?.jobId || '')
    if (!jobId) return { runId, postId: probe.postId, outboxId, jobId: null, candidateCount: 0, completedCount: 0 }
    const job = await dependencies.readJob(jobId)
    assertJobBinding(job, jobId, probe)
    if (job.status === 'completed' && ['indexed', 'removed', 'superseded'].includes(job.outcome)) {
      return {
        runId, postId: probe.postId, outboxId, jobId,
        candidateCount: 1, completedCount: 1, outcome: job.outcome,
      }
    }
    const result = await dependencies.processExactJob(jobId, workerId)
    const rows = Array.isArray(result?.results) ? result.results.filter((row: any) => row?.jobId === jobId) : []
    const completed = rows.find((row: any) => row?.status === 'completed' || row?.status === 'already_completed')
    return {
      runId,
      postId: probe.postId,
      outboxId,
      jobId,
      candidateCount: Number(result?.candidateCount || 0),
      completedCount: rows.filter((row: any) => row?.status === 'completed' || row?.status === 'already_completed').length,
      outcome: completed?.outcome || null,
    }
  }
}

let handler: ReturnType<typeof createExactIdValidationHandler> | null = null

export const main = async (event: any = {}) => {
  handler ||= createExactIdValidationHandler()
  return handler(event)
}
