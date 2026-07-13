import assert from 'node:assert/strict'
import test from 'node:test'

import { createTimerProbeDeadline, resolveTimerProbeTimeoutMs } from './post-rag-timer-probe-policy.mjs'

test('timer probe default covers bounded post-deploy trigger propagation', () => {
  assert.equal(resolveTimerProbeTimeoutMs({}), 12 * 60 * 1000)
  assert.equal(createTimerProbeDeadline(1000, {}), 1000 + 12 * 60 * 1000)
})

test('timer probe timeout override stays within safe release bounds', () => {
  assert.equal(resolveTimerProbeTimeoutMs({ HH_POST_RAG_TIMER_PROBE_TIMEOUT_MS: '600000' }), 600000)
  assert.throws(() => resolveTimerProbeTimeoutMs({ HH_POST_RAG_TIMER_PROBE_TIMEOUT_MS: '299999' }), /between/i)
  assert.throws(() => resolveTimerProbeTimeoutMs({ HH_POST_RAG_TIMER_PROBE_TIMEOUT_MS: '1200001' }), /between/i)
})
