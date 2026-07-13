import { processPostRagOutboxBatch } from '../post-rag-outbox-worker'
import { PostRagOutboxMaterializationError } from '../post-rag-outbox-materializer'

function claimed(id: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    aggregateType: 'post',
    eventType: 'post.upsert',
    leaseToken: `lease-${id}`,
    ...overrides,
  } as any
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    listCandidates: jest.fn().mockResolvedValue(['outbox-1']),
    claim: jest.fn().mockResolvedValue(claimed('outbox-1')),
    materialize: jest.fn().mockResolvedValue({ job: { _id: 'job-1' } }),
    fail: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any
}

describe('processPostRagOutboxBatch', () => {
  let warn: jest.SpyInstance

  beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined) })
  afterEach(() => { warn.mockRestore() })

  test('bounds the requested limit and materializes a claimed event with injected identity and clock', async () => {
    const deps = dependencies()

    const result = await processPostRagOutboxBatch({ limit: 99, workerId: 'worker-1', now: () => '2026-07-12T04:00:00.000Z' }, deps)

    expect(deps.listCandidates).toHaveBeenCalledWith('2026-07-12T04:00:00.000Z', 20)
    expect(deps.claim).toHaveBeenCalledWith('outbox-1', { workerId: 'worker-1', now: '2026-07-12T04:00:00.000Z' })
    expect(deps.materialize).toHaveBeenCalledWith('outbox-1', { workerId: 'worker-1', leaseToken: 'lease-outbox-1', now: '2026-07-12T04:00:00.000Z' })
    expect(result).toEqual({ candidateCount: 1, processedCount: 1, skippedCount: 0, failedCount: 0, results: [{ outboxId: 'outbox-1', status: 'completed', jobId: 'job-1' }] })
  })

  test('skips a candidate lost to another claimant', async () => {
    const deps = dependencies({ claim: jest.fn().mockResolvedValue(null) })

    const result = await processPostRagOutboxBatch({ workerId: 'worker-1', now: () => '2026-07-12T04:00:00.000Z' }, deps)

    expect(deps.materialize).not.toHaveBeenCalled()
    expect(deps.fail).not.toHaveBeenCalled()
    expect(result.results).toEqual([{ outboxId: 'outbox-1', status: 'skipped' }])
  })

  test('backs off unsupported claimed events and continues without exposing thrown text', async () => {
    const deps = dependencies({
      listCandidates: jest.fn().mockResolvedValue(['outbox-1', 'outbox-2']),
      claim: jest.fn()
        .mockResolvedValueOnce(claimed('outbox-1', { aggregateType: 'section', eventType: 'section.reindex' }))
        .mockResolvedValueOnce(claimed('outbox-2')),
      materialize: jest.fn()
        .mockRejectedValueOnce(new PostRagOutboxMaterializationError('UNSUPPORTED_EVENT'))
        .mockResolvedValueOnce({ job: { _id: 'job-2' } }),
    })

    const result = await processPostRagOutboxBatch({ workerId: 'worker-1', now: () => '2026-07-12T04:00:00.000Z' }, deps)

    expect(deps.fail).toHaveBeenCalledWith('outbox-1', { workerId: 'worker-1', leaseToken: 'lease-outbox-1', now: '2026-07-12T04:00:00.000Z', error: { code: 'UNSUPPORTED_EVENT' } })
    expect(result).toEqual({ candidateCount: 2, processedCount: 1, skippedCount: 0, failedCount: 1, results: [
      { outboxId: 'outbox-1', status: 'failed', errorCode: 'UNSUPPORTED_EVENT' },
      { outboxId: 'outbox-2', status: 'completed', jobId: 'job-2' },
    ] })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(warn).toHaveBeenCalledWith('[post-rag-outbox-worker] event failed', { outboxId: 'outbox-1', errorCode: 'UNSUPPORTED_EVENT' })
  })

  test('uses typed validation and internal codes without trusting error messages', async () => {
    const validationDeps = dependencies({ materialize: jest.fn().mockRejectedValue(new PostRagOutboxMaterializationError('VALIDATION_FAILED')) })
    const internalDeps = dependencies({ materialize: jest.fn().mockRejectedValue(new Error('ECONNRESET secret')) })
    const forgedDeps = dependencies({ materialize: jest.fn().mockRejectedValue(new Error('canonical value contains a cycle')) })

    const validation = await processPostRagOutboxBatch({ workerId: 'worker-1', now: () => '2026-07-12T04:00:00.000Z' }, validationDeps)
    const internal = await processPostRagOutboxBatch({ workerId: 'worker-1', now: () => '2026-07-12T04:00:00.000Z' }, internalDeps)
    const forged = await processPostRagOutboxBatch({ workerId: 'worker-1', now: () => '2026-07-12T04:00:00.000Z' }, forgedDeps)

    expect(validationDeps.fail).toHaveBeenCalledWith('outbox-1', expect.objectContaining({ error: { code: 'VALIDATION_FAILED' } }))
    expect(internalDeps.fail).toHaveBeenCalledWith('outbox-1', expect.objectContaining({ error: { code: 'INTERNAL_ERROR' } }))
    expect(forgedDeps.fail).toHaveBeenCalledWith('outbox-1', expect.objectContaining({ error: { code: 'INTERNAL_ERROR' } }))
    expect(JSON.stringify([validation, internal, forged])).not.toContain('secret')
  })

  test('treats canonical projection shape failures as non-retryable validation failures', async () => {
    const deps = dependencies({ materialize: jest.fn().mockRejectedValue(new PostRagOutboxMaterializationError('VALIDATION_FAILED')) })

    const result = await processPostRagOutboxBatch({ workerId: 'worker-1', now: () => '2026-07-12T04:00:00.000Z' }, deps)

    expect(deps.fail).toHaveBeenCalledWith('outbox-1', expect.objectContaining({ error: { code: 'VALIDATION_FAILED' } }))
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  test('rejects an unsafe injected worker identity before scanning', async () => {
    const deps = dependencies()

    await expect(processPostRagOutboxBatch({ workerId: 'bad\nworker' }, deps)).rejects.toThrow('workerId must be a safe identifier')

    expect(deps.listCandidates).not.toHaveBeenCalled()
  })

  test('reports a transient failure-store error as INTERNAL_ERROR without leaking it', async () => {
    const deps = dependencies({
      materialize: jest.fn().mockRejectedValue(new PostRagOutboxMaterializationError('VALIDATION_FAILED')),
      fail: jest.fn().mockRejectedValue(new Error('database password secret')),
    })

    const result = await processPostRagOutboxBatch({ workerId: 'worker-1', now: () => '2026-07-12T04:00:00.000Z' }, deps)

    expect(result.results).toEqual([{ outboxId: 'outbox-1', status: 'failed', errorCode: 'INTERNAL_ERROR' }])
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  test('uses the typed unsupported code without message inspection', async () => {
    const deps = dependencies({ materialize: jest.fn().mockRejectedValue(new PostRagOutboxMaterializationError('UNSUPPORTED_EVENT')) })

    const result = await processPostRagOutboxBatch({ workerId: 'worker-1', now: () => '2026-07-12T04:00:00.000Z' }, deps)

    expect(result.results).toEqual([{ outboxId: 'outbox-1', status: 'failed', errorCode: 'UNSUPPORTED_EVENT' }])
  })

  test('uses fresh times before scan, claim and materialize and skips an already expired lease without failing it', async () => {
    const times = ['2026-07-12T04:00:00.000Z', '2026-07-12T04:00:01.000Z', '2026-07-12T04:02:02.000Z']
    const deps = dependencies({ claim: jest.fn().mockResolvedValue({ ...claimed('outbox-1'), leaseExpiresAt: '2026-07-12T04:02:01.000Z' }) })

    const result = await processPostRagOutboxBatch({ workerId: 'worker-1', now: () => times.shift()! }, deps)

    expect(deps.listCandidates).toHaveBeenCalledWith('2026-07-12T04:00:00.000Z', 5)
    expect(deps.claim).toHaveBeenCalledWith('outbox-1', expect.objectContaining({ now: '2026-07-12T04:00:01.000Z' }))
    expect(deps.materialize).not.toHaveBeenCalled()
    expect(deps.fail).not.toHaveBeenCalled()
    expect(result.results).toEqual([{ outboxId: 'outbox-1', status: 'skipped' }])
  })

  test('rejects a prototype-forged materialization error as INTERNAL_ERROR', async () => {
    const forged = Object.create(PostRagOutboxMaterializationError.prototype)
    Object.assign(forged, { code: 'VALIDATION_FAILED', retryable: false })
    const deps = dependencies({ materialize: jest.fn().mockRejectedValue(forged) })

    const result = await processPostRagOutboxBatch({ workerId: 'worker-1', now: () => '2026-07-12T04:00:00.000Z' }, deps)

    expect(result.results[0]).toMatchObject({ errorCode: 'INTERNAL_ERROR' })
  })

  test('reads a fresh clock immediately before failure persistence', async () => {
    const times = ['2026-07-12T04:00:00.000Z', '2026-07-12T04:00:01.000Z', '2026-07-12T04:00:02.000Z', '2026-07-12T04:00:03.000Z']
    const deps = dependencies({ materialize: jest.fn().mockRejectedValue(new PostRagOutboxMaterializationError('VALIDATION_FAILED')) })

    await processPostRagOutboxBatch({ workerId: 'worker-1', now: () => times.shift()! }, deps)

    expect(deps.materialize).toHaveBeenCalledWith('outbox-1', expect.objectContaining({ now: '2026-07-12T04:00:02.000Z' }))
    expect(deps.fail).toHaveBeenCalledWith('outbox-1', expect.objectContaining({ now: '2026-07-12T04:00:03.000Z' }))
  })
})
