import { createHash } from 'node:crypto'
import * as db from './db'
import { appendPostRagOutboxEvent } from './post-rag-outbox'

const PROBES = 'post_rag_release_probes'
const TRIGGER = 'post-rag-worker-every-minute'
const TRIGGER_HASH = createHash('sha256').update(TRIGGER).digest('hex')

function validRunId(value: unknown) {
  const id = String(value || '')
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new Error('invalid release probe runId')
  return id
}

function fixtureIds(id: string) {
  const suffix = createHash('sha256').update(id).digest('hex').slice(0, 24)
  return { sectionId: `rag_timer_section_${suffix}`, postId: `rag_timer_post_${suffix}` }
}

async function readProbe(id: string) {
  try { return await db.getById(PROBES, id) as any } catch { return null }
}

function assertBound(input: any, probe: any) {
  for (const field of ['communityId', 'sectionId', 'postId']) {
    if (String(input?.[field] || '') !== String(probe?.[field] || '')) throw new Error('release probe ids do not match run binding')
  }
}

function assertCleanupBound(input: any, probe: any) {
  const fields = ['communityId', 'sectionId', 'postId']
  if (fields.every(field => input?.[field] == null || input?.[field] === '')) return
  assertBound(input, probe)
}

export async function createPostRagReleaseProbe(value: unknown) {
  const id = validRunId(value)
  if (await readProbe(id)) throw new Error('release probe runId already exists')
  const communities = await db.queryAfterId('communities', { status: 'active' }, null, 1) as any[]
  if (!communities[0]) throw new Error('active community required')
  const communityId = String(communities[0]._id)
  const { sectionId, postId } = fixtureIds(id)
  const now = new Date().toISOString()
  const outbox = await db.runTransaction(async tx => {
    if (await db.transactionGetByIdOrNull(tx, PROBES, id)) throw new Error('release probe runId already exists')
    await tx.collection('sections').doc(sectionId).set({ data: { communityId, name: 'RAG release probe', status: 'active', type: 'evergreen', widgets: [{ widgetId: 'probe', fieldKey: 'probe', label: 'Probe', type: 'short_text', visibility: 'public', order: 0 }] } })
    await tx.collection('posts').doc(postId).set({ data: { communityId, sectionId, status: 'active', auditStatus: 'pass', authorId: 'release-probe', content: { probe: `probe-${id}` }, createdAt: now, updatedAt: now } })
    const created = await appendPostRagOutboxEvent(tx, { communityId, aggregateId: postId, reasonCode: 'post.created', now })
    await tx.collection(PROBES).doc(id).set({ data: { runId: id, communityId, sectionId, postId, outboxId: created.outboxId, contentVersion: created.contentVersion, triggerName: TRIGGER, triggerIdHash: TRIGGER_HASH, baseline: now, status: 'active', createdAt: now } })
    return created
  })
  return { runId: id, communityId, sectionId, postId, outboxId: outbox.outboxId, contentVersion: outbox.contentVersion, baseline: now, triggerName: TRIGGER }
}

export async function readPostRagReleaseTimerEvidence(value: unknown) {
  const probe = await readProbe(validRunId(value))
  if (!probe || probe.status !== 'active') throw new Error('release probe run binding not found')
  const rows = await db.query('post_rag_worker_timer_evidence', {}, { orderBy: ['invokedAt', 'desc'], limit: 100 }) as any[]
  const row = rows.find(item => item?.schemaVersion === 2 && item?.triggerIdHash === probe.triggerIdHash && String(item?.invokedAt || '') > probe.baseline)
  if (!row) return { evidence: null }
  return { evidence: { source: 'timer', triggerName: probe.triggerName, invokedAt: String(row.invokedAt), outboxIds: Array.isArray(row.outboxIds) ? row.outboxIds.slice(0, 100) : [], v2JobIds: Array.isArray(row.v2JobIds) ? row.v2JobIds.slice(0, 100) : [], v2Attempted: Number(row.v2CandidateCount || 0) > 0, v2Succeeded: Number(row.v2CompletedCount || 0) > 0, v2CompletedCount: Number(row.v2CompletedCount || 0) } }
}

export async function readPostRagReleaseProbeStatus(input: any) {
  const probe = await readProbe(validRunId(input?.runId))
  if (!probe || probe.status !== 'active') throw new Error('release probe run binding not found')
  assertBound(input, probe)
  if (String(input.outboxId || '') !== String(probe.outboxId || '')) throw new Error('release probe ids do not match run binding')
  const outbox = await db.getById('post_rag_outbox', probe.outboxId) as any
  const exactOutbox = outbox?.schemaVersion === 2 && outbox?._id === probe.outboxId && outbox?.aggregateId === probe.postId && outbox?.communityId === probe.communityId && outbox?.status === 'completed'
  if (!exactOutbox) return { outbox: { _id: outbox?._id, status: outbox?.status }, job: null, state: null, complete: false }
  const job = outbox.materializedJobId ? await db.getByIdOrNull('post_rag_jobs', outbox.materializedJobId) as any : null
  const state = await db.getByIdOrNull('post_rag_index_state_v2', probe.postId) as any
  const complete = Boolean(job?.schemaVersion === 2 && job?.status === 'completed' && job?.postId === probe.postId && state?.schemaVersion === 2 && state?.postId === probe.postId && state?.state === 'active' && state?.sourceVersion === job?.sourceVersion)
  return { outbox: { _id: outbox._id, status: outbox.status, materializedJobId: outbox.materializedJobId }, job: job ? { _id: job._id, schemaVersion: job.schemaVersion, status: job.status, postId: job.postId, sourceVersion: job.sourceVersion } : null, state: state ? { postId: state.postId, schemaVersion: state.schemaVersion, state: state.state, sourceVersion: state.sourceVersion } : null, complete }
}

export async function cleanupPostRagReleaseProbe(input: any) {
  const id = validRunId(input?.runId)
  const probe = await readProbe(id)
  if (!probe) throw new Error('release probe run binding not found')
  assertCleanupBound(input, probe)
  if (probe.status === 'cleaned') return { success: true, alreadyCleaned: true }
  const now = new Date().toISOString()
  const outbox = await db.runTransaction(async tx => {
    const current = await db.transactionGetByIdOrNull<any>(tx, PROBES, id)
    if (!current) throw new Error('release probe run binding not found')
    if (current.status === 'cleaned') return null
    if (await db.transactionGetByIdOrNull(tx, 'posts', probe.postId)) await tx.collection('posts').doc(probe.postId).remove()
    if (await db.transactionGetByIdOrNull(tx, 'sections', probe.sectionId)) await tx.collection('sections').doc(probe.sectionId).remove()
    const removed = await appendPostRagOutboxEvent(tx, { communityId: probe.communityId, aggregateId: probe.postId, reasonCode: 'post.deleted', now })
    const { _id: _ignoredId, ...probeData } = probe
    await tx.collection(PROBES).doc(id).set({ data: { ...probeData, status: 'cleaned', cleanedAt: now, cleanupOutboxId: removed.outboxId } })
    return removed
  })
  return outbox ? { success: true, alreadyCleaned: false, outboxId: outbox.outboxId, contentVersion: outbox.contentVersion } : { success: true, alreadyCleaned: true }
}
