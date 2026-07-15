import * as db from '../db'
import { buildInitialCollaborationTemplates } from '../../shared/collaboration-templates'
import { POST_RAG_JOBS } from '../post-rag-jobs'
import { appendPostRagOutboxEvent, POST_RAG_OUTBOX } from '../post-rag-outbox'
import {
  claimPostRagOutboxEvent,
  failPostRagOutboxEvent,
  listPostRagOutboxCandidates,
  materializeClaimedPostRagOutboxEvent,
  materializeClaimedPostRagOutboxEventInTransaction,
  validateStoredPostRagOutboxDocument,
} from '../post-rag-outbox-materializer'

const localDb = db as typeof db & { _resetAll: () => void; _dump: (name: string) => any[] }
const NOW = '2026-07-12T04:00:00.000Z'

beforeEach(() => localDb._resetAll())

async function seed(reasonCode: 'post.created' | 'post.deleted' | 'section.metadata_changed' = 'post.created') {
  return db.runTransaction(async (transaction) => {
    await transaction.collection('sections').doc('section-1').set({ data: {
      communityId: 'community-1', name: '课堂', status: 'active', widgets: [
        { widgetId: 'title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true },
      ],
    } })
    await transaction.collection('posts').doc('post-1').set({ data: {
      communityId: 'community-1', sectionId: 'section-1', authorId: 'author-1', status: 'active', auditStatus: 'pass',
      content: { title: '第一课' }, commentCount: 0, likeCount: 0,
      createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-02T00:00:00.000Z',
    } })
    return appendPostRagOutboxEvent(transaction, {
      communityId: 'community-1', aggregateId: reasonCode.startsWith('section.') ? 'section-1' : 'post-1', reasonCode, now: NOW,
    })
  })
}

test('atomically materializes an eligible post event and completes its outbox lease', async () => {
  const event = await seed()
  const claimed = await claimPostRagOutboxEvent(event.outboxId, { workerId: 'worker-1', now: NOW })
  const result = await materializeClaimedPostRagOutboxEvent(event.outboxId, {
    workerId: 'worker-1', leaseToken: claimed!.leaseToken!, now: '2026-07-12T04:00:01.000Z',
  })

  expect(result.job).toMatchObject({ outboxId: event.outboxId, postId: 'post-1', action: 'upsert', contentVersion: 1 })
  await expect(db.getById(POST_RAG_OUTBOX, event.outboxId)).resolves.toMatchObject({
    status: 'completed', leaseOwner: 'worker-1', leaseToken: claimed!.leaseToken, leaseExpiresAt: null,
  })
  expect(localDb._dump(POST_RAG_JOBS)).toHaveLength(1)
})

test('materializes an eligible section-free collaboration post from its global template', async () => {
  const template = buildInitialCollaborationTemplates()[0]
  const { _id: templateId, ...templateData } = template
  const event = await db.runTransaction(async (transaction) => {
    await transaction.collection('collaboration_templates').doc(templateId).set({ data: templateData })
    await transaction.collection('posts').doc('collaboration-post-1').set({ data: {
      communityId: 'community-1', area: 'collaboration', collaborationTemplateId: templateId,
      collaborationSystemKey: template.systemKey, authorId: 'author-1', status: 'active', auditStatus: 'pass',
      content: { carpool_origin: '青山村', carpool_destination: '成都软件园' }, commentCount: 0, likeCount: 0,
      createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-02T00:00:00.000Z',
    } })
    return appendPostRagOutboxEvent(transaction, {
      communityId: 'community-1', aggregateId: 'collaboration-post-1', reasonCode: 'post.created', now: NOW,
    })
  })
  const claimed = await claimPostRagOutboxEvent(event.outboxId, { workerId: 'worker-1', now: NOW })

  const result = await materializeClaimedPostRagOutboxEvent(event.outboxId, {
    workerId: 'worker-1', leaseToken: claimed!.leaseToken!, now: '2026-07-12T04:00:01.000Z',
  })

  expect(result.job).toMatchObject({
    postId: 'collaboration-post-1',
    sectionId: null,
    action: 'upsert',
  })
})

test.each([
  ['deleted post', async () => db.updateById('posts', 'post-1', { status: 'deleted' })],
  ['pending post', async () => db.updateById('posts', 'post-1', { auditStatus: 'pending' })],
  ['missing post', async () => db.removeById('posts', 'post-1')],
  ['missing section', async () => db.removeById('sections', 'section-1')],
] as const)('materializes a removal job for %s', async (_label, mutate) => {
  const event = await seed('post.deleted')
  await mutate()
  const claimed = await claimPostRagOutboxEvent(event.outboxId, { workerId: 'worker-1', now: NOW })
  const result = await materializeClaimedPostRagOutboxEvent(event.outboxId, {
    workerId: 'worker-1', leaseToken: claimed!.leaseToken!, now: '2026-07-12T04:00:01.000Z',
  })
  expect(result.job).toMatchObject({ action: 'delete', sourceVersion: expect.stringMatching(/^removed-/) })
})

test('completed replay rejects a nested job lastError accessor without executing it', async () => {
  const event = await seed()
  const claimed = await claimPostRagOutboxEvent(event.outboxId, { workerId: 'worker-1', now: NOW })
  const completed = await materializeClaimedPostRagOutboxEvent(event.outboxId, { workerId: 'worker-1', leaseToken: claimed!.leaseToken!, now: '2026-07-12T04:00:01.000Z' })
  let getterCalls = 0
  const lastError = {
    stage: 'es_write', message: 'RAG job operation timed out', retryable: true, at: NOW,
    get code() { getterCalls += 1; return 'TIMEOUT' },
  }
  const completedOutbox = await db.getById(POST_RAG_OUTBOX, event.outboxId)
  const forgedJob = { ...completed.job, lastError }
  const transaction = {
    collection: (name: string) => ({ doc: (_id: string) => ({
      get: async () => ({ data: name === POST_RAG_OUTBOX ? completedOutbox : forgedJob }),
      set: async () => undefined, update: async () => undefined, remove: async () => undefined,
    }), add: async () => ({ _id: 'unused' }) }),
  }

  await expect(materializeClaimedPostRagOutboxEventInTransaction(transaction as any, event.outboxId, {
    workerId: 'worker-1', leaseToken: claimed!.leaseToken!, now: '2026-07-12T04:03:00.000Z',
  })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', retryable: false })
  expect(getterCalls).toBe(0)
})

test('is idempotent after a completed materialization and creates one job', async () => {
  const event = await seed()
  const claimed = await claimPostRagOutboxEvent(event.outboxId, { workerId: 'worker-1', now: NOW })
  const options = { workerId: 'worker-1', leaseToken: claimed!.leaseToken!, now: '2026-07-12T04:00:01.000Z' }
  const first = await materializeClaimedPostRagOutboxEvent(event.outboxId, options)
  const replay = await materializeClaimedPostRagOutboxEvent(event.outboxId, options)
  expect(replay.job._id).toBe(first.job._id)
  expect(localDb._dump(POST_RAG_JOBS)).toHaveLength(1)
})

test('completed replay rejects a stale or forged completion token', async () => {
  const event = await seed()
  const claimed = await claimPostRagOutboxEvent(event.outboxId, { workerId: 'worker-winner', now: NOW })
  await materializeClaimedPostRagOutboxEvent(event.outboxId, {
    workerId: 'worker-winner', leaseToken: claimed!.leaseToken!, now: '2026-07-12T04:00:01.000Z',
  })

  await expect(materializeClaimedPostRagOutboxEvent(event.outboxId, {
    workerId: 'worker-loser', leaseToken: 'forged-token', now: '2026-07-12T04:03:00.000Z',
  })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', retryable: false })
  expect(localDb._dump(POST_RAG_JOBS)).toHaveLength(1)
})

test.todo('real isolated CloudBase concurrent outbox claim and transaction-conflict fixture')

test('section reindex fans out deterministically across pages without dead lettering',async()=>{
  await db.create('sections',{_id:'section-1',communityId:'community-1',name:'家风',status:'active',widgets:[{widgetId:'body',fieldKey:'body',label:'正文',type:'short_text',visibility:'public',order:0}]})
  for(let i=0;i<25;i++)await db.create('posts',{_id:`post-${String(i).padStart(2,'0')}`,communityId:'community-1',sectionId:'section-1',status:'active',auditStatus:'pass',content:{body:`内容${i}`},createdAt:NOW,updatedAt:NOW})
  const event=await db.runTransaction(tx=>appendPostRagOutboxEvent(tx,{communityId:'community-1',aggregateId:'section-1',reasonCode:'section.widgets_changed',now:NOW}))
  let claimed=await claimPostRagOutboxEvent(event.outboxId,{workerId:'worker',now:'2026-07-12T04:00:01.000Z'})
  let page=await materializeClaimedPostRagOutboxEvent(event.outboxId,{workerId:'worker',leaseToken:claimed!.leaseToken!,now:'2026-07-12T04:00:02.000Z'})
  expect(page.outbox).toMatchObject({status:'pending',attempts:0,fanoutSkip:20})
  await db.removeById('posts','post-20');await db.create('posts',{_id:'post-19a',communityId:'community-1',sectionId:'section-1',status:'active',auditStatus:'pass',content:{body:'插入'},createdAt:NOW,updatedAt:NOW})
  claimed=await claimPostRagOutboxEvent(event.outboxId,{workerId:'worker',now:'2026-07-12T04:00:03.000Z'})
  page=await materializeClaimedPostRagOutboxEvent(event.outboxId,{workerId:'worker',leaseToken:claimed!.leaseToken!,now:'2026-07-12T04:00:04.000Z'})
  expect(page.outbox).toMatchObject({status:'completed',fanoutSkip:25})
  expect((await db.query(POST_RAG_JOBS,{outboxId:event.outboxId},{limit:100}))).toHaveLength(25)
  expect((await db.query(POST_RAG_JOBS,{outboxId:event.outboxId},{limit:100})).some((job:any)=>job.postId==='post-24')).toBe(true)
})

test('community fanout completes seven continuation pages without consuming the failure budget', async () => {
  await db.create('sections', { _id: 'section-1', communityId: 'community-1', name: '家风', status: 'active', widgets: [{ widgetId: 'body', fieldKey: 'body', label: '正文', type: 'short_text', visibility: 'public', order: 0 }] })
  for (let index = 0; index < 125; index += 1) await db.create('posts', { _id: `bulk-${String(index).padStart(3, '0')}`, communityId: 'community-1', sectionId: 'section-1', status: 'active', auditStatus: 'pass', content: { body: `内容${index}` }, createdAt: NOW, updatedAt: NOW })
  const event = await db.runTransaction(tx => appendPostRagOutboxEvent(tx, { communityId: 'community-1', aggregateId: 'community-1', reasonCode: 'community.status_changed', now: NOW }))
  let page: any
  for (let index = 0; index < 7; index += 1) {
    const now = `2026-07-12T04:00:${String(index * 2 + 1).padStart(2, '0')}.000Z`
    const claimed = await claimPostRagOutboxEvent(event.outboxId, { workerId: 'worker', now })
    expect(claimed).not.toBeNull()
    page = await materializeClaimedPostRagOutboxEvent(event.outboxId, { workerId: 'worker', leaseToken: claimed!.leaseToken!, now })
    if (index < 6) expect(page.outbox).toMatchObject({ status: 'pending', attempts: 0 })
  }
  expect(page.outbox).toMatchObject({ status: 'completed', attempts: 1, fanoutSkip: 125 })
})

test('a crashed fanout claim remains in the failure budget after a successful continuation page', async () => {
  await db.create('sections', { _id: 'section-1', communityId: 'community-1', name: '家风', status: 'active', widgets: [{ widgetId: 'body', fieldKey: 'body', label: '正文', type: 'short_text', visibility: 'public', order: 0 }] })
  for (let index = 0; index < 25; index += 1) await db.create('posts', { _id: `crash-${String(index).padStart(2, '0')}`, communityId: 'community-1', sectionId: 'section-1', status: 'active', auditStatus: 'pass', content: { body: `内容${index}` }, createdAt: NOW, updatedAt: NOW })
  const event = await db.runTransaction(tx => appendPostRagOutboxEvent(tx, { communityId: 'community-1', aggregateId: 'community-1', reasonCode: 'community.status_changed', now: NOW }))
  await claimPostRagOutboxEvent(event.outboxId, { workerId: 'crashed', now: '2026-07-12T04:00:01.000Z' })
  const reclaimed = await claimPostRagOutboxEvent(event.outboxId, { workerId: 'worker', now: '2026-07-12T04:02:01.000Z' })
  const page = await materializeClaimedPostRagOutboxEvent(event.outboxId, { workerId: 'worker', leaseToken: reclaimed!.leaseToken!, now: '2026-07-12T04:02:02.000Z' })
  expect(page.outbox).toMatchObject({ status: 'pending', attempts: 1, fanoutSkip: 20 })
})

test.each(['community.status_changed','community.acl_changed'] as const)('%s fans out to current post projections and completes',async reasonCode=>{
  await db.create('sections',{_id:'section-1',communityId:'community-1',name:'家风',status:'active',widgets:[{widgetId:'body',fieldKey:'body',label:'正文',type:'short_text',visibility:'member',order:0}]})
  await db.create('posts',{_id:'post-1',communityId:'community-1',sectionId:'section-1',status:'active',auditStatus:'pass',content:{body:'会员家风'},createdAt:NOW,updatedAt:NOW})
  const event=await db.runTransaction(tx=>appendPostRagOutboxEvent(tx,{communityId:'community-1',aggregateId:'community-1',reasonCode,now:NOW}))
  const claimed=await claimPostRagOutboxEvent(event.outboxId,{workerId:'worker',now:'2026-07-12T04:00:01.000Z'})
  const result=await materializeClaimedPostRagOutboxEvent(event.outboxId,{workerId:'worker',leaseToken:claimed!.leaseToken!,now:'2026-07-12T04:00:02.000Z'})
  if(reasonCode==='community.acl_changed')expect(result).toMatchObject({outbox:{status:'completed'},jobs:[]})
  else expect(result).toMatchObject({outbox:{status:'completed'},jobs:[{postId:'post-1',action:'upsert'}]})
})

test('community projection fanout uses _id keysets across pages with intervening delete and insert', async () => {
  await db.create('sections', { _id: 'section-1', communityId: 'community-1', name: '家风', status: 'active', widgets: [{ widgetId: 'body', fieldKey: 'body', label: '正文', type: 'short_text', visibility: 'public', order: 0 }] })
  for (let index = 0; index < 25; index += 1) {
    await db.create('posts', { _id: `community-post-${String(index).padStart(2, '0')}`, communityId: 'community-1', sectionId: 'section-1', status: 'active', auditStatus: 'pass', content: { body: `内容${index}` }, createdAt: NOW, updatedAt: NOW })
  }
  const event = await db.runTransaction(transaction => appendPostRagOutboxEvent(transaction, { communityId: 'community-1', aggregateId: 'community-1', reasonCode: 'community.status_changed', now: NOW }))
  let claimed = await claimPostRagOutboxEvent(event.outboxId, { workerId: 'worker', now: '2026-07-12T04:00:01.000Z' })
  let page = await materializeClaimedPostRagOutboxEvent(event.outboxId, { workerId: 'worker', leaseToken: claimed!.leaseToken!, now: '2026-07-12T04:00:02.000Z' })
  expect(page).toMatchObject({ outbox: { status: 'pending', attempts: 0, fanoutAfterPostId: 'community-post-19' } })
  await db.removeById('posts', 'community-post-20')
  await db.create('posts', { _id: 'community-post-19a', communityId: 'community-1', sectionId: 'section-1', status: 'active', auditStatus: 'pass', content: { body: '页间插入' }, createdAt: NOW, updatedAt: NOW })
  claimed = await claimPostRagOutboxEvent(event.outboxId, { workerId: 'worker', now: '2026-07-12T04:00:03.000Z' })
  page = await materializeClaimedPostRagOutboxEvent(event.outboxId, { workerId: 'worker', leaseToken: claimed!.leaseToken!, now: '2026-07-12T04:00:04.000Z' })
  expect(page).toMatchObject({ outbox: { status: 'completed', fanoutAfterPostId: 'community-post-24' } })
  const postIds = (db as any)._dump(POST_RAG_JOBS).map((job: any) => job.postId)
  expect(new Set(postIds).size).toBe(25)
  expect(postIds).toContain('community-post-19a')
  expect(postIds).not.toContain('community-post-20')
})

test('stored outbox validation rejects accessors without executing getters and rejects unsafe shapes', async () => {
  const event = await seed()
  const valid = await db.getById(POST_RAG_OUTBOX, event.outboxId)
  let getterCalls = 0
  const accessor = { ...valid }
  Object.defineProperty(accessor, 'status', { enumerable: true, get: () => { getterCalls += 1; return 'pending' } })
  expect(() => validateStoredPostRagOutboxDocument(accessor)).toThrow(/accessor/)
  expect(getterCalls).toBe(0)
  expect(() => validateStoredPostRagOutboxDocument(Object.assign(Object.create({ inherited: true }), valid))).toThrow(/prototype/)
  expect(() => validateStoredPostRagOutboxDocument(Object.assign(new (class Stored {})(), valid))).toThrow(/prototype/)
  expect(() => validateStoredPostRagOutboxDocument(Object.assign(Object.create(null), valid))).not.toThrow()
  const symbolKeyed = { ...valid, [Symbol('hidden')]: true }
  expect(() => validateStoredPostRagOutboxDocument(symbolKeyed)).toThrow(/symbol/)
  const unsafe = { ...valid }; Object.defineProperty(unsafe, '__proto__', { value: 'bad', enumerable: true })
  expect(() => validateStoredPostRagOutboxDocument(unsafe)).toThrow(/unsafe/)

  let errorGetterCalls = 0
  const unsafeLastError = {
    at: NOW, message: 'Internal RAG outbox error', retryable: true,
    get code() { errorGetterCalls += 1; return 'INTERNAL_ERROR' },
  }
  expect(() => validateStoredPostRagOutboxDocument({ ...valid, lastError: unsafeLastError })).toThrow(/accessor/)
  expect(errorGetterCalls).toBe(0)
})

test.each(['constructor', '__proto__'])('rejects unsafe error code %s by own whitelist membership', async (code) => {
  const event = await seed()
  const claimed = await claimPostRagOutboxEvent(event.outboxId, { workerId: 'worker-1', now: NOW })
  await expect(failPostRagOutboxEvent(event.outboxId, {
    workerId: 'worker-1', leaseToken: claimed!.leaseToken!, now: NOW, error: { code } as any,
  })).rejects.toThrow(/error code is invalid/)
})

test('rejects an accessor options.error code without executing its getter', async () => {
  const event = await seed()
  const claimed = await claimPostRagOutboxEvent(event.outboxId, { workerId: 'worker-1', now: NOW })
  let getterCalls = 0
  const error = Object.defineProperty({}, 'code', { enumerable: true, get: () => { getterCalls += 1; return 'INTERNAL_ERROR' } })
  await expect(failPostRagOutboxEvent(event.outboxId, {
    workerId: 'worker-1', leaseToken: claimed!.leaseToken!, now: NOW, error: error as any,
  })).rejects.toThrow(/accessor/)
  expect(getterCalls).toBe(0)
})

test.each([
  ['postId', 'forged-post'], ['communityId', 'forged-community'], ['contentVersion', 999], ['action', 'delete'], ['sourceVersion', 'forged-version'],
] as const)('completed replay rejects a materialized job with mismatched %s', async (field, value) => {
  const event = await seed()
  const claimed = await claimPostRagOutboxEvent(event.outboxId, { workerId: 'worker-1', now: NOW })
  const completed = await materializeClaimedPostRagOutboxEvent(event.outboxId, { workerId: 'worker-1', leaseToken: claimed!.leaseToken!, now: '2026-07-12T04:00:01.000Z' })
  await db.updateById(POST_RAG_JOBS, completed.job._id, { [field]: value })
  await expect(materializeClaimedPostRagOutboxEvent(event.outboxId, {
    workerId: 'worker-1', leaseToken: claimed!.leaseToken!, now: '2026-07-12T04:03:00.000Z',
  })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', retryable: false })
})

test('rejects a stale fencing token without creating a job', async () => {
  const event = await seed()
  await claimPostRagOutboxEvent(event.outboxId, { workerId: 'worker-1', now: NOW })
  await expect(materializeClaimedPostRagOutboxEvent(event.outboxId, {
    workerId: 'worker-1', leaseToken: 'stale-token', now: '2026-07-12T04:00:01.000Z',
  })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', retryable: false })
  expect(localDb._dump(POST_RAG_JOBS)).toEqual([])
})

test('transaction rollback prevents completed-without-job split', async () => {
  const event = await seed()
  const claimed = await claimPostRagOutboxEvent(event.outboxId, { workerId: 'worker-1', now: NOW })
  await expect(db.runTransaction(async (transaction) => {
    await materializeClaimedPostRagOutboxEventInTransaction(transaction, event.outboxId, {
      workerId: 'worker-1', leaseToken: claimed!.leaseToken!, now: '2026-07-12T04:00:01.000Z',
    })
    throw new Error('fixture rollback')
  })).rejects.toThrow('fixture rollback')
  await expect(db.getById(POST_RAG_OUTBOX, event.outboxId)).resolves.toMatchObject({ status: 'processing' })
  expect(localDb._dump(POST_RAG_JOBS)).toEqual([])
})

test('section fanout completes and creates the projected content job', async () => {
  const event = await seed('section.metadata_changed')
  const claimed = await claimPostRagOutboxEvent(event.outboxId, { workerId: 'worker-1', now: NOW })
  await expect(materializeClaimedPostRagOutboxEvent(event.outboxId, {
    workerId: 'worker-1', leaseToken: claimed!.leaseToken!, now: '2026-07-12T04:00:01.000Z',
  })).resolves.toMatchObject({outbox:{status:'completed'},jobs:[{postId:'post-1'}]})
  expect(localDb._dump(POST_RAG_JOBS)).toHaveLength(1)
})

test('candidate listing skips future retry items and returns due work in bounded order', async () => {
  const first = await seed()
  const second = await db.runTransaction((transaction) => appendPostRagOutboxEvent(transaction, {
    communityId: 'community-1', aggregateId: 'post-2', reasonCode: 'post.created', now: '2026-07-12T04:00:01.000Z',
  }))
  const claimed = await claimPostRagOutboxEvent(first.outboxId, { workerId: 'worker-1', now: NOW })
  await failPostRagOutboxEvent(first.outboxId, { workerId: 'worker-1', leaseToken: claimed!.leaseToken!, now: NOW, error: { code: 'INTERNAL_ERROR' } })
  await expect(listPostRagOutboxCandidates('2026-07-12T04:00:02.000Z', 1)).resolves.toEqual([second.outboxId])
})

test('candidate listing considers each status before globally ordering and limiting', async () => {
  const retry = await seed()
  const claim = await claimPostRagOutboxEvent(retry.outboxId, { workerId: 'worker-1', now: NOW })
  await failPostRagOutboxEvent(retry.outboxId, { workerId: 'worker-1', leaseToken: claim!.leaseToken!, now: NOW, error: { code: 'INTERNAL_ERROR' } })
  await db.runTransaction((transaction) => appendPostRagOutboxEvent(transaction, {
    communityId: 'community-1', aggregateId: 'post-2', reasonCode: 'post.created', now: '2026-07-12T04:00:06.000Z',
  }))
  await expect(listPostRagOutboxCandidates('2026-07-12T04:00:06.000Z', 1)).resolves.toEqual([retry.outboxId])
})

test('candidate listing quarantines malformed schema-v2 records and continues', async () => {
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  await db.create(POST_RAG_OUTBOX, {
    schemaVersion: 2, status: 'pending', createdAt: '2026-07-12T03:00:00.000Z', nextAttemptAt: NOW,
  })
  const valid = await seed()

  await expect(listPostRagOutboxCandidates(NOW, 1)).resolves.toEqual([valid.outboxId])
  expect(localDb._dump(POST_RAG_OUTBOX)).toEqual(expect.arrayContaining([
    expect.objectContaining({ schemaVersion: -2, status: 'dead_letter', lastError: expect.objectContaining({ code: 'VALIDATION_FAILED' }) }),
  ]))
  expect(warning).toHaveBeenCalledWith('[post-rag-outbox] quarantined malformed events', { count: 1 })
  warning.mockRestore()
})

test('concurrent claims yield one active lease and reclaim uses a new fencing token', async () => {
  const event = await seed()
  const [left, right] = await Promise.all([
    claimPostRagOutboxEvent(event.outboxId, { workerId: 'worker-a', now: NOW }),
    claimPostRagOutboxEvent(event.outboxId, { workerId: 'worker-b', now: NOW }),
  ])
  const winner = left || right
  expect([left, right].filter(Boolean)).toHaveLength(1)
  const reclaimed = await claimPostRagOutboxEvent(event.outboxId, { workerId: 'worker-c', now: '2026-07-12T04:02:00.000Z' })
  expect(reclaimed!.leaseToken).not.toBe(winner!.leaseToken)
  expect(reclaimed).toMatchObject({ attempts: 2, leaseOwner: 'worker-c' })
})

test('uses fixed retry policy and dead-letters after five attempts', async () => {
  const event = await seed()
  const claimTimes = [NOW, '2026-07-12T04:00:05.000Z', '2026-07-12T04:00:35.000Z', '2026-07-12T04:02:35.000Z', '2026-07-12T04:12:35.000Z']
  const expectedNext = ['2026-07-12T04:00:05.000Z', '2026-07-12T04:00:35.000Z', '2026-07-12T04:02:35.000Z', '2026-07-12T04:12:35.000Z']
  for (let index = 0; index < claimTimes.length; index += 1) {
    const claimed = await claimPostRagOutboxEvent(event.outboxId, { workerId: 'worker-1', now: claimTimes[index] })
    const failed = await failPostRagOutboxEvent(event.outboxId, {
      workerId: 'worker-1', leaseToken: claimed!.leaseToken!, now: claimTimes[index], error: { code: 'INTERNAL_ERROR' },
    })
    if (index < 4) expect(failed).toMatchObject({ status: 'retry_wait', nextAttemptAt: expectedNext[index], lastError: { code: 'INTERNAL_ERROR', message: 'Internal RAG outbox error', retryable: true, at: claimTimes[index] } })
    else expect(failed).toMatchObject({ status: 'dead_letter', attempts: 5 })
  }
})

test('preserves distinct immutable jobs for successive source versions', async () => {
  const firstEvent = await seed()
  const firstClaim = await claimPostRagOutboxEvent(firstEvent.outboxId, { workerId: 'worker-1', now: NOW })
  const first = await materializeClaimedPostRagOutboxEvent(firstEvent.outboxId, { workerId: 'worker-1', leaseToken: firstClaim!.leaseToken!, now: '2026-07-12T04:00:01.000Z' })
  await db.updateById('posts', 'post-1', { content: { title: '第二课' }, updatedAt: '2026-07-12T04:00:02.000Z' })
  const secondEvent = await db.runTransaction((transaction) => appendPostRagOutboxEvent(transaction, { communityId: 'community-1', aggregateId: 'post-1', reasonCode: 'post.updated', now: '2026-07-12T04:00:02.000Z' }))
  const secondClaim = await claimPostRagOutboxEvent(secondEvent.outboxId, { workerId: 'worker-1', now: '2026-07-12T04:00:02.000Z' })
  const second = await materializeClaimedPostRagOutboxEvent(secondEvent.outboxId, { workerId: 'worker-1', leaseToken: secondClaim!.leaseToken!, now: '2026-07-12T04:00:03.000Z' })
  expect(second.job._id).not.toBe(first.job._id)
  expect(second.job.sourceVersion).not.toBe(first.job.sourceVersion)
  expect(localDb._dump(POST_RAG_JOBS)).toHaveLength(2)
})
