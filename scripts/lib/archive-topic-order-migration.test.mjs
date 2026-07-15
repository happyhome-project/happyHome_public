import test from 'node:test'
import assert from 'node:assert/strict'
import { planArchiveTopicOrderBackfill } from './archive-topic-order-migration.mjs'

test('backfill only updates communities without explicit order and preserves current tab ranking', () => {
  const plan = planArchiveTopicOrderBackfill([
    { _id: 'new', archiveTopicOrder: ['keep'], archiveTopicOrderRevision: 4 },
    { _id: 'legacy' },
  ], [
    { communityId: 'legacy', topicKey: 'hot', displayName: '热门', origins: ['organic'], enabled: true, recentScore: 9 },
    { communityId: 'legacy', topicKey: 'first', displayName: '历史', origins: ['legacy'], enabled: true, legacyOrder: 1 },
    { communityId: 'legacy', topicKey: 'deleted', displayName: '删除', origins: ['legacy'], enabled: true, status: 'deleted', legacyOrder: 0 },
    { communityId: 'legacy', topicKey: 'hidden', displayName: '隐藏', origins: ['admin'], enabled: false, adminOrder: 0 },
  ])
  assert.deepEqual(plan, [{ communityId: 'legacy', archiveTopicOrder: ['first', 'hot'], archiveTopicOrderRevision: 1 }])
})
