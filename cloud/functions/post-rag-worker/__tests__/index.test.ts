jest.mock('wx-server-sdk', () => ({ init: jest.fn(), DYNAMIC_CURRENT_ENV: 'test' }))
jest.mock('../../../lib/post-rag-sync-worker', () => ({ processPostRagSyncBatch: jest.fn() }))

import { main } from '../index'
import { processPostRagSyncBatch } from '../../../lib/post-rag-sync-worker'

describe('post-rag-worker current state entry', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.POST_RAG_WORKER_TOKEN = 'worker-secret'
    process.env.POST_RAG_TIMER_TOKEN = 'timer-secret'
    ;(processPostRagSyncBatch as jest.Mock).mockResolvedValue({ scannedCount: 0, results: [] })
  })
  afterEach(() => { delete process.env.POST_RAG_WORKER_TOKEN; delete process.env.POST_RAG_TIMER_TOKEN })

  test('rejects unauthorized requests before reading synchronization state', async () => {
    await expect(main({ limit: 1 })).rejects.toThrow('Unauthorized')
    expect(processPostRagSyncBatch).not.toHaveBeenCalled()
  })

  test('runs only the bounded current-state processor', async () => {
    await expect(main({ limit: 99, postId: 'post-1', workerToken: 'worker-secret' }))
      .resolves.toEqual({ scannedCount: 0, results: [] })
    expect(processPostRagSyncBatch).toHaveBeenCalledWith({
      limit: 20,
      postId: 'post-1',
      workerId: expect.stringMatching(/^post-rag-worker:/),
    })
  })

  test('normalizes malformed or zero limits to one without retaining retired actions', async () => {
    await main({ action: 'indexV2', limit: 0, workerToken: 'worker-secret' })
    expect(processPostRagSyncBatch).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }))
  })

  test('allows an authenticated timer without writing historical timer evidence', async () => {
    const timer = { Type: 'Timer', TriggerName: 'post-rag-worker-every-minute', Time: new Date().toISOString(), Message: JSON.stringify({ timerToken: 'timer-secret' }) }
    await expect(main(timer)).resolves.toEqual({ scannedCount: 0, results: [] })
    expect(processPostRagSyncBatch).toHaveBeenCalledTimes(1)
  })
})
