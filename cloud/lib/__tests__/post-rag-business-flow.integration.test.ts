import * as db from '../db'
import { buildPostRagSourceProjection } from '../post-rag-indexing'
import { processClaimedPostRagJob } from '../post-rag-job-processor'
import { claimPostRagJob, completePostRagJob, failPostRagJob, getPostRagJob, renewPostRagJobLease } from '../post-rag-jobs'
import { POST_RAG_OUTBOX } from '../post-rag-outbox'
import { claimPostRagOutboxEvent, materializeClaimedPostRagOutboxEvent } from '../post-rag-outbox-materializer'
import { handleCreate, handleDelete } from '../../functions/post/index'
import { approvePostAudit } from '../content-audit'

const local = db as typeof db & { _resetAll(): void }
const NOW = '2099-07-12T06:00:00.000Z'

beforeEach(() => local._resetAll())

async function processOutbox(outboxId: string, sink: any) {
  const outboxClaim = await claimPostRagOutboxEvent(outboxId, { workerId: 'outbox-worker', now: NOW })
  const materialized = await materializeClaimedPostRagOutboxEvent(outboxId, { workerId: 'outbox-worker', leaseToken: outboxClaim!.leaseToken!, now: NOW })
  const claimed = await claimPostRagJob(materialized.job._id, { workerId: 'index-worker', now: NOW })
  return processClaimedPostRagJob(claimed!, { workerId: 'index-worker', now: () => NOW }, {
    sink,
    loadPost: async id => db.getById('posts', id).catch(() => null),
    loadSection: async id => db.getById('sections', id).catch(() => null),
    buildProjection: buildPostRagSourceProjection,
    readJob: getPostRagJob,
    renew: renewPostRagJobLease,
    complete: completePostRagJob,
    fail: failPostRagJob,
  })
}

test('real public post and audit handlers flow through outbox to active, then delete to removed', async () => {
  await db.create('communities', { _id: 'community-1', status: 'active' })
  await db.create('community_members', { _id: 'member-1', communityId: 'community-1', userId: 'user-1', role: 'member', status: 'active' })
  await db.create('sections', { _id: 'section-1', communityId: 'community-1', name: '家风', status: 'active', widgets: [{ widgetId: 'body', fieldKey: 'body', label: '正文', type: 'short_text', visibility: 'public', order: 0 }] })
  const createdPost = await handleCreate({ communityId: 'community-1', sectionId: 'section-1', content: { body: '一粥一饭，当思来处不易' } }, 'user-1')
  await approvePostAudit(createdPost.postId)
  const createdEvents = await db.query(POST_RAG_OUTBOX, { aggregateId: createdPost.postId, reasonCode: 'post.audit_changed' }, { orderBy: ['contentVersion', 'desc'], limit: 1 })
  const calls: string[] = []
  const sink = {
    stageUpsert: async () => { calls.push('stage') },
    inspectStaged: async () => ({ chunkCount: 1, chunkChecksum: buildPostRagSourceProjection(await db.getById('posts', createdPost.postId) as any, await db.getById('sections', 'section-1') as any).chunkChecksum }),
    activate: async () => { calls.push('active'); return { activated: true } },
    cleanupOldVersions: async () => undefined,
    remove: async () => { calls.push('removed'); return { removed: true } },
  }
  await expect(processOutbox((createdEvents[0] as any)._id, sink)).resolves.toMatchObject({ status: 'completed', outcome: 'indexed' })

  await handleDelete({ postId: createdPost.postId }, 'user-1')
  const deletedEvents = await db.query(POST_RAG_OUTBOX, { aggregateId: createdPost.postId, reasonCode: 'post.deleted' }, { limit: 1 })
  await expect(processOutbox((deletedEvents[0] as any)._id, sink)).resolves.toMatchObject({ status: 'completed', outcome: 'removed' })
  expect(calls).toEqual(['stage', 'active', 'removed'])
  expect((await db.query(POST_RAG_OUTBOX, {}, { limit: 10 })).length).toBeGreaterThanOrEqual(3)
})
