import * as db from './db'
import type { DbTransaction } from './db'

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
