import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyPlanToSnapshot,
  buildGlobalCollaborationTemplates,
  buildWidgetMapping,
  classifyRealtimeSection,
  createGlobalCollaborationManifest,
  executeVerifiedGlobalCollaborationPlan,
  planGlobalCollaborationMigration,
  verifyGlobalCollaborationManifest,
} from './global-collaboration-migration.mjs'

const NOW = '2026-07-15T08:00:00.000Z'
const HEAD = 'a'.repeat(40)

function carpoolWidgets() {
  return [
    { widgetId: 'legacy_from', type: 'short_text', label: '出发地', fieldKey: 'origin', required: true, order: 0, showInList: true },
    { widgetId: 'legacy_to', type: 'short_text', label: '目的地', fieldKey: 'destination', required: true, order: 1, showInList: true },
    { widgetId: 'legacy_when', type: 'datetime', label: '出发时间', fieldKey: 'departureTime', required: true, order: 2, showInList: true },
    { widgetId: 'legacy_map', type: 'location', label: '地图位置', fieldKey: 'location', required: true, order: 3, showInList: false },
  ]
}

function activityWidgets() {
  return [
    { widgetId: 'old_title', type: 'short_text', label: '邀约主题', fieldKey: 'title', required: true, order: 0, showInList: true },
    { widgetId: 'old_starts', type: 'datetime', label: '出发时间', fieldKey: 'startsAt', required: true, order: 1, showInList: true },
    { widgetId: 'old_location', type: 'location', label: '集合地点', fieldKey: 'location', required: true, order: 2, showInList: false },
    { widgetId: 'old_contact', type: 'short_text', label: '联系电话', fieldKey: 'contact', required: true, order: 3, showInList: false, visibility: 'member' },
    { widgetId: 'old_capacity', type: 'number', label: '人数上限', fieldKey: 'capacity', required: true, order: 4, showInList: false, unit: '人' },
    { widgetId: 'old_note', type: 'note_blocks', label: '补充说明', fieldKey: 'note', required: false, order: 5, showInList: false },
    { widgetId: 'old_attendance', type: 'attendance', label: '我要参与', fieldKey: 'attendance', required: false, order: 6, showInList: true, capacityWidgetId: 'old_capacity' },
  ]
}

function fixture() {
  return {
    communities: [
      { _id: 'community-teacher', name: '名师班', coverImage: 'cloud://env/shared.jpg' },
      { _id: 'community-qingshan', name: '青山村' },
      { _id: 'community-other', name: '其他社群' },
    ],
    sections: [
      { _id: 'archive-section', communityId: 'community-qingshan', name: '图文', type: 'evergreen', widgets: [{ widgetId: 'body', type: 'note_blocks' }] },
      { _id: 'carpool-section', communityId: 'community-teacher', name: '拼车出行', type: 'realtime', widgets: carpoolWidgets() },
      { _id: 'activity-section', communityId: 'community-qingshan', name: '出游邀约', type: 'realtime', widgets: activityWidgets() },
      { _id: 'discard-section', communityId: 'community-other', name: '闲置协作', type: 'realtime', widgets: [{ widgetId: 'body', type: 'short_text', label: '内容', required: true }] },
    ],
    posts: [
      {
        _id: 'archive-post', communityId: 'community-qingshan', sectionId: 'archive-section', area: 'archive',
        content: { body: [{ type: 'image', fileID: 'cloud://env/shared.jpg' }] }, status: 'active',
      },
      {
        _id: 'carpool-post', communityId: 'community-teacher', sectionId: 'carpool-section', status: 'active',
        content: { legacy_from: '青山村', legacy_to: '成都', legacy_when: '2026-07-16T00:00:00.000Z', legacy_map: { address: '东门' }, untouched: 'keep' },
        pendingContent: { legacy_from: '西门', legacy_to: '绵竹', legacy_when: '2026-07-17T00:00:00.000Z', legacy_map: { address: '西门' } },
      },
      {
        _id: 'activity-post', communityId: 'community-qingshan', sectionId: 'activity-section', status: 'active', originPostId: 'archive-post',
        content: { old_title: '周末徒步', old_starts: '2026-07-20T01:00:00.000Z', old_location: { address: '村口' }, old_contact: '13800000000', old_capacity: 8, old_note: [] },
      },
      {
        _id: 'discard-post', communityId: 'community-other', sectionId: 'discard-section', status: 'active',
        content: { body: ['cloud://env/shared.jpg', 'cloud://env/orphan.jpg'] },
        pendingContent: { image: 'cloud://env/pending-orphan.jpg' },
      },
    ],
    collaborationTemplates: [],
    ragCommunityVersions: [
      { _id: 'community-teacher', communityId: 'community-teacher', contentVersion: 10, aclVersion: 2, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-14T00:00:00.000Z' },
      { _id: 'community-qingshan', communityId: 'community-qingshan', contentVersion: 20, aclVersion: 4, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-14T00:00:00.000Z' },
      { _id: 'community-other', communityId: 'community-other', contentVersion: 30, aclVersion: 6, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-14T00:00:00.000Z' },
    ],
    dependents: {
      post_attendance_members: [
        { _id: 'attendance-retained', postId: 'activity-post', widgetId: 'old_attendance', userId: 'member-1' },
        { _id: 'attendance-deleted', postId: 'discard-post', widgetId: 'old_attendance', userId: 'member-2' },
      ],
      content_audit_tasks: [{ _id: 'audit-deleted', postId: 'discard-post', fileID: 'cloud://env/orphan.jpg' }],
      post_search_documents: [
        { _id: 'carpool-post', postId: 'carpool-post' },
        { _id: 'discard-post', postId: 'discard-post' },
      ],
      post_search_terms: [{ _id: 'term-deleted', postId: 'discard-post' }],
      post_rag_jobs: [{ _id: 'job-retained', postId: 'activity-post' }],
      post_rag_index_versions: [{ _id: 'version-deleted', postId: 'discard-post' }],
      post_video_rag_jobs: [{ _id: 'video-deleted', postId: 'discard-post' }],
    },
    referenceDocuments: [{ _id: 'user-1', avatar: 'cloud://env/avatar.jpg' }],
  }
}

test('classifies only realtime carpool and activity sections; all other realtime sections are deleted', () => {
  assert.equal(classifyRealtimeSection({ type: 'evergreen', name: '拼车出行' }), null)
  assert.equal(classifyRealtimeSection({ type: 'realtime', systemKey: 'carpool', name: '任意' }), 'carpool')
  assert.equal(classifyRealtimeSection({ type: 'realtime', name: '拼车出行' }), 'carpool')
  assert.equal(classifyRealtimeSection({ type: 'realtime', systemKey: 'activity_invite', name: '任意' }), 'activity_invite')
  assert.equal(classifyRealtimeSection({ type: 'realtime', name: '出游邀约' }), 'activity_invite')
  assert.equal(classifyRealtimeSection({ type: 'realtime', name: '其他' }), 'delete')
})

test('maps legacy widgets semantically and allows the new optional carpool note to be absent', () => {
  const templates = buildGlobalCollaborationTemplates(NOW)
  const mapping = buildWidgetMapping({ _id: 'legacy', widgets: carpoolWidgets() }, templates[0], { strict: true })
  assert.deepEqual(mapping.targetToSource, {
    carpool_origin: 'legacy_from',
    carpool_destination: 'legacy_to',
    carpool_departure_time: 'legacy_when',
    carpool_location: 'legacy_map',
  })
  assert.deepEqual(mapping.unmappedRequired, [])
  assert.deepEqual(mapping.unmappedOptional, ['carpool_note'])
})

test('plans retained conversion, dependent cleanup, attendance remap, outbox events, and unshared file deletion', () => {
  const plan = planGlobalCollaborationMigration(fixture(), { preparedAt: NOW, requireReferenceSections: true })
  assert.deepEqual(plan.summary, {
    realtimeSectionCount: 3,
    retainedSectionCount: 2,
    deletedSectionCount: 1,
    retainedPostCount: 2,
    deletedPostCount: 1,
    dependentDeleteCount: 7,
    dependentUpdateCount: 1,
    fileDeleteCount: 2,
    fileProtectedCount: 1,
    templateCreateCount: 2,
    outboxEventCount: 3,
  })
  const carpool = plan.postUpdates.find((item) => item.id === 'carpool-post').after
  assert.equal(carpool.area, 'collaboration')
  assert.equal(carpool.collaborationTemplateId, 'collaboration-template-carpool')
  assert.equal(Object.hasOwn(carpool, 'sectionId'), false)
  assert.deepEqual(carpool.content, {
    carpool_origin: '青山村', carpool_destination: '成都', carpool_departure_time: '2026-07-16T00:00:00.000Z',
    carpool_location: { address: '东门' }, untouched: 'keep',
  })
  assert.equal(plan.postUpdates.find((item) => item.id === 'activity-post').after.eventStartsAt, '2026-07-20T01:00:00.000Z')
  assert.deepEqual(plan.dependentUpdates[0].after, { _id: 'attendance-retained', postId: 'activity-post', widgetId: 'activity_invite_attendance', userId: 'member-1' })
  assert.equal(plan.dependentDeletes.some((item) => item.collection === 'post_search_documents' && item.id === 'carpool-post'), false)
  assert.equal(plan.dependentDeletes.some((item) => item.collection === 'post_search_documents' && item.id === 'discard-post'), true)
  assert.deepEqual(plan.files.delete, ['cloud://env/orphan.jpg', 'cloud://env/pending-orphan.jpg'])
  assert.deepEqual(plan.files.protected, ['cloud://env/shared.jpg'])
  assert.deepEqual(plan.sectionsToDelete.map((item) => item.id), ['activity-section', 'carpool-section', 'discard-section'])
  assert.deepEqual(plan.postsToDelete.map((item) => item.id), ['discard-post'])
  assert.equal(plan.archiveGuard.postIds.includes('archive-post'), true)
  assert.equal(plan.mutationIds.posts.includes('archive-post'), false)
})

test('refuses to plan if reference controls drift or if any archive post enters the mutation set', () => {
  const drifted = fixture()
  drifted.sections.find((item) => item._id === 'carpool-section').widgets[3].required = false
  assert.throws(
    () => planGlobalCollaborationMigration(drifted, { preparedAt: NOW, requireReferenceSections: true }),
    /名师班.*地图位置.*required/i,
  )

  const archiveCollision = fixture()
  archiveCollision.posts.find((item) => item._id === 'discard-post').area = 'archive'
  assert.throws(
    () => planGlobalCollaborationMigration(archiveCollision, { preparedAt: NOW, requireReferenceSections: true }),
    /archive.*mutation/i,
  )
})

test('manifest binds environment, HEAD, source snapshot, plan, and its own hash', () => {
  const snapshot = fixture()
  const plan = planGlobalCollaborationMigration(snapshot, { preparedAt: NOW, requireReferenceSections: true })
  const manifest = createGlobalCollaborationManifest({ envId: 'env-prod', headSha: HEAD, preparedAt: NOW, snapshot, plan })
  assert.equal(verifyGlobalCollaborationManifest(manifest, { envId: 'env-prod', headSha: HEAD }).manifestSha256, manifest.manifestSha256)
  assert.throws(() => verifyGlobalCollaborationManifest({ ...manifest, envId: 'other' }, { envId: 'other', headSha: HEAD }), /manifest hash mismatch/i)
  assert.throws(() => verifyGlobalCollaborationManifest(manifest, { envId: 'other', headSha: HEAD }), /environment mismatch/i)
  assert.throws(() => verifyGlobalCollaborationManifest(manifest, { envId: 'env-prod', headSha: 'b'.repeat(40) }), /HEAD mismatch/i)
})

test('a fully applied snapshot replans as a no-op and keeps archive bytes unchanged', () => {
  const before = fixture()
  const plan = planGlobalCollaborationMigration(before, { preparedAt: NOW, requireReferenceSections: true })
  const after = applyPlanToSnapshot(before, plan)
  const residual = planGlobalCollaborationMigration(after, { preparedAt: NOW, requireReferenceSections: true })
  assert.equal(residual.summary.realtimeSectionCount, 0)
  assert.equal(residual.summary.retainedPostCount, 0)
  assert.equal(residual.summary.deletedPostCount, 0)
  assert.equal(residual.summary.dependentDeleteCount, 0)
  assert.equal(residual.summary.templateCreateCount, 0)
  assert.equal(residual.noop, true)
  assert.equal(residual.archiveGuard.digest, plan.archiveGuard.digest)
})

test('executor performs complete preflight before invoking the first mutator', async () => {
  const snapshot = fixture()
  const plan = planGlobalCollaborationMigration(snapshot, { preparedAt: NOW, requireReferenceSections: true })
  const manifest = createGlobalCollaborationManifest({ envId: 'env-prod', headSha: HEAD, preparedAt: NOW, snapshot, plan })
  const changed = fixture()
  changed.posts.find((item) => item._id === 'discard-post').content.body.push('changed-after-prepare')
  let calls = 0
  await assert.rejects(
    executeVerifiedGlobalCollaborationPlan({
      manifest,
      envId: 'env-prod',
      headSha: HEAD,
      readSnapshot: async () => changed,
      apply: async () => { calls += 1 },
    }),
    /source snapshot mismatch/i,
  )
  assert.equal(calls, 0)
})
