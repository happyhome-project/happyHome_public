import fs from 'node:fs/promises'
import path from 'node:path'

import { DEFAULT_ENV_ID, defaultRunner } from '../cloud-release-smoke.mjs'
import { invokeAdmin, parseRebuildArgs } from '../rebuild-post-search-index.mjs'
import { abortableDelay } from './abortable-process.mjs'
import { advanceProbeTimerEvidence } from './post-rag-timer-evidence.mjs'
import { resolveTimerProbeTimeoutMs } from './post-rag-timer-probe-policy.mjs'
import { createSafeAggregateError, createSafeReleaseError, releaseFailureCauses } from './release-failure-safety.mjs'

const CLEANUP_TIMEOUT_MS = 5 * 60 * 1000
const CLEANUP_POLL_MS = 5000

function safeTimerError({ action = 'unknown', cleanup = false, code = 'REMOTE_CALL_FAILED', classification = 'remote-call-failed', error, phase }) {
  if (error?.result?.failureCauses) {
    return createSafeReleaseError(`post RAG timer ${phase} failed`, releaseFailureCauses(error, { branch: 'timer', phase, cleanup }))
  }
  return createSafeReleaseError(`post RAG timer ${phase} failed`, { branch: 'timer', phase, action, code, classification, cleanup })
}

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
  if (aborted) throw safeTimerError({ error: aborted, phase: 'create', code: 'ABORTED', classification: 'aborted' })
  const invokeSafe = async (action, params, { cleanup = false, invokeOptions = options, phase }) => {
    try {
      return await runtime.invoke(action, params, invokeOptions, runtime.runner)
    } catch (error) {
      throw safeTimerError({ action, cleanup, error, phase })
    }
  }
  const pollCleanup = async (cleanupBinding) => {
    const cleanupDeadlineMs = runtime.now() + CLEANUP_TIMEOUT_MS
    if (typeof runtime.beforeCleanup === 'function') await runtime.beforeCleanup('post.ragTimerProbeCleanupAdmin')
    while (true) {
      const remainingMs = cleanupDeadlineMs - runtime.now()
      if (remainingMs <= 0) {
        throw safeTimerError({ phase: 'cleanup', code: 'TIMEOUT', classification: 'timeout', cleanup: true })
      }
      let response
      try {
        response = await invokeSafe('post.ragTimerProbeCleanupAdmin', cleanupBinding, {
          phase: 'cleanup',
          cleanup: true,
          invokeOptions: {
            ...options,
            commandTimeoutMs: Math.min(options.commandTimeoutMs, remainingMs),
            adminInvokeRetries: 1,
          },
        })
      } catch (error) {
        if (runtime.now() >= cleanupDeadlineMs) {
          throw safeTimerError({ phase: 'cleanup', code: 'TIMEOUT', classification: 'timeout', cleanup: true })
        }
        throw error
      }
      if (response.functionResult?.success === true && response.functionResult?.status === 'cleaned') return response
      if (response.functionResult?.pending !== true) {
        throw safeTimerError({ phase: 'cleanup', code: 'INVALID_RESPONSE', classification: 'invalid-response', cleanup: true })
      }
      const sleepMs = Math.min(CLEANUP_POLL_MS, Math.max(0, cleanupDeadlineMs - runtime.now()))
      if (sleepMs > 0) {
        try {
          await runtime.sleep(sleepMs, signal)
        } catch (error) {
          if (signal?.aborted) throw safeTimerError({ error, phase: 'cleanup', code: 'ABORTED', classification: 'aborted', cleanup: true })
          throw safeTimerError({ error, phase: 'cleanup', cleanup: true })
        }
      }
    }
  }
  let probe
  try {
    probe = (await invokeSafe('post.ragTimerProbeCreateAdmin', { runId }, { phase: 'create' })).functionResult
  } catch (createError) {
    try {
      await pollCleanup({ runId })
    } catch (cleanupError) {
      throw createSafeAggregateError('post RAG timer create and cleanup failed', [
        ...releaseFailureCauses(createError, { branch: 'timer', phase: 'create' }),
        ...releaseFailureCauses(cleanupError, { branch: 'timer', phase: 'cleanup', cleanup: true }),
      ])
    }
    throw createError
  }
  if (probe?.runId !== runId || !probe?.communityId || !probe?.sectionId || !probe?.postId || !probe?.outboxId) {
    const identityError = safeTimerError({ phase: 'create', code: 'INVALID_RESPONSE', classification: 'invalid-response' })
    try {
      const hasTrustedIdentity = probe?.runId === runId && probe?.communityId && probe?.sectionId && probe?.postId
      await pollCleanup({
        runId,
        ...(hasTrustedIdentity ? {
          communityId: probe.communityId,
          sectionId: probe.sectionId,
          postId: probe.postId,
        } : {}),
      })
    } catch (cleanupError) {
      throw createSafeAggregateError('post RAG timer invalid response and cleanup failed', [
        ...releaseFailureCauses(identityError, { branch: 'timer', phase: 'create' }),
        ...releaseFailureCauses(cleanupError, { branch: 'timer', phase: 'cleanup', cleanup: true }),
      ])
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
          return await invokeSafe(action, params, { phase: 'wait' })
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
      await invokeSafe('post.ragTimerProbeStatusAdmin', bound, { phase: 'wait' })
      throw safeTimerError({ phase: 'wait', code: 'TIMEOUT', classification: 'timeout' })
    })().catch((error) => {
      if (!error?.result?.failureCauses && signal?.aborted) {
        throw safeTimerError({ error, phase: 'wait', code: 'ABORTED', classification: 'aborted' })
      }
      throw safeTimerError({ error, phase: 'wait' })
    })
    return waitPromise
  }

  const cleanup = () => {
    cleanupPromise ||= pollCleanup({
      runId: probe.runId,
      communityId: probe.communityId,
      sectionId: probe.sectionId,
      postId: probe.postId,
    })
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
      if (primaryError) throw createSafeAggregateError('post RAG timer wait and cleanup failed', [
        ...releaseFailureCauses(primaryError, { branch: 'timer', phase: 'wait' }),
        ...releaseFailureCauses(cleanupError, { branch: 'timer', phase: 'cleanup', cleanup: true }),
      ])
      throw cleanupError
    }
  }
}
