jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  DYNAMIC_CURRENT_ENV: 'test',
}))

jest.mock('../../../lib/post-rag', () => ({
  processPostVideoRagJobBatch: jest.fn(),
}))

import { main } from '../index'
import { processPostVideoRagJobBatch } from '../../../lib/post-rag'

describe('post-video-rag-worker auth', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.POST_RAG_WORKER_TOKEN = 'worker-secret'
  })

  afterEach(() => {
    delete process.env.POST_RAG_WORKER_TOKEN
  })

  test('rejects direct invocation without the worker token', async () => {
    await expect(main({ limit: 1 })).rejects.toThrow('Unauthorized')

    expect(processPostVideoRagJobBatch).not.toHaveBeenCalled()
  })

  test('processes a bounded batch when the worker token matches', async () => {
    ;(processPostVideoRagJobBatch as jest.Mock).mockResolvedValue({ scannedCount: 1, results: [] })

    const result = await main({ limit: 99, postId: 'post-1', workerToken: 'worker-secret' })

    expect(processPostVideoRagJobBatch).toHaveBeenCalledWith({ limit: 10, postId: 'post-1' })
    expect(result).toEqual({ scannedCount: 1, results: [] })
  })
})
