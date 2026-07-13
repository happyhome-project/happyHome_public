const mockStore = new Map<string, any>()
const mockRemoveFailures = new Map<string, number>()
const mockTransactionReads = new Map<string, Array<any | (() => any)>>()
const mockKey = (collection: string, id: string) => `${collection}/${id}`
const matchesWhere = (document: any, where: Record<string, any>) => Object.entries(where).every(([field, value]) => document?.[field] === value)

jest.mock('../db', () => ({
  getById: jest.fn(async (collection, id) => {
    if (!mockStore.has(mockKey(collection, id))) throw new Error('missing')
    return mockStore.get(mockKey(collection, id))
  }),
  getByIdOrNull: jest.fn(async (collection, id) => mockStore.get(mockKey(collection, id)) || null),
  getByIds: jest.fn(async (collection, ids) => ids.map((id: string) => mockStore.get(mockKey(collection, id))).filter(Boolean)),
  queryAfterId: jest.fn(async () => [{ _id: 'community-1', status: 'active' }]),
  query: jest.fn(async (collection, where, options = {}) => [...mockStore.entries()]
    .filter(([key, document]) => key.startsWith(`${collection}/`) && matchesWhere(document, where))
    .map(([, document]) => document)
    .slice(options.skip || 0, options.limit == null ? undefined : (options.skip || 0) + options.limit)),
  removeById: jest.fn(async (collection, id) => {
    const key = mockKey(collection, id)
    const failures = mockRemoveFailures.get(key) || 0
    if (failures > 0) {
      mockRemoveFailures.set(key, failures - 1)
      throw new Error(`remove failed: ${key}`)
    }
    mockStore.delete(key)
  }),
  transactionGetByIdOrNull: jest.fn(async (_transaction, collection, id) => {
    const key = mockKey(collection, id)
    const queued = mockTransactionReads.get(key)
    if (queued?.length) {
      const value = queued.shift()
      return (typeof value === 'function' ? value() : value) || null
    }
    return mockStore.get(key) || null
  }),
  runTransaction: jest.fn(async callback => {
    const snapshot = structuredClone([...mockStore.entries()])
    try { return await callback({
    collection: (collection: string) => ({
      doc: (id: string) => ({
        get: async () => ({ data: mockStore.get(mockKey(collection, id)) }),
        set: async ({ data }: any) => {
          if ('_id' in data) throw new Error('document.set cannot update _id')
          mockStore.set(mockKey(collection, id), { _id: id, ...structuredClone(data) })
        },
        remove: async () => {
          const key = mockKey(collection, id)
          const failures = mockRemoveFailures.get(key) || 0
          if (failures > 0) {
            mockRemoveFailures.set(key, failures - 1)
            throw new Error(`remove failed: ${key}`)
          }
          mockStore.delete(key)
        },
      }),
    }),
    }) } catch (error) {
      mockStore.clear()
      for (const [key, value] of snapshot) mockStore.set(key, value)
      throw error
    }
  }),
}))

import {
  cleanupPostRagReleaseProbe,
  createPostRagReleaseProbe,
  readPostRagReleaseProbeStatus,
  readPostRagReleaseTimerEvidence,
} from '../post-rag-release-probe'

function getProbe(runId: string) {
  return mockStore.get(mockKey('post_rag_release_probes', runId))
}

function put(collection: string, id: string, document: Record<string, any>) {
  mockStore.set(mockKey(collection, id), { _id: id, ...document })
}

function withoutTestId(document: Record<string, any>) {
  const { _id: _ignored, ...data } = document
  return data
}

async function beginCleanup(runId: string) {
  const probe = await createPostRagReleaseProbe(runId)
  expect(await cleanupPostRagReleaseProbe(probe)).toMatchObject({ success: false, pending: true, status: 'cleaning' })
  return { ...probe, cleanupOutboxId: getProbe(runId).cleanupOutboxId }
}

function bindOutboxes(probe: any, options: { createJobId?: string | null; cleanupJobId?: string | null; createStatus?: string } = {}) {
  const createJobId = options.createJobId === undefined ? 'create-job' : options.createJobId
  const cleanupJobId = options.cleanupJobId === undefined ? 'delete-job' : options.cleanupJobId
  put('post_rag_outbox', probe.outboxId, {
    schemaVersion: 2, status: options.createStatus || (createJobId ? 'completed' : 'dead_letter'), aggregateId: probe.postId,
    communityId: probe.communityId, materializedJobId: createJobId,
  })
  put('post_rag_outbox', probe.cleanupOutboxId, {
    schemaVersion: 2, status: cleanupJobId ? 'completed' : 'pending', aggregateId: probe.postId,
    communityId: probe.communityId, materializedJobId: cleanupJobId,
  })
}

function putJob(probe: any, id: string, values: Record<string, any>) {
  put('post_rag_jobs', id, {
    schemaVersion: 2, outboxId: values.action === 'delete' ? probe.cleanupOutboxId : probe.outboxId,
    postId: probe.postId, communityId: probe.communityId, action: values.action,
    contentVersion: values.action === 'delete' ? probe.contentVersion + 1 : probe.contentVersion,
    sourceVersion: values.action === 'delete' ? 'delete-source' : 'create-source',
    status: values.status, outcome: values.outcome ?? null, leaseExpiresAt: values.leaseExpiresAt ?? null,
    ...values,
  })
}

function putRemovedState(probe: any, values: Record<string, any> = {}) {
  put('post_rag_index_state_v2', probe.postId, {
    schemaVersion: 2, postId: probe.postId, state: 'removed', sourceVersion: 'delete-source',
    activationOrder: { contentVersion: probe.contentVersion + 1, jobId: 'delete-job' },
    ...values,
  })
}

function queueTransactionReads(collection: string, id: string, ...values: Array<any | (() => any)>) {
  mockTransactionReads.set(mockKey(collection, id), values)
}

async function readyForFinalization(runId: string) {
  const probe = await beginCleanup(runId)
  bindOutboxes(probe)
  putJob(probe, 'create-job', { action: 'upsert', status: 'completed', outcome: 'indexed' })
  putJob(probe, 'delete-job', { action: 'delete', status: 'completed', outcome: 'removed' })
  putRemovedState(probe)
  return probe
}

beforeEach(() => {
  mockStore.clear()
  mockRemoveFailures.clear()
  mockTransactionReads.clear()
})

test('first cleanup call persists the delete outbox and remains pending', async () => {
  const probe = await createPostRagReleaseProbe('run-cleaning')

  const result = await cleanupPostRagReleaseProbe(probe)

  expect(result).toMatchObject({ success: false, pending: true, status: 'cleaning' })
  expect(getProbe(probe.runId)).toMatchObject({
    status: 'cleaning', cleanupStartedAt: expect.any(String), cleanupOutboxId: expect.any(String),
  })
  expect(mockStore.has(mockKey('posts', probe.postId))).toBe(false)
  expect(mockStore.has(mockKey('sections', probe.sectionId))).toBe(false)
})

test('cleanup validates deterministic fixture and run identity before destructive action', async () => {
  const probe = await createPostRagReleaseProbe('run-tampered-fixture')
  put('posts', 'business-post', { communityId: probe.communityId })
  put('sections', 'business-section', { communityId: probe.communityId })
  put('post_rag_release_probes', probe.runId, {
    ...withoutTestId(getProbe(probe.runId)), postId: 'business-post', sectionId: 'business-section',
  })

  await expect(cleanupPostRagReleaseProbe({ runId: probe.runId })).rejects.toThrow(/binding/)
  expect(mockStore.has(mockKey('posts', 'business-post'))).toBe(true)
  expect(mockStore.has(mockKey('sections', 'business-section'))).toBe(true)
})

test('cleanup remains pending until its bound delete job completes with a removal outcome', async () => {
  const probe = await beginCleanup('run-pending')
  expect(await cleanupPostRagReleaseProbe({ runId: probe.runId })).toMatchObject({ success: false, pending: true, status: 'cleaning' })

  bindOutboxes(probe)
  putJob(probe, 'create-job', { action: 'upsert', status: 'completed', outcome: 'indexed' })
  putJob(probe, 'delete-job', { action: 'delete', status: 'pending' })
  expect(await cleanupPostRagReleaseProbe({ runId: probe.runId })).toMatchObject({ success: false, pending: true, status: 'cleaning' })
  expect(mockStore.has(mockKey('post_rag_outbox', probe.cleanupOutboxId))).toBe(true)

  putJob(probe, 'delete-job', { action: 'delete', status: 'completed', outcome: 'removed' })
  putRemovedState(probe)
  expect(await cleanupPostRagReleaseProbe({ runId: probe.runId })).toMatchObject({ success: true, alreadyCleaned: false, status: 'cleaned' })
})

test.each(['removed', 'superseded'])('accepts completed delete outcome %s', async outcome => {
  const probe = await beginCleanup(`run-${outcome}`)
  bindOutboxes(probe)
  putJob(probe, 'create-job', { action: 'upsert', status: 'completed', outcome: 'indexed' })
  putJob(probe, 'delete-job', { action: 'delete', status: 'completed', outcome })
  putRemovedState(probe)
  await expect(cleanupPostRagReleaseProbe({ runId: probe.runId })).resolves.toMatchObject({ success: true, status: 'cleaned' })
})

test.each([
  ['removed', 'missing'], ['removed', 'active'], ['removed', 'unknown'],
  ['superseded', 'missing'], ['superseded', 'active'], ['superseded', 'unknown'],
])('delete outcome %s remains pending while current index state is %s', async (outcome, stateKind) => {
  const probe = await beginCleanup(`run-${outcome}-${stateKind}`)
  bindOutboxes(probe)
  putJob(probe, 'create-job', { action: 'upsert', status: 'completed', outcome: 'indexed' })
  putJob(probe, 'delete-job', { action: 'delete', status: 'completed', outcome })
  if (stateKind !== 'missing') put('post_rag_index_state_v2', probe.postId, {
    schemaVersion: 2, postId: probe.postId, state: stateKind === 'active' ? 'active' : 'unknown',
    sourceVersion: 'delete-source', activationOrder: { contentVersion: probe.contentVersion + 1, jobId: 'delete-job' },
  })

  expect(await cleanupPostRagReleaseProbe({ runId: probe.runId })).toMatchObject({ success: false, pending: true, status: 'cleaning' })
})

test.each(['pending', 'processing', 'retry_wait', 'dead_letter'])('create outbox status %s without a job is not proof that creation is absent', async createStatus => {
  const probe = await beginCleanup(`run-create-outbox-${createStatus}`)
  bindOutboxes(probe, { createJobId: null, createStatus })
  putJob(probe, 'delete-job', { action: 'delete', status: 'completed', outcome: 'removed' })
  putRemovedState(probe)

  expect(await cleanupPostRagReleaseProbe({ runId: probe.runId })).toMatchObject({ success: false, pending: true, status: 'cleaning' })
  expect(mockStore.has(mockKey('post_rag_outbox', probe.outboxId))).toBe(true)
})

test.each([
  ['older order', { activationOrder: { contentVersion: 0, jobId: 'old-delete' } }],
  ['equal order with another source', { sourceVersion: 'other-source' }],
])('removed state with %s does not prove the cleanup delete won', async (_label, stateValues) => {
  const probe = await beginCleanup(`run-order-${String(_label).startsWith('older') ? 'older' : 'source'}`)
  bindOutboxes(probe)
  putJob(probe, 'create-job', { action: 'upsert', status: 'completed', outcome: 'indexed' })
  putJob(probe, 'delete-job', { action: 'delete', status: 'completed', outcome: 'removed' })
  putRemovedState(probe, stateValues)

  expect(await cleanupPostRagReleaseProbe({ runId: probe.runId })).toMatchObject({ success: false, pending: true, status: 'cleaning' })
})

test('cross-run outbox and non-probe job bindings fail closed', async () => {
  const probe = await beginCleanup('run-binding')
  bindOutboxes(probe)
  putJob(probe, 'create-job', { action: 'upsert', status: 'completed', outcome: 'indexed' })
  put('post_rag_outbox', probe.cleanupOutboxId, {
    schemaVersion: 2, status: 'completed', aggregateId: 'other-post', communityId: probe.communityId, materializedJobId: 'delete-job',
  })
  putJob(probe, 'delete-job', { action: 'delete', status: 'completed', outcome: 'removed' })
  await expect(cleanupPostRagReleaseProbe({ runId: probe.runId })).rejects.toThrow(/binding/)
  expect(getProbe(probe.runId).status).toBe('cleaning')

  bindOutboxes(probe)
  putJob(probe, 'create-job', { action: 'upsert', status: 'completed', outcome: 'indexed' })
  putJob(probe, 'delete-job', { action: 'upsert', status: 'completed', outcome: 'removed' })
  await expect(cleanupPostRagReleaseProbe({ runId: probe.runId })).rejects.toThrow(/binding/)
  expect(getProbe(probe.runId).status).toBe('cleaning')
})

test('a create job with a live lease keeps cleanup pending', async () => {
  const probe = await beginCleanup('run-live-lease')
  bindOutboxes(probe)
  putJob(probe, 'create-job', { action: 'upsert', status: 'processing', leaseExpiresAt: '2999-01-01T00:00:00.000Z' })
  putJob(probe, 'delete-job', { action: 'delete', status: 'completed', outcome: 'removed' })

  expect(await cleanupPostRagReleaseProbe({ runId: probe.runId })).toMatchObject({ success: false, pending: true, status: 'cleaning' })
  expect(mockStore.has(mockKey('post_rag_jobs', 'create-job'))).toBe(true)
  expect(mockStore.has(mockKey('post_rag_jobs', 'delete-job'))).toBe(true)
})

test('a missing create outbox fails closed because create-job lease safety cannot be proven', async () => {
  const probe = await beginCleanup('run-missing-create-outbox')
  mockStore.delete(mockKey('post_rag_outbox', probe.outboxId))
  put('post_rag_outbox', probe.cleanupOutboxId, {
    schemaVersion: 2, status: 'completed', aggregateId: probe.postId,
    communityId: probe.communityId, materializedJobId: 'delete-job',
  })
  putJob(probe, 'orphan-live-create-job', { action: 'upsert', status: 'processing', leaseExpiresAt: '2999-01-01T00:00:00.000Z' })
  putJob(probe, 'delete-job', { action: 'delete', status: 'completed', outcome: 'removed' })

  expect(await cleanupPostRagReleaseProbe({ runId: probe.runId })).toMatchObject({ success: false, pending: true, status: 'cleaning' })
  expect(mockStore.has(mockKey('post_rag_jobs', 'orphan-live-create-job'))).toBe(true)
})

test.each([
  ['completed', { action: 'upsert', status: 'completed', outcome: 'indexed' }],
  ['dead-letter', { action: 'upsert', status: 'dead_letter' }],
  ['expired lease', { action: 'upsert', status: 'processing', leaseExpiresAt: '2000-01-01T00:00:00.000Z' }],
])('removes an %s create job only after the higher-version delete job completes', async (_label, createJob) => {
  const probe = await beginCleanup(`run-create-${String(_label).replace(/\W/g, '-')}`)
  bindOutboxes(probe)
  putJob(probe, 'create-job', createJob)
  putJob(probe, 'delete-job', { action: 'delete', status: 'processing', leaseExpiresAt: '2999-01-01T00:00:00.000Z' })
  expect(await cleanupPostRagReleaseProbe({ runId: probe.runId })).toMatchObject({ success: false, pending: true })
  expect(mockStore.has(mockKey('post_rag_jobs', 'create-job'))).toBe(true)

  putJob(probe, 'delete-job', { action: 'delete', status: 'completed', outcome: 'superseded' })
  putRemovedState(probe)
  expect(await cleanupPostRagReleaseProbe({ runId: probe.runId })).toMatchObject({ success: true, status: 'cleaned' })
  expect(mockStore.has(mockKey('post_rag_jobs', 'create-job'))).toBe(false)
})

test('persists exact artifact ids before removals and resumes partial and final cleanup idempotently', async () => {
  const probe = await beginCleanup('run-resume')
  bindOutboxes(probe)
  putJob(probe, 'create-job', { action: 'upsert', status: 'completed', outcome: 'indexed' })
  putJob(probe, 'delete-job', { action: 'delete', status: 'completed', outcome: 'removed' })
  putRemovedState(probe)
  put('post_rag_index_versions', 'probe-version', { schemaVersion: 2, postId: probe.postId })
  put('post_rag_index_versions', 'legacy-probe-version', { schemaVersion: 1, postId: probe.postId })
  put('post_rag_jobs', 'business-job', { postId: 'business-post' })
  put('post_rag_index_versions', 'business-version', { schemaVersion: 2, postId: 'business-post' })
  mockRemoveFailures.set(mockKey('post_rag_outbox', probe.outboxId), 1)

  await expect(cleanupPostRagReleaseProbe({ runId: probe.runId })).rejects.toThrow(/remove failed/)
  expect(getProbe(probe.runId)).toMatchObject({
    status: 'finalizing',
    cleanupArtifactIds: {
      jobIds: ['create-job', 'delete-job'],
      outboxIds: [probe.outboxId, probe.cleanupOutboxId],
      indexStateIds: [probe.postId],
      indexVersionIds: ['legacy-probe-version', 'probe-version'],
    },
  })

  expect(await cleanupPostRagReleaseProbe({ runId: probe.runId })).toMatchObject({
    success: true, alreadyCleaned: false, status: 'cleaned',
    cleanupCounts: { jobs: 2, outboxes: 2, indexStates: 1, indexVersions: 2 },
  })
  expect(await cleanupPostRagReleaseProbe({ runId: probe.runId })).toMatchObject({ success: true, alreadyCleaned: true, status: 'cleaned' })
  expect(getProbe(probe.runId)).toMatchObject({ status: 'cleaned', cleanedAt: expect.any(String) })
  expect(mockStore.has(mockKey('post_rag_release_probes', probe.runId))).toBe(true)
  expect(mockStore.has(mockKey('post_rag_jobs', 'business-job'))).toBe(true)
  expect(mockStore.has(mockKey('post_rag_index_versions', 'business-version'))).toBe(true)
})

test('finalizing recovery rejects artifact ids that are not integrity-bound to the probe', async () => {
  const probe = await beginCleanup('run-corrupt-finalizing')
  put('post_rag_jobs', 'business-job', { postId: 'business-post' })
  put('post_rag_index_versions', 'business-version', { postId: 'business-post' })
  put('post_rag_release_probes', probe.runId, {
    ...withoutTestId(getProbe(probe.runId)), status: 'finalizing',
    cleanupArtifactIds: {
      jobIds: ['business-job'], outboxIds: [probe.outboxId, probe.cleanupOutboxId],
      indexStateIds: [], indexVersionIds: ['business-version'],
    },
  })

  await expect(cleanupPostRagReleaseProbe({ runId: probe.runId })).rejects.toThrow(/artifact binding/)
  expect(mockStore.has(mockKey('post_rag_jobs', 'business-job'))).toBe(true)
  expect(mockStore.has(mockKey('post_rag_index_versions', 'business-version'))).toBe(true)
})

test('finalizing retry revalidates a persisted artifact id against its live record binding', async () => {
  const probe = await beginCleanup('run-live-rebind')
  bindOutboxes(probe)
  putJob(probe, 'create-job', { action: 'upsert', status: 'completed', outcome: 'indexed' })
  putJob(probe, 'delete-job', { action: 'delete', status: 'completed', outcome: 'removed' })
  putRemovedState(probe)
  mockRemoveFailures.set(mockKey('post_rag_jobs', 'create-job'), 1)
  await expect(cleanupPostRagReleaseProbe({ runId: probe.runId })).rejects.toThrow(/remove failed/)
  put('post_rag_jobs', 'create-job', {
    schemaVersion: 2, outboxId: 'business-outbox', postId: 'business-post', communityId: 'business-community', action: 'upsert',
  })

  await expect(cleanupPostRagReleaseProbe({ runId: probe.runId })).rejects.toThrow(/binding/)
  expect(mockStore.has(mockKey('post_rag_jobs', 'create-job'))).toBe(true)
})

test('finalizing retry returns pending without deletion when the create job acquires a live lease', async () => {
  const probe = await beginCleanup('run-finalizing-live-lease')
  bindOutboxes(probe)
  putJob(probe, 'create-job', { action: 'upsert', status: 'processing', leaseExpiresAt: '2000-01-01T00:00:00.000Z' })
  putJob(probe, 'delete-job', { action: 'delete', status: 'completed', outcome: 'removed' })
  putRemovedState(probe)
  mockRemoveFailures.set(mockKey('post_rag_jobs', 'create-job'), 1)
  await expect(cleanupPostRagReleaseProbe({ runId: probe.runId })).rejects.toThrow(/remove failed/)
  putJob(probe, 'create-job', { action: 'upsert', status: 'processing', leaseExpiresAt: '2999-01-01T00:00:00.000Z' })

  expect(await cleanupPostRagReleaseProbe({ runId: probe.runId })).toMatchObject({ success: false, pending: true, status: 'finalizing' })
  for (const [collection, id] of [
    ['post_rag_jobs', 'create-job'], ['post_rag_jobs', 'delete-job'],
    ['post_rag_outbox', probe.outboxId], ['post_rag_outbox', probe.cleanupOutboxId],
    ['post_rag_index_state_v2', probe.postId],
  ]) expect(mockStore.has(mockKey(collection, id))).toBe(true)
})

test('destructive transaction observes a create lease acquired after preparation', async () => {
  const probe = await readyForFinalization('run-tx-live-lease')
  queueTransactionReads('post_rag_jobs', 'create-job', {
    ...mockStore.get(mockKey('post_rag_jobs', 'create-job')),
    status: 'processing', leaseExpiresAt: '2999-01-01T00:00:00.000Z',
  })

  expect(await cleanupPostRagReleaseProbe({ runId: probe.runId })).toMatchObject({ success: false, pending: true, status: 'finalizing' })
  expect(mockStore.has(mockKey('post_rag_jobs', 'delete-job'))).toBe(true)
  expect(mockStore.has(mockKey('post_rag_outbox', probe.cleanupOutboxId))).toBe(true)
})

test('destructive transaction rejects index state rebound to active after preparation', async () => {
  const probe = await readyForFinalization('run-tx-active-state')
  queueTransactionReads('post_rag_index_state_v2', probe.postId, {
    ...mockStore.get(mockKey('post_rag_index_state_v2', probe.postId)), state: 'active',
  })

  expect(await cleanupPostRagReleaseProbe({ runId: probe.runId })).toMatchObject({ success: false, pending: true, status: 'finalizing' })
  expect(mockStore.has(mockKey('post_rag_index_state_v2', probe.postId))).toBe(true)
})

test.each([
  ['status', { status: 'processing' }],
  ['job binding', { materializedJobId: 'other-job' }],
])('destructive transaction fails closed when create outbox %s changes after preparation', async (_label, changed) => {
  const probe = await readyForFinalization(`run-tx-outbox-${String(_label).replace(/\W/g, '-')}`)
  queueTransactionReads('post_rag_outbox', probe.outboxId, {
    ...mockStore.get(mockKey('post_rag_outbox', probe.outboxId)), ...changed,
  })

  await expect(cleanupPostRagReleaseProbe({ runId: probe.runId })).resolves.toMatchObject({ success: false, pending: true, status: 'finalizing' })
  expect(mockStore.has(mockKey('post_rag_jobs', 'create-job'))).toBe(true)
})

test('finalizing retry rejects a new same-post index version not in the persisted artifact set', async () => {
  const probe = await readyForFinalization('run-new-version')
  mockRemoveFailures.set(mockKey('post_rag_jobs', 'create-job'), 1)
  await expect(cleanupPostRagReleaseProbe({ runId: probe.runId })).rejects.toThrow(/remove failed/)
  put('post_rag_index_versions', 'late-version', { schemaVersion: 2, postId: probe.postId })

  expect(await cleanupPostRagReleaseProbe({ runId: probe.runId })).toMatchObject({ success: false, pending: true, status: 'finalizing' })
  expect(mockStore.has(mockKey('post_rag_index_versions', 'late-version'))).toBe(true)
})

test('destructive transaction revalidates probe binding before removing artifacts', async () => {
  const probe = await readyForFinalization('run-tx-probe-binding')
  queueTransactionReads('post_rag_release_probes', probe.runId,
    () => mockStore.get(mockKey('post_rag_release_probes', probe.runId)),
    () => ({ ...mockStore.get(mockKey('post_rag_release_probes', probe.runId)), postId: 'business-post' }),
  )

  await expect(cleanupPostRagReleaseProbe({ runId: probe.runId })).rejects.toThrow(/binding/)
  expect(mockStore.has(mockKey('post_rag_jobs', 'create-job'))).toBe(true)
  expect(mockStore.has(mockKey('post_rag_outbox', probe.outboxId))).toBe(true)
})

test('release probe evidence and status remain strictly run-bound', async () => {
  const probe = await createPostRagReleaseProbe('run-1')
  const hash = getProbe('run-1').triggerIdHash
  put('post_rag_worker_timer_evidence', 'e1', { schemaVersion: 2, triggerIdHash: hash, invokedAt: '2099-01-01T00:00:00.000Z', outboxIds: [probe.outboxId], v2JobIds: ['job-1'], v2CandidateCount: 1, v2CompletedCount: 1 })
  expect((await readPostRagReleaseTimerEvidence('run-1')).evidence).toMatchObject({ source: 'timer', outboxIds: [probe.outboxId] })
  put('post_rag_outbox', probe.outboxId, { schemaVersion: 2, status: 'completed', aggregateId: probe.postId, communityId: probe.communityId, materializedJobId: 'job-1' })
  expect(await readPostRagReleaseProbeStatus(probe)).toMatchObject({ job: null, state: null, complete: false })
  put('post_rag_jobs', 'job-1', { schemaVersion: 2, status: 'completed', postId: probe.postId, sourceVersion: 'sv1' })
  put('post_rag_index_state_v2', probe.postId, { postId: probe.postId, schemaVersion: 2, state: 'active', sourceVersion: 'sv1' })
  expect((await readPostRagReleaseProbeStatus(probe)).complete).toBe(true)
  await expect(readPostRagReleaseProbeStatus({ ...probe, postId: 'cross-run' })).rejects.toThrow(/binding/)
  await expect(readPostRagReleaseTimerEvidence('unknown')).rejects.toThrow(/binding/)
})

test('cleanup can recover a committed probe using its predeclared run identity', async () => {
  const probe = await createPostRagReleaseProbe('run-lost-response')
  expect(await cleanupPostRagReleaseProbe({ runId: probe.runId })).toMatchObject({ success: false, pending: true, status: 'cleaning' })
})
