
import type { DbTransaction } from '../db'

jest.mock('../db', () => ({
  transactionGetByIdOrNull: jest.fn(async (transaction, collectionName, id) => {
    const response = await transaction.collection(collectionName).doc(id).get()
    return response.data || null
  }),
}))

import {
  appendPostRagOutboxEvent,
  POST_RAG_OUTBOX,
  RAG_COMMUNITY_VERSIONS,
} from '../post-rag-outbox'
import type { AppendPostRagOutboxEventInput } from '../post-rag-outbox'

type StoredDocument = Record<string, any>

function createTransaction(initial: Record<string, Record<string, StoredDocument>> = {}) {
  const collections = new Map<string, Map<string, StoredDocument>>()
  for (const [collectionName, documents] of Object.entries(initial)) {
    collections.set(collectionName, new Map(Object.entries(documents)))
  }

  let reads = 0
  let writes = 0
  const transaction: DbTransaction = {
    collection: (collectionName) => ({
      doc: (id) => ({
        get: async () => {
          reads += 1
          return { data: collections.get(collectionName)?.get(id) || null }
        },
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
    reads: () => reads,
    writes: () => writes,
  }
}

const NOW = '2026-07-11T08:09:10.000Z'

test('creates the first community versions and pending outbox event', async () => {
  const store = createTransaction()

  const result = await appendPostRagOutboxEvent(store.transaction, {
    communityId: 'community-1',
    aggregateId: 'post-1',
    reasonCode: 'post.audit_changed',
    now: NOW,
  })

  expect(result).toEqual({
    outboxId: expect.stringMatching(/^[a-f0-9]{64}$/),
    contentVersion: 1,
    aclVersion: 0,
  })
  expect(store.get(RAG_COMMUNITY_VERSIONS, 'community-1')).toEqual({
    _id: 'community-1',
    communityId: 'community-1',
    contentVersion: 1,
    aclVersion: 0,
    createdAt: NOW,
    updatedAt: NOW,
  })
})

test('increments existing versions and ACL only for invalidating events', async () => {
  const store = createTransaction({
    [RAG_COMMUNITY_VERSIONS]: {
      'community-1': {
        _id: 'community-1',
        communityId: 'community-1',
        contentVersion: 7,
        aclVersion: 3,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
    },
  })

  const contentOnly = await appendPostRagOutboxEvent(store.transaction, {
    communityId: 'community-1', aggregateId: 'post-1', reasonCode: 'post.deleted', now: NOW,
  })
  const aclInvalidation = await appendPostRagOutboxEvent(store.transaction, {
    communityId: 'community-1', aggregateId: 'community-1', reasonCode: 'community.acl_changed', now: NOW,
  })

  expect(contentOnly).toMatchObject({ contentVersion: 8, aclVersion: 3 })
  expect(aclInvalidation).toMatchObject({ contentVersion: 9, aclVersion: 4 })
  expect(store.get(RAG_COMMUNITY_VERSIONS, 'community-1')).toMatchObject({
    contentVersion: 9,
    aclVersion: 4,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: NOW,
  })
})

test('uses deterministic but version-distinct outbox IDs', async () => {
  const firstStore = createTransaction()
  const duplicateStore = createTransaction()
  const input = {
    communityId: 'community-1', aggregateId: 'post-1',
    reasonCode: 'post.audit_changed' as const, now: NOW,
  }

  const first = await appendPostRagOutboxEvent(firstStore.transaction, input)
  const duplicate = await appendPostRagOutboxEvent(duplicateStore.transaction, input)
  const next = await appendPostRagOutboxEvent(firstStore.transaction, input)

  expect(duplicate.outboxId).toBe(first.outboxId)
  expect(next.outboxId).not.toBe(first.outboxId)
})

test('locks the SHA-256 tuple order with a golden outbox ID', async () => {
  const store = createTransaction()

  const result = await appendPostRagOutboxEvent(store.transaction, {
    communityId: 'community-1', aggregateId: 'post-1', reasonCode: 'post.created', now: NOW,
  })

  expect(result.outboxId).toBe('da24fa7dbd1373154cceda27c9d64667bc91e3fa96e34b8a90a2cf25868a220f')
})

test('stores only identifiers, versions, status metadata, reason and timestamps', async () => {
  const store = createTransaction()
  const result = await appendPostRagOutboxEvent(store.transaction, {
    communityId: 'community-1', aggregateId: 'section-1', reasonCode: 'section.widgets_changed', now: NOW,
  })

  expect(store.get(POST_RAG_OUTBOX, result.outboxId)).toEqual({
    _id: result.outboxId,
    schemaVersion: 2,
    communityId: 'community-1',
    aggregateType: 'section',
    aggregateId: 'section-1',
    eventType: 'section.reindex',
    reasonCode: 'section.widgets_changed',
    contentVersion: 1,
    aclVersion: 1,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: NOW,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    lastError: null,
    materializedJobId: null,
    fanoutSkip: 0,
    fanoutAfterPostId: null,
    createdAt: NOW,
    updatedAt: NOW,
  })
})

test.each([
  ['post.created', 'post.upsert', 'post', 0],
  ['post.updated', 'post.upsert', 'post', 0],
  ['post.audit_changed', 'post.upsert', 'post', 0],
  ['post.deleted', 'post.delete', 'post', 0],
  ['section.metadata_changed', 'section.reindex', 'section', 0],
  ['section.status_changed', 'section.reindex', 'section', 1],
  ['section.widgets_changed', 'section.reindex', 'section', 1],
  ['community.metadata_changed', 'community.reindex', 'community', 0],
  ['community.status_changed', 'community.reindex', 'community', 1],
  ['community.acl_changed', 'acl.invalidate', 'community', 1],
] as const)('derives policy for %s', async (reasonCode, eventType, aggregateType, aclVersion) => {
  const store = createTransaction()

  const result = await appendPostRagOutboxEvent(store.transaction, {
    communityId: 'community-1', aggregateId: 'aggregate-1', reasonCode, now: NOW,
  })

  expect(result.aclVersion).toBe(aclVersion)
  expect(store.get(POST_RAG_OUTBOX, result.outboxId)).toMatchObject({
    reasonCode,
    eventType,
    aggregateType,
  })
})

test('does not expose caller-controlled policy fields in the append input type', () => {
  const eventInput: AppendPostRagOutboxEventInput = {
    communityId: 'community-1', aggregateId: 'post-1', reasonCode: 'post.created', now: NOW,
    // @ts-expect-error eventType must be derived from reasonCode
    eventType: 'post.delete',
  }
  const aggregateInput: AppendPostRagOutboxEventInput = {
    communityId: 'community-1', aggregateId: 'post-1', reasonCode: 'post.created', now: NOW,
    // @ts-expect-error aggregateType must be derived from reasonCode
    aggregateType: 'community',
  }
  const aclInput: AppendPostRagOutboxEventInput = {
    communityId: 'community-1', aggregateId: 'post-1', reasonCode: 'post.created', now: NOW,
    // @ts-expect-error invalidatesAcl must be derived from reasonCode
    invalidatesAcl: true,
  }

  expect([eventInput.reasonCode, aggregateInput.reasonCode, aclInput.reasonCode])
    .toEqual(['post.created', 'post.created', 'post.created'])
})

test('rejects an unknown reason before writing', async () => {
  const store = createTransaction()

  await expect(appendPostRagOutboxEvent(store.transaction, {
    communityId: 'community-1', aggregateId: 'post-1', reasonCode: 'unknown.reason', now: NOW,
  } as unknown as AppendPostRagOutboxEventInput)).rejects.toThrow('reasonCode is unknown')
  expect(store.writes()).toBe(0)
})
test.each(['toString', 'constructor', '__proto__'])(
  'rejects inherited reason key %s before any transaction access',
  async (reasonCode) => {
    const store = createTransaction()

    await expect(appendPostRagOutboxEvent(store.transaction, {
      communityId: 'community-1', aggregateId: 'post-1', reasonCode, now: NOW,
    } as unknown as AppendPostRagOutboxEventInput)).rejects.toThrow('reasonCode is unknown')
    expect(store.reads()).toBe(0)
    expect(store.writes()).toBe(0)
  },
)

test.each([
  [{ communityId: 'different-community', contentVersion: 1, aclVersion: 0 }, 'communityId'],
  [{ communityId: 'community-1', contentVersion: -1, aclVersion: 0 }, 'contentVersion'],
  [{ communityId: 'community-1', contentVersion: 1.5, aclVersion: 0 }, 'contentVersion'],
  [{ communityId: 'community-1', contentVersion: Number.MAX_SAFE_INTEGER, aclVersion: 0 }, 'contentVersion'],
  [{ communityId: 'community-1', contentVersion: Number.MAX_SAFE_INTEGER + 1, aclVersion: 0 }, 'contentVersion'],
  [{ communityId: 'community-1', contentVersion: 1, aclVersion: -1 }, 'aclVersion'],
  [{ communityId: 'community-1', contentVersion: 1, aclVersion: Number.NaN }, 'aclVersion'],
] as const)('fails closed for malformed current versions: %s', async (current, expectedField) => {
  const store = createTransaction({
    [RAG_COMMUNITY_VERSIONS]: {
      'community-1': {
        _id: 'community-1',
        ...current,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
    },
  })

  await expect(appendPostRagOutboxEvent(store.transaction, {
    communityId: 'community-1', aggregateId: 'post-1', reasonCode: 'post.updated', now: NOW,
  })).rejects.toThrow(expectedField)
  expect(store.writes()).toBe(0)
})

test('replays deterministically from the same starting snapshot', async () => {
  const initial = {
    [RAG_COMMUNITY_VERSIONS]: {
      'community-1': {
        _id: 'community-1', communityId: 'community-1', contentVersion: 4, aclVersion: 2,
        createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
      },
    },
  }
  const first = createTransaction(initial)
  const replay = createTransaction(initial)
  const input: AppendPostRagOutboxEventInput = {
    communityId: 'community-1', aggregateId: 'section-1', reasonCode: 'section.status_changed', now: NOW,
  }

  const firstResult = await appendPostRagOutboxEvent(first.transaction, input)
  const replayResult = await appendPostRagOutboxEvent(replay.transaction, input)

  expect(replayResult).toEqual(firstResult)
  expect(replay.get(RAG_COMMUNITY_VERSIONS, 'community-1'))
    .toEqual(first.get(RAG_COMMUNITY_VERSIONS, 'community-1'))
  expect(replay.get(POST_RAG_OUTBOX, replayResult.outboxId))
    .toEqual(first.get(POST_RAG_OUTBOX, firstResult.outboxId))
})

test.each([
  [{ communityId: '', aggregateId: 'post-1', reasonCode: 'post.created', now: NOW }, 'communityId'],
  [{ communityId: 'community-1', aggregateId: ' ', reasonCode: 'post.created', now: NOW }, 'aggregateId'],
  [{ communityId: 'community-1', aggregateId: 'post-1', reasonCode: 'post.created', now: 'not-a-date' }, 'now'],
  [{ communityId: 'community-1', aggregateId: 'post-1', reasonCode: 'post.created', now: '2026-02-31T08:09:10.000Z' }, 'now'],
])('rejects invalid input before writing: %s', async (input, expectedField) => {
  const store = createTransaction()

  await expect(appendPostRagOutboxEvent(store.transaction, input as any)).rejects.toThrow(expectedField)
  expect(store.writes()).toBe(0)
})
