import * as db from '../db'
import { archiveTopicId, syncArchivePostTopics } from '../archive-topic-index'

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
    status: 'active', enabled: true, origins: ['admin', 'organic'], recentPostCount: 5,
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
