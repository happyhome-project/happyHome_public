const REQUIRED_NODES = [
  'preflight', 'configureRag', 'deployRag', 'startTimer', 'waitTimer', 'cleanupTimer',
  'deployRemainingCloud', 'runBasicCloudSmoke', 'runBackfill', 'runSemanticGates',
  'publishAdmin', 'publishMiniprogram',
]
import { createSafeAggregateError, releaseFailureCauses } from './release-failure-safety.mjs'

export function isReleaseDagV2Enabled(env = process.env) {
  return String(env.HH_RELEASE_DAG_V2 ?? '1').trim() !== '0'
}

export function releaseDagMode(env = process.env) {
  return isReleaseDagV2Enabled(env) ? 'v2' : 'legacy'
}

export function partitionReleaseCloudFunctions(functions = []) {
  const unique = [...new Set(functions)].sort()
  const bootstrapNames = new Set(['admin', 'post-rag-worker'])
  return {
    ragBootstrap: unique.filter((name) => bootstrapNames.has(name)),
    remaining: unique.filter((name) => !bootstrapNames.has(name)),
  }
}

export function assertRagBootstrapVerified(required = [], verified = []) {
  const proof = new Set(verified)
  for (const functionName of required) {
    if (!proof.has(functionName)) throw new Error(`${functionName} must be fresh verified before timer fixture creation`)
  }
}

function assertDagDependencies(deps) {
  for (const name of REQUIRED_NODES) {
    if (typeof deps?.[name] !== 'function') throw new Error(`release DAG V2 requires ${name}()`)
  }
}

function flattenErrors(error) {
  return error instanceof AggregateError ? error.errors.flatMap(flattenErrors) : [error]
}

function parallelFailure(settled) {
  const causes = []
  for (const [index, item] of settled.entries()) {
    if (item.status !== 'rejected') continue
    const branch = index === 0 ? 'timer' : 'cloud'
    const errors = flattenErrors(item.reason)
    for (let errorIndex = 0; errorIndex < errors.length; errorIndex += 1) {
      const error = errors[errorIndex]
      const fallbackPhase = branch === 'timer' && errorIndex > 0 ? 'cleanup' : (branch === 'timer' ? 'wait' : 'parallel')
      causes.push(...releaseFailureCauses(error, {
        branch,
        phase: fallbackPhase,
        cleanup: branch === 'timer' && errorIndex > 0,
      }))
    }
  }
  return createSafeAggregateError('release DAG V2 parallel phase failed; inspect sanitized ledger evidence', causes)
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw (signal.reason instanceof Error ? signal.reason : new Error('release DAG V2 aborted'))
}

export async function executeReleaseDagV2(deps = {}) {
  assertDagDependencies(deps)
  await deps.preflight()
  await deps.configureRag()
  await deps.deployRag()

  const controller = new AbortController()
  const timerSession = await deps.startTimer({ signal: controller.signal })
  const timerBranch = (async () => {
    let primaryError = null
    try {
      return await deps.waitTimer(timerSession, { signal: controller.signal })
    } catch (error) {
      primaryError = error
      throw error
    } finally {
      try {
        await deps.cleanupTimer(timerSession)
      } catch (cleanupError) {
        if (primaryError) throw new AggregateError([primaryError, cleanupError], 'timer probe and cleanup failed')
        throw cleanupError
      }
    }
  })()
  const cloudBranch = (async () => {
    throwIfAborted(controller.signal)
    const deploy = await deps.deployRemainingCloud({ signal: controller.signal })
    throwIfAborted(controller.signal)
    const smoke = await deps.runBasicCloudSmoke({ signal: controller.signal })
    throwIfAborted(controller.signal)
    return { deploy, smoke }
  })()

  let timerEvidence
  let cloudEvidence
  try {
    ;[timerEvidence, cloudEvidence] = await Promise.all([timerBranch, cloudBranch])
  } catch {
    controller.abort(new Error('release DAG V2 parallel branch failed'))
    const settled = await Promise.allSettled([timerBranch, cloudBranch])
    throw parallelFailure(settled)
  }

  const backfill = await deps.runBackfill({ timerEvidence, cloudEvidence })
  const semantic = await deps.runSemanticGates({ timerEvidence, cloudEvidence, backfill })
  const admin = await deps.publishAdmin({ timerEvidence, cloudEvidence, backfill, semantic })
  const miniprogram = await deps.publishMiniprogram({ timerEvidence, cloudEvidence, backfill, semantic, admin })
  return { timerEvidence, cloudEvidence, backfill, semantic, admin, miniprogram }
}
