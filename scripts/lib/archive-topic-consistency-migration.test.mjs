import test from 'node:test'
import assert from 'node:assert/strict'

import { planArchiveTopicConsistencyRepair } from './archive-topic-consistency-migration.mjs'

test('repair merges renamed duplicate identities and rebuilds links from authoritative posts', () => {
  const plan = planArchiveTopicConsistencyRepair({
    communities: [{ _id: 'community-1', archiveTopicOrder: ['家有小孩', '社区指南'], archiveTopicOrderRevision: 4 }],
    topics: [
      { _id: 'old', communityId: 'community-1', topicKey: '家有小孩', displayName: '教育成长', origins: ['admin'], enabled: true, status: 'active', recentPostCount: 9, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { _id: 'duplicate', communityId: 'community-1', topicKey: '教育成长', displayName: '教育成长', origins: ['organic'], enabled: true, status: 'active', recentPostCount: 1, createdAt: '2026-07-22', updatedAt: '2026-07-22' },
      { _id: 'guide', communityId: 'community-1', topicKey: '社区指南', displayName: '社区指南', origins: ['admin'], enabled: true, status: 'active', recentPostCount: 3, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ],
    posts: [
      { _id: 'post-1', communityId: 'community-1', area: 'archive', topics: ['教育成长'], status: 'active', auditStatus: 'pass', createdAt: '2026-07-22T01:00:00.000Z', sortKey: '2026-07-22T01:00:00.000Z_post-1' },
      { _id: 'post-2', communityId: 'community-1', area: 'archive', topics: ['教育成长'], status: 'active', auditStatus: 'pass', createdAt: '2026-07-22T02:00:00.000Z', sortKey: '2026-07-22T02:00:00.000Z_post-2' },
      { _id: 'post-deleted', communityId: 'community-1', area: 'archive', topics: ['社区指南'], status: 'deleted', auditStatus: 'pass', createdAt: '2026-01-01T00:00:00.000Z' },
    ],
    links: [
      { _id: 'wrong-link', communityId: 'community-1', topicKey: '教育成长', postId: 'post-1', status: 'active', auditStatus: 'pass', createdAt: '2026-07-22T01:00:00.000Z', sortKey: '2026-07-22T01:00:00.000Z_post-1' },
    ],
    now: '2026-07-22T03:00:00.000Z',
  })

  const canonical = plan.topicUpserts.find((item) => item.data.topicKey === '家有小孩')
  const duplicate = plan.topicUpserts.find((item) => item.data.topicKey === '教育成长')
  assert.equal(canonical.data.recentPostCount, 2)
  assert.deepEqual(canonical.data.origins, ['admin', 'organic'])
  assert.equal(duplicate.data.status, 'deleted')
  assert.equal(duplicate.data.enabled, false)
  assert.deepEqual(plan.communityUpdates, [])
  assert.deepEqual(plan.linkUpserts.map((item) => [item.data.postId, item.data.topicKey, item.data.status]), [
    ['post-1', '家有小孩', 'active'],
    ['post-2', '家有小孩', 'active'],
    ['post-deleted', '社区指南', 'deleted'],
  ])
  assert.deepEqual(plan.linkDeletes.map((item) => item.id), ['wrong-link'])
})

test('repair rewrites duplicate keys in explicit order and appends a newly discovered topic once', () => {
  const plan = planArchiveTopicConsistencyRepair({
    communities: [{ _id: 'community-1', archiveTopicOrder: ['教育成长', '家有小孩'], archiveTopicOrderRevision: 7 }],
    topics: [
      { _id: 'old', communityId: 'community-1', topicKey: '家有小孩', displayName: '教育成长', origins: ['admin'], enabled: true, status: 'active', createdAt: '2026-01-01' },
      { _id: 'duplicate', communityId: 'community-1', topicKey: '教育成长', displayName: '教育成长', origins: ['organic'], enabled: true, status: 'active', createdAt: '2026-07-22' },
    ],
    posts: [{ _id: 'post-1', communityId: 'community-1', area: 'archive', topics: ['新话题'], status: 'active', auditStatus: 'pass', createdAt: '2026-07-22T01:00:00.000Z' }],
    links: [],
    now: '2026-07-22T03:00:00.000Z',
  })

  assert.deepEqual(plan.communityUpdates, [{
    communityId: 'community-1', archiveTopicOrder: ['教育成长', '新话题'], archiveTopicOrderRevision: 8,
  }])
  assert.ok(plan.topicUpserts.some((item) => item.data.topicKey === '新话题' && item.data.recentPostCount === 1))
})
