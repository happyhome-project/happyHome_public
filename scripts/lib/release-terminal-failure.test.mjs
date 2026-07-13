import assert from 'node:assert/strict'
import test from 'node:test'

import { createSafeReleaseError } from './release-failure-safety.mjs'
import { persistFormalReleaseFailure } from './release-terminal-failure.mjs'

test('production guard failure terminalization runs before local ledger writes and survives local disk failure', async () => {
  const calls = []
  const error = createSafeReleaseError('post RAG timer create failed', {
    branch: 'timer', phase: 'create', action: 'post.ragTimerProbeCreateAdmin', code: 'REMOTE_CALL_FAILED', classification: 'remote-call-failed', cleanup: false,
  })
  const result = await persistFormalReleaseFailure({
    error,
    guardAcquired: true,
    guard: { finished: false, async fail(_error, evidence) { calls.push(['guard', evidence]) } },
    ledger: {
      runId: 'run',
      async appendEvent() { calls.push(['append']); throw new Error('disk failed') },
      async complete(status) { calls.push(['complete', status]) },
    },
  })
  assert.equal(calls[0][0], 'guard')
  assert.deepEqual(calls[0][1].failureCauses, error.result.failureCauses)
  assert.deepEqual(calls.slice(1), [['append'], ['complete', 'failed']])
  assert.equal(result.persistenceErrors.length, 1)
})
