import assert from 'node:assert/strict'
import test from 'node:test'
import { planArchiveMigration } from './archive-migration.mjs'

test('plans only evergreen sections and preserves existing topics', () => {
  const input = {
    communityId: 'community-1',
    sections: [
      { _id: 'evergreen-2', communityId: 'community-1', name: '闲置', type: 'evergreen', order: 2 },
      { _id: 'live-1', communityId: 'community-1', name: '活动召集', type: 'realtime', order: 1 },
      { _id: 'evergreen-1', communityId: 'community-1', name: ' #亲子出游 ', type: 'evergreen', order: 1 },
    ],
    posts: [
      { _id: 'post-1', communityId: 'community-1', sectionId: 'evergreen-1', status: 'active', auditStatus: 'pass', topics: ['PET'], createdAt: '2026-07-14T10:00:00.000Z' },
      { _id: 'post-live', communityId: 'community-1', sectionId: 'live-1', status: 'active', auditStatus: 'pass', createdAt: '2026-07-14T11:00:00.000Z' },
    ],
  }

  const plan = planArchiveMigration(input)

  assert.deepEqual(plan.topicUpserts.map((item) => item.displayName), ['亲子出游', '闲置'])
  assert.equal(plan.postUpdates.length, 1)
  assert.deepEqual(plan.postUpdates[0].data.topics, ['PET', '亲子出游'])
  assert.equal(plan.postUpdates[0].data.origin, 'legacy_section')
  assert.equal(plan.topicLinks.length, 2)
  assert.equal(plan.skippedRealtime, 1)
})

test('migration plan is deterministic and warns instead of dropping media-less legacy posts', () => {
  const input = {
    communityId: 'community-1',
    sections: [{ _id: 'section-1', communityId: 'community-1', name: '家书', type: 'evergreen', order: 1 }],
    posts: [{ _id: 'post-1', communityId: 'community-1', sectionId: 'section-1', status: 'active', createdAt: 'invalid' }],
  }

  const first = planArchiveMigration(input)
  const second = planArchiveMigration(input)

  assert.deepEqual(first, second)
  assert.equal(first.postUpdates.length, 1)
  assert.equal(first.warnings[0].postId, 'post-1')
  assert.match(first.topicLinks[0]._id, /^apt_[a-f0-9]{40}$/)
})
