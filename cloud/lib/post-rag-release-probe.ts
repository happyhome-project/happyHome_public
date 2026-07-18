import { createHash } from 'node:crypto'
import * as db from './db'
import { appendPostRagOutboxEvent } from './post-rag-outbox'
import { validateStoredPostRagJob } from './post-rag-jobs'
import { comparePostRagActivationOrder, type PostRagActivationOrder } from './post-rag-versioned-index-sink'

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

function createInput(value: unknown) {
  if (typeof value === 'string') return { runId: validRunId(value), communityId: '' }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid release probe runId')
  const raw = value as Record<string, unknown>
  if (Object.keys(raw).some(key => key !== 'runId' && key !== 'communityId')) throw new Error('invalid release probe create input')
  const communityId = String(raw.communityId || '')
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(communityId)) throw new Error('invalid release probe communityId')
  return { runId: validRunId(raw.runId), communityId }
}

function assertProbeIdentity(id: string, probe: any) {
  const expected = fixtureIds(id)
  if (probe?._id !== id || probe?.runId !== id || probe?.postId !== expected.postId || probe?.sectionId !== expected.sectionId) {
    throw new Error('release probe fixture binding does not match run binding')
  }
}

export async function createPostRagReleaseProbe(value: unknown) {
  const requested = createInput(value)
  const id = requested.runId
  if (await readProbe(id)) throw new Error('release probe runId already exists')
  const requestedCommunity = requested.communityId
    ? await db.getByIdOrNull<any>('communities', requested.communityId)
    : null
  const communities = requested.communityId
    ? (requestedCommunity ? [requestedCommunity] : [])
    : await db.queryAfterId('communities', { status: 'active' }, null, 1) as any[]
  if (!communities[0] || communities[0]._id !== (requested.communityId || communities[0]._id)
    || communities[0].status !== 'active') throw new Error('active community required')
  const communityId = String(communities[0]._id)
  const { sectionId, postId } = fixtureIds(id)
  const now = new Date().toISOString()
  const outbox = await db.runTransaction(async tx => {
    if (await db.transactionGetByIdOrNull(tx, PROBES, id)) throw new Error('release probe runId already exists')
    await tx.collection('sections').doc(sectionId).set({ data: { probeRunId: id, communityId, name: 'RAG release probe', status: 'active', type: 'evergreen', widgets: [{ widgetId: 'probe', fieldKey: 'probe', label: 'Probe', type: 'short_text', visibility: 'public', order: 0 }] } })
    await tx.collection('posts').doc(postId).set({ data: { probeRunId: id, communityId, sectionId, status: 'active', auditStatus: 'pass', authorId: 'release-probe', content: { probe: `probe-${id}` }, createdAt: now, updatedAt: now } })
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

const MAX_PROBE_INDEX_VERSIONS = 32

function withoutId(document: any) {
  const { _id: _ignored, ...data } = document
  return data
}

function pendingCleanup(status: 'active' | 'cleaning' | 'finalizing' = 'cleaning') {
  return { success: false, pending: true, status }
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

function assertFixtureBound(kind: 'post' | 'section', fixture: any, probe: any) {
  const valid = kind === 'section'
    ? fixture?.probeRunId === probe.runId && fixture?.communityId === probe.communityId
      && fixture?.name === 'RAG release probe' && fixture?.type === 'evergreen'
    : fixture?.probeRunId === probe.runId && fixture?.communityId === probe.communityId
      && fixture?.sectionId === probe.sectionId && fixture?.authorId === 'release-probe'
      && fixture?.content?.probe === `probe-${probe.runId}`
  if (!valid) throw new Error(`release probe ${kind} fixture binding does not match run binding`)
}

function validActivationOrder(value: any): value is PostRagActivationOrder {
  return Boolean(value && Number.isSafeInteger(value.contentVersion) && value.contentVersion >= 0
    && typeof value.jobId === 'string' && value.jobId.length > 0)
}

function createJobSafeToRemove(job: any, now: string) {
  if (!job) return true
  if (job.status === 'completed' || job.status === 'dead_letter') return true
  return job.status === 'processing' && typeof job.leaseExpiresAt === 'string' && job.leaseExpiresAt <= now
}

function removedStateProvesDelete(state: any, cleanupJob: any) {
  if (!state || state.schemaVersion !== 2 || state.state !== 'removed'
    || typeof state.sourceVersion !== 'string' || !state.sourceVersion
    || !validActivationOrder(state.activationOrder)) return false
  const cleanupOrder = { contentVersion: cleanupJob.contentVersion, jobId: cleanupJob._id }
  if (!validActivationOrder(cleanupOrder)) return false
  const comparison = comparePostRagActivationOrder(state.activationOrder, cleanupOrder)
  return comparison > 0 || (comparison === 0 && state.sourceVersion === cleanupJob.sourceVersion)
}

function jobBinding(job: any) {
  return {
    id: job._id, outboxId: job.outboxId, postId: job.postId, communityId: job.communityId,
    action: job.action, sourceVersion: job.sourceVersion, contentVersion: job.contentVersion,
  }
}

function sameJobBinding(job: any, binding: any) {
  return Boolean(binding && JSON.stringify(jobBinding(job)) === JSON.stringify(binding))
}

function validateCreateJobFence(probe: any) {
  const valid = typeof probe?.createJobId === 'string' && probe.createJobId.length > 0
    && typeof probe?.createJobWasPresent === 'boolean'
    && typeof probe?.createJobFencedAt === 'string' && Number.isFinite(Date.parse(probe.createJobFencedAt))
    && (probe.createJobWasPresent
      ? probe.createJobBinding?.id === probe.createJobId && probe.createJobBinding?.outboxId === probe.outboxId
        && probe.createJobBinding?.postId === probe.postId && probe.createJobBinding?.communityId === probe.communityId
        && probe.createJobBinding?.action === 'upsert' && probe.createJobBinding?.contentVersion === probe.contentVersion
      : probe.createJobBinding === null)
  if (!valid) throw new Error('release probe create job fence binding is invalid')
  return {
    createJobId: probe.createJobId as string,
    createJobWasPresent: probe.createJobWasPresent as boolean,
    createJobBinding: probe.createJobBinding as any,
    createJobFencedAt: probe.createJobFencedAt as string,
  }
}

function validateFinalizingArtifacts(probe: any) {
  const artifacts = probe?.cleanupArtifactIds
  const validIds = (value: unknown, max: number) => Array.isArray(value)
    && value.length <= max
    && new Set(value).size === value.length
    && value.every(id => typeof id === 'string' && id.length > 0)
  const fence = validateCreateJobFence(probe)
  if (!artifacts || !validIds(artifacts.jobIds, 1) || !validIds(artifacts.outboxIds, 2)
    || !validIds(artifacts.indexStateIds, 1) || !validIds(artifacts.indexVersionIds, MAX_PROBE_INDEX_VERSIONS)
    || artifacts.outboxIds.length !== 2 || artifacts.outboxIds[0] !== probe.outboxId || artifacts.outboxIds[1] !== probe.cleanupOutboxId
    || typeof artifacts.createJobId !== 'string' || typeof artifacts.cleanupJobId !== 'string'
    || artifacts.createJobId !== fence.createJobId || artifacts.createJobWasPresent !== fence.createJobWasPresent
    || JSON.stringify(artifacts.createJobBinding) !== JSON.stringify(fence.createJobBinding)
    || artifacts.cleanupJobBinding?.id !== artifacts.cleanupJobId
    || artifacts.jobIds.length !== 1 || artifacts.jobIds[0] !== artifacts.cleanupJobId
    || artifacts.indexStateIds.some((id: string) => id !== probe.postId)
    || probe.cleanupArtifactDigest !== artifactDigest(probe, artifacts)) {
    throw new Error('release probe finalizing artifact binding is invalid')
  }
  return artifacts as {
    createJobId: string; createJobWasPresent: boolean; createJobBinding: any; cleanupJobId: string; cleanupJobBinding: any;
    jobIds: string[]; outboxIds: string[]; indexStateIds: string[]; indexVersionIds: string[]
  }
}

async function exactCurrentVersionIds(probe: any) {
  const versions = await db.query('post_rag_index_versions', { postId: probe.postId }, { limit: MAX_PROBE_INDEX_VERSIONS + 1 }) as any[]
  if (versions.length > MAX_PROBE_INDEX_VERSIONS) throw new Error('release probe cleanup artifact limit exceeded')
  for (const version of versions) {
    if (typeof version?._id !== 'string' || !version._id || version.postId !== probe.postId) {
      throw new Error('release probe index version binding does not match run binding')
    }
  }
  return versions.map(version => version._id).sort()
}

async function finalizeProbeCleanup(probe: any) {
  const artifacts = validateFinalizingArtifacts(probe)
  if (!probe.artifactsRemovedAt) {
    const currentVersionIds = await exactCurrentVersionIds(probe)
    if (JSON.stringify(currentVersionIds) !== JSON.stringify(artifacts.indexVersionIds)) return pendingCleanup('finalizing')
    const removedAt = new Date().toISOString()
    const removal = await db.runTransaction(async tx => {
      const current = await db.transactionGetByIdOrNull<any>(tx, PROBES, probe.runId)
      if (!current) throw new Error('release probe run binding not found')
      assertProbeIdentity(probe.runId, current)
      if (current.communityId !== probe.communityId || current.sectionId !== probe.sectionId || current.postId !== probe.postId) {
        throw new Error('release probe ids do not match run binding')
      }
      if (current.status !== 'finalizing') return { pending: current.status !== 'cleaned', removed: current.status === 'cleaned' }
      const currentArtifacts = validateFinalizingArtifacts(current)
      if (current.artifactsRemovedAt) return { pending: false, removed: true }

      const createOutbox = await db.transactionGetByIdOrNull<any>(tx, 'post_rag_outbox', current.outboxId)
      const cleanupOutbox = await db.transactionGetByIdOrNull<any>(tx, 'post_rag_outbox', current.cleanupOutboxId)
      if (!createOutbox || !cleanupOutbox) return { pending: true, removed: false }
      assertArtifactBound(createOutbox, current.outboxId, current, 'outbox')
      assertArtifactBound(cleanupOutbox, current.cleanupOutboxId, current, 'outbox')
      if (createOutbox.schemaVersion !== 2 || cleanupOutbox.schemaVersion !== 2
        || createOutbox.status !== 'completed' || cleanupOutbox.status !== 'completed'
        || createOutbox.materializedJobId !== currentArtifacts.createJobId
        || cleanupOutbox.materializedJobId !== currentArtifacts.cleanupJobId) return { pending: true, removed: false }

      const createJob = await db.transactionGetByIdOrNull<any>(tx, 'post_rag_jobs', currentArtifacts.createJobId)
      const cleanupJob = await db.transactionGetByIdOrNull<any>(tx, 'post_rag_jobs', currentArtifacts.cleanupJobId)
      if (createJob || !cleanupJob) return { pending: true, removed: false }
      validateStoredPostRagJob(cleanupJob, currentArtifacts.cleanupJobId)
      assertJobBound(cleanupJob, currentArtifacts.cleanupJobId, current.cleanupOutboxId, 'delete', current)
      if (!sameJobBinding(cleanupJob, currentArtifacts.cleanupJobBinding)) {
        throw new Error('release probe job binding does not match persisted artifact binding')
      }
      if (cleanupJob.status !== 'completed' || !['removed', 'superseded'].includes(String(cleanupJob.outcome))) {
        return { pending: true, removed: false }
      }
      const state = await db.transactionGetByIdOrNull<any>(tx, 'post_rag_index_state_v2', current.postId)
      if (!state || state._id !== current.postId || state.postId !== current.postId || !removedStateProvesDelete(state, cleanupJob)) {
        return { pending: true, removed: false }
      }
      for (const versionId of currentArtifacts.indexVersionIds) {
        const version = await db.transactionGetByIdOrNull<any>(tx, 'post_rag_index_versions', versionId)
        if (!version || version._id !== versionId || version.postId !== current.postId) return { pending: true, removed: false }
      }
      for (const jobId of currentArtifacts.jobIds) await tx.collection('post_rag_jobs').doc(jobId).remove()
      await tx.collection('post_rag_outbox').doc(current.outboxId).remove()
      await tx.collection('post_rag_outbox').doc(current.cleanupOutboxId).remove()
      await tx.collection('post_rag_index_state_v2').doc(current.postId).remove()
      for (const versionId of currentArtifacts.indexVersionIds) await tx.collection('post_rag_index_versions').doc(versionId).remove()
      await tx.collection(PROBES).doc(current.runId).set({ data: withoutId({ ...current, artifactsRemovedAt: removedAt }) })
      return { pending: false, removed: true }
    })
    if (removal.pending) return pendingCleanup('finalizing')
  }

  if ((await exactCurrentVersionIds(probe)).length !== 0) return pendingCleanup('finalizing')
  const cleanupCounts = {
    jobs: artifacts.jobIds.length + (artifacts.createJobWasPresent ? 1 : 0),
    outboxes: artifacts.outboxIds.length,
    indexStates: artifacts.indexStateIds.length,
    indexVersions: artifacts.indexVersionIds.length,
  }
  const now = new Date().toISOString()
  const cleaned = await db.runTransaction(async tx => {
    const current = await db.transactionGetByIdOrNull<any>(tx, PROBES, probe.runId)
    if (!current) throw new Error('release probe run binding not found')
    if (current.status === 'cleaned') return { document: current, transitioned: false }
    assertProbeIdentity(probe.runId, current)
    if (current.status !== 'finalizing') throw new Error('release probe cleanup state changed during finalization')
    const currentArtifacts = validateFinalizingArtifacts(current)
    if (!current.artifactsRemovedAt) return null
    for (const [collection, ids] of [
      ['post_rag_jobs', [...new Set([currentArtifacts.createJobId, currentArtifacts.cleanupJobId])]], ['post_rag_outbox', currentArtifacts.outboxIds],
      ['post_rag_index_state_v2', currentArtifacts.indexStateIds], ['post_rag_index_versions', currentArtifacts.indexVersionIds],
    ] as Array<[string, string[]]>) {
      for (const artifactId of ids) if (await db.transactionGetByIdOrNull(tx, collection, artifactId)) return null
    }
    const next = { ...current, status: 'cleaned', cleanedAt: now, cleanupCounts }
    await tx.collection(PROBES).doc(probe.runId).set({ data: withoutId(next) })
    return { document: next, transitioned: true }
  })
  if (!cleaned) return pendingCleanup('finalizing')
  return { success: true, alreadyCleaned: !cleaned.transitioned, transitioned: cleaned.transitioned, status: 'cleaned', cleanupCounts: cleaned.document.cleanupCounts }
}

async function prepareProbeFinalization(probe: any) {
  const fence = validateCreateJobFence(probe)
  const outboxes = await db.getByIds('post_rag_outbox', [probe.outboxId, probe.cleanupOutboxId]) as any[]
  const byOutboxId = new Map(outboxes.map(outbox => [String(outbox?._id || ''), outbox]))
  const createOutbox = byOutboxId.get(probe.outboxId)
  const cleanupOutbox = byOutboxId.get(probe.cleanupOutboxId)
  if (!createOutbox) return null
  assertArtifactBound(createOutbox, probe.outboxId, probe, 'outbox')
  if (createOutbox.schemaVersion !== 2) return null
  if (createOutbox.status !== 'completed' || !createOutbox.materializedJobId) return null
  if (!cleanupOutbox) return null
  assertArtifactBound(cleanupOutbox, probe.cleanupOutboxId, probe, 'outbox')
  if (cleanupOutbox.schemaVersion !== 2 || cleanupOutbox.status !== 'completed' || !cleanupOutbox.materializedJobId) return null

  const createJobId = String(createOutbox.materializedJobId)
  if (createJobId !== fence.createJobId) throw new Error('release probe create outbox binding does not match persisted fence')
  const cleanupJobId = String(cleanupOutbox.materializedJobId)
  const jobs = await db.getByIds('post_rag_jobs', [createJobId, cleanupJobId]) as any[]
  const byJobId = new Map(jobs.map(job => [String(job?._id || ''), job]))
  const createJob = byJobId.get(createJobId)
  const cleanupJob = byJobId.get(cleanupJobId)
  if (createJob) return null
  if (!cleanupJob) return null
  validateStoredPostRagJob(cleanupJob, cleanupJobId)
  assertJobBound(cleanupJob, cleanupJobId, probe.cleanupOutboxId, 'delete', probe)
  if (cleanupJob.status !== 'completed' || !['removed', 'superseded'].includes(String(cleanupJob.outcome))) return null
  const createVersion = Number(fence.createJobBinding?.contentVersion ?? probe.contentVersion)
  if (!Number.isSafeInteger(createVersion) || !Number.isSafeInteger(cleanupJob.contentVersion) || cleanupJob.contentVersion <= createVersion) {
    throw new Error('release probe delete job binding is not a higher content version')
  }
  const state = await db.getByIdOrNull('post_rag_index_state_v2', probe.postId) as any
  if (state && (String(state._id || '') !== probe.postId || String(state.postId || '') !== probe.postId)) {
    throw new Error('release probe index state binding does not match run binding')
  }
  if (!removedStateProvesDelete(state, cleanupJob)) return null
  const indexVersionIds = await exactCurrentVersionIds(probe)
  const cleanupArtifactIds = {
    createJobId, cleanupJobId,
    createJobWasPresent: fence.createJobWasPresent,
    createJobBinding: fence.createJobBinding, cleanupJobBinding: jobBinding(cleanupJob),
    jobIds: [cleanupJobId],
    outboxIds: [probe.outboxId, probe.cleanupOutboxId],
    indexStateIds: state ? [probe.postId] : [],
    indexVersionIds,
  }
  return db.runTransaction(async tx => {
    const current = await db.transactionGetByIdOrNull<any>(tx, PROBES, probe.runId)
    if (!current) throw new Error('release probe run binding not found')
    if (current.status === 'finalizing' || current.status === 'cleaned') return current
    if (current.status !== 'cleaning' || current.cleanupOutboxId !== probe.cleanupOutboxId) {
      throw new Error('release probe cleanup state changed during preparation')
    }
    validateCreateJobFence(current)
    const currentCreateOutbox = await db.transactionGetByIdOrNull<any>(tx, 'post_rag_outbox', current.outboxId)
    if (!currentCreateOutbox) return null
    assertArtifactBound(currentCreateOutbox, current.outboxId, current, 'outbox')
    if (currentCreateOutbox.schemaVersion !== 2 || currentCreateOutbox.status !== 'completed'
      || currentCreateOutbox.materializedJobId !== createJobId) return null
    if (await db.transactionGetByIdOrNull<any>(tx, 'post_rag_jobs', createJobId)) return null
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
  if (probe.status === 'cleaned') return { success: true, alreadyCleaned: true, transitioned: false, status: 'cleaned', cleanupCounts: probe.cleanupCounts }
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
    assertProbeIdentity(id, current)
    if (current.communityId !== probe.communityId || current.sectionId !== probe.sectionId || current.postId !== probe.postId) {
      throw new Error('release probe ids do not match run binding')
    }
    if (current.status !== 'active') return current
    const createOutbox = await db.transactionGetByIdOrNull<any>(tx, 'post_rag_outbox', current.outboxId)
    if (!createOutbox) return current
    assertArtifactBound(createOutbox, current.outboxId, current, 'outbox')
    if (createOutbox.schemaVersion !== 2 || createOutbox.status !== 'completed'
      || typeof createOutbox.materializedJobId !== 'string' || !createOutbox.materializedJobId) return current
    const createJobId = createOutbox.materializedJobId
    const createJob = await db.transactionGetByIdOrNull<any>(tx, 'post_rag_jobs', createJobId)
    if (createJob) {
      validateStoredPostRagJob(createJob, createJobId)
      assertJobBound(createJob, createJobId, current.outboxId, 'upsert', current)
      if (createJob.contentVersion !== current.contentVersion) throw new Error('release probe job binding does not match run binding')
      if (!createJobSafeToRemove(createJob, now)) return current
    }
    const currentPost = await db.transactionGetByIdOrNull<any>(tx, 'posts', current.postId)
    const currentSection = await db.transactionGetByIdOrNull<any>(tx, 'sections', current.sectionId)
    if (currentPost) assertFixtureBound('post', currentPost, current)
    if (currentSection) assertFixtureBound('section', currentSection, current)
    if (createJob) await tx.collection('post_rag_jobs').doc(createJobId).remove()
    if (currentPost) await tx.collection('posts').doc(current.postId).remove()
    if (currentSection) await tx.collection('sections').doc(current.sectionId).remove()
    const removed = await appendPostRagOutboxEvent(tx, { communityId: current.communityId, aggregateId: current.postId, reasonCode: 'post.deleted', now })
    const next = {
      ...current, status: 'cleaning', cleanupStartedAt: now, cleanupOutboxId: removed.outboxId,
      createJobId, createJobWasPresent: Boolean(createJob), createJobBinding: createJob ? jobBinding(createJob) : null,
      createJobFencedAt: now,
    }
    await tx.collection(PROBES).doc(id).set({ data: withoutId(next) })
    return next
  })
  if (started.status === 'cleaned') return { success: true, alreadyCleaned: true, transitioned: false, status: 'cleaned', cleanupCounts: started.cleanupCounts }
  if (started.status === 'finalizing') return finalizeProbeCleanup(started)
  if (started.status === 'active') return pendingCleanup('active')
  return pendingCleanup()
}
