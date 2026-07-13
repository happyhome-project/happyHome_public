import fs from 'node:fs/promises'
import path from 'node:path'

import { DEFAULT_ENV_ID, defaultRunner } from '../cloud-release-smoke.mjs'
import { invokeAdmin, parseRebuildArgs } from '../rebuild-post-search-index.mjs'
import { abortableDelay } from './abortable-process.mjs'
import { advanceProbeTimerEvidence } from './post-rag-timer-evidence.mjs'
import { resolveTimerProbeTimeoutMs } from './post-rag-timer-probe-policy.mjs'

function abortError(signal) {
  if (!signal?.aborted) return null
  return signal.reason instanceof Error ? signal.reason : new Error('timer probe aborted')
}

function defaultDependencies() {
  return {
    invoke: invokeAdmin,
    now: () => Date.now(),
    runner: defaultRunner,
    sleep: abortableDelay,
    writeEvidence: async (output) => {
      const evidencePath = path.resolve('.codex-local', 'release-evidence', output.runId, 'post-rag-timer.json')
      await fs.mkdir(path.dirname(evidencePath), { recursive: true })
      await fs.writeFile(evidencePath, JSON.stringify(output, null, 2))
      return { ...output, evidencePath }
    },
  }
}

export async function startPostRagTimerProbeSession({ env = process.env, signal, deps = {} } = {}) {
  const runtime = { ...defaultDependencies(), ...deps }
  const startedAtMs = runtime.now()
  const startedAt = new Date(startedAtMs).toISOString()
  const runId = String(env.HH_RELEASE_RUN_ID || startedAtMs)
  const deadlineMs = startedAtMs + resolveTimerProbeTimeoutMs(env)
  const base = parseRebuildArgs([], env)
  const options = { ...base, envId: env.TCB_ENV || DEFAULT_ENV_ID, commandTimeoutMs: 180000, adminInvokeRetries: 3 }
  if (!options.adminInternalToken) throw new Error('ADMIN_INTERNAL_CALL_TOKEN is required')
  const aborted = abortError(signal)
  if (aborted) throw aborted
  let probe
  try {
    probe = (await runtime.invoke('post.ragTimerProbeCreateAdmin', { runId }, options, runtime.runner)).functionResult
  } catch (createError) {
    try {
      if (typeof runtime.beforeCleanup === 'function') await runtime.beforeCleanup('post.ragTimerProbeCleanupAdmin')
      await runtime.invoke('post.ragTimerProbeCleanupAdmin', { runId }, options, runtime.runner)
    } catch (cleanupError) {
      throw new AggregateError([createError, cleanupError], 'timer fixture create and run-bound cleanup failed')
    }
    throw createError
  }
  if (!probe?.runId || !probe?.communityId || !probe?.sectionId || !probe?.postId || !probe?.outboxId) {
    const identityError = new Error('timer probe fixture identity is incomplete')
    try {
      if (typeof runtime.beforeCleanup === 'function') await runtime.beforeCleanup('post.ragTimerProbeCleanupAdmin')
      await runtime.invoke('post.ragTimerProbeCleanupAdmin', {
        runId: probe?.runId || runId,
        communityId: probe?.communityId,
        sectionId: probe?.sectionId,
        postId: probe?.postId,
      }, options, runtime.runner)
    } catch (cleanupError) {
      throw new AggregateError([identityError, cleanupError], 'incomplete timer fixture cleanup failed')
    }
    throw identityError
  }

  let waitPromise = null
  let cleanupPromise = null
  const bound = {
    runId: probe.runId,
    communityId: probe.communityId,
    sectionId: probe.sectionId,
    postId: probe.postId,
    outboxId: probe.outboxId,
  }

  const wait = () => {
    waitPromise ||= (async () => {
      let evidence = null
      let probeEvidence = { probeOutboxSeen: false, probeV2JobSeen: false }
      while (runtime.now() < deadlineMs) {
        const abort = abortError(signal)
        if (abort) throw abort
        const invokeObserved = async (action, params) => {
          if (typeof runtime.beforeInvoke === 'function') await runtime.beforeInvoke(action)
          return await runtime.invoke(action, params, options, runtime.runner)
        }
        const [evidenceRecord, statusRecord] = await Promise.all([
          invokeObserved('post.ragTimerEvidenceAdmin', { runId: probe.runId }),
          invokeObserved('post.ragTimerProbeStatusAdmin', bound),
        ])
        evidence = evidenceRecord.functionResult?.evidence
        const status = statusRecord.functionResult
        probeEvidence = advanceProbeTimerEvidence(probeEvidence, evidence, {
          startedAt,
          outboxId: probe.outboxId,
          jobId: status?.job?._id,
        })
        if (probeEvidence.probeOutboxSeen && probeEvidence.probeV2JobSeen && status?.complete) {
          return await runtime.writeEvidence({
            schemaVersion: 1,
            runId,
            triggerName: evidence.triggerName,
            postId: probe.postId,
            probeOutboxSeen: true,
            probeV2JobSeen: true,
            complete: true,
          })
        }
        const remainingMs = deadlineMs - runtime.now()
        if (remainingMs > 0) await runtime.sleep(Math.min(5000, remainingMs), signal)
      }
      const abort = abortError(signal)
      if (abort) throw abort
      if (typeof runtime.beforeInvoke === 'function') await runtime.beforeInvoke('post.ragTimerProbeStatusAdmin')
      await runtime.invoke('post.ragTimerProbeStatusAdmin', bound, options, runtime.runner)
      throw new Error('fresh authenticated timer did not complete the unique V2 probe before the bounded deadline')
    })()
    return waitPromise
  }

  const cleanup = () => {
    cleanupPromise ||= (async () => {
      if (typeof runtime.beforeCleanup === 'function') await runtime.beforeCleanup('post.ragTimerProbeCleanupAdmin')
      return await runtime.invoke('post.ragTimerProbeCleanupAdmin', {
        runId: probe.runId,
        communityId: probe.communityId,
        sectionId: probe.sectionId,
        postId: probe.postId,
      }, options, runtime.runner)
    })()
    return cleanupPromise
  }

  return { cleanup, deadlineMs, probe, runId, startedAt, startedAtMs, wait }
}

export async function runPostRagTimerProbe(options = {}) {
  const session = await startPostRagTimerProbeSession(options)
  let primaryError = null
  try {
    return await session.wait()
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    try {
      await session.cleanup()
    } catch (cleanupError) {
      if (primaryError) throw new AggregateError([primaryError, cleanupError], 'timer probe and cleanup failed')
      throw cleanupError
    }
  }
}
