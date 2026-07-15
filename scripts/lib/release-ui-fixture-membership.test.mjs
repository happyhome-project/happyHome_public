import assert from 'node:assert/strict'
import test from 'node:test'

import { applyReleaseFixtureMembership } from './release-ui-fixture-membership.mjs'

test('retries a transient TransactionBusy membership apply', async () => {
  let calls = 0
  const result = await applyReleaseFixtureMembership({
    apply: async () => {
      calls += 1
      if (calls === 1) throw new Error('[ResourceUnavailable.TransactionBusy] Transaction is busy')
      return { status: 'active', alreadyApplied: true }
    },
    retryDelayMs: 0,
  })

  assert.equal(calls, 2)
  assert.deepEqual(result, { status: 'active', alreadyApplied: true })
})

test('does not retry a permanent membership error', async () => {
  let calls = 0
  await assert.rejects(
    () => applyReleaseFixtureMembership({
      apply: async () => {
        calls += 1
        throw new Error('community disabled')
      },
      retryDelayMs: 0,
    }),
    /community disabled/,
  )
  assert.equal(calls, 1)
})

test('bounds repeated transient membership failures', async () => {
  let calls = 0
  await assert.rejects(
    () => applyReleaseFixtureMembership({
      apply: async () => {
        calls += 1
        throw new Error('DATABASE_TRANSACTION_FAIL')
      },
      attempts: 3,
      retryDelayMs: 0,
    }),
    /DATABASE_TRANSACTION_FAIL/,
  )
  assert.equal(calls, 3)
})
