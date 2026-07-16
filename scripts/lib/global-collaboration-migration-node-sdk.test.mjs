import assert from 'node:assert/strict'
import test from 'node:test'

import {
  readOutboxedPostTransactionState,
  runTransactionWithBusyRetry,
} from './global-collaboration-migration-node-sdk.mjs'

test('reads post, version, and outbox sequentially inside one CloudBase transaction', async () => {
  let activeReads = 0
  let maxActiveReads = 0
  const values = {
    'posts/post-1': { _id: 'post-1' },
    'rag_community_versions/community-1': { _id: 'community-1' },
    'post_rag_outbox/outbox-1': { _id: 'outbox-1' },
  }
  const transaction = {
    collection(collection) {
      return { doc(id) { return { async get() {
        activeReads += 1
        maxActiveReads = Math.max(maxActiveReads, activeReads)
        await new Promise((resolve) => setTimeout(resolve, 1))
        activeReads -= 1
        return { data: [values[`${collection}/${id}`]] }
      } } } }
    },
  }

  const state = await readOutboxedPostTransactionState(transaction, {
    postId: 'post-1',
    versionId: 'community-1',
    outboxId: 'outbox-1',
  })

  assert.deepEqual(state, {
    currentPost: values['posts/post-1'],
    currentVersion: values['rag_community_versions/community-1'],
    currentOutbox: values['post_rag_outbox/outbox-1'],
  })
  assert.equal(maxActiveReads, 1)
})

test('retries transient CloudBase TransactionBusy failures with bounded backoff', async () => {
  let attempts = 0
  const delays = []
  const database = {
    async runTransaction(callback) {
      attempts += 1
      if (attempts < 3) throw new Error('[ResourceUnavailable.TransactionBusy] Transaction is busy')
      return callback({})
    },
  }

  const result = await runTransactionWithBusyRetry(database, async () => 'applied', {
    attempts: 4,
    sleep: async (ms) => delays.push(ms),
  })

  assert.equal(result, 'applied')
  assert.equal(attempts, 3)
  assert.deepEqual(delays, [250, 500])
})

test('does not retry non-transient transaction failures', async () => {
  let attempts = 0
  const database = { async runTransaction() { attempts += 1; throw new Error('document contract mismatch') } }

  await assert.rejects(
    () => runTransactionWithBusyRetry(database, async () => 'never', { attempts: 4, sleep: async () => {} }),
    /contract mismatch/,
  )
  assert.equal(attempts, 1)
})

test('does not retry a generic DATABASE_TRANSACTION_FAIL without a busy signal', async () => {
  let attempts = 0
  const database = { async runTransaction() { attempts += 1; throw new Error('DATABASE_TRANSACTION_FAIL') } }

  await assert.rejects(
    () => runTransactionWithBusyRetry(database, async () => 'never', { attempts: 4, sleep: async () => {} }),
    /DATABASE_TRANSACTION_FAIL/,
  )
  assert.equal(attempts, 1)
})

test('stops after the configured TransactionBusy attempt limit', async () => {
  let attempts = 0
  const database = { async runTransaction() { attempts += 1; throw new Error('[ResourceUnavailable.TransactionBusy] Transaction is busy') } }

  await assert.rejects(
    () => runTransactionWithBusyRetry(database, async () => 'never', { attempts: 3, sleep: async () => {} }),
    /TransactionBusy/,
  )
  assert.equal(attempts, 3)
})
