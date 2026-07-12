
const mockDb = {
  runTransaction: jest.fn(),
  transactionGetByIdOrNull: jest.fn(),
  query: jest.fn(),
  getById: jest.fn(),
}

const mockRandomUUID = jest.fn(() => 'generated-lease-token')

jest.mock('node:crypto', () => ({
  ...jest.requireActual('node:crypto'),
  randomUUID: () => mockRandomUUID(),
}))

jest.mock('../db', () => mockDb)

import {
  buildPostRagJobId,
  claimPostRagJob,
  completePostRagJob,
  createPostRagJobInTransaction,
  failPostRagJob,
  renewPostRagJobLease,
  getPostRagJob,
  isPostRagJobLeaseError,
  listPostRagJobCandidates,
  POST_RAG_JOBS,
  PostRagJobValidationError,
  isPostRagJobValidationError,
  validateCreatePostRagJobInput,
  type PostRagJobDocument,
} from '../post-rag-jobs'

test('renewPostRagJobLease atomically extends only the matching live lease without changing attempts', async () => {
  const state = transactionFor(job({ status: 'processing', attempts: 3, leaseOwner: 'worker-1', leaseToken: 'lease-a', leaseExpiresAt: '2026-07-12T01:02:00.000Z' }))
  mockDb.runTransaction.mockImplementation(async callback => callback(state.transaction))
  await expect(renewPostRagJobLease('job-1', { workerId: 'worker-1', leaseToken: 'lease-a', now: '2026-07-12T01:01:00.000Z' })).resolves.toMatchObject({
    attempts: 3, leaseToken: 'lease-a', leaseExpiresAt: '2026-07-12T01:03:00.000Z', updatedAt: '2026-07-12T01:01:00.000Z',
  })
  await expect(renewPostRagJobLease('job-1', { workerId: 'worker-1', leaseToken: 'wrong', now: '2026-07-12T01:01:01.000Z' })).rejects.toThrow('token')
})

const NOW = '2026-07-12T01:00:00.000Z'

function job(overrides: Partial<PostRagJobDocument> = {}): PostRagJobDocument {
  return {
    schemaVersion: 2,
    _id: 'job-1',
    outboxId: 'outbox-1',
    postId: 'post-1',
    communityId: 'community-1',
    sectionId: 'section-1',
    action: 'upsert',
    sourceVersion: 'source-v7',
    contentVersion: 7,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: NOW,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    outcome: null,
    lastError: null,
    ...overrides,
  }
}

function transactionFor(initial: PostRagJobDocument | null) {
  let value = initial ? { ...initial } : null
  const document = {
    get: jest.fn(async () => ({ data: value })),
    set: jest.fn(async ({ data }: { data: object }) => { value = { _id: initial?._id || 'job-1', ...data } as PostRagJobDocument }),
    update: jest.fn(async ({ data }: { data: object }) => { value = { ...value, ...data } as PostRagJobDocument }),
  }
  const transaction = { collection: jest.fn(() => ({ doc: jest.fn(() => document) })) }
  mockDb.transactionGetByIdOrNull.mockImplementation(async () => value)
  return { transaction, document, current: () => value }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRandomUUID.mockReturnValue('generated-lease-token')
})

test('buildPostRagJobId hashes the canonical tuple', () => {
  expect(buildPostRagJobId('outbox-1', 'post-1', 'upsert', 'source-v7', 7)).toBe(
    'cb2a10c5c2fbf5832a0d59896866c2f7ccdc5083a9b6522425aa1e6876dcee78',
  )
})

test('validateCreatePostRagJobInput rejects deterministic input errors synchronously', () => {
  expect(() => validateCreatePostRagJobInput({
    outboxId: 'outbox-1', postId: 'post-1', communityId: 'community-1', sectionId: 'section-1',
    action: 'upsert', sourceVersion: 'source-v7', contentVersion: 7, now: 'not-an-iso-date',
  })).toThrow('now must be a valid ISO timestamp')
  expect(mockDb.transactionGetByIdOrNull).not.toHaveBeenCalled()
})

test('job validation error has immutable authenticated policy fields', () => {
  const error = new PostRagJobValidationError()
  expect(error).toMatchObject({ code: 'VALIDATION_FAILED', retryable: false })
  expect(() => { (error as any).code = 'INTERNAL_ERROR' }).toThrow()
  expect(isPostRagJobValidationError(Object.create(PostRagJobValidationError.prototype))).toBe(false)
  expect(isPostRagJobValidationError(error)).toBe(true)
})

test('createPostRagJobInTransaction creates a pending document without raw content', async () => {
  const { transaction, document } = transactionFor(null)
  const created = await createPostRagJobInTransaction(transaction as any, {
    outboxId: 'outbox-1', postId: 'post-1', communityId: 'community-1', sectionId: 'section-1',
    action: 'upsert', sourceVersion: 'source-v7', contentVersion: 7, now: NOW,
  })

  expect(created).toMatchObject({
    schemaVersion: 2, _id: expect.any(String), status: 'pending', attempts: 0,
    nextAttemptAt: NOW, leaseOwner: null, leaseToken: null, leaseExpiresAt: null,
  })
  expect(document.set).toHaveBeenCalledWith({ data: expect.not.objectContaining({ content: expect.anything() }) })
})

test('createPostRagJobInTransaction returns an identical existing job idempotently', async () => {
  const existing = job({ _id: buildPostRagJobId('outbox-1', 'post-1', 'upsert', 'source-v7', 7) })
  const { transaction, document } = transactionFor(existing)
  await expect(createPostRagJobInTransaction(transaction as any, {
    outboxId: 'outbox-1', postId: 'post-1', communityId: 'community-1', sectionId: 'section-1',
    action: 'upsert', sourceVersion: 'source-v7', contentVersion: 7, now: NOW,
  })).resolves.toEqual(existing)
  expect(document.set).not.toHaveBeenCalled()
})

test('createPostRagJobInTransaction fails closed on deterministic id collision', async () => {
  const existing = job({ _id: buildPostRagJobId('outbox-1', 'post-1', 'upsert', 'source-v7', 7), communityId: 'other' })
  const { transaction } = transactionFor(existing)
  await expect(createPostRagJobInTransaction(transaction as any, {
    outboxId: 'outbox-1', postId: 'post-1', communityId: 'community-1', sectionId: 'section-1',
    action: 'upsert', sourceVersion: 'source-v7', contentVersion: 7, now: NOW,
  })).rejects.toMatchObject({ name: 'PostRagJobValidationError', retryable: false })
})

test('createPostRagJobInTransaction types malformed stored state after a successful DB read', async () => {
  const existing = job({ _id: buildPostRagJobId('outbox-1', 'post-1', 'upsert', 'source-v7', 7), attempts: -1 })
  const { transaction } = transactionFor(existing)

  await expect(createPostRagJobInTransaction(transaction as any, {
    outboxId: 'outbox-1', postId: 'post-1', communityId: 'community-1', sectionId: 'section-1',
    action: 'upsert', sourceVersion: 'source-v7', contentVersion: 7, now: NOW,
  })).rejects.toBeInstanceOf(PostRagJobValidationError)
})

test('createPostRagJobInTransaction does not wrap transaction read or write failures', async () => {
  const readFailure = new Error('transient read failure')
  const transaction = transactionFor(null).transaction
  mockDb.transactionGetByIdOrNull.mockRejectedValueOnce(readFailure)
  await expect(createPostRagJobInTransaction(transaction as any, {
    outboxId: 'outbox-1', postId: 'post-1', communityId: 'community-1', sectionId: 'section-1',
    action: 'upsert', sourceVersion: 'source-v7', contentVersion: 7, now: NOW,
  })).rejects.toBe(readFailure)

  const writeFailure = new Error('transient write failure')
  const state = transactionFor(null)
  state.document.set.mockRejectedValueOnce(writeFailure)
  await expect(createPostRagJobInTransaction(state.transaction as any, {
    outboxId: 'outbox-1', postId: 'post-1', communityId: 'community-1', sectionId: 'section-1',
    action: 'upsert', sourceVersion: 'source-v7', contentVersion: 7, now: NOW,
  })).rejects.toBe(writeFailure)
})

test.each(['', ' source-v7', 'source-v7 ', 'source\nversion', 'x'.repeat(257)])(
  'createPostRagJobInTransaction rejects malformed sourceVersion %p before writing',
  async (sourceVersion) => {
    const { transaction, document } = transactionFor(null)
    await expect(createPostRagJobInTransaction(transaction as any, {
      outboxId: 'outbox-1', postId: 'post-1', communityId: 'community-1', sectionId: 'section-1',
      action: 'upsert', sourceVersion, contentVersion: 7, now: NOW,
    })).rejects.toThrow(/sourceVersion/)
    expect(document.set).not.toHaveBeenCalled()
  },
)

test('createPostRagJobInTransaction treats sourceVersion as immutable', async () => {
  const id = buildPostRagJobId('outbox-1', 'post-1', 'upsert', 'source-v7', 7)
  const existing = job({ _id: id, sourceVersion: 'different-source' })
  const { transaction, document } = transactionFor(existing)
  await expect(createPostRagJobInTransaction(transaction as any, {
    outboxId: 'outbox-1', postId: 'post-1', communityId: 'community-1', sectionId: 'section-1',
    action: 'upsert', sourceVersion: 'source-v7', contentVersion: 7, now: NOW,
  })).rejects.toBeInstanceOf(PostRagJobValidationError)
  expect(document.set).not.toHaveBeenCalled()
})

test('claimPostRagJob generates and persists an opaque lease token server-side', async () => {
  const state = transactionFor(job())
  mockDb.runTransaction.mockImplementation(async (callback) => callback(state.transaction))
  const claimed = await claimPostRagJob('job-1', { workerId: 'worker-1', leaseToken: 'caller-controlled', now: NOW } as any)
  expect(claimed).toMatchObject({
    status: 'processing', attempts: 1, leaseOwner: 'worker-1', leaseToken: expect.any(String), leaseExpiresAt: '2026-07-12T01:02:00.000Z',
  })
  expect(claimed?.leaseToken).not.toHaveLength(0)
  expect(claimed?.leaseToken).not.toBe('caller-controlled')
  await expect(claimPostRagJob('job-1', { workerId: 'worker-2', now: NOW })).resolves.toBeNull()
})

test('serialized transaction conflicts produce one claim winner at the transaction boundary', async () => {
  const state = transactionFor(job())
  let transactionTail = Promise.resolve()
  mockDb.runTransaction.mockImplementation((callback) => {
    const result = transactionTail.then(() => callback(state.transaction))
    transactionTail = result.then(() => undefined, () => undefined)
    return result
  })

  const results = await Promise.all([
    claimPostRagJob('job-1', { workerId: 'worker-1', now: NOW }),
    claimPostRagJob('job-1', { workerId: 'worker-2', now: NOW }),
  ])
  expect(results.filter(Boolean)).toHaveLength(1)
  expect(results.filter(Boolean)[0]).toMatchObject({ status: 'processing', attempts: 1, leaseOwner: 'worker-1' })
})

test.todo('isolated CloudBase fixture: concurrent claim transactions produce exactly one winner')

test('claimPostRagJob recovers an expired same-worker lease with a distinct server fencing token', async () => {
  const state = transactionFor(job({ status: 'processing', attempts: 1, leaseOwner: 'worker-2', leaseToken: 'lease-a', leaseExpiresAt: '2026-07-12T00:59:59.000Z' }))
  mockDb.runTransaction.mockImplementation(async (callback) => callback(state.transaction))
  const reclaimed = await claimPostRagJob('job-1', { workerId: 'worker-2', now: NOW })
  expect(reclaimed).toMatchObject({ attempts: 2, leaseOwner: 'worker-2', leaseToken: expect.any(String), leaseExpiresAt: '2026-07-12T01:02:00.000Z' })
  expect(reclaimed?.leaseToken).not.toBe('lease-a')
})

test('claimPostRagJob fails closed after bounded repeated lease-token entropy', async () => {
  const state = transactionFor(job({
    status: 'processing', attempts: 1, leaseOwner: 'worker-2', leaseToken: 'repeated-token',
    leaseExpiresAt: '2026-07-12T00:59:59.000Z',
  }))
  mockDb.runTransaction.mockImplementation(async (callback) => callback(state.transaction))
  mockRandomUUID
    .mockReturnValueOnce('repeated-token')
    .mockReturnValueOnce('repeated-token')
    .mockReturnValueOnce('repeated-token')
    .mockReturnValueOnce('repeated-token')
    .mockReturnValueOnce('repeated-token')
    .mockReturnValueOnce('eventually-distinct-token')

  await expect(claimPostRagJob('job-1', { workerId: 'worker-2', now: NOW }))
    .rejects.toThrow('unable to generate a distinct lease token')
  expect(mockRandomUUID).toHaveBeenCalledTimes(5)
  expect(state.document.update).not.toHaveBeenCalled()
})
test('claimPostRagJob atomically dead-letters an exhausted eligible job', async () => {
  const state = transactionFor(job({ status: 'retry_wait', attempts: 5, nextAttemptAt: NOW }))
  mockDb.runTransaction.mockImplementation(async (callback) => callback(state.transaction))
  await expect(claimPostRagJob('job-1', { workerId: 'worker-2', now: NOW })).resolves.toBeNull()
  expect(state.current()).toMatchObject({ status: 'dead_letter', leaseOwner: null, leaseToken: null, leaseExpiresAt: null })
})

test('completePostRagJob only permits the active unexpired lease owner', async () => {
  const state = transactionFor(job({ status: 'processing', attempts: 1, leaseOwner: 'worker-1', leaseToken: 'lease-a', leaseExpiresAt: '2026-07-12T01:02:00.000Z' }))
  mockDb.runTransaction.mockImplementation(async (callback) => callback(state.transaction))
  await expect(completePostRagJob('job-1', { workerId: 'worker-old', leaseToken: 'lease-a', now: NOW, outcome: 'indexed' })).rejects.toThrow('lease owner')
  await expect(completePostRagJob('job-1', { workerId: 'worker-1', leaseToken: 'lease-a', now: NOW, outcome: 'indexed' })).resolves.toMatchObject({
    status: 'completed', outcome: 'indexed', leaseOwner: null, leaseToken: null,
  })
})

test('completePostRagJob rejects an expired owner even before another worker reclaims it', async () => {
  const state = transactionFor(job({ status: 'processing', attempts: 1, leaseOwner: 'worker-1', leaseToken: 'lease-a', leaseExpiresAt: NOW }))
  mockDb.runTransaction.mockImplementation(async (callback) => callback(state.transaction))
  await expect(completePostRagJob('job-1', { workerId: 'worker-1', leaseToken: 'lease-a', now: NOW, outcome: 'indexed' })).rejects.toThrow('expired')
  expect(state.document.update).not.toHaveBeenCalled()
})

test('getPostRagJob strictly reloads current schema-v2 state without writing', async () => {
  const id = buildPostRagJobId('outbox-1', 'post-1', 'upsert', 'source-v7', 7)
  const state = transactionFor(job({ _id: id }))
  mockDb.getById.mockResolvedValue(state.current())
  await expect(getPostRagJob(id)).resolves.toMatchObject({ _id: id, schemaVersion: 2 })
  expect(state.document.update).not.toHaveBeenCalled()
})

test('complete and fail expose authenticated lease errors without message matching', async () => {
  const state = transactionFor(job({ status: 'processing', attempts: 1, leaseOwner: 'other-worker', leaseToken: 'lease-a', leaseExpiresAt: '2026-07-12T01:02:00.000Z' }))
  mockDb.runTransaction.mockImplementation(async (callback: any) => callback(state.transaction))
  const completeError = await completePostRagJob('job-1', { workerId: 'worker-1', leaseToken: 'lease-a', now: NOW, outcome: 'indexed' }).catch((error) => error)
  const failError = await failPostRagJob('job-1', { workerId: 'worker-1', leaseToken: 'lease-a', now: NOW, error: { code: 'INTERNAL_ERROR', stage: 'claim' } }).catch((error) => error)
  expect(isPostRagJobLeaseError(completeError)).toBe(true)
  expect(isPostRagJobLeaseError(failError)).toBe(true)
  expect(isPostRagJobLeaseError(Object.create(Object.getPrototypeOf(completeError)))).toBe(false)
})

test('a reclaimed lease fences stale completion and failure even for the same worker id', async () => {
  const state = transactionFor(job({
    status: 'processing', attempts: 1, leaseOwner: 'worker-1', leaseToken: 'lease-a',
    leaseExpiresAt: '2026-07-12T00:59:59.000Z',
  }))
  mockDb.runTransaction.mockImplementation(async (callback) => callback(state.transaction))

  const reclaimed = await claimPostRagJob('job-1', { workerId: 'worker-1', now: NOW })
  expect(reclaimed).toMatchObject({ leaseOwner: 'worker-1', leaseToken: expect.any(String), attempts: 2 })
  const activeLeaseToken = reclaimed!.leaseToken!

  state.document.update.mockClear()
  await expect(completePostRagJob('job-1', {
    workerId: 'worker-1', leaseToken: 'lease-a', now: NOW, outcome: 'indexed',
  })).rejects.toThrow('lease token')
  await expect(failPostRagJob('job-1', {
    workerId: 'worker-1', leaseToken: 'lease-a', now: NOW,
    error: { code: 'TIMEOUT', stage: 'es_write' },
  })).rejects.toThrow('lease token')
  expect(state.document.update).not.toHaveBeenCalled()

  await expect(completePostRagJob('job-1', {
    workerId: 'worker-1', leaseToken: activeLeaseToken, now: NOW, outcome: 'indexed',
  })).resolves.toMatchObject({ status: 'completed', leaseToken: null })
})

test.each([
  [1, 5, '2026-07-12T01:00:05.000Z'],
  [2, 30, '2026-07-12T01:00:30.000Z'],
  [3, 120, '2026-07-12T01:02:00.000Z'],
  [4, 600, '2026-07-12T01:10:00.000Z'],
])('failPostRagJob schedules retry attempt %i after %i seconds', async (attempts, _seconds, nextAttemptAt) => {
  const state = transactionFor(job({ status: 'processing', attempts, leaseOwner: 'worker-1', leaseToken: 'lease-a', leaseExpiresAt: '2026-07-12T01:02:00.000Z' }))
  mockDb.runTransaction.mockImplementation(async (callback) => callback(state.transaction))
  await expect(failPostRagJob('job-1', { workerId: 'worker-1', leaseToken: 'lease-a', now: NOW, error: {
    code: 'TIMEOUT', stage: 'es_write',
  } })).resolves.toMatchObject({ status: 'retry_wait', nextAttemptAt, leaseOwner: null })
})

test.each([
  [5, 'TIMEOUT'],
  [1, 'VALIDATION_FAILED'],
] as const)('failPostRagJob dead-letters attempts=%i code=%s', async (attempts, code) => {
  const state = transactionFor(job({ status: 'processing', attempts, leaseOwner: 'worker-1', leaseToken: 'lease-a', leaseExpiresAt: '2026-07-12T01:02:00.000Z' }))
  mockDb.runTransaction.mockImplementation(async (callback) => callback(state.transaction))
  await expect(failPostRagJob('job-1', { workerId: 'worker-1', leaseToken: 'lease-a', now: NOW, error: {
    code, stage: 'load_source',
  } })).resolves.toMatchObject({ status: 'dead_letter', leaseOwner: null })
})

test.each([
  ['MAX_ATTEMPTS', false],
  ['SOURCE_NOT_FOUND', false],
  ['SOURCE_SUPERSEDED', false],
  ['VALIDATION_FAILED', false],
  ['EMBEDDING_FAILED', true],
  ['ES_UNAVAILABLE', true],
  ['ES_WRITE_FAILED', true],
  ['MIRROR_WRITE_FAILED', true],
  ['TIMEOUT', true],
  ['INTERNAL_ERROR', true],
] as const)('failPostRagJob derives retryability for %s as %s', async (code, retryable) => {
  const state = transactionFor(job({ status: 'processing', attempts: 1, leaseOwner: 'worker-1', leaseToken: 'lease-a', leaseExpiresAt: '2026-07-12T01:02:00.000Z' }))
  mockDb.runTransaction.mockImplementation(async (callback) => callback(state.transaction))
  await expect(failPostRagJob('job-1', { workerId: 'worker-1', leaseToken: 'lease-a', now: NOW, error: {
    code, stage: 'es_write',
  } })).resolves.toMatchObject({
    lastError: { code, retryable, at: NOW },
  })
})

test('failPostRagJob rejects any caller-provided raw message before writing', async () => {
  await expect(failPostRagJob('job-1', { workerId: 'worker-1', leaseToken: 'lease-a', now: NOW, error: {
    code: 'INTERNAL_ERROR', stage: 'es_write', message: 'query or post text', retryable: true,
  } as any })).rejects.toThrow('message')
  await expect(failPostRagJob('job-1', { workerId: 'worker-1', leaseToken: 'lease-a', now: NOW, error: {
    code: 'INTERNAL_ERROR', stage: 'es_write', message: { raw: true } as any, retryable: true,
  } as any })).rejects.toThrow('message')
  expect(mockDb.runTransaction).not.toHaveBeenCalled()
})

test('failPostRagJob rejects caller-controlled retryable before writing', async () => {
  await expect(failPostRagJob('job-1', {
    workerId: 'worker-1', leaseToken: 'lease-a', now: NOW,
    error: { code: 'VALIDATION_FAILED', stage: 'load_source', retryable: true } as any,
  })).rejects.toThrow('retryable')
  expect(mockDb.runTransaction).not.toHaveBeenCalled()
})

test.each([
  ['code', '用户查询：我家的门禁密码'],
  ['stage', '用户查询：我家的门禁密码'],
  ['code', '__proto__'],
  ['code', 'constructor'],
  ['code', 'prototype'],
  ['stage', '__proto__'],
  ['stage', 'constructor'],
  ['stage', 'prototype'],
  ['code', 'UNKNOWN_ERROR'],
  ['stage', 'unknown_stage'],
] as const)('failPostRagJob rejects unsafe or unknown %s token %p before a transaction', async (field, value) => {
  const error = { code: 'INTERNAL_ERROR', stage: 'es_write', [field]: value }
  await expect(failPostRagJob('job-1', {
    workerId: 'worker-1', leaseToken: 'lease-a', now: NOW, error: error as any,
  })).rejects.toThrow(field)
  expect(mockDb.runTransaction).not.toHaveBeenCalled()
})

test('claimPostRagJob rejects a tampered stored error message with zero writes', async () => {
  const state = transactionFor(job({
    status: 'retry_wait', attempts: 1, nextAttemptAt: NOW,
    lastError: {
      code: 'TIMEOUT', stage: 'es_write', message: '用户原始问题：门禁密码是 123456', retryable: true, at: NOW,
    },
  }))
  mockDb.runTransaction.mockImplementation(async (callback) => callback(state.transaction))
  await expect(claimPostRagJob('job-1', { workerId: 'worker-1', now: NOW })).rejects.toThrow('lastError.message')
  expect(state.document.set).not.toHaveBeenCalled()
  expect(state.document.update).not.toHaveBeenCalled()
})

test('stored lastError rejects unsafe object shapes without executing getters', async () => {
  const validError = { code: 'TIMEOUT', stage: 'es_write', message: 'RAG job operation timed out', retryable: true, at: NOW }
  let getterCalls = 0
  const accessor = { ...validError }
  Object.defineProperty(accessor, 'code', { enumerable: true, get: () => { getterCalls += 1; return 'TIMEOUT' } })
  const custom = Object.assign(Object.create({ inherited: true }), validError)
  const symbol = { ...validError, [Symbol('hidden')]: true }
  const unsafe = { ...validError }; Object.defineProperty(unsafe, '__proto__', { enumerable: true, value: 'bad' })

  for (const lastError of [accessor, custom, symbol, unsafe]) {
    const state = transactionFor(job({ status: 'retry_wait', attempts: 1, lastError: lastError as any }))
    mockDb.runTransaction.mockImplementation(async (callback) => callback(state.transaction))
    await expect(claimPostRagJob('job-1', { workerId: 'worker-1', now: NOW })).rejects.toThrow(/lastError/)
    expect(state.document.update).not.toHaveBeenCalled()
  }
  expect(getterCalls).toBe(0)
})

test.each([
  ['wrong owner', 'worker-old', NOW, /lease owner/],
  ['expired lease', 'worker-1', '2026-07-12T01:02:00.000Z', /expired/],
])('failPostRagJob rejects %s with zero writes', async (_case, workerId, now, expectedError) => {
  const state = transactionFor(job({ status: 'processing', attempts: 1, leaseOwner: 'worker-1', leaseToken: 'lease-a', leaseExpiresAt: '2026-07-12T01:02:00.000Z' }))
  mockDb.runTransaction.mockImplementation(async (callback) => callback(state.transaction))
  await expect(failPostRagJob('job-1', { workerId, leaseToken: 'lease-a', now, error: {
    code: 'TIMEOUT', stage: 'es_write',
  } })).rejects.toThrow(expectedError)
  expect(state.document.set).not.toHaveBeenCalled()
  expect(state.document.update).not.toHaveBeenCalled()
})

test('public lifecycle APIs reject malformed identifiers and timestamps before writes', async () => {
  await expect(claimPostRagJob('job-1', { workerId: 'worker\nraw', now: NOW })).rejects.toThrow('control')
  await expect(claimPostRagJob('job-1', { workerId: 'worker-1', now: '2026-07-12' })).rejects.toThrow('ISO')
  await expect(claimPostRagJob(' job-1', { workerId: 'worker-1', now: NOW })).rejects.toThrow('identifier')
  expect(mockDb.runTransaction).not.toHaveBeenCalled()
})

test('listPostRagJobCandidates filters due work, deduplicates and returns oldest first', async () => {
  mockDb.query
    .mockResolvedValueOnce([job({ _id: 'pending-new', createdAt: '2026-07-12T00:59:00.000Z' })])
    .mockResolvedValueOnce([
      job({ _id: 'retry-old', status: 'retry_wait', attempts: 1, nextAttemptAt: NOW, createdAt: '2026-07-12T00:30:00.000Z' }),
      job({ _id: 'retry-future', status: 'retry_wait', attempts: 1, nextAttemptAt: '2026-07-12T01:00:01.000Z' }),
    ])
    .mockResolvedValueOnce([
      job({ _id: 'pending-new', status: 'processing', attempts: 1, leaseOwner: 'old', leaseToken: 'expired-token', leaseExpiresAt: '2026-07-12T00:59:00.000Z', createdAt: '2026-07-12T00:59:00.000Z' }),
      job({ _id: 'processing-live', status: 'processing', attempts: 1, leaseOwner: 'w', leaseToken: 'live-token', leaseExpiresAt: '2026-07-12T01:00:01.000Z' }),
    ])

  await expect(listPostRagJobCandidates(NOW, 10)).resolves.toEqual(['retry-old', 'pending-new'])
  expect(mockDb.query).toHaveBeenCalledTimes(3)
  expect(mockDb.query).toHaveBeenCalledWith(POST_RAG_JOBS, { schemaVersion: 2, status: 'pending' }, { orderBy: ['createdAt', 'asc'], limit: 100 })
})

test('listPostRagJobCandidates scans every status before applying the global oldest-first limit', async () => {
  mockDb.query
    .mockResolvedValueOnce([job({ _id: 'pending-new', createdAt: '2026-07-12T00:59:00.000Z' })])
    .mockResolvedValueOnce([job({
      _id: 'retry-old', status: 'retry_wait', attempts: 1, nextAttemptAt: NOW,
      createdAt: '2026-07-12T00:30:00.000Z',
    })])
    .mockResolvedValueOnce([])

  await expect(listPostRagJobCandidates(NOW, 1)).resolves.toEqual(['retry-old'])
  expect(mockDb.query).toHaveBeenCalledTimes(3)
})

test('listPostRagJobCandidates excludes legacy rows and skips malformed v2 candidates without blocking valid work', async () => {
  const legacy = { ...job({ _id: 'legacy' }) } as Record<string, unknown>
  delete legacy.schemaVersion
  const malformed = job({ _id: 'corrupted-earliest', createdAt: '2026-07-12T00:10:00.000Z', attempts: -1 })
  mockDb.query
    .mockResolvedValueOnce([
      legacy,
      malformed,
      job({ _id: 'valid-later', createdAt: '2026-07-12T00:20:00.000Z' }),
    ])
    .mockResolvedValueOnce([job({ _id: 'valid-later', createdAt: '2026-07-12T00:20:00.000Z' })])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
  mockDb.transactionGetByIdOrNull.mockResolvedValue(malformed)
  mockDb.runTransaction.mockImplementation(async (callback) => callback({
    collection: () => ({ doc: () => ({ update: jest.fn(async () => ({ stats: { updated: 1 } })) }) }),
  }))
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

  await expect(listPostRagJobCandidates(NOW, 10)).resolves.toEqual(['valid-later'])
  expect(warning).toHaveBeenCalledWith('[post-rag-jobs] quarantined malformed jobs', { count: 1 })
  warning.mockRestore()
  expect(mockDb.query).toHaveBeenNthCalledWith(
    1, POST_RAG_JOBS, { schemaVersion: 2, status: 'pending' }, { orderBy: ['createdAt', 'asc'], limit: 100 },
  )
})

test('listPostRagJobCandidates re-reads the head after quarantine so shifted valid work is not skipped', async () => {
  const malformed = job({ _id: 'bad-head', attempts: -1 })
  const valid = job({ _id: 'valid-after-page', createdAt: '2026-07-12T00:20:00.000Z' })
  let quarantined = false
  mockDb.query.mockImplementation(async (_collection, where) => {
    if (where.status !== 'pending') return []
    return quarantined ? [valid] : [malformed]
  })
  mockDb.transactionGetByIdOrNull.mockResolvedValue(malformed)
  const quarantineUpdate = jest.fn(async () => { quarantined = true; return { stats: { updated: 1 } } })
  mockDb.runTransaction.mockImplementation(async (callback) => callback({
    collection: () => ({ doc: () => ({ update: quarantineUpdate }) }),
  }))
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

  await expect(listPostRagJobCandidates(NOW, 1)).resolves.toEqual(['valid-after-page'])
  expect(mockDb.query).toHaveBeenNthCalledWith(2, POST_RAG_JOBS, { schemaVersion: 2, status: 'pending' }, {
    orderBy: ['createdAt', 'asc'], limit: 100,
  })
  expect(mockDb.runTransaction).toHaveBeenCalledTimes(1)
  expect(quarantineUpdate).toHaveBeenCalledWith({ data: expect.objectContaining({
    schemaVersion: -2,
    status: 'dead_letter',
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    lastError: {
      code: 'VALIDATION_FAILED', stage: 'claim', message: 'RAG source validation failed', retryable: false, at: NOW,
    },
  }) })
  expect(warning).toHaveBeenCalledWith('[post-rag-jobs] quarantined malformed jobs', { count: 1 })
  expect(JSON.stringify(warning.mock.calls)).not.toContain('bad-head')
  warning.mockRestore()
})

test('listPostRagJobCandidates stops ordered retry and processing scans at the first future timestamp', async () => {
  const futureRetries = Array.from({ length: 100 }, (_, index) => job({
    _id: `retry-${index}`, status: 'retry_wait', attempts: 1,
    nextAttemptAt: '2026-07-12T01:00:01.000Z',
  }))
  const liveLeases = Array.from({ length: 100 }, (_, index) => job({
    _id: `processing-${index}`, status: 'processing', attempts: 1, leaseOwner: 'worker',
    leaseToken: `lease-${index}`, leaseExpiresAt: '2026-07-12T01:00:01.000Z',
  }))
  mockDb.query
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(futureRetries)
    .mockResolvedValueOnce(liveLeases)

  await expect(listPostRagJobCandidates(NOW, 100)).resolves.toEqual([])
  expect(mockDb.query).toHaveBeenCalledTimes(3)
})

test('listPostRagJobCandidates fails explicitly when malformed v2 work has no usable id', async () => {
  mockDb.query.mockResolvedValueOnce([{ ...job(), _id: '', attempts: -1 }])

  await expect(listPostRagJobCandidates(NOW, 1))
    .rejects.toThrow('malformed RAG job cannot be quarantined: invalid _id')
  expect(mockDb.runTransaction).not.toHaveBeenCalled()
})

test('malformed persisted state fails closed without a write', async () => {
  const state = transactionFor(job({ attempts: -1 }))
  mockDb.runTransaction.mockImplementation(async (callback) => callback(state.transaction))
  await expect(claimPostRagJob('job-1', { workerId: 'worker-1', now: NOW })).rejects.toThrow('attempts')
  expect(state.document.update).not.toHaveBeenCalled()
})

test('a processing job with zero attempts is rejected as malformed', async () => {
  const state = transactionFor(job({
    status: 'processing', attempts: 0, leaseOwner: 'stale-worker', leaseToken: 'lease-old', leaseExpiresAt: '2026-07-12T00:59:00.000Z',
  }))
  mockDb.runTransaction.mockImplementation(async (callback) => callback(state.transaction))
  await expect(claimPostRagJob('job-1', { workerId: 'worker-1', now: NOW })).rejects.toThrow('attempts')
  expect(state.document.update).not.toHaveBeenCalled()
})
