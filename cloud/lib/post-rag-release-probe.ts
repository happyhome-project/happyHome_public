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

function assertProbeIdentity(id: string, probe: any) {
  const expected = fixtureIds(id)
  if (probe?.runId !== id || probe?.postId !== expected.postId || probe?.sectionId !== expected.sectionId) {
    throw new Error('release probe fixture binding does not match run binding')
  }
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

const MAX_PROBE_INDEX_VERSIONS = 99

function withoutId(document: any) {
  const { _id: _ignored, ...data } = document
  return data
}

function pendingCleanup() {
  return { success: false, pending: true, status: 'cleaning' }
}

function artifactDigest(probe: any, artifacts: any) {
  return createHash('sha256').update(JSON.stringify({
    runId: probe.runId, communityId: probe.communityId, postId: probe.postId,
    outboxId: probe.outboxId, cleanupOutboxId: probe.cleanupOutboxId, artifacts,
  })).digest('hex')
}

function assertArtifactBound(document: any, expectedId: string, probe: any, kind: 'outbox' | 'job') {
  if (String(document?._id || '') !== expectedId
    || String(document?.postId ?? document?.aggregateId ?? '') !== String(probe.postId)
    || String(document?.communityId || '') !== String(probe.communityId)) {
    throw new Error(`release probe ${kind} binding does not match run binding`)
  }
}

function assertJobBound(job: any, expectedId: string, expectedOutboxId: string, expectedAction: 'upsert' | 'delete', probe: any) {
  assertArtifactBound(job, expectedId, probe, 'job')
  if (job?.schemaVersion !== 2 || job?.outboxId !== expectedOutboxId || job?.action !== expectedAction) {
    throw new Error('release probe job binding does not match run binding')
  }
}

function validateFinalizingArtifacts(probe: any) {
  const artifacts = probe?.cleanupArtifactIds
  const validIds = (value: unknown, max: number) => Array.isArray(value)
    && value.length <= max
    && new Set(value).size === value.length
    && value.every(id => typeof id === 'string' && id.length > 0)
  if (!artifacts || !validIds(artifacts.jobIds, 2) || !validIds(artifacts.outboxIds, 2)
    || !validIds(artifacts.indexStateIds, 1) || !validIds(artifacts.indexVersionIds, MAX_PROBE_INDEX_VERSIONS)
    || artifacts.outboxIds.length !== 2 || artifacts.outboxIds[0] !== probe.outboxId || artifacts.outboxIds[1] !== probe.cleanupOutboxId
    || artifacts.indexStateIds.some((id: string) => id !== probe.postId)
    || probe.cleanupArtifactDigest !== artifactDigest(probe, artifacts)) {
    throw new Error('release probe finalizing artifact binding is invalid')
  }
  return artifacts as { jobIds: string[]; outboxIds: string[]; indexStateIds: string[]; indexVersionIds: string[] }
}

async function revalidateLiveFinalizingArtifacts(probe: any, artifacts: ReturnType<typeof validateFinalizingArtifacts>) {
  const outboxes = await db.getByIds('post_rag_outbox', artifacts.outboxIds) as any[]
  for (const outbox of outboxes) {
    const id = String(outbox?._id || '')
    if (!artifacts.outboxIds.includes(id)) throw new Error('release probe outbox binding does not match run binding')
    assertArtifactBound(outbox, id, probe, 'outbox')
  }
  const jobs = await db.getByIds('post_rag_jobs', artifacts.jobIds) as any[]
  for (const job of jobs) {
    const id = String(job?._id || '')
    if (!artifacts.jobIds.includes(id)) throw new Error('release probe job binding does not match run binding')
    if (job?.outboxId === probe.outboxId) assertJobBound(job, id, probe.outboxId, 'upsert', probe)
    else if (job?.outboxId === probe.cleanupOutboxId) assertJobBound(job, id, probe.cleanupOutboxId, 'delete', probe)
    else throw new Error('release probe job binding does not match run binding')
  }
  const states = await db.getByIds('post_rag_index_state_v2', artifacts.indexStateIds) as any[]
  for (const state of states) {
    if (state?._id !== probe.postId || state?.postId !== probe.postId) throw new Error('release probe index state binding does not match run binding')
  }
  const versions = await db.getByIds('post_rag_index_versions', artifacts.indexVersionIds) as any[]
  for (const version of versions) {
    if (!artifacts.indexVersionIds.includes(String(version?._id || '')) || version?.postId !== probe.postId) {
      throw new Error('release probe index version binding does not match run binding')
    }
  }
}

async function finalizeProbeCleanup(probe: any) {
  const artifacts = validateFinalizingArtifacts(probe)
  await revalidateLiveFinalizingArtifacts(probe, artifacts)
  for (const id of artifacts.jobIds) await db.removeById('post_rag_jobs', id)
  for (const id of artifacts.outboxIds) await db.removeById('post_rag_outbox', id)
  for (const id of artifacts.indexStateIds) await db.removeById('post_rag_index_state_v2', id)
  for (const id of artifacts.indexVersionIds) await db.removeById('post_rag_index_versions', id)
  const cleanupCounts = {
    jobs: artifacts.jobIds.length,
    outboxes: artifacts.outboxIds.length,
    indexStates: artifacts.indexStateIds.length,
    indexVersions: artifacts.indexVersionIds.length,
  }
  const now = new Date().toISOString()
  const cleaned = await db.runTransaction(async tx => {
    const current = await db.transactionGetByIdOrNull<any>(tx, PROBES, probe.runId)
    if (!current) throw new Error('release probe run binding not found')
    if (current.status === 'cleaned') return current
    if (current.status !== 'finalizing') throw new Error('release probe cleanup state changed during finalization')
    validateFinalizingArtifacts(current)
    const next = { ...current, status: 'cleaned', cleanedAt: now, cleanupCounts }
    await tx.collection(PROBES).doc(probe.runId).set({ data: withoutId(next) })
    return next
  })
  return { success: true, alreadyCleaned: cleaned.cleanedAt !== probe.cleanedAt && probe.status !== 'cleaned' ? false : true, status: 'cleaned', cleanupCounts: cleaned.cleanupCounts }
}

async function prepareProbeFinalization(probe: any) {
  const outboxes = await db.getByIds('post_rag_outbox', [probe.outboxId, probe.cleanupOutboxId]) as any[]
  const byOutboxId = new Map(outboxes.map(outbox => [String(outbox?._id || ''), outbox]))
  const createOutbox = byOutboxId.get(probe.outboxId)
  const cleanupOutbox = byOutboxId.get(probe.cleanupOutboxId)
  if (!createOutbox) return null
  assertArtifactBound(createOutbox, probe.outboxId, probe, 'outbox')
  if (!cleanupOutbox) return null
  assertArtifactBound(cleanupOutbox, probe.cleanupOutboxId, probe, 'outbox')
  if (cleanupOutbox.schemaVersion !== 2 || cleanupOutbox.status !== 'completed' || !cleanupOutbox.materializedJobId) return null

  const createJobId = createOutbox?.materializedJobId ? String(createOutbox.materializedJobId) : null
  const cleanupJobId = String(cleanupOutbox.materializedJobId)
  const jobIds = [...new Set([createJobId, cleanupJobId].filter(Boolean) as string[])]
  const jobs = await db.getByIds('post_rag_jobs', jobIds) as any[]
  const byJobId = new Map(jobs.map(job => [String(job?._id || ''), job]))
  const createJob = createJobId ? byJobId.get(createJobId) : null
  const cleanupJob = byJobId.get(cleanupJobId)
  if (createJob) assertJobBound(createJob, createJobId!, probe.outboxId, 'upsert', probe)
  if (!cleanupJob) return null
  assertJobBound(cleanupJob, cleanupJobId, probe.cleanupOutboxId, 'delete', probe)
  if (cleanupJob.status !== 'completed' || !['removed', 'superseded'].includes(cleanupJob.outcome)) return null
  const createVersion = Number(createJob?.contentVersion ?? probe.contentVersion)
  if (!Number.isSafeInteger(createVersion) || !Number.isSafeInteger(cleanupJob.contentVersion) || cleanupJob.contentVersion <= createVersion) {
    throw new Error('release probe delete job binding is not a higher content version')
  }
  if (createJob) {
    if (createJob.status === 'processing' && String(createJob.leaseExpiresAt || '') > new Date().toISOString()) return null
    if (!['completed', 'dead_letter', 'processing'].includes(createJob.status)) return null
  }

  const state = await db.getByIdOrNull('post_rag_index_state_v2', probe.postId) as any
  if (state && (String(state._id || '') !== probe.postId || String(state.postId || '') !== probe.postId)) {
    throw new Error('release probe index state binding does not match run binding')
  }
  if (cleanupJob.outcome === 'superseded' && state?.state === 'active') return null
  const versions = await db.query('post_rag_index_versions', { postId: probe.postId }, { limit: MAX_PROBE_INDEX_VERSIONS + 1 }) as any[]
  if (versions.length > MAX_PROBE_INDEX_VERSIONS) throw new Error('release probe cleanup artifact limit exceeded')
  for (const version of versions) {
    if (typeof version?._id !== 'string' || !version._id || String(version.postId || '') !== probe.postId) {
      throw new Error('release probe index version binding does not match run binding')
    }
  }
  const cleanupArtifactIds = {
    jobIds,
    outboxIds: [probe.outboxId, probe.cleanupOutboxId],
    indexStateIds: state ? [probe.postId] : [],
    indexVersionIds: versions.map(version => version._id).sort(),
  }
  return db.runTransaction(async tx => {
    const current = await db.transactionGetByIdOrNull<any>(tx, PROBES, probe.runId)
    if (!current) throw new Error('release probe run binding not found')
    if (current.status === 'finalizing' || current.status === 'cleaned') return current
    if (current.status !== 'cleaning' || current.cleanupOutboxId !== probe.cleanupOutboxId) {
      throw new Error('release probe cleanup state changed during preparation')
    }
    const next = { ...current, status: 'finalizing', cleanupArtifactIds, cleanupArtifactDigest: artifactDigest(current, cleanupArtifactIds) }
    await tx.collection(PROBES).doc(probe.runId).set({ data: withoutId(next) })
    return next
  })
}

export async function cleanupPostRagReleaseProbe(input: any) {
  const id = validRunId(input?.runId)
  const probe = await readProbe(id)
  if (!probe) throw new Error('release probe run binding not found')
  assertProbeIdentity(id, probe)
  assertCleanupBound(input, probe)
  if (probe.status === 'cleaned') return { success: true, alreadyCleaned: true, status: 'cleaned', cleanupCounts: probe.cleanupCounts }
  if (probe.status === 'finalizing') return finalizeProbeCleanup(probe)
  if (probe.status === 'cleaning') {
    const finalizing = await prepareProbeFinalization(probe)
    return finalizing ? finalizeProbeCleanup(finalizing) : pendingCleanup()
  }
  if (probe.status !== 'active') throw new Error('release probe cleanup state is invalid')
  const now = new Date().toISOString()
  const started = await db.runTransaction(async tx => {
    const current = await db.transactionGetByIdOrNull<any>(tx, PROBES, id)
    if (!current) throw new Error('release probe run binding not found')
    if (current.status !== 'active') return current
    if (await db.transactionGetByIdOrNull(tx, 'posts', current.postId)) await tx.collection('posts').doc(current.postId).remove()
    if (await db.transactionGetByIdOrNull(tx, 'sections', current.sectionId)) await tx.collection('sections').doc(current.sectionId).remove()
    const removed = await appendPostRagOutboxEvent(tx, { communityId: current.communityId, aggregateId: current.postId, reasonCode: 'post.deleted', now })
    const next = { ...current, status: 'cleaning', cleanupStartedAt: now, cleanupOutboxId: removed.outboxId }
    await tx.collection(PROBES).doc(id).set({ data: withoutId(next) })
    return next
  })
  if (started.status === 'cleaned') return { success: true, alreadyCleaned: true, status: 'cleaned', cleanupCounts: started.cleanupCounts }
  if (started.status === 'finalizing') return finalizeProbeCleanup(started)
  return pendingCleanup()
}
