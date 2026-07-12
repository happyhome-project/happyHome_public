import * as db from '../db'
import { buildPostRagSourceProjection } from '../post-rag-indexing'
import { processClaimedPostRagJob } from '../post-rag-job-processor'
import { claimPostRagJob, completePostRagJob, failPostRagJob, getPostRagJob, renewPostRagJobLease } from '../post-rag-jobs'
import { appendPostRagOutboxEvent, POST_RAG_OUTBOX } from '../post-rag-outbox'
import { claimPostRagOutboxEvent, materializeClaimedPostRagOutboxEvent } from '../post-rag-outbox-materializer'

const local = db as typeof db & { _resetAll(): void }
const NOW = '2026-07-12T06:00:00.000Z'

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

test('business mutation flows through outbox and v2 job to active, then delete to removed', async () => {
  await db.create('sections', { _id: 'section-1', communityId: 'community-1', name: '家风', status: 'active', widgets: [{ widgetId: 'body', fieldKey: 'body', label: '正文', type: 'short_text', visibility: 'public', order: 0 }] })
  const created = await db.runTransaction(async transaction => {
    await transaction.collection('posts').doc('post-1').set({ data: { communityId: 'community-1', sectionId: 'section-1', authorId: 'user-1', status: 'active', auditStatus: 'pass', content: { body: '一粥一饭，当思来处不易' }, commentCount: 0, likeCount: 0, createdAt: NOW, updatedAt: NOW } })
    return appendPostRagOutboxEvent(transaction, { communityId: 'community-1', aggregateId: 'post-1', reasonCode: 'post.created', now: NOW })
  })
  const calls: string[] = []
  const sink = {
    stageUpsert: async () => { calls.push('stage') },
    inspectStaged: async () => ({ chunkCount: 1, chunkChecksum: buildPostRagSourceProjection(await db.getById('posts', 'post-1') as any, await db.getById('sections', 'section-1') as any).chunkChecksum }),
    activate: async () => { calls.push('active'); return { activated: true } },
    cleanupOldVersions: async () => undefined,
    remove: async () => { calls.push('removed'); return { removed: true } },
  }
  await expect(processOutbox(created.outboxId, sink)).resolves.toMatchObject({ status: 'completed', outcome: 'indexed' })

  const deleted = await db.runTransaction(async transaction => {
    await transaction.collection('posts').doc('post-1').update({ data: { status: 'deleted' } })
    return appendPostRagOutboxEvent(transaction, { communityId: 'community-1', aggregateId: 'post-1', reasonCode: 'post.deleted', now: '2026-07-12T06:00:01.000Z' })
  })
  await expect(processOutbox(deleted.outboxId, sink)).resolves.toMatchObject({ status: 'completed', outcome: 'removed' })
  expect(calls).toEqual(['stage', 'active', 'removed'])
  expect(await db.query(POST_RAG_OUTBOX, {}, { limit: 10 })).toHaveLength(2)
})
