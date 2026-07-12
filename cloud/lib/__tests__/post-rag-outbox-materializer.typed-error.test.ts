const mockTransactionGetByIdOrNull = jest.fn()
const mockCreateJob = jest.fn()
const mockValidateCreateJob = jest.fn()

jest.mock('../db', () => ({ transactionGetByIdOrNull: (...args: unknown[]) => mockTransactionGetByIdOrNull(...args) }))
jest.mock('../post-rag-indexing', () => {
  const authenticated = new WeakSet<object>()
  class PostRagSourceProjectionValidationError extends Error { constructor() { super(); authenticated.add(this) } }
  return {
    buildPostRagSourceProjection: () => ({ eligible: true, sourceVersion: 'source-v1' }),
    PostRagSourceProjectionValidationError,
    isPostRagSourceProjectionValidationError: (value: unknown) => Boolean(value && typeof value === 'object' && authenticated.has(value as object)),
  }
})
jest.mock('../post-rag-jobs', () => {
  const authenticated = new WeakSet<object>()
  class PostRagJobValidationError extends Error { constructor() { super(); authenticated.add(this) } }
  return {
    POST_RAG_JOBS: 'post_rag_jobs',
    createPostRagJobInTransaction: (...args: unknown[]) => mockCreateJob(...args),
    validateCreatePostRagJobInput: (...args: unknown[]) => mockValidateCreateJob(...args),
    validateStoredPostRagJob: jest.fn(), PostRagJobValidationError,
    isPostRagJobValidationError: (value: unknown) => Boolean(value && typeof value === 'object' && authenticated.has(value as object)),
  }
})

import { PostRagJobValidationError } from '../post-rag-jobs'
import { PostRagSourceProjectionValidationError } from '../post-rag-indexing'

import {
  materializeClaimedPostRagOutboxEventInTransaction,
  PostRagOutboxMaterializationError,
} from '../post-rag-outbox-materializer'

const NOW = '2026-07-12T04:00:00.000Z'
const outbox = {
  schemaVersion: 2, _id: 'outbox-1', communityId: 'community-1', aggregateType: 'post', aggregateId: 'post-1',
  eventType: 'post.upsert', reasonCode: 'post.updated', contentVersion: 1, aclVersion: 0, status: 'processing',
  attempts: 1, nextAttemptAt: NOW, leaseOwner: 'worker-1', leaseToken: 'lease-1', leaseExpiresAt: '2026-07-12T04:02:00.000Z',
  lastError: null, materializedJobId: null, fanoutSkip: 0, fanoutAfterPostId:null, createdAt: NOW, updatedAt: NOW,
}

test('typed materialization errors enforce immutable whitelisted policy fields', () => {
  const error = new PostRagOutboxMaterializationError('VALIDATION_FAILED')
  expect(() => { (error as any).code = 'UNSUPPORTED_EVENT' }).toThrow()
  expect(() => { (error as any).retryable = true }).toThrow()
  expect(error).toMatchObject({ code: 'VALIDATION_FAILED', retryable: false })
  expect(() => new PostRagOutboxMaterializationError('INTERNAL_ERROR' as any)).toThrow('Invalid materialization error code')
})

test('maps deterministic job input validation to a typed non-retryable error before job DB work', async () => {
  mockTransactionGetByIdOrNull.mockReset()
  mockValidateCreateJob.mockReset()
  mockCreateJob.mockReset()
  mockTransactionGetByIdOrNull
    .mockResolvedValueOnce(outbox)
    .mockResolvedValueOnce({ _id: 'post-1', communityId: 'community-1', sectionId: '', status: 'active', auditStatus: 'pass', content: {}, createdAt: NOW, updatedAt: NOW })
  mockValidateCreateJob.mockImplementation(() => { throw new Error('action rejected without a known message prefix') })
  const transaction = { collection: jest.fn() }

  const error = await materializeClaimedPostRagOutboxEventInTransaction(transaction as any, 'outbox-1', {
    workerId: 'worker-1', leaseToken: 'lease-1', now: NOW,
  }).catch((caught) => caught)

  expect(error).toBeInstanceOf(PostRagOutboxMaterializationError)
  expect(error).toMatchObject({ code: 'VALIDATION_FAILED', retryable: false })
  expect(mockCreateJob).not.toHaveBeenCalled()
})

test('maps typed stored-job validation but preserves transaction failures', async () => {
  mockTransactionGetByIdOrNull.mockReset()
  mockValidateCreateJob.mockReset()
  mockCreateJob.mockReset()
  mockTransactionGetByIdOrNull
    .mockResolvedValueOnce(outbox)
    .mockResolvedValueOnce({ _id: 'post-1', communityId: 'community-1', sectionId: '', status: 'active', auditStatus: 'pass', content: {}, createdAt: NOW, updatedAt: NOW })
  mockCreateJob.mockRejectedValueOnce(new PostRagJobValidationError())
  const transaction = { collection: jest.fn() }

  await expect(materializeClaimedPostRagOutboxEventInTransaction(transaction as any, 'outbox-1', {
    workerId: 'worker-1', leaseToken: 'lease-1', now: NOW,
  })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', retryable: false })

  const dbFailure = new Error('transaction set failed')
  mockTransactionGetByIdOrNull.mockReset()
    .mockResolvedValueOnce(outbox)
    .mockResolvedValueOnce({ _id: 'post-1', communityId: 'community-1', sectionId: '', status: 'active', auditStatus: 'pass', content: {}, createdAt: NOW, updatedAt: NOW })
  mockCreateJob.mockRejectedValueOnce(dbFailure)
  await expect(materializeClaimedPostRagOutboxEventInTransaction(transaction as any, 'outbox-1', {
    workerId: 'worker-1', leaseToken: 'lease-1', now: NOW,
  })).rejects.toBe(dbFailure)
})

test('maps only authenticated projection validation errors and preserves unknown projection failures', async () => {
  const transaction = { collection: jest.fn() }
  const source = { _id: 'post-1', communityId: 'community-1', sectionId: '', status: 'active', content: {}, createdAt: NOW, updatedAt: NOW }
  const seedReads = () => mockTransactionGetByIdOrNull.mockReset().mockResolvedValueOnce(outbox).mockResolvedValueOnce(source)
  seedReads()
  await expect(materializeClaimedPostRagOutboxEventInTransaction(transaction as any, 'outbox-1', {
    workerId: 'worker-1', leaseToken: 'lease-1', now: NOW,
  }, { buildProjection: () => { throw new PostRagSourceProjectionValidationError() } } as any)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

  const unknown = new Error('crypto runtime failure')
  seedReads()
  await expect(materializeClaimedPostRagOutboxEventInTransaction(transaction as any, 'outbox-1', {
    workerId: 'worker-1', leaseToken: 'lease-1', now: NOW,
  }, { buildProjection: () => { throw unknown } } as any)).rejects.toBe(unknown)
})
