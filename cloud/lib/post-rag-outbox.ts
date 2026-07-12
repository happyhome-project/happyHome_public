
import { createHash } from 'node:crypto'

import { DbTransaction, runTransaction, transactionGetByIdOrNull } from './db'

export const RAG_COMMUNITY_VERSIONS = 'rag_community_versions'
export const POST_RAG_OUTBOX = 'post_rag_outbox'

export type PostRagOutboxEventType =
  | 'post.upsert'
  | 'post.delete'
  | 'section.reindex'
  | 'community.reindex'
  | 'acl.invalidate'

export type PostRagOutboxAggregateType = 'post' | 'section' | 'community'

export type PostRagOutboxStatus =
  | 'pending'
  | 'processing'
  | 'retry_wait'
  | 'completed'
  | 'dead_letter'

export type PostRagOutboxError = {
  code: string
  message: string
  at: string
  retryable: boolean
}
export type PostRagOutboxReasonCode =
  | 'post.created'
  | 'post.updated'
  | 'post.deleted'
  | 'post.audit_changed'
  | 'section.metadata_changed'
  | 'section.status_changed'
  | 'section.widgets_changed'
  | 'community.metadata_changed'
  | 'community.status_changed'
  | 'community.acl_changed'

export type AppendPostRagOutboxEventInput = {
  communityId: string
  aggregateId: string
  reasonCode: PostRagOutboxReasonCode
  now?: string
}

export type AppendPostRagOutboxEventResult = {
  outboxId: string
  contentVersion: number
  aclVersion: number
}

type CommunityVersionDocument = {
  communityId: string
  contentVersion: number
  aclVersion: number
  createdAt: string
  updatedAt: string
}

export type PostRagOutboxPolicy = Readonly<{
  eventType: PostRagOutboxEventType
  aggregateType: PostRagOutboxAggregateType
  invalidatesAcl: boolean
}>

export const POST_RAG_OUTBOX_REASON_POLICIES = {
  'post.created': { eventType: 'post.upsert', aggregateType: 'post', invalidatesAcl: false },
  'post.updated': { eventType: 'post.upsert', aggregateType: 'post', invalidatesAcl: false },
  'post.audit_changed': { eventType: 'post.upsert', aggregateType: 'post', invalidatesAcl: false },
  'post.deleted': { eventType: 'post.delete', aggregateType: 'post', invalidatesAcl: false },
  'section.metadata_changed': { eventType: 'section.reindex', aggregateType: 'section', invalidatesAcl: false },
  'section.status_changed': { eventType: 'section.reindex', aggregateType: 'section', invalidatesAcl: true },
  'section.widgets_changed': { eventType: 'section.reindex', aggregateType: 'section', invalidatesAcl: true },
  'community.metadata_changed': { eventType: 'community.reindex', aggregateType: 'community', invalidatesAcl: false },
  'community.status_changed': { eventType: 'community.reindex', aggregateType: 'community', invalidatesAcl: true },
  'community.acl_changed': { eventType: 'acl.invalidate', aggregateType: 'community', invalidatesAcl: true },
} as const satisfies Readonly<Record<PostRagOutboxReasonCode, PostRagOutboxPolicy>>

function requireNonemptyString(field: string, value: unknown) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a nonempty string`)
  }
}

function resolveAndValidateNow(now: unknown) {
  if (typeof now !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(now)) {
    throw new Error('now must be a valid ISO timestamp')
  }
  const parsed = new Date(now)
  const canonicalInput = now.includes('.') ? now : now.replace(/Z$/, '.000Z')
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== canonicalInput) {
    throw new Error('now must be a valid ISO timestamp')
  }
  return now
}

function validateInput(input: AppendPostRagOutboxEventInput): PostRagOutboxPolicy {
  requireNonemptyString('communityId', input?.communityId)
  requireNonemptyString('aggregateId', input?.aggregateId)
  if (!Object.prototype.hasOwnProperty.call(POST_RAG_OUTBOX_REASON_POLICIES, input.reasonCode)) {
    throw new Error('reasonCode is unknown')
  }
  const policy = POST_RAG_OUTBOX_REASON_POLICIES[input.reasonCode]
  return policy
}

function validateCommunityVersions(current: CommunityVersionDocument, expectedCommunityId: string) {
  if (current.communityId !== expectedCommunityId) {
    throw new Error('communityId does not match stored community version')
  }
  if (!Number.isSafeInteger(current.contentVersion) || current.contentVersion < 0) {
    throw new Error('contentVersion must be a nonnegative safe integer')
  }
  if (!Number.isSafeInteger(current.aclVersion) || current.aclVersion < 0) {
    throw new Error('aclVersion must be a nonnegative safe integer')
  }
}

function createOutboxId(
  input: AppendPostRagOutboxEventInput,
  policy: PostRagOutboxPolicy,
  contentVersion: number,
  aclVersion: number,
) {
  return createHash('sha256').update(JSON.stringify([
    input.communityId,
    policy.eventType,
    policy.aggregateType,
    input.aggregateId,
    contentVersion,
    aclVersion,
  ])).digest('hex')
}

/**
 * Appends an indexing fact to an existing business transaction. The caller is
 * responsible for wrapping this together with the business write via
 * `runTransaction`; this function deliberately never starts its own one.
 */
export async function appendPostRagOutboxEvent(
  transaction: DbTransaction,
  input: AppendPostRagOutboxEventInput,
): Promise<AppendPostRagOutboxEventResult> {
  const policy = validateInput(input)
  const now = resolveAndValidateNow(input.now ?? new Date().toISOString())

  const current = await transactionGetByIdOrNull<CommunityVersionDocument>(
    transaction,
    RAG_COMMUNITY_VERSIONS,
    input.communityId,
  )
  if (current) validateCommunityVersions(current, input.communityId)
  const contentVersion = (current?.contentVersion ?? 0) + 1
  const aclVersion = (current?.aclVersion ?? 0) + (policy.invalidatesAcl ? 1 : 0)
  if (!Number.isSafeInteger(contentVersion)) {
    throw new Error('contentVersion must remain a nonnegative safe integer')
  }
  if (!Number.isSafeInteger(aclVersion)) {
    throw new Error('aclVersion must remain a nonnegative safe integer')
  }
  const outboxId = createOutboxId(input, policy, contentVersion, aclVersion)

  await transaction.collection(RAG_COMMUNITY_VERSIONS).doc(input.communityId).set({
    data: {
      communityId: input.communityId,
      contentVersion,
      aclVersion,
      createdAt: current?.createdAt || now,
      updatedAt: now,
    },
  })
  await transaction.collection(POST_RAG_OUTBOX).doc(outboxId).set({
    data: {
      schemaVersion: 2,
      communityId: input.communityId,
      aggregateType: policy.aggregateType,
      aggregateId: input.aggregateId,
      eventType: policy.eventType,
      reasonCode: input.reasonCode,
      contentVersion,
      aclVersion,
      status: 'pending' satisfies PostRagOutboxStatus,
      attempts: 0,
      nextAttemptAt: now,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: null as PostRagOutboxError | null,
      materializedJobId: null,
      fanoutSkip: 0,
      fanoutAfterPostId: null,
      createdAt: now,
      updatedAt: now,
    },
  })

  return { outboxId, contentVersion, aclVersion }
}

export async function runPostRagTransactionalMutation<T>(
  input: AppendPostRagOutboxEventInput | ((result: T) => AppendPostRagOutboxEventInput),
  mutate: (transaction: DbTransaction) => Promise<T>,
): Promise<{ result: T; outbox: AppendPostRagOutboxEventResult }> {
  return runTransaction(async transaction => {
    const result = await mutate(transaction)
    const outbox = await appendPostRagOutboxEvent(transaction, typeof input === 'function' ? input(result) : input)
    return { result, outbox }
  })
}
