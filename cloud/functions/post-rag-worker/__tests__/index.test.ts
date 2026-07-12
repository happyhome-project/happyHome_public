jest.mock('wx-server-sdk', () => ({ init: jest.fn(), DYNAMIC_CURRENT_ENV: 'test' }))
jest.mock('../../../lib/post-rag', () => ({ ensurePostRagIndex: jest.fn(), processPostRagJobBatch: jest.fn() }))
jest.mock('../../../lib/post-rag-outbox-worker', () => ({ processPostRagOutboxBatch: jest.fn() }))
jest.mock('../../../lib/post-rag-job-processor', () => ({ processPostRagJobV2Batch: jest.fn() }))
jest.mock('../../../lib/post-rag-v2-runtime', () => ({ createPostRagV2RuntimeFromEnv: jest.fn(() => ({ sink: { runtime: true } })) }))
jest.mock('../../../lib/rag-worker-timer-evidence', () => ({ recordPostRagTimerEvidence: jest.fn() }))

import { main } from '../index'
import { ensurePostRagIndex, processPostRagJobBatch } from '../../../lib/post-rag'
import { processPostRagOutboxBatch } from '../../../lib/post-rag-outbox-worker'
import { processPostRagJobV2Batch } from '../../../lib/post-rag-job-processor'
import { createPostRagV2RuntimeFromEnv } from '../../../lib/post-rag-v2-runtime'
import { recordPostRagTimerEvidence } from '../../../lib/rag-worker-timer-evidence'

describe('post-rag-worker stages', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.POST_RAG_WORKER_TOKEN = 'worker-secret'
    ;(processPostRagOutboxBatch as jest.Mock).mockResolvedValue({ candidateCount: 0, results: [] })
    ;(processPostRagJobV2Batch as jest.Mock).mockResolvedValue({ candidateCount: 0, results: [] })
    ;(processPostRagJobBatch as jest.Mock).mockResolvedValue({ scannedCount: 0, results: [] })
  })
  afterEach(() => { delete process.env.POST_RAG_WORKER_TOKEN })

  test('auth rejects before stage calls or v2 dependency construction', async () => {
    await expect(main({ limit: 1 })).rejects.toThrow('Unauthorized')
    expect(createPostRagV2RuntimeFromEnv).not.toHaveBeenCalled()
    expect(processPostRagOutboxBatch).not.toHaveBeenCalled()
    expect(processPostRagJobV2Batch).not.toHaveBeenCalled()
    expect(processPostRagJobBatch).not.toHaveBeenCalled()
  })

  test('default runs bounded outbox then v2 then legacy', async () => {
    const order: string[] = []
    ;(processPostRagOutboxBatch as jest.Mock).mockImplementation(async () => { order.push('outbox'); return { candidateCount: 1, results: [] } })
    ;(processPostRagJobV2Batch as jest.Mock).mockImplementation(async () => { order.push('v2'); return { candidateCount: 1, results: [] } })
    ;(processPostRagJobBatch as jest.Mock).mockImplementation(async () => { order.push('legacy'); return { scannedCount: 1, results: [] } })
    await expect(main({ limit: 99, postId: 'post-1', workerToken: 'worker-secret' })).resolves.toMatchObject({ errors: [] })
    expect(order).toEqual(['outbox', 'v2', 'legacy'])
    expect(processPostRagJobV2Batch).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, sink: { runtime: true }, workerId: expect.stringMatching(/^post-rag-worker:/) }))
    expect(processPostRagJobBatch).toHaveBeenCalledWith({ limit: 20, postId: 'post-1' })
  })

  test('explicit indexV2 constructs runtime after auth and runs only v2', async () => {
    ;(processPostRagJobV2Batch as jest.Mock).mockResolvedValue({ candidateCount: 1, results: [] })
    await expect(main({ action: 'indexV2', limit: 0, workerToken: 'worker-secret' })).resolves.toEqual({ candidateCount: 1, results: [] })
    expect(processPostRagJobV2Batch).toHaveBeenCalledWith(expect.objectContaining({ limit: 1, sink: { runtime: true } }))
    expect(processPostRagOutboxBatch).not.toHaveBeenCalled()
    expect(processPostRagJobBatch).not.toHaveBeenCalled()
  })

  test('authenticated Timer Message writes evidence but a manual token invocation does not', async () => {
    const timer = { Type: 'Timer', TriggerName: 'post-rag-worker-every-minute', Time: '2026-07-12T00:00:00.000Z', Message: JSON.stringify({ workerToken: 'worker-secret' }) }
    await main(timer)
    expect(recordPostRagTimerEvidence).toHaveBeenCalledWith(expect.objectContaining({ triggerName: timer.TriggerName, eventTime: timer.Time, outbox: expect.any(Object), v2: expect.any(Object) }))
    ;(recordPostRagTimerEvidence as jest.Mock).mockClear()
    await main({ workerToken: 'worker-secret' })
    expect(recordPostRagTimerEvidence).not.toHaveBeenCalled()
  })

  test('isolates stage errors without exposing provider details', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    ;(processPostRagJobV2Batch as jest.Mock).mockRejectedValue(new Error('credential secret'))
    await expect(main({ workerToken: 'worker-secret' })).resolves.toMatchObject({ v2: null, errors: [{ stage: 'v2', code: 'INTERNAL_ERROR' }] })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('credential secret')
    warn.mockRestore()
  })

  test('retains authorized ensureIndex and materializeOutbox actions', async () => {
    ;(ensurePostRagIndex as jest.Mock).mockResolvedValue({ created: true })
    await expect(main({ action: 'ensureIndex', workerToken: 'worker-secret' })).resolves.toEqual({ created: true })
    await main({ action: 'materializeOutbox', workerToken: 'worker-secret' })
    expect(processPostRagJobV2Batch).not.toHaveBeenCalled()
    expect(processPostRagJobBatch).not.toHaveBeenCalled()
  })
})
