import { comparePostRagActivationOrder, PostRagJobProcessorError, processClaimedPostRagJob, processPostRagJobV2Batch } from '../post-rag-job-processor'
import { buildPostRagJobId, type PostRagJobDocument } from '../post-rag-jobs'
import { PostRagSourceProjectionValidationError } from '../post-rag-indexing'

const times = (...values: string[]) => { const queue = [...values]; return () => queue.shift() || values[values.length - 1] }
const NOW = '2026-07-12T04:00:00.000Z'
const EXPIRY = '2026-07-12T04:02:00.000Z'
const JOB_ID = buildPostRagJobId('outbox-1', 'post-1', 'upsert', 'source-1', 3)
const JOB2_ID = buildPostRagJobId('outbox-2', 'post-1', 'upsert', 'source-1', 3)

function job(overrides: Partial<PostRagJobDocument> = {}): PostRagJobDocument {
  const value = { schemaVersion: 2, _id: JOB_ID, outboxId: 'outbox-1', postId: 'post-1', communityId: 'community-1', sectionId: 'section-1', action: 'upsert', sourceVersion: 'source-1', contentVersion: 3, status: 'processing', attempts: 1, nextAttemptAt: NOW, leaseOwner: 'worker-1', leaseToken: 'lease-1', leaseExpiresAt: EXPIRY, createdAt: NOW, updatedAt: NOW, outcome: null, lastError: null, ...overrides } as PostRagJobDocument
  if (!Object.prototype.hasOwnProperty.call(overrides, '_id')) value._id = buildPostRagJobId(value.outboxId, value.postId, value.action, value.sourceVersion, value.contentVersion)
  return value
}

function projection(overrides: Record<string, unknown> = {}) {
  return { eligible: true, sourceVersion: 'source-1', retrievalIndexVersion: 'index-v1', chunks: [{ chunkId: 'chunk-1' }], chunkCount: 1, chunkChecksum: 'checksum-1', ...overrides } as any
}

function dependencies(overrides: Record<string, unknown> = {}) {
  const calls: string[] = []
  const sink = {
    stageUpsert: jest.fn(async () => { calls.push('stage') }),
    inspectStaged: jest.fn(async () => { calls.push('inspect'); return { chunkCount: 1, chunkChecksum: 'checksum-1' } }),
    activate: jest.fn(async () => { calls.push('activate'); return { activated: true } }),
    cleanupOldVersions: jest.fn(async () => { calls.push('cleanup') }),
    remove: jest.fn(async () => { calls.push('remove'); return { removed: true } }),
  }
  return {
    calls, sink,
    readJob: jest.fn(async (jobId: string) => job({ _id: jobId, leaseToken: jobId === JOB2_ID ? 'lease-2' : 'lease-1' })),
    loadPost: jest.fn(async () => ({ _id: 'post-1', communityId: 'community-1', sectionId: 'section-1', status: 'active' })),
    loadSection: jest.fn(async () => ({ _id: 'section-1', communityId: 'community-1', status: 'active' })),
    buildProjection: jest.fn(() => projection()),
    complete: jest.fn(async (_id, options) => { calls.push(`complete:${options.outcome}`); return {} }),
    fail: jest.fn(async () => { calls.push('fail'); return {} }),
    renew: jest.fn(async () => job()),
    ...overrides,
  } as any
}

describe('processClaimedPostRagJob', () => {
  test('strictly validates even completed fast-path jobs before calling dependencies', async () => {
    const deps = dependencies()
    const malformed = job({ status: 'completed', outcome: 'indexed', leaseOwner: null, leaseToken: null, leaseExpiresAt: null }) as any
    malformed.lastError = { message: 'unsafe secret' }
    await expect(processClaimedPostRagJob(malformed, { workerId: 'worker-1', now: times(NOW) }, deps)).rejects.toThrow(/job|lastError/)
    expect(deps.loadPost).not.toHaveBeenCalled()
  })

  test('uses frozen trusted snapshots when callers and sinks attempt mutation', async () => {
    const claimed = job()
    const built = projection()
    const deps = dependencies({
      buildProjection: jest.fn(() => built),
      loadPost: jest.fn(async () => { claimed.postId = 'attacker-post'; claimed.sourceVersion = 'attacker-source'; return { _id: 'post-1', communityId: 'community-1', sectionId: 'section-1', status: 'active' } }),
    })
    deps.sink.stageUpsert.mockImplementation(async ({ job: sinkJob, projection: sinkProjection }: any) => {
      deps.calls.push('stage')
      expect(Object.isFrozen(sinkJob)).toBe(true); expect(Object.isFrozen(sinkProjection)).toBe(true); expect(Object.isFrozen(sinkProjection.chunks)).toBe(true)
      try { sinkJob.postId = 'mutated' } catch {}
      try { sinkProjection.chunkChecksum = 'mutated' } catch {}
    })
    const result = await processClaimedPostRagJob(claimed, { workerId: 'worker-1', now: times(NOW) }, deps)
    expect(result).toEqual({ jobId: JOB_ID, status: 'completed', outcome: 'indexed' })
    expect(deps.sink.inspectStaged).toHaveBeenCalledWith({ postId: 'post-1', sourceVersion: 'source-1', jobId: JOB_ID, leaseToken: 'lease-1' })
    expect(deps.sink.activate).toHaveBeenCalledWith(expect.objectContaining({ postId: 'post-1', sourceVersion: 'source-1' }))
    expect(deps.complete).toHaveBeenCalledWith(JOB_ID, expect.anything())
  })

  test('completes a superseded job without writing the sink', async () => {
    const deps = dependencies({ buildProjection: jest.fn(() => projection({ sourceVersion: 'source-2' })) })
    await expect(processClaimedPostRagJob(job(), { workerId: 'worker-1', now: times(NOW) }, deps)).resolves.toEqual({ jobId: JOB_ID, status: 'completed', outcome: 'superseded' })
    expect(deps.sink.stageUpsert).not.toHaveBeenCalled(); expect(deps.sink.remove).not.toHaveBeenCalled()
    expect(deps.complete).toHaveBeenCalledWith(JOB_ID, expect.objectContaining({ outcome: 'superseded' }))
  })

  test('does not let an old upsert delete facts when its section is now missing', async () => {
    const deps = dependencies({
      loadSection: jest.fn(async () => null),
      buildProjection: jest.fn(() => projection({ eligible: false, sourceVersion: 'removed-new-fact', chunks: [], chunkCount: 0, chunkChecksum: '' })),
    })
    const result = await processClaimedPostRagJob(job(), { workerId: 'worker-1', now: times(NOW) }, deps)
    expect(result).toEqual({ jobId: JOB_ID, status: 'completed', outcome: 'superseded' })
    expect(deps.sink.remove).not.toHaveBeenCalled()
    // Section/community fanout must enqueue the matching removal sourceVersion; this stale job must never infer deletion.
  })

  test('removes a still-ineligible matching delete and completes it', async () => {
    const deps = dependencies({ buildProjection: jest.fn(() => projection({ eligible: false, chunks: [], chunkCount: 0, chunkChecksum: '' })) })
    const claimed = job({ action: 'delete' })
    const result = await processClaimedPostRagJob(claimed, { workerId: 'worker-1', now: times(NOW) }, deps)
    expect(result).toEqual({ jobId: claimed._id, status: 'completed', outcome: 'removed' })
    expect(deps.calls).toEqual(['remove', 'complete:removed'])
    expect(deps.sink.remove).toHaveBeenCalledWith(expect.objectContaining({ postId: 'post-1', sourceVersion: 'source-1', activationOrder: { contentVersion: 3, jobId: claimed._id } }))
  })

  test('treats a delete rejected by a newer activation fence as superseded', async () => {
    const deps = dependencies({ buildProjection: jest.fn(() => projection({ eligible: false, chunks: [], chunkCount: 0, chunkChecksum: '' })) })
    deps.sink.remove.mockImplementation(async () => { deps.calls.push('remove'); return { removed: false } })
    const claimed = job({ action: 'delete' })
    const result = await processClaimedPostRagJob(claimed, { workerId: 'worker-1', now: times(NOW) }, deps)
    expect(result).toEqual({ jobId: claimed._id, status: 'completed', outcome: 'superseded' })
    expect(deps.calls).toEqual(['remove', 'complete:superseded'])
  })

  test('stages, verifies, activates with monotonic fencing, cleans and completes in exact order', async () => {
    const deps = dependencies()
    const result = await processClaimedPostRagJob(job(), { workerId: 'worker-1', now: times(NOW) }, deps)
    expect(result).toEqual({ jobId: JOB_ID, status: 'completed', outcome: 'indexed' })
    expect(deps.calls).toEqual(['stage', 'inspect', 'activate', 'cleanup', 'complete:indexed'])
    expect(deps.sink.stageUpsert).toHaveBeenCalledWith(expect.objectContaining({ jobId: JOB_ID, leaseToken: 'lease-1' }))
    expect(deps.sink.activate).toHaveBeenCalledWith({ postId: 'post-1', sourceVersion: 'source-1', activationOrder: { contentVersion: 3, jobId: JOB_ID }, jobId: JOB_ID, leaseToken: 'lease-1' })
    expect(deps.sink.cleanupOldVersions).toHaveBeenCalledWith({ postId: 'post-1', keepSourceVersion: 'source-1', activationOrder: { contentVersion: 3, jobId: JOB_ID }, jobId: JOB_ID, leaseToken: 'lease-1' })
  })

  test.each([
    [{ chunkCount: 2, chunkChecksum: 'checksum-1' }],
    [{ chunkCount: 1, chunkChecksum: 'wrong' }],
  ])('fails retryably when staged verification does not exactly match %p', async (inspected) => {
    const deps = dependencies(); deps.sink.inspectStaged.mockResolvedValue(inspected)
    const result = await processClaimedPostRagJob(job(), { workerId: 'worker-1', now: times(NOW) }, deps)
    expect(result).toEqual({ jobId: JOB_ID, status: 'failed', errorCode: 'ES_WRITE_FAILED', errorStage: 'es_write' })
    expect(deps.sink.activate).not.toHaveBeenCalled(); expect(deps.fail).toHaveBeenCalledWith(JOB_ID, expect.objectContaining({ error: { code: 'ES_WRITE_FAILED', stage: 'es_write' } }))
  })

  test.each([
    ['stageUpsert', 'ES_WRITE_FAILED', 'es_write'], ['inspectStaged', 'ES_WRITE_FAILED', 'es_write'],
    ['activate', 'ES_WRITE_FAILED', 'activate'], ['cleanupOldVersions', 'ES_WRITE_FAILED', 'cleanup'],
  ])('maps %s failures without trusting thrown messages', async (method, code, stage) => {
    const deps = dependencies(); deps.sink[method].mockRejectedValue(new Error('secret provider response'))
    const result = await processClaimedPostRagJob(job(), { workerId: 'worker-1', now: times(NOW) }, deps)
    expect(result).toEqual({ jobId: JOB_ID, status: 'failed', errorCode: code, errorStage: stage })
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  test('maps remove failure to a safe retryable ES write failure', async () => {
    const deps = dependencies({ buildProjection: jest.fn(() => projection({ eligible: false, chunks: [], chunkCount: 0, chunkChecksum: '' })) })
    deps.sink.remove.mockRejectedValue(new Error('secret delete response'))
    const claimed = job({ action: 'delete' })
    const result = await processClaimedPostRagJob(claimed, { workerId: 'worker-1', now: times(NOW) }, deps)
    expect(result).toEqual({ jobId: claimed._id, status: 'failed', errorCode: 'ES_WRITE_FAILED', errorStage: 'es_write' })
  })

  test('maps DB reads to retryable INTERNAL_ERROR at load_source and canonical input errors to validation', async () => {
    const dbFailure = dependencies({ loadPost: jest.fn(async () => { throw new Error('secret database endpoint') }) })
    const malformed = dependencies({ buildProjection: jest.fn(() => { throw new PostRagSourceProjectionValidationError() }) })
    expect(await processClaimedPostRagJob(job(), { workerId: 'worker-1', now: times(NOW) }, dbFailure)).toMatchObject({ errorCode: 'INTERNAL_ERROR', errorStage: 'load_source' })
    expect(await processClaimedPostRagJob(job(), { workerId: 'worker-1', now: times(NOW) }, malformed)).toMatchObject({ errorCode: 'VALIDATION_FAILED', errorStage: 'chunk' })
  })

  test('stops side effects when the lease expires between stages', async () => {
    const deps = dependencies()
    const result = await processClaimedPostRagJob(job(), { workerId: 'worker-1', now: times(NOW, NOW, '2026-07-12T04:02:00.000Z') }, deps)
    expect(result).toEqual({ jobId: JOB_ID, status: 'lease_lost' })
    expect(deps.calls).toEqual(['stage']); expect(deps.fail).not.toHaveBeenCalled()
  })

  test('reloads the active lease before every sink side effect and stops after another claim wins', async () => {
    const deps = dependencies()
    deps.readJob
      .mockResolvedValueOnce(job())
      .mockResolvedValueOnce(job({ leaseOwner: 'worker-2', leaseToken: 'lease-2' }))
    const result = await processClaimedPostRagJob(job(), { workerId: 'worker-1', now: times(NOW) }, deps)
    expect(result).toEqual({ jobId: JOB_ID, status: 'lease_lost' })
    expect(deps.calls).toEqual(['stage'])
    expect(deps.sink.inspectStaged).not.toHaveBeenCalled()
  })

  test('renews a lease throughout a sink promise longer than 120 seconds and clears heartbeat timers', async () => {
    jest.useFakeTimers(); jest.setSystemTime(new Date(NOW))
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const deps = dependencies()
    deps.sink.stageUpsert.mockImplementation(async () => { deps.calls.push('stage'); await blocked })
    const running = processClaimedPostRagJob(job({ leaseExpiresAt: '2026-07-12T04:10:00.000Z' }), {
      workerId: 'worker-1', now: () => new Date().toISOString(),
    }, deps)
    await jest.advanceTimersByTimeAsync(130_000)
    expect(deps.renew.mock.calls.length).toBeGreaterThanOrEqual(4)
    release(); await running
    expect(jest.getTimerCount()).toBe(0)
    jest.useRealTimers()
  })

  test('heartbeat token mismatch returns lease_lost without completing and clears its timer', async () => {
    jest.useFakeTimers(); jest.setSystemTime(new Date(NOW))
    const { PostRagJobLeaseError } = jest.requireActual('../post-rag-jobs')
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const deps = dependencies({ renew: jest.fn().mockResolvedValueOnce(job()).mockRejectedValue(new PostRagJobLeaseError('token')) })
    deps.sink.stageUpsert.mockImplementation(async () => { deps.calls.push('stage'); await blocked })
    const running = processClaimedPostRagJob(job({ leaseExpiresAt: '2026-07-12T04:10:00.000Z' }), {
      workerId: 'worker-1', now: () => new Date().toISOString(),
    }, deps)
    await jest.advanceTimersByTimeAsync(40_000)
    await expect(running).resolves.toEqual({ jobId: JOB_ID, status: 'lease_lost' })
    expect(deps.complete).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0)
    release(); jest.useRealTimers()
  })

  test('returns a safe INTERNAL failure when the current-lease DB reload fails', async () => {
    const deps = dependencies({ readJob: jest.fn(async () => { throw new Error('secret database outage') }) })
    const result = await processClaimedPostRagJob(job(), { workerId: 'worker-1', now: times(NOW) }, deps)
    expect(result).toEqual({ jobId: JOB_ID, status: 'failed', errorCode: 'INTERNAL_ERROR', errorStage: 'es_write' })
    expect(deps.sink.stageUpsert).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  test('treats a typed lease rejection from completion as lease_lost instead of INTERNAL_ERROR', async () => {
    const { PostRagJobLeaseError } = jest.requireActual('../post-rag-jobs')
    const deps = dependencies({ buildProjection: jest.fn(() => projection({ sourceVersion: 'newer' })), complete: jest.fn(async () => { throw new PostRagJobLeaseError() }) })
    await expect(processClaimedPostRagJob(job(), { workerId: 'worker-1', now: times(NOW) }, deps)).resolves.toEqual({ jobId: JOB_ID, status: 'lease_lost' })
    expect(deps.fail).not.toHaveBeenCalled()
  })

  test('treats a missing stored post as authoritative removal without recomputing source version', async () => {
    const deps = dependencies({ loadPost: jest.fn(async () => null), buildProjection: jest.fn(() => { throw new Error('must not project missing post') }) })
    const result = await processClaimedPostRagJob(job({ action: 'upsert' }), { workerId: 'worker-1', now: times(NOW) }, deps)
    expect(result).toEqual({ jobId: JOB_ID, status: 'completed', outcome: 'removed' })
    expect(deps.buildProjection).not.toHaveBeenCalled()
    expect(deps.sink.remove).toHaveBeenCalledWith(expect.objectContaining({ postId: 'post-1', sourceVersion: 'source-1' }))
  })

  test('does not remove a missing post after the current lease is lost', async () => {
    const deps = dependencies({
      loadPost: jest.fn(async () => null),
      readJob: jest.fn(async () => job({ leaseOwner: 'worker-2', leaseToken: 'lease-2' })),
    })
    await expect(processClaimedPostRagJob(job(), { workerId: 'worker-1', now: times(NOW) }, deps)).resolves.toEqual({ jobId: JOB_ID, status: 'lease_lost' })
    expect(deps.sink.remove).not.toHaveBeenCalled()
  })

  test('maps a missing-post removal provider failure without exposing provider text', async () => {
    const deps = dependencies({ loadPost: jest.fn(async () => null) })
    deps.sink.remove.mockRejectedValue(new Error('secret provider delete failure'))
    const result = await processClaimedPostRagJob(job(), { workerId: 'worker-1', now: times(NOW) }, deps)
    expect(result).toEqual({ jobId: JOB_ID, status: 'failed', errorCode: 'ES_WRITE_FAILED', errorStage: 'es_write' })
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  test('does not cleanup or complete indexed when a newer activation wins', async () => {
    const deps = dependencies(); deps.sink.activate.mockImplementation(async () => { deps.calls.push('activate'); return { activated: false } })
    const result = await processClaimedPostRagJob(job(), { workerId: 'worker-1', now: times(NOW) }, deps)
    expect(result).toEqual({ jobId: JOB_ID, status: 'completed', outcome: 'superseded' })
    expect(deps.calls).toEqual(['stage', 'inspect', 'activate', 'complete:superseded'])
  })

  test('maps authenticated processor and projection errors, but unknown runtime errors become INTERNAL_ERROR', async () => {
    const typed = dependencies({ buildProjection: jest.fn(() => { throw new PostRagJobProcessorError('VALIDATION_FAILED', 'chunk') }) })
    const unknown = dependencies({ buildProjection: jest.fn(() => { throw new Error('VALIDATION_FAILED secret') }) })
    expect(await processClaimedPostRagJob(job(), { workerId: 'worker-1', now: times(NOW) }, typed)).toMatchObject({ errorCode: 'VALIDATION_FAILED', errorStage: 'chunk' })
    const result = await processClaimedPostRagJob(job(), { workerId: 'worker-1', now: times(NOW) }, unknown)
    expect(result).toMatchObject({ errorCode: 'INTERNAL_ERROR', errorStage: 'chunk' }); expect(JSON.stringify(result)).not.toContain('secret')
  })

  test('returns read-only for an already completed replay and performs no side effects', async () => {
    const deps = dependencies()
    const result = await processClaimedPostRagJob(job({ status: 'completed', outcome: 'indexed', leaseOwner: null, leaseToken: null, leaseExpiresAt: null }), { workerId: 'worker-1', now: times(NOW) }, deps)
    expect(result).toEqual({ jobId: JOB_ID, status: 'already_completed', outcome: 'indexed' }); expect(deps.calls).toEqual([])
  })
})

describe('activation order contract', () => {
  test('compares numeric contentVersion first and ASCII code-unit jobId second', () => {
    expect(comparePostRagActivationOrder({ contentVersion: 2, jobId: 'a' }, { contentVersion: 10, jobId: '0' })).toBe(-1)
    expect(comparePostRagActivationOrder({ contentVersion: 3, jobId: 'A' }, { contentVersion: 3, jobId: 'a' })).toBe(-1)
    expect(comparePostRagActivationOrder({ contentVersion: 3, jobId: 'same' }, { contentVersion: 3, jobId: 'same' })).toBe(0)
    expect(() => comparePostRagActivationOrder({ contentVersion: 1.5, jobId: 'a' }, { contentVersion: 1, jobId: 'b' })).toThrow()
    expect(() => comparePostRagActivationOrder({ contentVersion: 1, jobId: ' bad' }, { contentVersion: 1, jobId: 'b' })).toThrow()
  })

  test('equal activation order remains idempotently active so cleanup retry can finish', async () => {
    let active = { contentVersion: 3, jobId: JOB_ID }
    const deps = dependencies()
    deps.sink.activate.mockImplementation(async ({ activationOrder }: any) => {
      deps.calls.push('activate')
      const comparison = comparePostRagActivationOrder(activationOrder, active)
      if (comparison < 0) return { activated: false }
      active = activationOrder
      return { activated: true }
    })
    deps.sink.cleanupOldVersions.mockRejectedValueOnce(new Error('retry')).mockImplementationOnce(async () => { deps.calls.push('cleanup') })
    const first = await processClaimedPostRagJob(job(), { workerId: 'worker-1', now: times(NOW) }, deps)
    const second = await processClaimedPostRagJob(job(), { workerId: 'worker-1', now: times(NOW) }, deps)
    expect(first).toMatchObject({ status: 'failed', errorStage: 'cleanup' })
    expect(second).toMatchObject({ status: 'completed', outcome: 'indexed' })
  })
})

describe('processor option validation', () => {
  test.each(['', ' bad', 'bad\nworker'])('rejects unsafe workerId %p before dependencies', async (workerId) => {
    const deps = dependencies()
    await expect(processClaimedPostRagJob(job(), { workerId, now: times(NOW) }, deps)).rejects.toThrow('workerId')
    expect(deps.loadPost).not.toHaveBeenCalled()
  })

  test('rejects invalid or decreasing clocks before the next side effect', async () => {
    const invalid = dependencies()
    await expect(processClaimedPostRagJob(job(), { workerId: 'worker-1', now: times('not-iso') }, invalid)).rejects.toThrow('clock')
    expect(invalid.loadPost).not.toHaveBeenCalled()

    const backwards = dependencies()
    await expect(processClaimedPostRagJob(job(), { workerId: 'worker-1', now: times(NOW, '2026-07-12T03:59:59.000Z') }, backwards)).resolves.toMatchObject({ status: 'failed', errorCode: 'INTERNAL_ERROR' })
    expect(backwards.sink.stageUpsert).not.toHaveBeenCalled()
  })

  test.each([NaN, Infinity, 0, 21, 1.5])('batch rejects invalid limit %p before listing', async (limit) => {
    const deps = dependencies({ listCandidates: jest.fn() })
    await expect(processPostRagJobV2Batch({ workerId: 'worker-1', now: times(NOW), limit }, deps)).rejects.toThrow('limit')
    expect(deps.listCandidates).not.toHaveBeenCalled()
  })
})

test('processPostRagJobV2Batch isolates candidates and continues after one failure', async () => {
  const deps = dependencies({
    listCandidates: jest.fn(async () => [JOB_ID, JOB2_ID]),
    claim: jest.fn().mockResolvedValueOnce(job()).mockResolvedValueOnce(job({ outboxId: 'outbox-2', leaseToken: 'lease-2' })),
  })
  deps.sink.stageUpsert.mockRejectedValueOnce(new Error('provider down')).mockResolvedValueOnce(undefined)
  const result = await processPostRagJobV2Batch({ workerId: 'worker-1', now: times(NOW), limit: 2 }, deps)
  expect(result.results.map((item: any) => item.status)).toEqual(['failed', 'completed'])
})

test('processPostRagJobV2Batch isolates claim failures without aborting later candidates', async () => {
  const deps = dependencies({
    listCandidates: jest.fn(async () => [JOB_ID, JOB2_ID]),
    claim: jest.fn().mockRejectedValueOnce(new Error('secret db failure')).mockResolvedValueOnce(job({ outboxId: 'outbox-2', leaseToken: 'lease-2' })),
  })
  const result = await processPostRagJobV2Batch({ workerId: 'worker-1', now: times(NOW), limit: 2 }, deps)
  expect(result.results[0]).toEqual({ jobId: JOB_ID, status: 'failed', errorCode: 'INTERNAL_ERROR', errorStage: 'claim' })
  expect(result.results[1]).toMatchObject({ jobId: JOB2_ID, status: 'completed' })
  expect(JSON.stringify(result)).not.toContain('secret')
})

test('processPostRagJobV2Batch isolates an invalid claimed snapshot before later candidates', async () => {
  const malformed = job() as any; malformed.postId = 'tampered-post'
  const deps = dependencies({
    listCandidates: jest.fn(async () => [JOB_ID, JOB2_ID]),
    claim: jest.fn().mockResolvedValueOnce(malformed).mockResolvedValueOnce(job({ outboxId: 'outbox-2', leaseToken: 'lease-2' })),
  })
  const result = await processPostRagJobV2Batch({ workerId: 'worker-1', now: times(NOW), limit: 2 }, deps)
  expect(result.results[0]).toEqual({ jobId: JOB_ID, status: 'failed', errorCode: 'VALIDATION_FAILED', errorStage: 'claim' })
  expect(result.results[1]).toMatchObject({ jobId: JOB2_ID, status: 'completed' })
})
