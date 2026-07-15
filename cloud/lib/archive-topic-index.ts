import { createHash } from 'crypto'
import * as db from './db'
import { normalizeArchiveTopic } from '../shared/archive-topics'

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

export async function syncArchivePostTopics(post: {
  _id: string
  communityId: string
  topics?: string[]
  createdAt: string
  status: string
  auditStatus: string
}) {
  const now = new Date().toISOString()
  const sortKey = buildArchiveSortKey(post.createdAt, post._id)
  for (const rawTopic of post.topics || []) {
    const { topicKey, displayName } = normalizeArchiveTopic(rawTopic)
    const topicId = archiveTopicId(post.communityId, topicKey)
    const linkId = archivePostTopicId(post._id, topicKey)
    await db.runTransaction(async transaction => {
      const [existing, existingLink, community] = await Promise.all([
        db.transactionGetByIdOrNull<any>(transaction, 'archive_topics', topicId),
        db.transactionGetByIdOrNull<any>(transaction, 'archive_post_topics', linkId),
        db.transactionGetByIdOrNull<any>(transaction, 'communities', post.communityId),
      ])
      const countsAsRecent = !existingLink && post.status === 'active' && post.auditStatus === 'pass'
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
        recentScore: Number(existing?.recentScore || 0) + (countsAsRecent ? 1 : 0),
        recentPostCount: Number(existing?.recentPostCount || 0) + (countsAsRecent ? 1 : 0),
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
      if (community && (reactivating || (!existing && Array.isArray(community.archiveTopicOrder)))) {
        const order = (community.archiveTopicOrder || []).filter((key: string) => key !== topicKey)
        await transaction.collection('communities').doc(post.communityId).update({ data: {
          archiveTopicOrder: [...order, topicKey],
          archiveTopicOrderRevision: Number(community.archiveTopicOrderRevision || 0) + 1,
        } })
      }
    })
  }
}

export async function updateArchivePostTopicLinks(postId: string, data: { status?: string; auditStatus?: string }) {
  await db.updateWhere('archive_post_topics', { postId }, { ...data, updatedAt: new Date().toISOString() })
}
