import test from 'node:test'
import assert from 'node:assert/strict'

import { planArchiveTopicConsistencyRepair } from './archive-topic-consistency-migration.mjs'

test('repair merges renamed duplicate identities and rebuilds links from authoritative posts', () => {
  const plan = planArchiveTopicConsistencyRepair({
    communities: [{ _id: 'community-1', archiveTopicOrder: ['家有小孩', '社区指南'], archiveTopicOrderRevision: 4 }],
    topics: [
      { _id: 'old', communityId: 'community-1', topicKey: '家有小孩', displayName: '教育成长', origins: ['admin'], enabled: true, status: 'active', recentScore: 2, recentPostCount: 9, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { _id: 'duplicate', communityId: 'community-1', topicKey: '教育成长', displayName: '教育成长', origins: ['organic'], enabled: true, status: 'active', recentScore: 3, recentPostCount: 1, adminOrder: 2, createdAt: '2026-07-22', updatedAt: '2026-07-22' },
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
  assert.equal(canonical.data.recentScore, 5)
  assert.equal(canonical.data.adminOrder, 2)
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

test('repair preserves the stable admin identity even when a duplicate key appears first in explicit order', () => {
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
    communityId: 'community-1', archiveTopicOrder: ['家有小孩', '新话题'], archiveTopicOrderRevision: 8,
  }])
  assert.ok(plan.topicUpserts.some((item) => item.data.topicKey === '新话题' && item.data.recentPostCount === 1))
})

test('an applied repair produces an empty residual plan with the same migration timestamp', () => {
  const input = {
    communities: [{ _id: 'community-1', archiveTopicOrder: ['家有小孩'], archiveTopicOrderRevision: 1 }],
    topics: [
      { _id: 'old', communityId: 'community-1', topicKey: '家有小孩', displayName: '教育成长', origins: ['admin'], enabled: true, status: 'active', recentScore: 1, recentPostCount: 8, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { _id: 'dup', communityId: 'community-1', topicKey: '教育成长', displayName: '教育成长', origins: ['organic'], enabled: true, status: 'active', recentScore: 2, recentPostCount: 1, createdAt: '2026-07-22', updatedAt: '2026-07-22' },
    ],
    posts: [{ _id: 'post-1', communityId: 'community-1', area: 'archive', topics: ['教育成长'], status: 'active', auditStatus: 'pass', createdAt: '2026-07-22T01:00:00.000Z' }],
    links: [],
    now: '2026-07-22T03:00:00.000Z',
  }
  const first = planArchiveTopicConsistencyRepair(input)
  const topics = input.topics.map((topic) => {
    const update = first.topicUpserts.find((item) => item.id === topic._id)
    return update ? { _id: topic._id, ...update.data } : topic
  })
  for (const update of first.topicUpserts.filter((item) => !topics.some((topic) => topic._id === item.id))) {
    topics.push({ _id: update.id, ...update.data })
  }
  const links = first.linkUpserts.map((item) => ({ _id: item.id, ...item.data }))
  const communities = input.communities.map((community) => {
    const update = first.communityUpdates.find((item) => item.communityId === community._id)
    return update ? { ...community, ...update } : community
  })

  const residual = planArchiveTopicConsistencyRepair({ ...input, communities, topics, links })

  assert.deepEqual(residual.summary, { topicUpserts: 0, linkUpserts: 0, linkDeletes: 0, communityUpdates: 0 })
})

test('a disabled stable admin topic stays disabled when merging an enabled organic duplicate', () => {
  const plan = planArchiveTopicConsistencyRepair({
    communities: [{ _id: 'community-1', archiveTopicOrder: ['家有小孩'], archiveTopicOrderRevision: 1 }],
    topics: [
      { _id: 'admin', communityId: 'community-1', topicKey: '家有小孩', displayName: '教育成长', origins: ['admin'], enabled: false, status: 'active', createdAt: '2026-01-01' },
      { _id: 'organic', communityId: 'community-1', topicKey: '教育成长', displayName: '教育成长', origins: ['organic'], enabled: true, status: 'active', createdAt: '2026-07-22' },
    ],
    posts: [],
    links: [],
    now: '2026-07-22T03:00:00.000Z',
  })

  const canonical = plan.topicUpserts.find((item) => item.id === 'admin')
  assert.equal(canonical.data.enabled, false)
})
