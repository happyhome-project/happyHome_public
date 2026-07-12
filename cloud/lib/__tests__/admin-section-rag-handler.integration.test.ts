import * as db from '../db'
import { claimPostRagOutboxEvent, materializeClaimedPostRagOutboxEvent } from '../post-rag-outbox-materializer'
import { POST_RAG_OUTBOX, RAG_COMMUNITY_VERSIONS } from '../post-rag-outbox'

const local = db as typeof db & { _resetAll(): void }
const TOKEN = 'task5-handler-integration-token'

beforeEach(() => { local._resetAll(); process.env.ADMIN_INTERNAL_CALL_TOKEN = TOKEN })

test('real admin post update and section status handlers emit the correct materializable projection facts', async () => {
  const { main } = await import('../../functions/admin/index')
  const actor = { accountId: 'admin-1', role: 'superAdmin', userId: 'admin-user', username: 'admin' }
  await db.create('communities', { _id: 'community-1', status: 'active' })
  await db.create('sections', { _id: 'section-1', communityId: 'community-1', name: '实时家风', type: 'realtime', status: 'active', widgets: [{ widgetId: 'body', fieldKey: 'body', label: '正文', type: 'short_text', visibility: 'public', order: 0 }] })
  await db.create('posts', { _id: 'post-1', communityId: 'community-1', sectionId: 'section-1', authorId: 'user-1', status: 'active', auditStatus: 'pass', content: { body: '旧内容' }, commentCount: 0, likeCount: 0, createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z' })

  await main({ action: 'post.updateAdmin', postId: 'post-1', content: { body: '勤俭持家' }, _actAs: actor, _internalToken: TOKEN })
  const postEvents = await db.query(POST_RAG_OUTBOX, { aggregateId: 'post-1', reasonCode: 'post.updated' }, { limit: 10 })
  expect(postEvents).toHaveLength(1)
  const postClaim = await claimPostRagOutboxEvent((postEvents[0] as any)._id, { workerId: 'worker', now: '2099-01-01T00:00:00.000Z' })
  await expect(materializeClaimedPostRagOutboxEvent((postEvents[0] as any)._id, { workerId: 'worker', leaseToken: postClaim!.leaseToken!, now: '2099-01-01T00:00:00.000Z' })).resolves.toMatchObject({ job: { postId: 'post-1' } })

  await main({ action: 'section.updateStatus', sectionId: 'section-1', status: 'dormant', _actAs: actor, _internalToken: TOKEN })
  const sectionEvents = await db.query(POST_RAG_OUTBOX, { aggregateId: 'section-1', reasonCode: 'section.status_changed' }, { limit: 10 })
  expect(sectionEvents).toHaveLength(1)
  const sectionClaim = await claimPostRagOutboxEvent((sectionEvents[0] as any)._id, { workerId: 'worker', now: '2099-01-01T00:00:01.000Z' })
  const fanout = await materializeClaimedPostRagOutboxEvent((sectionEvents[0] as any)._id, { workerId: 'worker', leaseToken: sectionClaim!.leaseToken!, now: '2099-01-01T00:00:01.000Z' })
  expect(fanout.jobs).toEqual(expect.arrayContaining([expect.objectContaining({ postId: 'post-1', action: 'delete' })]))
})

test.each([
  {
    name: 'an explicit dormant to active transition',
    before: { type: 'realtime', status: 'dormant' },
    update: { status: 'active' },
  },
  {
    name: 'an archived section forced active by changing its type to evergreen',
    before: { type: 'realtime', status: 'archived' },
    update: { type: 'evergreen' },
  },
])('section.updateMeta treats $name as an ACL-changing status fact', async ({ before, update }) => {
  const { main } = await import('../../functions/admin/index')
  const actor = { accountId: 'admin-1', role: 'superAdmin', userId: 'admin-user', username: 'admin' }
  await db.create('communities', { _id: 'community-1', status: 'active' })
  await db.create('sections', { _id: 'section-1', communityId: 'community-1', name: '家风', ...before })

  await main({ action: 'section.updateMeta', sectionId: 'section-1', ...update, _actAs: actor, _internalToken: TOKEN })

  await expect(db.getById('sections', 'section-1')).resolves.toMatchObject({ status: 'active' })
  const events = await db.query(POST_RAG_OUTBOX, { aggregateId: 'section-1' }, { limit: 10 })
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({ reasonCode: 'section.status_changed', aclVersion: 1 })
  await expect(db.getById(RAG_COMMUNITY_VERSIONS, 'community-1')).resolves.toMatchObject({ aclVersion: 1 })
})

test('section.updateMeta keeps metadata-only changes content-only', async () => {
  const { main } = await import('../../functions/admin/index')
  const actor = { accountId: 'admin-1', role: 'superAdmin', userId: 'admin-user', username: 'admin' }
  await db.create('communities', { _id: 'community-1', status: 'active' })
  await db.create('sections', { _id: 'section-1', communityId: 'community-1', name: '旧名称', type: 'realtime', status: 'active' })

  await main({ action: 'section.updateMeta', sectionId: 'section-1', name: '新名称', _actAs: actor, _internalToken: TOKEN })

  const events = await db.query(POST_RAG_OUTBOX, { aggregateId: 'section-1' }, { limit: 10 })
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({ reasonCode: 'section.metadata_changed', aclVersion: 0 })
  await expect(db.getById(RAG_COMMUNITY_VERSIONS, 'community-1')).resolves.toMatchObject({ aclVersion: 0 })
})
