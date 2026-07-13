import { getCollectionStatus, RELEASE_CONTROL_PLANE_COLLECTIONS } from './release-control-plane.mjs'
import { assertPostSemanticIndexCompatible } from './tencent-rag-index-schema.mjs'
import { assertFormalReleaseGitState } from './release-policy.mjs'
import { createReleasePlan } from './release-plan.mjs'
import { createReleasePlanAfterResumeIdentityCheck } from './release-run-ledger.mjs'
import { advanceProbeTimerEvidence } from './post-rag-timer-evidence.mjs'
import { isScfTriggerEnabled } from './scf-owned-timer.mjs'

export const REQUIRED_RAG_COLLECTIONS = ['post_rag_outbox', 'post_rag_jobs', 'post_rag_index_state_v2', 'post_rag_index_versions', 'post_rag_worker_timer_evidence']

export async function verifyPreflightCollections(db, ragCollections = REQUIRED_RAG_COLLECTIONS) {
  for (const collection of [...RELEASE_CONTROL_PLANE_COLLECTIONS, ...ragCollections]) {
    const status = getCollectionStatus(collection, await db.checkCollectionExists(collection))
    if (status === 'missing') throw new Error(`required collection missing: ${collection}`)
  }
  return { status: 'passed' }
}

export async function verifyPreflightIndex({ readMappings, dims, vectorField = 'embedding' }) {
  const mappings = await readMappings()
  assertPostSemanticIndexCompatible(mappings, { vectorField, dims })
  return { status: 'passed' }
}

export function resolvePreflightIndexOptions(env = {}) {
  const indexName = String(env.TENCENT_RAG_INDEX_NAME || '').trim()
  const region = String(env.TENCENT_RAG_ES_REGION || 'ap-shanghai').trim()
  const dims = Number(env.TENCENT_RAG_EMBEDDING_DIMS || 768)
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(indexName)) throw new Error('RAG index name is unavailable')
  if (!/^ap-[a-z]+(?:-[a-z]+)*$/.test(region)) throw new Error('RAG index region is unavailable')
  if (!Number.isSafeInteger(dims) || dims < 1) throw new Error('RAG embedding dimensions are invalid')
  return { indexName, region, dims }
}

function cronMatches(value, cron) {
  if (value === cron) return true
  try { const parsed = JSON.parse(value); return parsed && Object.keys(parsed).length === 1 && parsed.cron === cron } catch { return false }
}

export async function verifyPreflightTimers({ listTriggers, configs }) {
  for (const config of configs) {
    const desired = config.triggers[0]
    const all = await listTriggers(config.name)
    const owned = all.filter(item => item.TriggerName === desired.name || item.TriggerName?.startsWith(`${config.name}-every-`))
    const matches = owned.filter(item => item.TriggerName === desired.name
      && cronMatches(item.TriggerDesc, desired.config)
      && (desired.customArgument === undefined || item.CustomArgument === desired.customArgument)
      && isScfTriggerEnabled(item))
    if (owned.length !== 1 || matches.length !== 1) throw new Error(`${config.name} timer desired-state mismatch`)
  }
  return { status: 'passed' }
}

export function verifyPreflightGitAndPlan({
  gitState,
  expectedHeadSha,
  resumeRequested,
  resumeRunState,
  releaseStrategy = 'full-current',
  fullCurrentExplicit = releaseStrategy === 'full-current',
  forceRedeployCurrent = false,
  publishOnly = false,
  generatedBuildInfoMatches = false,
}) {
  if (!/^[0-9a-f]{40}$/i.test(String(expectedHeadSha || ''))) throw new Error('expected release HEAD must be a full 40-hex SHA')
  if (!['main', 'full-current'].includes(releaseStrategy)) throw new Error(`unsupported release strategy: ${releaseStrategy}`)
  if (forceRedeployCurrent && (releaseStrategy !== 'full-current' || !fullCurrentExplicit)) throw new Error('force-redeploy-current requires explicit full-current mode')
  assertFormalReleaseGitState({ ...gitState, releaseStrategy, fullCurrentExplicit, publishOnly, generatedBuildInfoMatches })
  if (expectedHeadSha !== gitState.headSha) throw new Error(`expected HEAD ${expectedHeadSha} does not equal workspace HEAD ${gitState.headSha}`)
  if (resumeRequested && !resumeRunState) throw new Error('resume state is required when resume is requested')
  if (!resumeRequested && resumeRunState) throw new Error('resume state is forbidden without explicit resume mode')
  const plan = createReleasePlanAfterResumeIdentityCheck({
    resumeRunState, gitSha: gitState.headSha, releaseStrategy, forceRedeployCurrent,
    createPlan: (headSha, mode, force) => createReleasePlan({ headSha, mode, forceRedeployCurrent: force }),
  })
  return { status: 'passed', plan }
}

export function evaluateProbeEvidence({ state = {}, evidence, startedAt, outboxId, jobId, complete }) {
  const next = advanceProbeTimerEvidence(state, evidence, { startedAt, outboxId, jobId })
  return { ...next, complete: complete === true, passed: next.probeOutboxSeen && next.probeV2JobSeen && complete === true }
}

export function evaluatePreflightTimerEvidence({ evidence, startedAt, outboxId }) {
  const passed = Boolean(evidence
    && evidence.source === 'timer'
    && evidence.triggerName === 'post-rag-worker-every-minute'
    && String(evidence.invokedAt || '') > String(startedAt || '')
    && Array.isArray(evidence.outboxIds)
    && evidence.outboxIds.includes(outboxId))
  return { passed }
}
