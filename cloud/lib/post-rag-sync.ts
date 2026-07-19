import * as db from './db'
import type { DbTransaction } from './db'
import { randomUUID } from 'crypto'

export const POST_RAG_SYNC_STATE = 'post_rag_sync_state'

export type RagIndexPolicy = 'business' | 'validation' | 'excluded'
export type PostRagSyncStatus = 'pending' | 'processing' | 'retry_wait' | 'synced' | 'dead_letter'

export interface PostRagSyncDocument {
  _id: string
  schemaVersion: 1
  postId: string
  communityId: string
  sectionId: string
  desiredRevision: number
  status: PostRagSyncStatus
  attempts: number
  reason: string
  requestedAt: string
  nextAttemptAt: string
  leaseOwner: string | null
  leaseToken: string | null
  leaseExpiresAt: string | null
  appliedSourceVersion: string | null
  indexScope: RagIndexPolicy | null
  lastErrorCode: string | null
  createdAt: string
  updatedAt: string
}

export interface SchedulePostRagSyncInput {
  postId: string
  communityId: string
  sectionId?: string
  reason: string
  now?: string
}

export interface ClaimedPostRagSync extends PostRagSyncDocument {
  status: 'processing'
  leaseOwner: string
  leaseToken: string
  leaseExpiresAt: string
}

function requireSafeText(value: unknown, field: string, maximumLength: number, allowEmpty = false) {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  const normalized = value.trim()
  if ((!allowEmpty && !normalized) || normalized.length > maximumLength || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${field} is invalid`)
  }
  return normalized
}

function requireIsoTimestamp(value: unknown, field: string) {
  const timestamp = requireSafeText(value, field, 32)
  const parsed = new Date(timestamp)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) throw new Error(`${field} is invalid`)
  return timestamp
}

function readCurrentRevision(current: Partial<PostRagSyncDocument> | null) {
  if (!current) return 0
  const revision = current.desiredRevision
  if (!Number.isSafeInteger(revision) || Number(revision) < 1 || Number(revision) >= Number.MAX_SAFE_INTEGER) {
    throw new Error('desiredRevision is invalid')
  }
  return Number(revision)
}

function readNullableString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readIndexScope(value: unknown): RagIndexPolicy | null {
  return value === 'business' || value === 'validation' || value === 'excluded' ? value : null
}

export async function schedulePostRagSyncInTransaction(
  transaction: DbTransaction,
  input: SchedulePostRagSyncInput,
) {
  const postId = requireSafeText(input.postId, 'postId', 256)
  const communityId = requireSafeText(input.communityId, 'communityId', 256)
  const sectionId = requireSafeText(input.sectionId || '', 'sectionId', 256, true)
  const reason = requireSafeText(input.reason, 'reason', 128)
  const now = requireIsoTimestamp(input.now || new Date().toISOString(), 'now')

  const current = await db.transactionGetByIdOrNull<Partial<PostRagSyncDocument>>(
    transaction,
    POST_RAG_SYNC_STATE,
    postId,
  )
  const desiredRevision = readCurrentRevision(current) + 1
  const createdAt = current ? requireIsoTimestamp(current.createdAt, 'createdAt') : now
  const document: Omit<PostRagSyncDocument, '_id'> = {
    schemaVersion: 1,
    postId,
    communityId,
    sectionId,
    desiredRevision,
    status: 'pending',
    attempts: 0,
    reason,
    requestedAt: now,
    nextAttemptAt: now,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    appliedSourceVersion: readNullableString(current?.appliedSourceVersion),
    indexScope: readIndexScope(current?.indexScope),
    lastErrorCode: null,
    createdAt,
    updatedAt: now,
  }
  await transaction.collection(POST_RAG_SYNC_STATE).doc(postId).set({ data: document })
  return { postId, desiredRevision }
}

export async function schedulePostRagSync(input: SchedulePostRagSyncInput) {
  return db.runTransaction((transaction) => schedulePostRagSyncInTransaction(transaction, input))
}

export async function schedulePostRagSyncForCurrentPosts(input: {
  communityId: string
  sectionId?: string
  reason: string
  now?: string
  maximumPosts?: number
}) {
  const communityId = requireSafeText(input.communityId, 'communityId', 256)
  const sectionId = input.sectionId ? requireSafeText(input.sectionId, 'sectionId', 256) : ''
  const reason = requireSafeText(input.reason, 'reason', 128)
  const now = requireIsoTimestamp(input.now || new Date().toISOString(), 'now')
  const maximumPosts = requirePositiveInteger(input.maximumPosts || 5_000, 'maximumPosts', 10_000)
  const postFilter = {
    communityId,
    ...(sectionId ? { sectionId } : {}),
  }
  let afterId: string | null = null
  const currentPosts: Array<{ _id?: string; communityId?: string; sectionId?: string }> = []
  while (true) {
    const posts = await db.queryAfterId('posts', postFilter, afterId, 100) as Array<{ _id?: string; communityId?: string; sectionId?: string }>
    if (!posts.length) break
    currentPosts.push(...posts)
    if (currentPosts.length > maximumPosts) throw new Error('RAG synchronization fanout exceeds maximumPosts')
    afterId = String(posts[posts.length - 1]._id || '')
    if (posts.length < 100) break
  }
  for (const post of currentPosts) {
    await schedulePostRagSync({
      postId: String(post._id || ''),
      communityId,
      sectionId: String(post.sectionId || sectionId),
      reason,
      now,
    })
  }
  return { scheduledCount: currentPosts.length }
}

function requirePositiveInteger(value: unknown, field: string, maximum: number) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) throw new Error(`${field} is invalid`)
  return number
}

export async function listPostRagSyncCandidates(input: { now?: string; limit?: number; postId?: string } = {}) {
  const now = requireIsoTimestamp(input.now || new Date().toISOString(), 'now')
  const limit = requirePositiveInteger(input.limit || 5, 'limit', 20)
  const postId = input.postId ? requireSafeText(input.postId, 'postId', 256) : ''
  if (postId) {
    const candidate = await db.getByIdOrNull<PostRagSyncDocument>(POST_RAG_SYNC_STATE, postId)
    return candidate && isClaimable(candidate, now) ? [candidate] : []
  }
  const candidates: PostRagSyncDocument[] = []
  for (const status of ['pending', 'retry_wait', 'processing'] as const) {
    const rows = await db.query(POST_RAG_SYNC_STATE, { status }, {
      orderBy: [status === 'pending' ? 'requestedAt' : status === 'retry_wait' ? 'nextAttemptAt' : 'leaseExpiresAt', 'asc'],
      limit: Math.min(100, limit * 4),
    }) as PostRagSyncDocument[]
    candidates.push(...rows.filter((row) => isClaimable(row, now)))
  }
  return candidates
    .sort((left, right) => claimableAt(left).localeCompare(claimableAt(right)) || left.postId.localeCompare(right.postId))
    .slice(0, limit)
}

function claimableAt(document: Partial<PostRagSyncDocument>) {
  if (document.status === 'processing') return String(document.leaseExpiresAt || '')
  if (document.status === 'retry_wait') return String(document.nextAttemptAt || '')
  return String(document.requestedAt || '')
}

function isClaimable(document: Partial<PostRagSyncDocument>, now: string) {
  if (document.status === 'pending') return true
  if (document.status === 'retry_wait') return Boolean(document.nextAttemptAt && document.nextAttemptAt <= now)
  return document.status === 'processing' && Boolean(document.leaseExpiresAt && document.leaseExpiresAt <= now)
}

export async function claimPostRagSync(
  postIdValue: string,
  input: { workerId: string; now?: string; leaseMs?: number },
): Promise<ClaimedPostRagSync | null> {
  const postId = requireSafeText(postIdValue, 'postId', 256)
  const workerId = requireSafeText(input.workerId, 'workerId', 256)
  const now = requireIsoTimestamp(input.now || new Date().toISOString(), 'now')
  const leaseMs = requirePositiveInteger(input.leaseMs || 60_000, 'leaseMs', 15 * 60_000)
  const leaseToken = randomUUID()
  return db.runTransaction(async (transaction) => {
    const current = await db.transactionGetByIdOrNull<PostRagSyncDocument>(transaction, POST_RAG_SYNC_STATE, postId)
    if (!current || !isClaimable(current, now)) return null
    const claimed: PostRagSyncDocument = {
      ...current,
      _id: postId,
      status: 'processing',
      leaseOwner: workerId,
      leaseToken,
      leaseExpiresAt: new Date(Date.parse(now) + leaseMs).toISOString(),
      updatedAt: now,
    }
    const { _id, ...data } = claimed
    await transaction.collection(POST_RAG_SYNC_STATE).doc(postId).set({ data })
    return claimed as ClaimedPostRagSync
  })
}

function ownsClaim(current: PostRagSyncDocument | null, input: { workerId: string; leaseToken: string; desiredRevision: number }) {
  return Boolean(current
    && current.status === 'processing'
    && current.leaseOwner === input.workerId
    && current.leaseToken === input.leaseToken
    && current.desiredRevision === input.desiredRevision)
}

export async function completePostRagSync(input: {
  postId: string
  workerId: string
  leaseToken: string
  desiredRevision: number
  sourceVersion: string
  indexScope: RagIndexPolicy | null
  now?: string
}) {
  const postId = requireSafeText(input.postId, 'postId', 256)
  const now = requireIsoTimestamp(input.now || new Date().toISOString(), 'now')
  return db.runTransaction(async (transaction) => {
    const current = await db.transactionGetByIdOrNull<PostRagSyncDocument>(transaction, POST_RAG_SYNC_STATE, postId)
    if (!ownsClaim(current, input)) return { applied: false, reason: 'superseded' as const }
    const completed: PostRagSyncDocument = {
      ...current!,
      status: 'synced',
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      nextAttemptAt: now,
      appliedSourceVersion: requireSafeText(input.sourceVersion, 'sourceVersion', 256),
      indexScope: input.indexScope,
      lastErrorCode: null,
      updatedAt: now,
    }
    const { _id, ...data } = completed
    await transaction.collection(POST_RAG_SYNC_STATE).doc(postId).set({ data })
    return { applied: true as const }
  })
}

export async function failPostRagSync(input: {
  postId: string
  workerId: string
  leaseToken: string
  desiredRevision: number
  errorCode: string
  retryable: boolean
  now?: string
  maxAttempts?: number
}) {
  const postId = requireSafeText(input.postId, 'postId', 256)
  const now = requireIsoTimestamp(input.now || new Date().toISOString(), 'now')
  const errorCode = requireSafeText(input.errorCode, 'errorCode', 64)
  const maxAttempts = requirePositiveInteger(input.maxAttempts || 5, 'maxAttempts', 20)
  return db.runTransaction(async (transaction) => {
    const current = await db.transactionGetByIdOrNull<PostRagSyncDocument>(transaction, POST_RAG_SYNC_STATE, postId)
    if (!ownsClaim(current, input)) return { applied: false, reason: 'superseded' as const }
    const attempts = current!.attempts + 1
    const deadLetter = !input.retryable || attempts >= maxAttempts
    const delaySeconds = Math.min(600, 5 * (2 ** Math.max(0, attempts - 1)))
    const failed: PostRagSyncDocument = {
      ...current!,
      status: deadLetter ? 'dead_letter' : 'retry_wait',
      attempts,
      nextAttemptAt: deadLetter ? now : new Date(Date.parse(now) + delaySeconds * 1000).toISOString(),
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      lastErrorCode: errorCode,
      updatedAt: now,
    }
    const { _id, ...data } = failed
    await transaction.collection(POST_RAG_SYNC_STATE).doc(postId).set({ data })
    return { applied: true as const, status: failed.status, attempts }
  })
}
