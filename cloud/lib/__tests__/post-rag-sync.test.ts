import type { DbTransaction } from '../db'

const mockQueryAfterId = jest.fn()
const mockRunTransaction = jest.fn()
jest.mock('../db', () => ({
  queryAfterId: (...args: any[]) => mockQueryAfterId(...args),
  runTransaction: (...args: any[]) => mockRunTransaction(...args),
  transactionGetByIdOrNull: jest.fn(async (transaction, collectionName, id) => {
    const response = await transaction.collection(collectionName).doc(id).get()
    return response.data || null
  }),
}))

import {
  POST_RAG_SYNC_STATE,
  claimPostRagSync,
  completePostRagSync,
  schedulePostRagSyncForCurrentPosts,
  schedulePostRagSyncInTransaction,
} from '../post-rag-sync'

type StoredDocument = Record<string, any>

function createTransaction(initial: Record<string, Record<string, StoredDocument>> = {}) {
  const collections = new Map<string, Map<string, StoredDocument>>()
  for (const [collectionName, documents] of Object.entries(initial)) {
    collections.set(collectionName, new Map(Object.entries(documents).map(([id, value]) => [id, { ...value }])))
  }
  let writes = 0
  const transaction: DbTransaction = {
    collection: (collectionName) => ({
      doc: (id) => ({
        get: async () => ({ data: collections.get(collectionName)?.get(id) || null }),
        set: async ({ data }) => {
          writes += 1
          if (!collections.has(collectionName)) collections.set(collectionName, new Map())
          collections.get(collectionName)!.set(id, { _id: id, ...data })
          return { stats: { updated: 1 } }
        },
        update: async () => ({ stats: { updated: 1 } }),
        remove: async () => ({ stats: { removed: 1 } }),
      }),
      add: async () => ({ _id: 'unused' }),
    }),
  }
  return {
    transaction,
    get: (collectionName: string, id: string) => collections.get(collectionName)?.get(id),
    writes: () => writes,
  }
}

const NOW = '2026-07-19T01:00:00.000Z'
const LATER = '2026-07-19T01:01:00.000Z'

test('a newer schedule replaces the same post state instead of appending history', async () => {
  const store = createTransaction()
  await schedulePostRagSyncInTransaction(store.transaction, {
    postId: 'post-1', communityId: 'community-1', sectionId: 'section-1', reason: 'post.created', now: NOW,
  })
  await schedulePostRagSyncInTransaction(store.transaction, {
    postId: 'post-1', communityId: 'community-1', sectionId: 'section-1', reason: 'post.updated', now: LATER,
  })

  expect(store.get(POST_RAG_SYNC_STATE, 'post-1')).toEqual({
    _id: 'post-1',
    schemaVersion: 1,
    postId: 'post-1',
    communityId: 'community-1',
    sectionId: 'section-1',
    desiredRevision: 2,
    status: 'pending',
    attempts: 0,
    reason: 'post.updated',
    requestedAt: LATER,
    nextAttemptAt: LATER,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    appliedSourceVersion: null,
    indexScope: null,
    lastErrorCode: null,
    createdAt: NOW,
    updatedAt: LATER,
  })
  expect(store.writes()).toBe(2)
})

test('rescheduling a processing record clears stale lease retry and error state', async () => {
  const store = createTransaction({
    [POST_RAG_SYNC_STATE]: {
      'post-1': {
        _id: 'post-1', schemaVersion: 1, postId: 'post-1', communityId: 'community-1', sectionId: 'section-1',
        desiredRevision: 7, status: 'processing', attempts: 4, reason: 'old', requestedAt: NOW,
        nextAttemptAt: '2026-07-20T00:00:00.000Z', leaseOwner: 'worker-1', leaseToken: 'lease-1',
        leaseExpiresAt: '2026-07-19T01:05:00.000Z', appliedSourceVersion: 'old-source', indexScope: 'business',
        lastErrorCode: 'PROVIDER_FAILED', createdAt: NOW, updatedAt: NOW,
      },
    },
  })

  const result = await schedulePostRagSyncInTransaction(store.transaction, {
    postId: 'post-1', communityId: 'community-1', sectionId: '', reason: 'post.deleted', now: LATER,
  })

  expect(result).toEqual({ postId: 'post-1', desiredRevision: 8 })
  expect(store.get(POST_RAG_SYNC_STATE, 'post-1')).toMatchObject({
    desiredRevision: 8,
    sectionId: '',
    status: 'pending',
    attempts: 0,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    createdAt: NOW,
  })
})

test.each([
  [{ postId: '', communityId: 'community-1', reason: 'post.created', now: NOW }, 'postId'],
  [{ postId: 'post-1', communityId: '', reason: 'post.created', now: NOW }, 'communityId'],
  [{ postId: 'post-1', communityId: 'community-1', reason: '', now: NOW }, 'reason'],
  [{ postId: 'post-1', communityId: 'community-1', reason: 'post.created', now: 'not-a-date' }, 'now'],
])('rejects malformed schedule input before writing: %s', async (input, field) => {
  const store = createTransaction()
  await expect(schedulePostRagSyncInTransaction(store.transaction, input as any)).rejects.toThrow(field)
  expect(store.writes()).toBe(0)
})

test('rejects revision overflow before writing', async () => {
  const store = createTransaction({
    [POST_RAG_SYNC_STATE]: {
      'post-1': {
        _id: 'post-1', postId: 'post-1', communityId: 'community-1', desiredRevision: Number.MAX_SAFE_INTEGER,
      },
    },
  })
  await expect(schedulePostRagSyncInTransaction(store.transaction, {
    postId: 'post-1', communityId: 'community-1', reason: 'post.updated', now: NOW,
  })).rejects.toThrow('desiredRevision')
  expect(store.writes()).toBe(0)
})

test('stores identifiers and state metadata without caller payload content', async () => {
  const store = createTransaction()
  await schedulePostRagSyncInTransaction(store.transaction, {
    postId: 'post-1', communityId: 'community-1', sectionId: 'section-1', reason: 'post.updated', now: NOW,
  })
  expect(JSON.stringify(store.get(POST_RAG_SYNC_STATE, 'post-1'))).not.toMatch(/content|勤俭持家/)
})

test('fanout rejects an oversized community before scheduling any partial work', async () => {
  mockQueryAfterId.mockReset()
  mockRunTransaction.mockReset()
  mockQueryAfterId
    .mockResolvedValueOnce(Array.from({ length: 100 }, (_, index) => ({ _id: `post-${index + 1}`, communityId: 'community-1' })))
    .mockResolvedValueOnce([{ _id: 'post-101', communityId: 'community-1' }])
  await expect(schedulePostRagSyncForCurrentPosts({
    communityId: 'community-1', reason: 'community.policy_changed', now: NOW, maximumPosts: 100,
  })).rejects.toThrow('maximumPosts')
  expect(mockQueryAfterId).toHaveBeenCalledTimes(2)
  expect(mockRunTransaction).not.toHaveBeenCalled()
})

test('a late worker completion cannot overwrite a newer requested revision', async () => {
  const store = createTransaction()
  await schedulePostRagSyncInTransaction(store.transaction, {
    postId: 'post-1', communityId: 'community-1', sectionId: 'section-1', reason: 'post.created', now: NOW,
  })
  mockRunTransaction.mockImplementation((callback) => callback(store.transaction))
  const claimed = await claimPostRagSync('post-1', { workerId: 'worker-1', now: NOW, leaseMs: 60_000 })
  expect(claimed).toMatchObject({ desiredRevision: 1, status: 'processing', leaseOwner: 'worker-1' })

  await schedulePostRagSyncInTransaction(store.transaction, {
    postId: 'post-1', communityId: 'community-1', sectionId: 'section-1', reason: 'post.updated', now: LATER,
  })
  const completion = await completePostRagSync({
    postId: 'post-1', workerId: 'worker-1', leaseToken: claimed!.leaseToken,
    desiredRevision: claimed!.desiredRevision, sourceVersion: 'stale-source', indexScope: 'business', now: LATER,
  })

  expect(completion).toEqual({ applied: false, reason: 'superseded' })
  expect(store.get(POST_RAG_SYNC_STATE, 'post-1')).toMatchObject({
    desiredRevision: 2, status: 'pending', appliedSourceVersion: null,
  })
})
