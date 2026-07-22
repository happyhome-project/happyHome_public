import * as db from '../db'
import { archivePostTopicId, archiveTopicId, syncArchivePostTopics } from '../archive-topic-index'

const local = db as typeof db & { _resetAll(): void }

beforeEach(() => local._resetAll())

test('an organic post reactivates a deleted same-name topic at the end without removing history', async () => {
  await db.setById('communities', 'community-1', {
    archiveTopicOrder: ['existing'], archiveTopicOrderRevision: 2,
  })
  await db.setById('archive_topics', archiveTopicId('community-1', '宠物'), {
    communityId: 'community-1', topicKey: '宠物', displayName: '宠物', origins: ['admin'],
    enabled: false, status: 'deleted', recentScore: 4, recentPostCount: 4,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  })

  await syncArchivePostTopics({
    _id: 'post-1', communityId: 'community-1', topics: ['宠物'],
    createdAt: '2026-07-15T00:00:00.000Z', status: 'active', auditStatus: 'pass',
  })

  await expect(db.getById('archive_topics', archiveTopicId('community-1', '宠物'))).resolves.toMatchObject({
    status: 'active', enabled: true, origins: ['admin', 'organic'], recentPostCount: 4,
  })
  await expect(db.getById('communities', 'community-1')).resolves.toMatchObject({
    archiveTopicOrder: ['existing', '宠物'], archiveTopicOrderRevision: 3,
  })
  expect(await db.query('archive_post_topics', { communityId: 'community-1', topicKey: '宠物' })).toHaveLength(1)
})

test('a newly discovered organic topic appends to an existing explicit order', async () => {
  await db.setById('communities', 'community-1', { archiveTopicOrder: ['existing'], archiveTopicOrderRevision: 7 })
  await syncArchivePostTopics({
    _id: 'post-2', communityId: 'community-1', topics: ['新话题'],
    createdAt: '2026-07-15T00:00:00.000Z', status: 'active', auditStatus: 'pass',
  })
  await expect(db.getById('communities', 'community-1')).resolves.toMatchObject({
    archiveTopicOrder: ['existing', '新话题'], archiveTopicOrderRevision: 8,
  })
})

test('a post using a renamed display name reuses the configured stable topic key', async () => {
  await db.setById('communities', 'community-1', {
    archiveTopicOrder: ['家有小孩'], archiveTopicOrderRevision: 3,
  })
  await db.setById('archive_topics', archiveTopicId('community-1', '家有小孩'), {
    communityId: 'community-1', topicKey: '家有小孩', displayName: '教育成长',
    origins: ['admin'], enabled: true, status: 'active', recentScore: 2, recentPostCount: 2,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
  })

  await syncArchivePostTopics({
    _id: 'post-renamed', communityId: 'community-1', topics: ['教育成长'],
    createdAt: '2026-07-22T01:00:00.000Z', status: 'active', auditStatus: 'pass',
  })

  await expect(db.getById('archive_post_topics', archivePostTopicId('post-renamed', '家有小孩')))
    .resolves.toMatchObject({ topicKey: '家有小孩', postId: 'post-renamed', status: 'active', auditStatus: 'pass' })
  await expect(db.getByIdOrNull('archive_topics', archiveTopicId('community-1', '教育成长'))).resolves.toBeNull()
})

test('resync marks links that are no longer present on the authoritative post as deleted', async () => {
  await db.setById('communities', 'community-1', { archiveTopicOrder: [], archiveTopicOrderRevision: 0 })
  const post = {
    _id: 'post-edit', communityId: 'community-1', topics: ['旧话题', '保留话题'],
    createdAt: '2026-07-22T01:00:00.000Z', status: 'active', auditStatus: 'pass',
  }
  await syncArchivePostTopics(post)
  await syncArchivePostTopics({ ...post, topics: ['保留话题'] })

  await expect(db.getById('archive_post_topics', archivePostTopicId('post-edit', '旧话题')))
    .resolves.toMatchObject({ status: 'deleted' })
  await expect(db.getById('archive_post_topics', archivePostTopicId('post-edit', '保留话题')))
    .resolves.toMatchObject({ status: 'active', auditStatus: 'pass' })
})
