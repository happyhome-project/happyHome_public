import { randomUUID } from 'node:crypto'

import type { Post, Section } from '../shared/types'
import * as db from './db'
import { buildPostRagSourceProjection, isPostRagSourceProjectionValidationError } from './post-rag-indexing'
import { createPostRagJobInTransaction, isPostRagJobValidationError, POST_RAG_JOBS, validateCreatePostRagJobInput, validateStoredPostRagJob, type CreatePostRagJobInput, type PostRagJobDocument } from './post-rag-jobs'
import {
  POST_RAG_OUTBOX,
  POST_RAG_OUTBOX_REASON_POLICIES,
  type PostRagOutboxAggregateType,
  type PostRagOutboxEventType,
  type PostRagOutboxReasonCode,
  type PostRagOutboxStatus,
} from './post-rag-outbox'

type OutboxErrorCode = 'MAX_ATTEMPTS' | 'UNSUPPORTED_EVENT' | 'VALIDATION_FAILED' | 'INTERNAL_ERROR'
type OutboxError = { code: OutboxErrorCode; message: string; retryable: boolean; at: string }

export type PostRagOutboxDocument = {
  schemaVersion: 2
  _id: string
  communityId: string
  aggregateType: PostRagOutboxAggregateType
  aggregateId: string
  eventType: PostRagOutboxEventType
  reasonCode: PostRagOutboxReasonCode
  contentVersion: number
  aclVersion: number
  status: PostRagOutboxStatus
  attempts: number
  nextAttemptAt: string
  leaseOwner: string | null
  leaseToken: string | null
  leaseExpiresAt: string | null
  lastError: OutboxError | null
  materializedJobId: string | null
  fanoutSkip: number
  fanoutAfterPostId: string | null
  createdAt: string
  updatedAt: string
}

const authenticatedMaterializationErrors = new WeakSet<object>()

export class PostRagOutboxMaterializationError extends Error {
  declare readonly code: 'UNSUPPORTED_EVENT' | 'VALIDATION_FAILED'
  declare readonly retryable: boolean

  constructor(code: 'UNSUPPORTED_EVENT' | 'VALIDATION_FAILED') {
    if (code !== 'UNSUPPORTED_EVENT' && code !== 'VALIDATION_FAILED') throw new Error('Invalid materialization error code')
    super(code === 'UNSUPPORTED_EVENT' ? 'Unsupported RAG outbox materialization event' : 'Invalid RAG outbox materialization input')
    this.name = 'PostRagOutboxMaterializationError'
    Object.defineProperties(this, {
      code: { value: code, enumerable: true, writable: false, configurable: false },
      retryable: { value: code === 'UNSUPPORTED_EVENT', enumerable: true, writable: false, configurable: false },
    })
    authenticatedMaterializationErrors.add(this)
  }
}

export function isPostRagOutboxMaterializationError(value: unknown): value is PostRagOutboxMaterializationError {
  return Boolean(value && typeof value === 'object' && authenticatedMaterializationErrors.has(value as object))
}

function deterministicValidation<T>(operation: () => T): T {
  try { return operation() } catch { throw new PostRagOutboxMaterializationError('VALIDATION_FAILED') }
}

const MAX_ATTEMPTS = 5
const RETRY_DELAYS_SECONDS = [5, 30, 120, 600] as const
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const STATUSES = new Set(['pending', 'processing', 'retry_wait', 'completed', 'dead_letter'])
const EVENTS = new Set(['post.upsert', 'post.delete', 'section.reindex', 'community.reindex', 'acl.invalidate'])
const AGGREGATES = new Set(['post', 'section', 'community'])
const REASONS = new Set([
  'post.created', 'post.updated', 'post.deleted', 'post.audit_changed',
  'section.metadata_changed', 'section.status_changed', 'section.widgets_changed',
  'community.metadata_changed', 'community.status_changed', 'community.acl_changed',
])
const ERROR_POLICY: Readonly<Record<OutboxErrorCode, { message: string; retryable: boolean }>> = Object.freeze({
  MAX_ATTEMPTS: { message: 'Maximum RAG outbox attempts exhausted', retryable: false },
  UNSUPPORTED_EVENT: { message: 'RAG outbox event is not supported by this materializer', retryable: true },
  VALIDATION_FAILED: { message: 'RAG outbox validation failed', retryable: false },
  INTERNAL_ERROR: { message: 'Internal RAG outbox error', retryable: true },
})
const ERROR_CODES = new Set<OutboxErrorCode>(['MAX_ATTEMPTS', 'UNSUPPORTED_EVENT', 'VALIDATION_FAILED', 'INTERNAL_ERROR'])
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const EXACT_KEYS = [
  'schemaVersion', '_id', 'communityId', 'aggregateType', 'aggregateId', 'eventType', 'reasonCode',
  'contentVersion', 'aclVersion', 'status', 'attempts', 'nextAttemptAt', 'leaseOwner', 'leaseToken',
  'leaseExpiresAt', 'lastError', 'materializedJobId', 'fanoutSkip', 'fanoutAfterPostId', 'createdAt', 'updatedAt',
] as const

function requireIdentifier(field: string, value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${field} must be a valid identifier`)
  }
}

function requireTimestamp(field: string, value: unknown): asserts value is string {
  if (typeof value !== 'string' || !ISO.test(value) || new Date(value).toISOString() !== value) throw new Error(`${field} must be a valid ISO timestamp`)
}

function ownPlainDataDescriptors(value: unknown, label: string): PropertyDescriptorMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is malformed`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} has a custom prototype`)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key === 'symbol') throw new Error(`${label} contains a symbol key`)
    if (UNSAFE_KEYS.has(key)) throw new Error(`${label} contains an unsafe key`)
    if (!Object.prototype.hasOwnProperty.call(descriptors[key], 'value')) throw new Error(`${label} contains an accessor`)
  }
  return descriptors
}

function hasExactDescriptorKeys(descriptors: PropertyDescriptorMap, expected: readonly string[]) {
  const keys = Object.keys(descriptors)
  return keys.length === expected.length && expected.every((key) => Object.prototype.hasOwnProperty.call(descriptors, key))
}

function validateError(error: unknown) {
  if (error === null) return
  const descriptors = ownPlainDataDescriptors(error, 'lastError')
  if (!hasExactDescriptorKeys(descriptors, ['at', 'code', 'message', 'retryable'])) throw new Error('lastError is malformed')
  const candidate = Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value])) as Record<string, unknown>
  if (typeof candidate.code !== 'string' || !ERROR_CODES.has(candidate.code as OutboxErrorCode)) throw new Error('lastError.code is malformed')
  const policy = ERROR_POLICY[candidate.code as OutboxErrorCode]
  if (candidate.message !== policy.message || candidate.retryable !== policy.retryable) throw new Error('lastError policy is malformed')
  requireTimestamp('lastError.at', candidate.at)
}

function validateOutbox(value: unknown, expectedId?: string): asserts value is PostRagOutboxDocument {
  const descriptors = ownPlainDataDescriptors(value, 'outbox state')
  if (!hasExactDescriptorKeys(descriptors, EXACT_KEYS)) throw new Error('outbox state schema is malformed')
  const item = Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value])) as Record<string, unknown>
  if (item.schemaVersion !== 2) throw new Error('outbox schemaVersion must be 2')
  requireIdentifier('_id', item._id); if (expectedId && item._id !== expectedId) throw new Error('outbox id mismatch')
  requireIdentifier('communityId', item.communityId); requireIdentifier('aggregateId', item.aggregateId)
  if (!AGGREGATES.has(item.aggregateType as string)) throw new Error('aggregateType is malformed')
  if (!EVENTS.has(item.eventType as string)) throw new Error('eventType is malformed')
  if (!REASONS.has(item.reasonCode as string)) throw new Error('reasonCode is malformed')
  const policy = POST_RAG_OUTBOX_REASON_POLICIES[item.reasonCode as PostRagOutboxReasonCode]
  if (item.eventType !== policy.eventType || item.aggregateType !== policy.aggregateType) throw new Error('outbox reason policy is malformed')
  for (const field of ['contentVersion', 'aclVersion', 'attempts', 'fanoutSkip'] as const) {
    if (!Number.isSafeInteger(item[field]) || Number(item[field]) < 0) throw new Error(`${field} is malformed`)
  }
  if(item.fanoutAfterPostId!==null)requireIdentifier('fanoutAfterPostId',item.fanoutAfterPostId)
  if (!STATUSES.has(item.status as string)) throw new Error('status is malformed')
  requireTimestamp('nextAttemptAt', item.nextAttemptAt); requireTimestamp('createdAt', item.createdAt); requireTimestamp('updatedAt', item.updatedAt)
  if (item.leaseOwner !== null) requireIdentifier('leaseOwner', item.leaseOwner)
  if (item.leaseToken !== null) requireIdentifier('leaseToken', item.leaseToken)
  if (item.leaseExpiresAt !== null) requireTimestamp('leaseExpiresAt', item.leaseExpiresAt)
  if (item.materializedJobId !== null) requireIdentifier('materializedJobId', item.materializedJobId)
  validateError(item.lastError)
  if (item.status === 'processing' && (!item.leaseOwner || !item.leaseToken || !item.leaseExpiresAt)) throw new Error('processing outbox must have a lease')
  if (item.status === 'completed' && (!item.leaseOwner || !item.leaseToken || item.leaseExpiresAt)) throw new Error('completed outbox must retain completion fencing')
  if (item.status !== 'processing' && item.status !== 'completed' && (item.leaseOwner || item.leaseToken || item.leaseExpiresAt)) throw new Error('inactive outbox must not have a lease')
  if (item.status !== 'pending' && Number(item.attempts) < 1) throw new Error('non-pending attempts must be positive')
  if (item.status === 'completed' && item.aggregateType === 'post' && !item.materializedJobId) throw new Error('completed post outbox must reference a job')
  if (item.status !== 'completed' && item.materializedJobId) throw new Error('only completed outbox may reference a job')
}

export function validateStoredPostRagOutboxDocument(value: unknown, expectedId?: string): asserts value is PostRagOutboxDocument {
  validateOutbox(value, expectedId)
}

function withoutId(item: PostRagOutboxDocument) { const { _id: _id, ...data } = item; return data }
function addSeconds(now: string, seconds: number) { return new Date(new Date(now).getTime() + seconds * 1000).toISOString() }
function isEligible(item: PostRagOutboxDocument, now: string) {
  return item.status === 'pending' || (item.status === 'retry_wait' && item.nextAttemptAt <= now)
    || (item.status === 'processing' && Boolean(item.leaseExpiresAt && item.leaseExpiresAt <= now))
}

export async function claimPostRagOutboxEvent(outboxId: string, options: { workerId: string; now: string }): Promise<PostRagOutboxDocument | null> {
  requireIdentifier('outboxId', outboxId); requireIdentifier('workerId', options?.workerId); requireTimestamp('now', options?.now)
  return db.runTransaction(async (transaction) => {
    const current = await db.transactionGetByIdOrNull(transaction, POST_RAG_OUTBOX, outboxId)
    if (!current) return null
    validateOutbox(current, outboxId)
    if (!isEligible(current, options.now)) return null
    if (current.attempts >= MAX_ATTEMPTS) {
      const policy = ERROR_POLICY.MAX_ATTEMPTS
      await transaction.collection(POST_RAG_OUTBOX).doc(outboxId).update({ data: withoutId({ ...current, status: 'dead_letter', leaseOwner: null, leaseToken: null, leaseExpiresAt: null, updatedAt: options.now, lastError: { code: 'MAX_ATTEMPTS', ...policy, at: options.now } }) })
      return null
    }
    let leaseToken = randomUUID()
    for (let attempt = 0; attempt < 4 && leaseToken === current.leaseToken; attempt += 1) leaseToken = randomUUID()
    if (leaseToken === current.leaseToken) throw new Error('unable to generate distinct outbox lease token')
    const claimed: PostRagOutboxDocument = { ...current, status: 'processing', attempts: current.attempts + 1, leaseOwner: options.workerId, leaseToken, leaseExpiresAt: addSeconds(options.now, 120), updatedAt: options.now }
    await transaction.collection(POST_RAG_OUTBOX).doc(outboxId).update({ data: withoutId(claimed) })
    return claimed
  })
}

function assertLease(item: PostRagOutboxDocument, workerId: string, leaseToken: string, now: string) {
  if (item.status !== 'processing') throw new Error('outbox is not processing')
  if (item.leaseOwner !== workerId) throw new Error('outbox lease owner does not match worker')
  if (item.leaseToken !== leaseToken) throw new Error('outbox lease token does not match active claim')
  if (!item.leaseExpiresAt || item.leaseExpiresAt <= now) throw new Error('outbox lease has expired')
}

export async function failPostRagOutboxEvent(outboxId: string, options: { workerId: string; leaseToken: string; now: string; error: { code: OutboxErrorCode } }) {
  requireIdentifier('outboxId', outboxId); requireIdentifier('workerId', options?.workerId); requireIdentifier('leaseToken', options?.leaseToken); requireTimestamp('now', options?.now)
  const errorDescriptors = ownPlainDataDescriptors(options.error, 'error')
  if (!hasExactDescriptorKeys(errorDescriptors, ['code'])) throw new Error('error code is invalid')
  const errorCode = errorDescriptors.code.value
  if (typeof errorCode !== 'string' || !ERROR_CODES.has(errorCode as OutboxErrorCode)) throw new Error('error code is invalid')
  return db.runTransaction(async (transaction) => {
    const current = await db.transactionGetByIdOrNull(transaction, POST_RAG_OUTBOX, outboxId); if (!current) throw new Error('outbox does not exist')
    validateOutbox(current, outboxId); assertLease(current, options.workerId, options.leaseToken, options.now)
    const code = errorCode as OutboxErrorCode
    const policy = ERROR_POLICY[code]
    const dead = !policy.retryable || current.attempts >= MAX_ATTEMPTS
    const failed: PostRagOutboxDocument = { ...current, status: dead ? 'dead_letter' : 'retry_wait', nextAttemptAt: dead ? options.now : addSeconds(options.now, RETRY_DELAYS_SECONDS[current.attempts - 1]), leaseOwner: null, leaseToken: null, leaseExpiresAt: null, updatedAt: options.now, lastError: { code, ...policy, at: options.now } }
    await transaction.collection(POST_RAG_OUTBOX).doc(outboxId).update({ data: withoutId(failed) }); return failed
  })
}

function missingPost(item: PostRagOutboxDocument): Post {
  return { _id: item.aggregateId, communityId: item.communityId, sectionId: '', authorId: '', status: 'deleted', content: {}, commentCount: 0, likeCount: 0, createdAt: item.createdAt, updatedAt: item.createdAt } as Post
}

export async function materializeClaimedPostRagOutboxEventInTransaction(
  transaction: db.DbTransaction,
  outboxId: string,
  options: { workerId: string; leaseToken: string; now: string },
  dependencies: { buildProjection: typeof buildPostRagSourceProjection } = { buildProjection: buildPostRagSourceProjection },
) {
  deterministicValidation(() => {
    requireIdentifier('outboxId', outboxId); requireIdentifier('workerId', options?.workerId)
    requireIdentifier('leaseToken', options?.leaseToken); requireTimestamp('now', options?.now)
  })
  const current = await db.transactionGetByIdOrNull(transaction, POST_RAG_OUTBOX, outboxId); if (!current) throw new Error('outbox does not exist')
  deterministicValidation(() => validateOutbox(current, outboxId))
  if (current.status === 'completed') {
    if (current.leaseOwner !== options.workerId) throw new PostRagOutboxMaterializationError('VALIDATION_FAILED')
    if (current.leaseToken !== options.leaseToken) throw new PostRagOutboxMaterializationError('VALIDATION_FAILED')
    const existing = await db.transactionGetByIdOrNull<PostRagJobDocument>(transaction, POST_RAG_JOBS, current.materializedJobId!)
    if (!existing) throw new PostRagOutboxMaterializationError('VALIDATION_FAILED')
    deterministicValidation(() => validateStoredPostRagJob(existing, current.materializedJobId!))
    if (existing.outboxId !== current._id || existing.postId !== current.aggregateId
      || existing.communityId !== current.communityId || existing.contentVersion !== current.contentVersion) {
      throw new PostRagOutboxMaterializationError('VALIDATION_FAILED')
    }
    return { outbox: current, job: existing }
  }
  deterministicValidation(() => assertLease(current, options.workerId, options.leaseToken, options.now))
  if (current.aggregateType !== 'post' || (current.eventType !== 'post.upsert' && current.eventType !== 'post.delete')) throw new PostRagOutboxMaterializationError('UNSUPPORTED_EVENT')
  const storedPost = await db.transactionGetByIdOrNull<Post>(transaction, 'posts', current.aggregateId)
  if (storedPost && (storedPost._id !== current.aggregateId || storedPost.communityId !== current.communityId)) throw new PostRagOutboxMaterializationError('VALIDATION_FAILED')
  const post = storedPost || missingPost(current)
  const section = post.sectionId ? await db.transactionGetByIdOrNull<Section>(transaction, 'sections', post.sectionId) : null
  let projection: ReturnType<typeof buildPostRagSourceProjection>
  try {
    projection = dependencies.buildProjection(post, section)
  } catch (error) {
    if (isPostRagSourceProjectionValidationError(error)) throw new PostRagOutboxMaterializationError('VALIDATION_FAILED')
    throw error
  }
  const jobInput: CreatePostRagJobInput = { outboxId, postId: current.aggregateId, communityId: current.communityId, sectionId: storedPost?.sectionId || null, action: projection.eligible ? 'upsert' : 'delete', sourceVersion: projection.sourceVersion, contentVersion: current.contentVersion, now: options.now }
  deterministicValidation(() => validateCreatePostRagJobInput(jobInput))
  let job: PostRagJobDocument
  try {
    job = await createPostRagJobInTransaction(transaction, jobInput)
  } catch (error) {
    if (isPostRagJobValidationError(error)) throw new PostRagOutboxMaterializationError('VALIDATION_FAILED')
    throw error
  }
  const completed: PostRagOutboxDocument = { ...current, status: 'completed', leaseExpiresAt: null, materializedJobId: job._id, updatedAt: options.now }
  await transaction.collection(POST_RAG_OUTBOX).doc(outboxId).update({ data: withoutId(completed) })
  return { outbox: completed, job }
}

export async function materializeClaimedPostRagOutboxEvent(outboxId: string, options: { workerId: string; leaseToken: string; now: string }):Promise<any> {
  const snapshot = await db.getById(POST_RAG_OUTBOX, outboxId) as PostRagOutboxDocument
  validateOutbox(snapshot, outboxId)
  if (snapshot.aggregateType === 'post') return db.runTransaction((transaction) => materializeClaimedPostRagOutboxEventInTransaction(transaction, outboxId, options))
  if(snapshot.eventType==='acl.invalidate')return db.runTransaction(async transaction=>{const current=await db.transactionGetByIdOrNull<PostRagOutboxDocument>(transaction,POST_RAG_OUTBOX,outboxId);if(!current)throw new Error('outbox does not exist');validateOutbox(current,outboxId);assertLease(current,options.workerId,options.leaseToken,options.now);const completed={...current,status:'completed' as const,leaseExpiresAt:null,updatedAt:options.now};await transaction.collection(POST_RAG_OUTBOX).doc(outboxId).update({data:withoutId(completed)});return{outbox:completed,job:null,jobs:[]}})
  const where = snapshot.aggregateType === 'section' ? { communityId: snapshot.communityId, sectionId: snapshot.aggregateId } : { communityId: snapshot.communityId }
  const posts = await db.queryAfterId('posts',where,snapshot.fanoutAfterPostId,20) as Post[]
  return db.runTransaction(async transaction => {
    const current = await db.transactionGetByIdOrNull<PostRagOutboxDocument>(transaction, POST_RAG_OUTBOX, outboxId)
    if (!current) throw new Error('outbox does not exist')
    validateOutbox(current, outboxId); assertLease(current, options.workerId, options.leaseToken, options.now)
    const jobs: PostRagJobDocument[] = []
    for (const listed of posts) {
      const storedPost = await db.transactionGetByIdOrNull<Post>(transaction, 'posts', listed._id)
      if (!storedPost || storedPost.communityId !== current.communityId) continue
      const section = storedPost.sectionId ? await db.transactionGetByIdOrNull<Section>(transaction, 'sections', storedPost.sectionId) : null
      const projection = buildPostRagSourceProjection(storedPost, section)
      jobs.push(await createPostRagJobInTransaction(transaction, { outboxId, postId: storedPost._id, communityId: current.communityId,
        sectionId: storedPost.sectionId || null, action: projection.eligible ? 'upsert' : 'delete', sourceVersion: projection.sourceVersion,
        contentVersion: current.contentVersion, now: options.now }))
    }
    const done = posts.length < 20
    const updated: PostRagOutboxDocument = { ...current, status: done ? 'completed' : 'pending', attempts: done ? current.attempts : current.attempts - 1, fanoutSkip: current.fanoutSkip + posts.length,fanoutAfterPostId:posts[posts.length-1]?._id||current.fanoutAfterPostId,
      leaseExpiresAt: null, ...(done ? {} : { leaseOwner: null, leaseToken: null }), updatedAt: options.now, nextAttemptAt: options.now }
    await transaction.collection(POST_RAG_OUTBOX).doc(outboxId).update({ data: withoutId(updated) })
    return { outbox: updated, job: jobs[0] || null, jobs }
  })
}

export async function listPostRagOutboxCandidates(now: string, limit: number): Promise<string[]> {
  requireTimestamp('now', now); if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be between 1 and 100')
  const found = new Map<string, PostRagOutboxDocument>()
  const quarantinedIds = new Set<string>()
  let quarantinedCount = 0
  for (const [status, orderBy] of [['pending', 'createdAt'], ['retry_wait', 'nextAttemptAt'], ['processing', 'leaseExpiresAt']] as const) {
    let validForStatus = 0
    while (validForStatus < limit) {
      const page = await db.query(POST_RAG_OUTBOX, { schemaVersion: 2, status }, { orderBy: [orderBy, 'asc'], limit: 100 }) as unknown[]
      if (page.length === 0) break
      let quarantined = false
      let stop = false
      for (const candidate of page) {
        try {
          validateOutbox(candidate)
        } catch {
          const id = candidate && typeof candidate === 'object' ? (candidate as Record<string, unknown>)._id : null
          requireIdentifier('_id', id)
          if (quarantinedIds.has(id)) throw new Error('RAG outbox candidate scan made no progress after quarantine')
          quarantinedIds.add(id)
          const didQuarantine = await db.runTransaction(async (transaction) => {
            const current = await db.transactionGetByIdOrNull<Record<string, unknown>>(transaction, POST_RAG_OUTBOX, id)
            if (!current || current.schemaVersion !== 2) return false
            try { validateOutbox(current); return false } catch { /* quarantine the still-malformed schema-v2 record */ }
            const policy = ERROR_POLICY.VALIDATION_FAILED
            await transaction.collection(POST_RAG_OUTBOX).doc(id).update({ data: {
              schemaVersion: -2, status: 'dead_letter', nextAttemptAt: now, leaseOwner: null, leaseToken: null,
              leaseExpiresAt: null, materializedJobId: null, updatedAt: now,
              lastError: { code: 'VALIDATION_FAILED', ...policy, at: now },
            } })
            return true
          })
          if (didQuarantine) quarantinedCount += 1
          quarantined = true
          break
        }
        if ((status === 'retry_wait' && candidate.nextAttemptAt > now) || (status === 'processing' && candidate.leaseExpiresAt! > now)) { stop = true; break }
        if (isEligible(candidate, now) && !found.has(candidate._id)) { found.set(candidate._id, candidate); validForStatus += 1 }
        if (validForStatus >= limit) break
      }
      if (quarantined) continue
      if (stop || validForStatus >= limit) break
      break
    }
  }
  if (quarantinedCount) console.warn('[post-rag-outbox] quarantined malformed events', { count: quarantinedCount })
  return [...found.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a._id.localeCompare(b._id)).slice(0, limit).map((item) => item._id)
}
