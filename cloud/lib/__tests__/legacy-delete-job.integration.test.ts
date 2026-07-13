import * as db from '../db'
import {
  enqueuePostRagDeleteJobInTransaction,
  POST_RAG_JOBS,
  processPostRagJobBatch,
} from '../post-rag'
import {
  POST_SEARCH_CHUNKS,
  POST_SEARCH_DOCUMENTS,
  POST_SEARCH_TERMS,
  POST_SEARCH_VECTOR_TERMS,
} from '../post-search'

const local = db as typeof db & { _resetAll(): void }
beforeEach(() => local._resetAll())

test('durable legacy delete job survives one provider failure and retries search and semantic cleanup', async () => {
  await db.create(POST_SEARCH_DOCUMENTS, { _id: 'post-1', postId: 'post-1', communityId: 'community-1', sectionId: 'section-1' })
  await db.create(POST_SEARCH_TERMS, { _id: 'term-1', postId: 'post-1' })
  await db.create(POST_SEARCH_VECTOR_TERMS, { _id: 'vector-1', postId: 'post-1' })
  await db.create(POST_SEARCH_CHUNKS, { _id: 'chunk-1', postId: 'post-1' })
  const job = await db.runTransaction(transaction => enqueuePostRagDeleteJobInTransaction(transaction, {
    postId: 'post-1', communityId: 'community-1', sectionId: 'section-1', reason: 'test.delete',
  }))
  const provider = {
    name: 'fake-rag',
    isConfigured: () => true,
    search: jest.fn(),
    deletePostChunks: jest.fn()
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce(undefined),
  }

  await expect(processPostRagJobBatch({ provider, limit: 1, postId: 'post-1' })).resolves.toMatchObject({ results: [{ ok: false }] })
  await expect(db.getById(POST_RAG_JOBS, job._id)).resolves.toMatchObject({ status: 'failed', attempts: 1 })

  await expect(processPostRagJobBatch({ provider, limit: 1, postId: 'post-1' })).resolves.toMatchObject({ results: [{ ok: true }] })
  await expect(db.getById(POST_RAG_JOBS, job._id)).resolves.toMatchObject({ status: 'completed' })
  await expect(db.query(POST_SEARCH_DOCUMENTS, { postId: 'post-1' })).resolves.toHaveLength(0)
  await expect(db.query(POST_SEARCH_TERMS, { postId: 'post-1' })).resolves.toHaveLength(0)
  await expect(db.query(POST_SEARCH_VECTOR_TERMS, { postId: 'post-1' })).resolves.toHaveLength(0)
  await expect(db.query(POST_SEARCH_CHUNKS, { postId: 'post-1' })).resolves.toHaveLength(0)
  expect(provider.deletePostChunks).toHaveBeenCalledTimes(2)
})
