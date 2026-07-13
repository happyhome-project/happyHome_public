import { getCollectionStatus, RELEASE_CONTROL_PLANE_COLLECTIONS } from './release-control-plane.mjs'
import { assertPostSemanticIndexCompatible } from './tencent-rag-index-schema.mjs'
import { assertFormalReleaseGitState } from './release-policy.mjs'
import { createReleasePlan } from './release-plan.mjs'
import { createReleasePlanAfterResumeIdentityCheck } from './release-run-ledger.mjs'
import { advanceProbeTimerEvidence } from './post-rag-timer-evidence.mjs'

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

function cronMatches(value, cron) {
  if (value === cron) return true
  try { const parsed = JSON.parse(value); return parsed && Object.keys(parsed).length === 1 && parsed.cron === cron } catch { return false }
}

function enabled(trigger) {
  return trigger.Enable === 'OPEN' || trigger.Enable === true || trigger.EnableStatus === 'OPEN'
}

export async function verifyPreflightTimers({ listTriggers, configs }) {
  for (const config of configs) {
    const desired = config.triggers[0]
    const all = await listTriggers(config.name)
    const owned = all.filter(item => item.TriggerName === desired.name || item.TriggerName?.startsWith(`${config.name}-every-`))
    const matches = owned.filter(item => item.TriggerName === desired.name
      && cronMatches(item.TriggerDesc, desired.config)
      && (desired.customArgument === undefined || item.CustomArgument === desired.customArgument)
      && enabled(item))
    if (owned.length !== 1 || matches.length !== 1) throw new Error(`${config.name} timer desired-state mismatch`)
  }
  return { status: 'passed' }
}

export function verifyPreflightGitAndPlan({ gitState, resumeRequested, resumeRunState }) {
  assertFormalReleaseGitState({ ...gitState, releaseStrategy: 'full-current', fullCurrentExplicit: true })
  if (resumeRequested && !resumeRunState) throw new Error('resume state is required when resume is requested')
  if (!resumeRequested && resumeRunState) throw new Error('resume state is forbidden without explicit resume mode')
  return createReleasePlanAfterResumeIdentityCheck({
    resumeRunState, gitSha: gitState.headSha, releaseStrategy: 'full-current',
    createPlan: (headSha, mode) => createReleasePlan({ headSha, mode }),
  })
}

export function evaluateProbeEvidence({ evidence, startedAt, outboxId, jobId, complete }) {
  const state = advanceProbeTimerEvidence({}, evidence, { startedAt, outboxId, jobId })
  return { ...state, complete: complete === true, passed: state.probeOutboxSeen && state.probeV2JobSeen && complete === true }
}
