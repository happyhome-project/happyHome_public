import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runPostRagTimerProbe, startPostRagTimerProbeSession } from './post-rag-timer-probe-runner.mjs'
import { createReleaseRunLedger } from './release-run-ledger.mjs'
import { InMemoryReleaseStore, ReleaseGovernance } from './release-governance.mjs'

function fakeDeps(events, overrides = {}) {
  let nowMs = 1_000_000
  return {
    now: () => nowMs,
    invoke: async (action) => {
      events.push(action)
      if (action === 'post.ragTimerProbeCreateAdmin') return { functionResult: { runId: 'run', communityId: 'c', sectionId: 's', postId: 'p', outboxId: 'o' } }
      if (action === 'post.ragTimerEvidenceAdmin') return { functionResult: { evidence: {
        source: 'timer', triggerName: 'post-rag-worker-every-minute', invokedAt: new Date(nowMs + 1).toISOString(),
        outboxIds: ['o'], v2JobIds: ['j'], v2Attempted: true, v2Succeeded: true, v2CompletedCount: 1,
      } } }
      if (action === 'post.ragTimerProbeStatusAdmin') return { functionResult: { complete: true, job: { _id: 'j' } } }
      if (action === 'post.ragTimerProbeCleanupAdmin') return { functionResult: { success: true, pending: false, status: 'cleaned' } }
      throw new Error(`unexpected ${action}`)
    },
    sleep: async (ms, signal) => {
      if (signal?.aborted) throw signal.reason || new Error('aborted')
      events.push(`sleep:${ms}`)
      nowMs += ms
    },
    writeEvidence: async (output) => { events.push('write'); return { ...output, evidencePath: 'evidence.json' } },
    ...overrides,
  }
}

test('timer session returns only after its unique fixture is ready and defaults to a 12 minute bound', async () => {
  const events = []
  const session = await startPostRagTimerProbeSession({
    env: { ADMIN_INTERNAL_CALL_TOKEN: 'token', HH_RELEASE_RUN_ID: 'run' },
    deps: fakeDeps(events),
  })
  assert.deepEqual(events, ['post.ragTimerProbeCreateAdmin'])
  assert.equal(session.deadlineMs - session.startedAtMs, 12 * 60 * 1000)
  await session.cleanup()
})

test('timer wait succeeds immediately when the first authenticated observation is complete', async () => {
  const events = []
  const session = await startPostRagTimerProbeSession({ env: { ADMIN_INTERNAL_CALL_TOKEN: 'token', HH_RELEASE_RUN_ID: 'run' }, deps: fakeDeps(events) })
  const evidence = await session.wait()
  await session.cleanup()
  await session.cleanup()
  assert.equal(evidence.complete, true)
  assert.equal(evidence.evidencePath, 'evidence.json')
  assert.equal(events.some((event) => event.startsWith('sleep:')), false)
  assert.equal(events.filter((event) => event === 'post.ragTimerProbeCleanupAdmin').length, 1)
})

test('cleanup polls its bound fixture until the server reports cleaned', async () => {
  const events = []
  const cleanupResults = [
    { functionResult: { success: false, pending: true, status: 'cleaning' } },
    { functionResult: { success: false, pending: true, status: 'finalizing' } },
    { functionResult: { success: true, pending: false, status: 'cleaned' } },
  ]
  const base = fakeDeps(events)
  const session = await startPostRagTimerProbeSession({
    env: { ADMIN_INTERNAL_CALL_TOKEN: 'token', HH_RELEASE_RUN_ID: 'run' },
    deps: {
      ...base,
      invoke: async (action, params, options, runner) => {
        if (action === 'post.ragTimerProbeCleanupAdmin') {
          events.push(`${action}:${params.runId}:${params.postId}`)
          return cleanupResults.shift()
        }
        return base.invoke(action, params, options, runner)
      },
    },
  })

  const result = await session.cleanup()

  assert.deepEqual(result, { functionResult: { success: true, pending: false, status: 'cleaned' } })
  assert.equal(events.filter((event) => event === 'post.ragTimerProbeCleanupAdmin:run:p').length, 3)
  assert.deepEqual(events.filter((event) => event.startsWith('sleep:')), ['sleep:5000', 'sleep:5000'])
})

test('cleanup caps every admin call to its remaining hard budget and disables inner retries', async () => {
  const cleanupOptions = []
  let cleanupCalls = 0
  let nowMs = 0
  const base = fakeDeps([])
  const session = await startPostRagTimerProbeSession({
    env: { ADMIN_INTERNAL_CALL_TOKEN: 'token', HH_RELEASE_RUN_ID: 'run' },
    deps: {
      ...base,
      now: () => nowMs,
      sleep: async () => { nowMs = 299_000 },
      invoke: async (action, params, options, runner) => {
        if (action === 'post.ragTimerProbeCleanupAdmin') {
          cleanupOptions.push(options)
          cleanupCalls += 1
          return cleanupCalls === 1
            ? { functionResult: { success: false, pending: true, status: 'cleaning' } }
            : { functionResult: { success: true, pending: false, status: 'cleaned' } }
        }
        return base.invoke(action, params, options, runner)
      },
    },
  })

  await session.cleanup()

  assert.deepEqual(cleanupOptions.map(({ commandTimeoutMs, adminInvokeRetries }) => ({ commandTimeoutMs, adminInvokeRetries })), [
    { commandTimeoutMs: 180_000, adminInvokeRetries: 1 },
    { commandTimeoutMs: 1_000, adminInvokeRetries: 1 },
  ])
})

test('cleanup classifies an invoke that consumes its remaining budget as timeout', async () => {
  let nowMs = 0
  const base = fakeDeps([])
  const session = await startPostRagTimerProbeSession({
    env: { ADMIN_INTERNAL_CALL_TOKEN: 'token', HH_RELEASE_RUN_ID: 'run' },
    deps: {
      ...base,
      now: () => nowMs,
      beforeCleanup: async () => { nowMs = 120_000 },
      invoke: async (action, params, options, runner) => {
        if (action === 'post.ragTimerProbeCleanupAdmin') {
          nowMs += options.commandTimeoutMs
          throw new Error('admin invoke timed out')
        }
        return base.invoke(action, params, options, runner)
      },
    },
  })

  await assert.rejects(() => session.cleanup(), (error) => {
    assert.deepEqual(error.result.failureCauses, [{
      branch: 'timer', phase: 'cleanup', action: 'unknown', code: 'TIMEOUT', classification: 'timeout', cleanup: true,
    }])
    return true
  })
  assert.equal(nowMs, 300_000)
})

test('cleanup uses an independent five minute budget and safely times out while pending', async () => {
  const events = []
  let nowMs = 0
  const base = fakeDeps(events)
  const session = await startPostRagTimerProbeSession({
    env: { ADMIN_INTERNAL_CALL_TOKEN: 'token', HH_RELEASE_RUN_ID: 'run', HH_POST_RAG_TIMER_PROBE_TIMEOUT_MS: '300000' },
    deps: {
      ...base,
      now: () => nowMs,
      sleep: async (ms, signal) => {
        assert(ms >= 0)
        if (signal?.aborted) throw signal.reason || new Error('aborted')
        events.push(`sleep:${ms}`)
        nowMs += ms
      },
      invoke: async (action, params, options, runner) => {
        if (action === 'post.ragTimerProbeCleanupAdmin') {
          events.push(action)
          return { functionResult: { success: false, pending: true, status: 'cleaning' } }
        }
        return base.invoke(action, params, options, runner)
      },
    },
  })

  nowMs = 400_000
  await assert.rejects(() => session.cleanup(), (error) => {
    assert.deepEqual(error.result.failureCauses, [{
      branch: 'timer', phase: 'cleanup', action: 'unknown', code: 'TIMEOUT', classification: 'timeout', cleanup: true,
    }])
    return true
  })
  assert.equal(nowMs, 700_000)
  assert.equal(events.filter((event) => event === 'post.ragTimerProbeCleanupAdmin').length, 60)
  assert.equal(events.filter((event) => event.startsWith('sleep:')).length, 60)
  assert.equal(events.some((event) => event === 'sleep:-1'), false)
})

test('cleanup rejects a non-pending response that is not explicitly cleaned', async () => {
  const events = []
  const base = fakeDeps(events)
  const session = await startPostRagTimerProbeSession({
    env: { ADMIN_INTERNAL_CALL_TOKEN: 'token', HH_RELEASE_RUN_ID: 'run' },
    deps: {
      ...base,
      invoke: async (action, params, options, runner) => {
        if (action === 'post.ragTimerProbeCleanupAdmin') return { functionResult: { success: true, status: 'cleaning' } }
        return base.invoke(action, params, options, runner)
      },
    },
  })

  await assert.rejects(() => session.cleanup(), (error) => {
    assert.deepEqual(error.result.failureCauses, [{
      branch: 'timer', phase: 'cleanup', action: 'unknown', code: 'INVALID_RESPONSE', classification: 'invalid-response', cleanup: true,
    }])
    return true
  })
})

test('aborting a timer wait stops polling and run wrapper still cleans the fixture exactly once', async () => {
  const events = []
  const controller = new AbortController()
  const deps = fakeDeps(events, {
    invoke: async (action) => {
      events.push(action)
      if (action === 'post.ragTimerProbeCreateAdmin') return { functionResult: { runId: 'run', communityId: 'c', sectionId: 's', postId: 'p', outboxId: 'o' } }
      if (action === 'post.ragTimerProbeCleanupAdmin') return { functionResult: { success: true, pending: false, status: 'cleaned' } }
      if (action === 'post.ragTimerEvidenceAdmin') {
        controller.abort(new Error('parallel cloud failed'))
        return { functionResult: { evidence: null } }
      }
      if (action === 'post.ragTimerProbeStatusAdmin') return { functionResult: { complete: false } }
      throw new Error(`unexpected ${action}`)
    },
  })
  await assert.rejects(() => runPostRagTimerProbe({
    env: { ADMIN_INTERNAL_CALL_TOKEN: 'token', HH_RELEASE_RUN_ID: 'run' }, signal: controller.signal, deps,
  }), (error) => {
    assert.match(error.message, /post RAG timer wait failed/i)
    assert.deepEqual(error.result.failureCauses, [{ branch: 'timer', phase: 'wait', action: 'unknown', code: 'ABORTED', classification: 'aborted', cleanup: false }])
    return true
  })
  assert.equal(events.filter((event) => event === 'post.ragTimerProbeCleanupAdmin').length, 1)
  assert.equal(events.some((event) => event.startsWith('sleep:')), false)
})

test('timer deadline failure retains cleanup failure instead of losing fixture cleanup evidence', async () => {
  const events = []
  let nowMs = 0
  const deps = fakeDeps(events, {
    now: () => nowMs,
    sleep: async (ms) => { nowMs += ms },
    invoke: async (action) => {
      events.push(action)
      if (action === 'post.ragTimerProbeCreateAdmin') return { functionResult: { runId: 'run', communityId: 'c', sectionId: 's', postId: 'p', outboxId: 'o' } }
      if (action === 'post.ragTimerEvidenceAdmin') return { functionResult: { evidence: null } }
      if (action === 'post.ragTimerProbeStatusAdmin') return { functionResult: { complete: false } }
      if (action === 'post.ragTimerProbeCleanupAdmin') throw new Error('cleanup failed')
      throw new Error(`unexpected ${action}`)
    },
  })
  await assert.rejects(() => runPostRagTimerProbe({
    env: { ADMIN_INTERNAL_CALL_TOKEN: 'token', HH_RELEASE_RUN_ID: 'run', HH_POST_RAG_TIMER_PROBE_TIMEOUT_MS: '300000' }, deps,
  }), (error) => {
    assert(error instanceof AggregateError)
    assert.deepEqual(error.result.failureCauses, [
      { branch: 'timer', phase: 'wait', action: 'unknown', code: 'TIMEOUT', classification: 'timeout', cleanup: false },
      { branch: 'timer', phase: 'cleanup', action: 'post.ragTimerProbeCleanupAdmin', code: 'REMOTE_CALL_FAILED', classification: 'remote-call-failed', cleanup: true },
    ])
    return true
  })
})

test('an incomplete create response polls cleanup using every available binding field', async () => {
  const events = []
  const cleanupResults = [
    { functionResult: { success: false, pending: true, status: 'cleaning' } },
    { functionResult: { success: true, pending: false, status: 'cleaned' } },
  ]
  const deps = fakeDeps(events, {
    invoke: async (action, params) => {
      events.push({ action, params })
      if (action === 'post.ragTimerProbeCreateAdmin') return { functionResult: { runId: 'run', communityId: 'c', sectionId: 's', postId: 'p' } }
      if (action === 'post.ragTimerProbeCleanupAdmin') return cleanupResults.shift()
      throw new Error(`unexpected ${action}`)
    },
  })
  await assert.rejects(() => startPostRagTimerProbeSession({
    env: { ADMIN_INTERNAL_CALL_TOKEN: 'token', HH_RELEASE_RUN_ID: 'run' }, deps,
  }), /post RAG timer create failed/i)
  assert.deepEqual(events.filter(({ action }) => action === 'post.ragTimerProbeCleanupAdmin').map(({ params }) => params), [
    { runId: 'run', communityId: 'c', sectionId: 's', postId: 'p' },
    { runId: 'run', communityId: 'c', sectionId: 's', postId: 'p' },
  ])
})

test('a create transport failure polls run-bound cleanup for a remotely committed fixture', async () => {
  const events = []
  const cleanupResults = [
    { functionResult: { success: false, pending: true, status: 'cleaning' } },
    { functionResult: { success: true, pending: false, status: 'cleaned' } },
  ]
  const deps = fakeDeps(events, {
    invoke: async (action, params) => {
      events.push(`${action}:${params.runId}`)
      if (action === 'post.ragTimerProbeCreateAdmin') throw new Error('create response lost')
      if (action === 'post.ragTimerProbeCleanupAdmin') return cleanupResults.shift()
      throw new Error(`unexpected ${action}`)
    },
  })
  await assert.rejects(() => startPostRagTimerProbeSession({
    env: { ADMIN_INTERNAL_CALL_TOKEN: 'token', HH_RELEASE_RUN_ID: 'run' }, deps,
  }), /post RAG timer create failed/i)
  assert.deepEqual(events.filter((event) => event.startsWith('post.ragTimer')), [
    'post.ragTimerProbeCreateAdmin:run',
    'post.ragTimerProbeCleanupAdmin:run',
    'post.ragTimerProbeCleanupAdmin:run',
  ])
})

test('a create failure aggregates an invalid cleanup response without losing either cause', async () => {
  const deps = fakeDeps([], {
    invoke: async (action) => {
      if (action === 'post.ragTimerProbeCreateAdmin') throw new Error('create response lost')
      if (action === 'post.ragTimerProbeCleanupAdmin') return { functionResult: { success: false, pending: false, status: 'cleaning' } }
      throw new Error(`unexpected ${action}`)
    },
  })

  await assert.rejects(() => startPostRagTimerProbeSession({
    env: { ADMIN_INTERNAL_CALL_TOKEN: 'token', HH_RELEASE_RUN_ID: 'run' }, deps,
  }), (error) => {
    assert(error instanceof AggregateError)
    assert.deepEqual(error.result.failureCauses, [
      { branch: 'timer', phase: 'create', action: 'post.ragTimerProbeCreateAdmin', code: 'REMOTE_CALL_FAILED', classification: 'remote-call-failed', cleanup: false },
      { branch: 'timer', phase: 'cleanup', action: 'unknown', code: 'INVALID_RESPONSE', classification: 'invalid-response', cleanup: true },
    ])
    return true
  })
})

test('a create failure aggregates cleanup timeout without losing either cause', async () => {
  let nowMs = 0
  const deps = fakeDeps([], {
    now: () => nowMs,
    sleep: async (ms) => { nowMs += ms },
    invoke: async (action) => {
      if (action === 'post.ragTimerProbeCreateAdmin') throw new Error('create response lost')
      if (action === 'post.ragTimerProbeCleanupAdmin') return { functionResult: { success: false, pending: true, status: 'cleaning' } }
      throw new Error(`unexpected ${action}`)
    },
  })

  await assert.rejects(() => startPostRagTimerProbeSession({
    env: { ADMIN_INTERNAL_CALL_TOKEN: 'token', HH_RELEASE_RUN_ID: 'run' }, deps,
  }), (error) => {
    assert(error instanceof AggregateError)
    assert.deepEqual(error.result.failureCauses, [
      { branch: 'timer', phase: 'create', action: 'post.ragTimerProbeCreateAdmin', code: 'REMOTE_CALL_FAILED', classification: 'remote-call-failed', cleanup: false },
      { branch: 'timer', phase: 'cleanup', action: 'unknown', code: 'TIMEOUT', classification: 'timeout', cleanup: true },
    ])
    return true
  })
  assert.equal(nowMs, 5 * 60 * 1000)
})

test('null or missing-runId create results always use the requested runId for ambiguous cleanup', async () => {
  for (const functionResult of [null, { communityId: 'c', sectionId: 's', postId: 'p' }]) {
    const cleanupRunIds = []
    const deps = fakeDeps([], {
      invoke: async (action, params) => {
        if (action === 'post.ragTimerProbeCreateAdmin') return { functionResult }
        if (action === 'post.ragTimerProbeCleanupAdmin') { cleanupRunIds.push(params.runId); return { functionResult: { success: true, pending: false, status: 'cleaned' } } }
        throw new Error(`unexpected ${action}`)
      },
    })
    await assert.rejects(() => startPostRagTimerProbeSession({
      env: { ADMIN_INTERNAL_CALL_TOKEN: 'token', HH_RELEASE_RUN_ID: 'requested-run' }, deps,
    }), /post RAG timer create failed/i)
    assert.deepEqual(cleanupRunIds, ['requested-run'])
  }
})

test('invalid create response never trusts a mismatched response runId or a partial identity tuple', async () => {
  const invalidResults = [
    { runId: 'wrong-run', communityId: 'c', sectionId: 's', postId: 'p' },
    { runId: 'requested-run', communityId: 'c', sectionId: 's' },
  ]
  for (const functionResult of invalidResults) {
    const cleanupParams = []
    const deps = fakeDeps([], {
      invoke: async (action, params) => {
        if (action === 'post.ragTimerProbeCreateAdmin') return { functionResult }
        if (action === 'post.ragTimerProbeCleanupAdmin') {
          cleanupParams.push(params)
          return { functionResult: { success: true, pending: false, status: 'cleaned' } }
        }
        throw new Error(`unexpected ${action}`)
      },
    })

    await assert.rejects(() => startPostRagTimerProbeSession({
      env: { ADMIN_INTERNAL_CALL_TOKEN: 'token', HH_RELEASE_RUN_ID: 'requested-run' }, deps,
    }), /post RAG timer create failed/i)
    assert.deepEqual(cleanupParams, [{ runId: 'requested-run' }])
  }
})

test('ordinary timer observations use local fences while cleanup uses its drift-tolerant cleanup fence', async () => {
  const events = []
  const base = fakeDeps(events)
  const session = await startPostRagTimerProbeSession({
    env: { ADMIN_INTERNAL_CALL_TOKEN: 'token', HH_RELEASE_RUN_ID: 'run' },
    deps: {
      ...base,
      beforeInvoke: async (action) => events.push(`local:${action}`),
      beforeCleanup: async () => events.push('cleanup-fence'),
    },
  })
  await session.wait()
  await session.cleanup()
  for (const event of ['local:post.ragTimerEvidenceAdmin', 'local:post.ragTimerProbeStatusAdmin', 'cleanup-fence']) {
    assert.notEqual(events.indexOf(event), -1, `missing ${event}`)
  }
  assert(events.indexOf('local:post.ragTimerEvidenceAdmin') < events.indexOf('post.ragTimerEvidenceAdmin'))
  assert(events.indexOf('local:post.ragTimerProbeStatusAdmin') < events.indexOf('post.ragTimerProbeStatusAdmin'))
  assert(events.indexOf('cleanup-fence') < events.indexOf('post.ragTimerProbeCleanupAdmin'))
})

test('create errors echoing the admin token are sanitized before error ledger and governance persistence', async () => {
  const token = 'timer-secret-token-value'
  const deps = fakeDeps([], {
    invoke: async (action) => {
      if (action === 'post.ragTimerProbeCreateAdmin') throw new Error(`runner stdout ADMIN_INTERNAL_CALL_TOKEN=${token}`)
      if (action === 'post.ragTimerProbeCleanupAdmin') return { functionResult: { success: true, pending: false, status: 'cleaned' } }
      throw new Error(`unexpected ${action}`)
    },
  })
  let safeError
  await assert.rejects(() => startPostRagTimerProbeSession({
    env: { ADMIN_INTERNAL_CALL_TOKEN: token, HH_RELEASE_RUN_ID: 'safe-run' }, deps,
  }), (error) => { safeError = error; return true })
  assert.doesNotMatch(JSON.stringify({ message: safeError.message, stack: safeError.stack, result: safeError.result }), new RegExp(token))
  assert.deepEqual(safeError.result.failureCauses, [{ branch: 'timer', phase: 'create', action: 'post.ragTimerProbeCreateAdmin', code: 'REMOTE_CALL_FAILED', classification: 'remote-call-failed', cleanup: false }])

  const root = await mkdtemp(join(tmpdir(), 'happyhome-safe-error-'))
  try {
    const ledger = await createReleaseRunLedger({ root, runId: 'safe-run', gitSha: 'abc', version: '1', desc: 'd', envId: 'env' })
    await ledger.failStage('post-rag-timer-probe', safeError, { result: safeError.result })
    const persistedLedger = await readFile(ledger.runPath, 'utf8')
    assert.doesNotMatch(persistedLedger, new RegExp(token))

    const governance = new ReleaseGovernance({ store: new InMemoryReleaseStore(), now: () => 1000 })
    const lock = await governance.acquire({ gitSha: 'abc', owner: 'unit', runId: 'safe-run' })
    await governance.fail(lock, safeError, { failureCauses: safeError.result.failureCauses })
    const persistedGovernance = JSON.stringify(await governance.inspect({ runId: 'safe-run' }))
    assert.doesNotMatch(persistedGovernance, new RegExp(token))
    assert.match(persistedGovernance, /REMOTE_CALL_FAILED/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
