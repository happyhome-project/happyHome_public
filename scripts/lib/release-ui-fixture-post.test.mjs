import assert from 'node:assert/strict'
import test from 'node:test'

import { createReleaseFixturePostWithRetry } from './release-ui-fixture-post.mjs'

test('retries a transient TransactionBusy fixture post creation', async () => {
  let calls = 0
  const result = await createReleaseFixturePostWithRetry({
    create: async () => {
      calls += 1
      if (calls === 1) throw new Error('[ResourceUnavailable.TransactionBusy] Transaction is busy')
      return { postId: 'post-1' }
    },
    retryDelayMs: 0,
  })

  assert.equal(calls, 2)
  assert.deepEqual(result, { postId: 'post-1' })
})

test('does not retry permanent fixture post creation failures', async () => {
  let calls = 0
  await assert.rejects(
    () => createReleaseFixturePostWithRetry({
      create: async () => {
        calls += 1
        throw new Error('permission denied')
      },
      retryDelayMs: 0,
    }),
    /permission denied/,
  )
  assert.equal(calls, 1)
})

test('bounds repeated transient fixture post creation failures', async () => {
  let calls = 0
  await assert.rejects(
    () => createReleaseFixturePostWithRetry({
      create: async () => {
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
