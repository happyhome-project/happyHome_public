jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  DYNAMIC_CURRENT_ENV: 'test',
}))

jest.mock('../../../lib/post-rag', () => ({
  ensurePostRagIndex: jest.fn(),
  processPostRagJobBatch: jest.fn(),
}))

import { main } from '../index'
import { ensurePostRagIndex, processPostRagJobBatch } from '../../../lib/post-rag'

describe('post-rag-worker auth', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.POST_RAG_WORKER_TOKEN = 'worker-secret'
  })

  afterEach(() => {
    delete process.env.POST_RAG_WORKER_TOKEN
  })

  test('rejects direct invocation without the worker token', async () => {
    await expect(main({ limit: 1 })).rejects.toThrow('Unauthorized')

    expect(processPostRagJobBatch).not.toHaveBeenCalled()
  })

  test('processes a bounded batch when the worker token matches', async () => {
    ;(processPostRagJobBatch as jest.Mock).mockResolvedValue({ scannedCount: 1, results: [] })

    const result = await main({ limit: 99, postId: 'post-1', workerToken: 'worker-secret' })

    expect(processPostRagJobBatch).toHaveBeenCalledWith({ limit: 20, postId: 'post-1' })
    expect(result).toEqual({ scannedCount: 1, results: [] })
  })

  test('ensures the private ES index when requested by an authorized worker', async () => {
    ;(ensurePostRagIndex as jest.Mock).mockResolvedValue({ created: true, indexName: 'happyhome_post_rag_chunks', dims: 768 })

    const result = await main({ action: 'ensureIndex', workerToken: 'worker-secret' })

    expect(ensurePostRagIndex).toHaveBeenCalledWith()
    expect(processPostRagJobBatch).not.toHaveBeenCalled()
    expect(result).toEqual({ created: true, indexName: 'happyhome_post_rag_chunks', dims: 768 })
  })
})
