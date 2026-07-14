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
    const existing = await db.getByIdOrNull<any>('archive_topics', topicId)
    const linkId = archivePostTopicId(post._id, topicKey)
    const existingLink = await db.getByIdOrNull<any>('archive_post_topics', linkId)
    const countsAsRecent = !existingLink && post.status === 'active' && post.auditStatus === 'pass'
    const { _id: _existingId, ...existingData } = existing || {}
    const origins = Array.from(new Set([...(existing?.origins || []), 'organic']))
    await db.setById('archive_topics', topicId, {
      ...existingData,
      communityId: post.communityId,
      topicKey,
      displayName: existing?.displayName || displayName,
      origins,
      enabled: existing?.enabled !== false,
      recentScore: Number(existing?.recentScore || 0) + (countsAsRecent ? 1 : 0),
      recentPostCount: Number(existing?.recentPostCount || 0) + (countsAsRecent ? 1 : 0),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    })
    await db.setById('archive_post_topics', linkId, {
      communityId: post.communityId,
      topicKey,
      postId: post._id,
      sortKey,
      createdAt: post.createdAt,
      status: post.status,
      auditStatus: post.auditStatus,
      updatedAt: now,
    })
  }
}

export async function updateArchivePostTopicLinks(postId: string, data: { status?: string; auditStatus?: string }) {
  await db.updateWhere('archive_post_topics', { postId }, { ...data, updatedAt: new Date().toISOString() })
}
