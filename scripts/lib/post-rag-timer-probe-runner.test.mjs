import assert from 'node:assert/strict'
import test from 'node:test'

import { runPostRagTimerProbe, startPostRagTimerProbeSession } from './post-rag-timer-probe-runner.mjs'

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
      if (action === 'post.ragTimerProbeCleanupAdmin') return { functionResult: { cleaned: true } }
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

test('aborting a timer wait stops polling and run wrapper still cleans the fixture exactly once', async () => {
  const events = []
  const controller = new AbortController()
  const deps = fakeDeps(events, {
    invoke: async (action) => {
      events.push(action)
      if (action === 'post.ragTimerProbeCreateAdmin') return { functionResult: { runId: 'run', communityId: 'c', sectionId: 's', postId: 'p', outboxId: 'o' } }
      if (action === 'post.ragTimerProbeCleanupAdmin') return { functionResult: { cleaned: true } }
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
  }), /parallel cloud failed|aborted/i)
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
    assert.match(error.errors.map((item) => item.message).join('\n'), /bounded deadline/)
    assert.match(error.errors.map((item) => item.message).join('\n'), /cleanup failed/)
    return true
  })
})

test('an incomplete create response still attempts cleanup for the committed partial fixture', async () => {
  const events = []
  const deps = fakeDeps(events, {
    invoke: async (action) => {
      events.push(action)
      if (action === 'post.ragTimerProbeCreateAdmin') return { functionResult: { runId: 'run', communityId: 'c', sectionId: 's', postId: 'p' } }
      if (action === 'post.ragTimerProbeCleanupAdmin') return { functionResult: { cleaned: true } }
      throw new Error(`unexpected ${action}`)
    },
  })
  await assert.rejects(() => startPostRagTimerProbeSession({
    env: { ADMIN_INTERNAL_CALL_TOKEN: 'token', HH_RELEASE_RUN_ID: 'run' }, deps,
  }), /identity is incomplete/i)
  assert.deepEqual(events, ['post.ragTimerProbeCreateAdmin', 'post.ragTimerProbeCleanupAdmin'])
})

test('a create transport failure still attempts run-bound cleanup for a remotely committed fixture', async () => {
  const events = []
  const deps = fakeDeps(events, {
    invoke: async (action, params) => {
      events.push(`${action}:${params.runId}`)
      if (action === 'post.ragTimerProbeCreateAdmin') throw new Error('create response lost')
      if (action === 'post.ragTimerProbeCleanupAdmin') return { functionResult: { cleaned: true } }
      throw new Error(`unexpected ${action}`)
    },
  })
  await assert.rejects(() => startPostRagTimerProbeSession({
    env: { ADMIN_INTERNAL_CALL_TOKEN: 'token', HH_RELEASE_RUN_ID: 'run' }, deps,
  }), /create response lost/)
  assert.deepEqual(events, ['post.ragTimerProbeCreateAdmin:run', 'post.ragTimerProbeCleanupAdmin:run'])
})

test('null or missing-runId create results always use the requested runId for ambiguous cleanup', async () => {
  for (const functionResult of [null, { communityId: 'c', sectionId: 's', postId: 'p' }]) {
    const cleanupRunIds = []
    const deps = fakeDeps([], {
      invoke: async (action, params) => {
        if (action === 'post.ragTimerProbeCreateAdmin') return { functionResult }
        if (action === 'post.ragTimerProbeCleanupAdmin') { cleanupRunIds.push(params.runId); return { functionResult: { cleaned: true } } }
        throw new Error(`unexpected ${action}`)
      },
    })
    await assert.rejects(() => startPostRagTimerProbeSession({
      env: { ADMIN_INTERNAL_CALL_TOKEN: 'token', HH_RELEASE_RUN_ID: 'requested-run' }, deps,
    }), /identity is incomplete/i)
    assert.deepEqual(cleanupRunIds, ['requested-run'])
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
