
import { createHash, randomUUID } from 'node:crypto'

import * as db from './db'

export const POST_RAG_JOBS = 'post_rag_jobs'

export type PostRagJobAction = 'upsert' | 'delete'
export type PostRagJobStatus = 'pending' | 'processing' | 'retry_wait' | 'completed' | 'dead_letter'
export type PostRagJobOutcome = 'indexed' | 'removed' | 'superseded'

const POST_RAG_JOB_ERROR_STAGES = [
  'claim', 'load_source', 'chunk', 'embedding', 'es_write', 'mirror_write', 'activate', 'cleanup',
] as const
const POST_RAG_JOB_ERROR_CODES = [
  'MAX_ATTEMPTS', 'SOURCE_NOT_FOUND', 'SOURCE_SUPERSEDED', 'VALIDATION_FAILED', 'EMBEDDING_FAILED',
  'ES_UNAVAILABLE', 'ES_WRITE_FAILED', 'MIRROR_WRITE_FAILED', 'TIMEOUT', 'INTERNAL_ERROR',
] as const

export type PostRagJobErrorStage = typeof POST_RAG_JOB_ERROR_STAGES[number]
export type PostRagJobErrorCode = typeof POST_RAG_JOB_ERROR_CODES[number]

export type PostRagJobError = {
  code: PostRagJobErrorCode
  stage: PostRagJobErrorStage
  message: string
  retryable: boolean
  at: string
}
export type PostRagJobDocument = {
  schemaVersion: 2
  _id: string
  outboxId: string
  postId: string
  communityId: string
  sectionId: string | null
  action: PostRagJobAction
  sourceVersion: string
  contentVersion: number
  status: PostRagJobStatus
  attempts: number
  nextAttemptAt: string
  leaseOwner: string | null
  leaseToken: string | null
  leaseExpiresAt: string | null
  createdAt: string
  updatedAt: string
  outcome: PostRagJobOutcome | null
  lastError: PostRagJobError | null
}

const authenticatedJobValidationErrors = new WeakSet<object>()
const authenticatedJobLeaseErrors = new WeakSet<object>()

export class PostRagJobValidationError extends Error {
  declare readonly code: 'VALIDATION_FAILED'
  declare readonly retryable: false

  constructor() {
    super('Stored RAG job validation failed')
    this.name = 'PostRagJobValidationError'
    Object.defineProperties(this, {
      code: { value: 'VALIDATION_FAILED', enumerable: true, writable: false, configurable: false },
      retryable: { value: false, enumerable: true, writable: false, configurable: false },
    })
    authenticatedJobValidationErrors.add(this)
  }
}

export function isPostRagJobValidationError(value: unknown): value is PostRagJobValidationError {
  return Boolean(value && typeof value === 'object' && authenticatedJobValidationErrors.has(value as object))
}

export class PostRagJobLeaseError extends Error {
  constructor(reason: 'status' | 'owner' | 'token' | 'expired' = 'status') {
    super(reason === 'status' ? 'job is not processing' : reason === 'owner' ? 'job lease owner does not match worker'
      : reason === 'token' ? 'job lease token does not match active claim' : 'job lease has expired')
    this.name = 'PostRagJobLeaseError'
    authenticatedJobLeaseErrors.add(this)
  }
}

export function isPostRagJobLeaseError(value: unknown): value is PostRagJobLeaseError {
  return Boolean(value && typeof value === 'object' && authenticatedJobLeaseErrors.has(value as object))
}

export type CreatePostRagJobInput = Pick<
  PostRagJobDocument,
  'outboxId' | 'postId' | 'communityId' | 'sectionId' | 'action' | 'sourceVersion' | 'contentVersion'
> & { now: string }

export type FailPostRagJobError = Pick<PostRagJobError, 'code' | 'stage'>

const MAX_ATTEMPTS = 5
const RETRY_DELAYS_SECONDS = [5, 30, 120, 600] as const
const MAX_LEASE_TOKEN_ATTEMPTS = 5
const ACTIONS = new Set<PostRagJobAction>(['upsert', 'delete'])
const STATUSES = new Set<PostRagJobStatus>(['pending', 'processing', 'retry_wait', 'completed', 'dead_letter'])
const OUTCOMES = new Set<PostRagJobOutcome>(['indexed', 'removed', 'superseded'])
const ERROR_STAGES = new Set<string>(POST_RAG_JOB_ERROR_STAGES)
const ERROR_CODES = new Set<string>(POST_RAG_JOB_ERROR_CODES)
const ERROR_MESSAGES: Readonly<Record<PostRagJobErrorCode, string>> = Object.freeze({
  MAX_ATTEMPTS: 'Maximum RAG job attempts exhausted',
  SOURCE_NOT_FOUND: 'RAG source not found',
  SOURCE_SUPERSEDED: 'RAG source version superseded',
  VALIDATION_FAILED: 'RAG source validation failed',
  EMBEDDING_FAILED: 'RAG embedding failed',
  ES_UNAVAILABLE: 'RAG search index unavailable',
  ES_WRITE_FAILED: 'RAG search index write failed',
  MIRROR_WRITE_FAILED: 'RAG rollback mirror write failed',
  TIMEOUT: 'RAG job operation timed out',
  INTERNAL_ERROR: 'Internal RAG job error',
})
const ERROR_RETRYABILITY: Readonly<Record<PostRagJobErrorCode, boolean>> = Object.freeze({
  MAX_ATTEMPTS: false,
  SOURCE_NOT_FOUND: false,
  SOURCE_SUPERSEDED: false,
  VALIDATION_FAILED: false,
  EMBEDDING_FAILED: true,
  ES_UNAVAILABLE: true,
  ES_WRITE_FAILED: true,
  MIRROR_WRITE_FAILED: true,
  TIMEOUT: true,
  INTERNAL_ERROR: true,
})
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function hasExactOwnKeys(candidate: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(candidate)
  return keys.length === expected.length
    && expected.every((key) => Object.prototype.hasOwnProperty.call(candidate, key))
}

function ownPlainDataRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is malformed`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} has a custom prototype`)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const record: Record<string, unknown> = Object.create(null)
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key === 'symbol') throw new Error(`${label} contains a symbol key`)
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') throw new Error(`${label} contains an unsafe key`)
    const descriptor = descriptors[key]
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new Error(`${label} contains an accessor`)
    record[key] = descriptor.value
  }
  return record
}

function requireIdentifier(field: string, value: unknown, maxLength = 256): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || value !== value.trim()) {
    throw new Error(`${field} must be a valid identifier`)
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${field} must not contain control characters`)
  }
}

function requireIsoTimestamp(field: string, value: unknown): asserts value is string {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value)) {
    throw new Error(`${field} must be a valid ISO timestamp`)
  }
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a valid ISO timestamp`)
  }
}

function requireContentVersion(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error('contentVersion must be a nonnegative safe integer')
  }
}

function requireAttempts(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error('attempts must be a nonnegative safe integer')
  }
}

function validateAction(value: unknown): asserts value is PostRagJobAction {
  if (typeof value !== 'string' || !ACTIONS.has(value as PostRagJobAction)) {
    throw new Error('action must be upsert or delete')
  }
}

function validateErrorCode(field: string, value: unknown): asserts value is PostRagJobErrorCode {
  if (typeof value !== 'string' || !ERROR_CODES.has(value)) throw new Error(`${field} is invalid`)
}

function validateErrorStage(field: string, value: unknown): asserts value is PostRagJobErrorStage {
  if (typeof value !== 'string' || !ERROR_STAGES.has(value)) throw new Error(`${field} is invalid`)
}

function normalizeError(error: unknown, now: string): PostRagJobError {
  if (!error || typeof error !== 'object' || Array.isArray(error)) {
    throw new Error('error must be a structured object')
  }
  const candidate = error as Record<string, unknown>
  if (!hasExactOwnKeys(candidate, ['code', 'stage'])) {
    throw new Error('error must contain only code and stage; error.message and error.retryable are not accepted')
  }
  validateErrorCode('error.code', candidate.code)
  validateErrorStage('error.stage', candidate.stage)
  return {
    code: candidate.code,
    stage: candidate.stage,
    message: ERROR_MESSAGES[candidate.code],
    retryable: ERROR_RETRYABILITY[candidate.code],
    at: now,
  }
}

function validateStoredError(value: unknown) {
  if (value === null) return
  const candidate = ownPlainDataRecord(value, 'lastError')
  if (!hasExactOwnKeys(candidate, ['code', 'stage', 'message', 'retryable', 'at'])) throw new Error('lastError is malformed')
  validateErrorCode('lastError.code', candidate.code)
  validateErrorStage('lastError.stage', candidate.stage)
  requireIsoTimestamp('lastError.at', candidate.at)
  if (candidate.message !== ERROR_MESSAGES[candidate.code]) {
    throw new Error('lastError.message is malformed')
  }
  if (candidate.retryable !== ERROR_RETRYABILITY[candidate.code]) throw new Error('lastError.retryable is malformed')
}

function validateStoredJob(value: unknown, expectedId?: string): asserts value is PostRagJobDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('job state is malformed')
  const job = value as Record<string, unknown>
  if (!hasExactOwnKeys(job, [
    'schemaVersion', '_id', 'outboxId', 'postId', 'communityId', 'sectionId', 'action', 'sourceVersion',
    'contentVersion', 'status', 'attempts', 'nextAttemptAt', 'leaseOwner', 'leaseToken', 'leaseExpiresAt',
    'createdAt', 'updatedAt', 'outcome', 'lastError',
  ])) throw new Error('job state schema is malformed')
  if (job.schemaVersion !== 2) throw new Error('job schemaVersion must be 2')
  requireIdentifier('_id', job._id)
  if (expectedId !== undefined && job._id !== expectedId) throw new Error('job id does not match stored state')
  requireIdentifier('outboxId', job.outboxId)
  requireIdentifier('postId', job.postId)
  requireIdentifier('communityId', job.communityId)
  if (job.sectionId !== null) requireIdentifier('sectionId', job.sectionId)
  validateAction(job.action)
  requireIdentifier('sourceVersion', job.sourceVersion)
  requireContentVersion(job.contentVersion)
  if (typeof job.status !== 'string' || !STATUSES.has(job.status as PostRagJobStatus)) throw new Error('status is malformed')
  requireAttempts(job.attempts)
  requireIsoTimestamp('nextAttemptAt', job.nextAttemptAt)
  requireIsoTimestamp('createdAt', job.createdAt)
  requireIsoTimestamp('updatedAt', job.updatedAt)
  if (job.leaseOwner !== null) requireIdentifier('leaseOwner', job.leaseOwner)
  if (job.leaseToken !== null) requireIdentifier('leaseToken', job.leaseToken, 128)
  if (job.leaseExpiresAt !== null) requireIsoTimestamp('leaseExpiresAt', job.leaseExpiresAt)
  if (job.outcome !== null && (typeof job.outcome !== 'string' || !OUTCOMES.has(job.outcome as PostRagJobOutcome))) {
    throw new Error('outcome is malformed')
  }
  validateStoredError(job.lastError)

  if (job.status === 'processing' && (job.leaseOwner === null || job.leaseToken === null || job.leaseExpiresAt === null)) {
    throw new Error('processing job must have a lease')
  }
  if (job.status !== 'processing' && (job.leaseOwner !== null || job.leaseToken !== null || job.leaseExpiresAt !== null)) {
    throw new Error('non-processing job must not have a lease')
  }
  if (job.status === 'completed' && job.outcome === null) throw new Error('completed job must have an outcome')
  if (job.status !== 'completed' && job.outcome !== null) throw new Error('only completed jobs may have an outcome')
  if (job.status === 'pending' && job.attempts !== 0) throw new Error('pending job attempts must be zero')
  if (job.status !== 'pending' && job.attempts < 1) throw new Error('non-pending job attempts must be positive')
}

/** Read-only strict validation for consumers resolving persisted job references. */
export function validateStoredPostRagJob(value: unknown, expectedId?: string): asserts value is PostRagJobDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('job state is malformed')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new Error('job state has a custom prototype')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key === 'symbol') throw new Error('job state contains a symbol key')
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') throw new Error('job state contains an unsafe key')
    if (!Object.prototype.hasOwnProperty.call(descriptors[key], 'value')) throw new Error('job state contains an accessor')
  }
  validateStoredJob(value, expectedId)
  const job = value as PostRagJobDocument
  if (buildPostRagJobId(job.outboxId, job.postId, job.action, job.sourceVersion, job.contentVersion) !== job._id) {
    throw new Error('job deterministic id is malformed')
  }
}

function addSeconds(now: string, seconds: number) {
  return new Date(new Date(now).getTime() + seconds * 1000).toISOString()
}

function immutableFieldsMatch(existing: PostRagJobDocument, input: CreatePostRagJobInput) {
  return existing.outboxId === input.outboxId
    && existing.postId === input.postId
    && existing.communityId === input.communityId
    && existing.sectionId === input.sectionId
    && existing.action === input.action
    && existing.sourceVersion === input.sourceVersion
    && existing.contentVersion === input.contentVersion
}

function jobWithoutId(job: PostRagJobDocument): Omit<PostRagJobDocument, '_id'> {
  const { _id: _ignored, ...data } = job
  return data
}

export function buildPostRagJobId(
  outboxId: string,
  postId: string,
  action: PostRagJobAction,
  sourceVersion: string,
  contentVersion: number,
) {
  requireIdentifier('outboxId', outboxId)
  requireIdentifier('postId', postId)
  validateAction(action)
  requireIdentifier('sourceVersion', sourceVersion)
  requireContentVersion(contentVersion)
  return createHash('sha256').update(JSON.stringify([outboxId, postId, action, sourceVersion, contentVersion])).digest('hex')
}

export function validateCreatePostRagJobInput(input: CreatePostRagJobInput): void {
  requireIdentifier('outboxId', input?.outboxId)
  requireIdentifier('postId', input?.postId)
  requireIdentifier('communityId', input?.communityId)
  if (input?.sectionId !== null) requireIdentifier('sectionId', input?.sectionId)
  validateAction(input?.action)
  requireIdentifier('sourceVersion', input?.sourceVersion)
  requireContentVersion(input?.contentVersion)
  requireIsoTimestamp('now', input?.now)
}

export async function createPostRagJobInTransaction(
  transaction: db.DbTransaction,
  input: CreatePostRagJobInput,
): Promise<PostRagJobDocument> {
  if (!transaction || typeof transaction.collection !== 'function') throw new Error('transaction is required')
  validateCreatePostRagJobInput(input)

  const id = buildPostRagJobId(input.outboxId, input.postId, input.action, input.sourceVersion, input.contentVersion)
  const existing = await db.transactionGetByIdOrNull<PostRagJobDocument>(transaction, POST_RAG_JOBS, id)
  if (existing) {
    try {
      validateStoredJob(existing, id)
      if (!immutableFieldsMatch(existing, input)) throw new PostRagJobValidationError()
    } catch (error) {
      if (isPostRagJobValidationError(error)) throw error
      throw new PostRagJobValidationError()
    }
    return existing
  }

  const created: PostRagJobDocument = {
    schemaVersion: 2,
    _id: id,
    outboxId: input.outboxId,
    postId: input.postId,
    communityId: input.communityId,
    sectionId: input.sectionId,
    action: input.action,
    sourceVersion: input.sourceVersion,
    contentVersion: input.contentVersion,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: input.now,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    createdAt: input.now,
    updatedAt: input.now,
    outcome: null,
    lastError: null,
  }
  await transaction.collection(POST_RAG_JOBS).doc(id).set({ data: jobWithoutId(created) })
  return created
}

function isEligible(job: PostRagJobDocument, now: string) {
  if (job.status === 'pending') return true
  if (job.status === 'retry_wait') return job.nextAttemptAt <= now
  if (job.status === 'processing') return Boolean(job.leaseExpiresAt && job.leaseExpiresAt <= now)
  return false
}

function createDistinctLeaseToken(previousToken: string | null) {
  for (let attempt = 0; attempt < MAX_LEASE_TOKEN_ATTEMPTS; attempt += 1) {
    const candidate = randomUUID()
    if (candidate !== previousToken) return candidate
  }
  throw new Error('unable to generate a distinct lease token')
}

export async function claimPostRagJob(
  jobId: string,
  options: { workerId: string; now: string; leaseSeconds?: number },
): Promise<PostRagJobDocument | null> {
  requireIdentifier('jobId', jobId)
  requireIdentifier('workerId', options?.workerId)
  requireIsoTimestamp('now', options?.now)
  const leaseSeconds = options.leaseSeconds ?? 120
  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3600) {
    throw new Error('leaseSeconds must be an integer between 1 and 3600')
  }

  return db.runTransaction(async (transaction) => {
    const current = await db.transactionGetByIdOrNull<PostRagJobDocument>(transaction, POST_RAG_JOBS, jobId)
    if (!current) return null
    validateStoredJob(current, jobId)
    if (!isEligible(current, options.now)) return null
    if (current.attempts >= MAX_ATTEMPTS) {
      const exhausted: PostRagJobDocument = {
        ...current,
        status: 'dead_letter',
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: options.now,
        lastError: {
          code: 'MAX_ATTEMPTS', stage: 'claim', message: ERROR_MESSAGES.MAX_ATTEMPTS, retryable: false, at: options.now,
        },
      }
      await transaction.collection(POST_RAG_JOBS).doc(jobId).update({ data: jobWithoutId(exhausted) })
      return null
    }
    const leaseToken = createDistinctLeaseToken(current.leaseToken)
    const claimed: PostRagJobDocument = {
      ...current,
      status: 'processing',
      attempts: current.attempts + 1,
      leaseOwner: options.workerId,
      leaseToken,
      leaseExpiresAt: addSeconds(options.now, leaseSeconds),
      updatedAt: options.now,
    }
    await transaction.collection(POST_RAG_JOBS).doc(jobId).update({ data: jobWithoutId(claimed) })
    return claimed
  })
}

function assertCurrentLease(job: PostRagJobDocument, workerId: string, leaseToken: string, now: string) {
  if (job.status !== 'processing') throw new PostRagJobLeaseError('status')
  if (job.leaseOwner !== workerId) throw new PostRagJobLeaseError('owner')
  if (job.leaseToken !== leaseToken) throw new PostRagJobLeaseError('token')
  if (!job.leaseExpiresAt || job.leaseExpiresAt <= now) throw new PostRagJobLeaseError('expired')
}

export async function getPostRagJob(jobId: string): Promise<PostRagJobDocument> {
  requireIdentifier('jobId', jobId)
  const current = await db.getById(POST_RAG_JOBS, jobId) as PostRagJobDocument
  validateStoredPostRagJob(current, jobId)
  return current
}

export async function renewPostRagJobLease(
  jobId: string,
  options: { workerId: string; leaseToken: string; now: string; leaseSeconds?: number },
): Promise<PostRagJobDocument> {
  requireIdentifier('jobId', jobId); requireIdentifier('workerId', options?.workerId)
  requireIdentifier('leaseToken', options?.leaseToken, 128); requireIsoTimestamp('now', options?.now)
  const leaseSeconds = options.leaseSeconds ?? 120
  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3600) throw new Error('leaseSeconds must be an integer between 1 and 3600')
  return db.runTransaction(async (transaction) => {
    const current = await db.transactionGetByIdOrNull<PostRagJobDocument>(transaction, POST_RAG_JOBS, jobId)
    if (!current) throw new Error('job does not exist')
    validateStoredJob(current, jobId); assertCurrentLease(current, options.workerId, options.leaseToken, options.now)
    const renewed = { ...current, leaseExpiresAt: addSeconds(options.now, leaseSeconds), updatedAt: options.now }
    await transaction.collection(POST_RAG_JOBS).doc(jobId).update({ data: jobWithoutId(renewed) })
    return renewed
  })
}

export async function completePostRagJob(
  jobId: string,
  options: { workerId: string; leaseToken: string; now: string; outcome: PostRagJobOutcome },
): Promise<PostRagJobDocument> {
  requireIdentifier('jobId', jobId)
  requireIdentifier('workerId', options?.workerId)
  requireIdentifier('leaseToken', options?.leaseToken, 128)
  requireIsoTimestamp('now', options?.now)
  if (!OUTCOMES.has(options?.outcome)) throw new Error('outcome is invalid')
  return db.runTransaction(async (transaction) => {
    const current = await db.transactionGetByIdOrNull<PostRagJobDocument>(transaction, POST_RAG_JOBS, jobId)
    if (!current) throw new Error('job does not exist')
    validateStoredJob(current, jobId)
    assertCurrentLease(current, options.workerId, options.leaseToken, options.now)
    const completed: PostRagJobDocument = {
      ...current,
      status: 'completed',
      outcome: options.outcome,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: options.now,
    }
    await transaction.collection(POST_RAG_JOBS).doc(jobId).update({ data: jobWithoutId(completed) })
    return completed
  })
}

export async function failPostRagJob(
  jobId: string,
  options: { workerId: string; leaseToken: string; now: string; error: FailPostRagJobError },
): Promise<PostRagJobDocument> {
  requireIdentifier('jobId', jobId)
  requireIdentifier('workerId', options?.workerId)
  requireIdentifier('leaseToken', options?.leaseToken, 128)
  requireIsoTimestamp('now', options?.now)
  const error = normalizeError(options?.error, options.now)
  return db.runTransaction(async (transaction) => {
    const current = await db.transactionGetByIdOrNull<PostRagJobDocument>(transaction, POST_RAG_JOBS, jobId)
    if (!current) throw new Error('job does not exist')
    validateStoredJob(current, jobId)
    assertCurrentLease(current, options.workerId, options.leaseToken, options.now)
    const shouldDeadLetter = !error.retryable || current.attempts >= MAX_ATTEMPTS
    const failed: PostRagJobDocument = {
      ...current,
      status: shouldDeadLetter ? 'dead_letter' : 'retry_wait',
      nextAttemptAt: shouldDeadLetter
        ? options.now
        : addSeconds(options.now, RETRY_DELAYS_SECONDS[current.attempts - 1]),
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: options.now,
      lastError: error,
    }
    await transaction.collection(POST_RAG_JOBS).doc(jobId).update({ data: jobWithoutId(failed) })
    return failed
  })
}

export async function listPostRagJobCandidates(now: string, limit: number): Promise<string[]> {
  requireIsoTimestamp('now', now)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer between 1 and 100')
  const pageSize = 100
  const handledMalformedIds = new Set<string>()
  const byId = new Map<string, PostRagJobDocument>()
  let quarantinedCount = 0

  const quarantineMalformedJob = async (jobId: string) => db.runTransaction(async (transaction) => {
    const current = await db.transactionGetByIdOrNull<Record<string, unknown>>(transaction, POST_RAG_JOBS, jobId)
    if (!current || current.schemaVersion !== 2) return false
    try {
      validateStoredJob(current)
      return false
    } catch {
      await transaction.collection(POST_RAG_JOBS).doc(jobId).update({ data: {
        schemaVersion: -2,
        status: 'dead_letter',
        nextAttemptAt: now,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        outcome: null,
        updatedAt: now,
        lastError: {
          code: 'VALIDATION_FAILED',
          stage: 'claim',
          message: ERROR_MESSAGES.VALIDATION_FAILED,
          retryable: false,
          at: now,
        },
      } })
      return true
    }
  })

  const scans: Array<{ status: PostRagJobStatus; orderBy: [string, 'asc'] }> = [
    { status: 'pending', orderBy: ['createdAt', 'asc'] },
    { status: 'retry_wait', orderBy: ['nextAttemptAt', 'asc'] },
    { status: 'processing', orderBy: ['leaseExpiresAt', 'asc'] },
  ]
  for (const scan of scans) {
    let validForStatus = 0
    while (validForStatus < limit) {
      const page = await db.query(
        POST_RAG_JOBS,
        { schemaVersion: 2, status: scan.status },
        { orderBy: scan.orderBy, limit: pageSize },
      ) as unknown[]
      if (page.length === 0) break
      let quarantinedFromPage = false
      let stopOrderedScan = false
      for (const candidate of page) {
        try {
          validateStoredJob(candidate)
        } catch {
          const record = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : null
          if (record?.schemaVersion !== 2) continue
          const id = record._id
          try {
            requireIdentifier('_id', id)
          } catch {
            throw new Error('malformed RAG job cannot be quarantined: invalid _id')
          }
          if (handledMalformedIds.has(id as string)) {
            throw new Error('RAG job candidate scan made no progress after quarantine')
          }
          handledMalformedIds.add(id as string)
          if (await quarantineMalformedJob(id as string)) quarantinedCount += 1
          quarantinedFromPage = true
          break
        }
        const valid = candidate as PostRagJobDocument
        if (scan.status === 'retry_wait' && valid.nextAttemptAt > now) {
          stopOrderedScan = true
          break
        }
        if (scan.status === 'processing' && valid.leaseExpiresAt! > now) {
          stopOrderedScan = true
          break
        }
        if (isEligible(valid, now) && !byId.has(valid._id)) {
          byId.set(valid._id, valid)
          validForStatus += 1
          if (validForStatus >= limit) break
        }
      }
      if (stopOrderedScan || validForStatus >= limit) break
      if (quarantinedFromPage) continue
      break
    }
  }

  if (quarantinedCount > 0) {
    console.warn('[post-rag-jobs] quarantined malformed jobs', { count: quarantinedCount })
  }
  return [...byId.values()]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left._id.localeCompare(right._id))
    .slice(0, limit)
    .map((candidate) => candidate._id)
}
