import * as db from '../../../lib/db'
import { archiveTopicId, syncArchivePostTopics } from '../../../lib/archive-topic-index'
import { handleListArchive } from '../index'

const local = db as typeof db & { _resetAll(): void }

beforeEach(() => local._resetAll())

test('a post selecting a renamed display name appears in the configured stable-key tab', async () => {
  await db.setById('communities', 'community-1', {
    status: 'active', archiveTopicOrder: ['家有小孩'], archiveTopicOrderRevision: 2,
  })
  await db.create('community_members', { communityId: 'community-1', userId: 'viewer-1', status: 'active' })
  await db.setById('archive_topics', archiveTopicId('community-1', '家有小孩'), {
    communityId: 'community-1', topicKey: '家有小孩', displayName: '教育成长',
    origins: ['admin'], enabled: true, status: 'active', recentScore: 0, recentPostCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
  })
  const post = {
    _id: 'post-education', communityId: 'community-1', area: 'archive', topics: ['教育成长'],
    authorId: 'author-1', status: 'active', auditStatus: 'pass',
    createdAt: '2026-07-22T01:00:00.000Z', sortKey: '2026-07-22T01:00:00.000Z_post-education',
    content: { title: '教育成长测试' },
  }
  await db.setById('posts', post._id, post)
  await syncArchivePostTopics(post)

  const result = await handleListArchive({ communityId: 'community-1', topicKey: '家有小孩' }, 'viewer-1')

  expect(result.posts.map((item) => item._id)).toEqual(['post-education'])
})
