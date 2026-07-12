import * as db from '../db'
import { claimPostRagOutboxEvent, materializeClaimedPostRagOutboxEvent } from '../post-rag-outbox-materializer'
import { POST_RAG_OUTBOX } from '../post-rag-outbox'

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
