import { createHash } from 'crypto'
import * as db from './db'
import { resolveArchiveTopicReferences } from '../shared/archive-topics'

export function archivePostTopicId(postId: string, topicKey: string): string {
  const digest = createHash('sha1').update(`${postId}\u0000${topicKey}`).digest('hex')
  return `apt_${digest}`
}

export function buildArchiveSortKey(createdAt: string, postId: string): string {
  return `${createdAt}_${postId}`
}

export function archiveTopicId(communityId: string, topicKey: string): string {
  return `at_${createHash('sha1').update(`${communityId}\u0000${topicKey}`).digest('hex')}`
}

export type ArchivePostTopicSource = {
  _id: string
  communityId: string
  topics?: string[]
  createdAt: string
  status: string
  auditStatus: string
}

export type PreparedArchivePostTopicReconciliation = {
  references: Array<{ topicKey: string; displayName: string }>
  existingLinks: any[]
}

export async function prepareArchivePostTopicReconciliation(
  post: ArchivePostTopicSource,
): Promise<PreparedArchivePostTopicReconciliation> {
  const [community, queriedTopics, queriedLinks] = await Promise.all([
    db.getByIdOrNull<any>('communities', post.communityId),
    db.query('archive_topics', { communityId: post.communityId }, { limit: 100 }) as Promise<any[]>,
    db.query('archive_post_topics', { postId: post._id }, { limit: 100 }) as Promise<any[]>,
  ])
  const existingTopics = Array.isArray(queriedTopics)
    ? queriedTopics.filter((topic) => typeof topic?.topicKey === 'string' && typeof topic?.displayName === 'string')
    : []
  const existingLinks = Array.isArray(queriedLinks) ? queriedLinks : []
  return {
    references: resolveArchiveTopicReferences(
      post.topics || [],
      existingTopics,
      Array.isArray(community?.archiveTopicOrder) ? community.archiveTopicOrder : [],
    ),
    existingLinks,
  }
}

export async function reconcileArchivePostTopicsInTransaction(
  transaction: db.DbTransaction,
  post: ArchivePostTopicSource,
  prepared: PreparedArchivePostTopicReconciliation,
  now = new Date().toISOString(),
) {
  const sortKey = buildArchiveSortKey(post.createdAt, post._id)
  const desiredKeys = new Set(prepared.references.map((reference) => reference.topicKey))
  for (const link of prepared.existingLinks) {
    if (desiredKeys.has(String(link.topicKey))) continue
    await transaction.collection('archive_post_topics').doc(link._id).update({ data: { status: 'deleted', updatedAt: now } })
  }

  const currentCommunity = await db.transactionGetByIdOrNull<any>(transaction, 'communities', post.communityId)
  let nextOrder = Array.isArray(currentCommunity?.archiveTopicOrder) ? [...currentCommunity.archiveTopicOrder] : null
  let orderChanged = false
  for (const { topicKey, displayName } of prepared.references) {
    const topicId = archiveTopicId(post.communityId, topicKey)
    const linkId = archivePostTopicId(post._id, topicKey)
    const [existing, existingLink] = await Promise.all([
      db.transactionGetByIdOrNull<any>(transaction, 'archive_topics', topicId),
      db.transactionGetByIdOrNull<any>(transaction, 'archive_post_topics', linkId),
    ])
    const reactivating = existing?.status === 'deleted'
    const { _id: _existingId, deletedAt: _deletedAt, deletedByAccountId: _deletedBy, ...existingData } = existing || {}
    const origins = Array.from(new Set([...(existing?.origins || []), 'organic']))
    await transaction.collection('archive_topics').doc(topicId).set({ data: {
      ...existingData,
      communityId: post.communityId,
      topicKey,
      displayName: existing?.displayName || displayName,
      origins,
      enabled: reactivating ? true : existing?.enabled !== false,
      status: 'active',
      recentScore: Number(existing?.recentScore || 0) + (!existingLink && post.status === 'active' && post.auditStatus === 'pass' ? 1 : 0),
      recentPostCount: Number(existing?.recentPostCount || 0),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    } })
    await transaction.collection('archive_post_topics').doc(linkId).set({ data: {
      communityId: post.communityId,
      topicKey,
      postId: post._id,
      sortKey,
      createdAt: post.createdAt,
      status: post.status,
      auditStatus: post.auditStatus,
      updatedAt: now,
    } })
    if (nextOrder && (reactivating || !existing)) {
      nextOrder = [...nextOrder.filter((key: string) => key !== topicKey), topicKey]
      orderChanged = true
    }
  }
  if (currentCommunity && nextOrder && orderChanged) {
    await transaction.collection('communities').doc(post.communityId).update({ data: {
      archiveTopicOrder: nextOrder,
      archiveTopicOrderRevision: Number(currentCommunity.archiveTopicOrderRevision || 0) + 1,
    } })
  }
}

export async function syncArchivePostTopics(post: ArchivePostTopicSource) {
  const prepared = await prepareArchivePostTopicReconciliation(post)
  await db.runTransaction(async transaction => {
    await reconcileArchivePostTopicsInTransaction(transaction, post, prepared)
  })
}

export async function updateArchivePostTopicLinks(postId: string, data: { status?: string; auditStatus?: string }) {
  await db.updateWhere('archive_post_topics', { postId }, { ...data, updatedAt: new Date().toISOString() })
}
