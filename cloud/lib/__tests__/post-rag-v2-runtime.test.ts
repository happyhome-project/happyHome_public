import { createPostRagV2RuntimeFromEnv, createRawEsRequest } from '../post-rag-v2-runtime'

const env = {
  TENCENT_RAG_ES_ENDPOINT: 'https://es.example.test:9200', TENCENT_RAG_ES_USERNAME: 'elastic',
  TENCENT_RAG_ES_PASSWORD: 'password-secret', TENCENT_RAG_INDEX_NAME: 'post-rag-v2',
  TENCENT_RAG_ATOMIC_SECRET_ID: 'secret-id', TENCENT_RAG_ATOMIC_SECRET_KEY: 'secret-key',
  TENCENT_RAG_ATOMIC_REGION: 'ap-shanghai', TENCENT_RAG_EMBEDDING_MODEL: 'bge-base-zh-v1.5',
} as NodeJS.ProcessEnv
const database = { runTransaction: jest.fn(), transactionGetByIdOrNull: jest.fn(), getById: jest.fn(), queryAfterId: jest.fn(), create: jest.fn(), updateById: jest.fn(), removeById: jest.fn() }

test('runtime rejects incomplete environment before database or network side effects', () => {
  const atomic = jest.fn()
  for (const key of ['TENCENT_RAG_ES_ENDPOINT', 'TENCENT_RAG_ES_USERNAME', 'TENCENT_RAG_ES_PASSWORD', 'TENCENT_RAG_INDEX_NAME', 'TENCENT_RAG_ATOMIC_SECRET_ID', 'TENCENT_RAG_ATOMIC_SECRET_KEY', 'TENCENT_RAG_EMBEDDING_MODEL']) {
    expect(() => createPostRagV2RuntimeFromEnv({ env: { ...env, [key]: '' }, database: database as any, requestAtomicJson: atomic })).toThrow('RAG v2 runtime is not configured')
  }
  expect(atomic).not.toHaveBeenCalled(); expect(database.getById).not.toHaveBeenCalled()
})

test('runtime accepts the existing TencentCloud credential fallback and default region', () => {
  const fallbackEnv = { ...env, TENCENT_RAG_ATOMIC_SECRET_ID: '', TENCENT_RAG_ATOMIC_SECRET_KEY: '', TENCENT_RAG_ATOMIC_REGION: '', TENCENTCLOUD_SECRETID: 'fallback-id', TENCENTCLOUD_SECRETKEY: 'fallback-key' }
  expect(() => createPostRagV2RuntimeFromEnv({ env: fallbackEnv, database: database as any, requestAtomicJson: jest.fn(), requestJson: jest.fn() })).not.toThrow()
})

test('runtime rejects a vector field that the v2 writer does not write', () => {
  expect(() => createPostRagV2RuntimeFromEnv({ env: { ...env, TENCENT_RAG_VECTOR_FIELD:'other_vector' }, database:database as any, requestJson:jest.fn(), requestAtomicJson:jest.fn() })).toThrow('RAG v2 runtime is not configured')
})

test('raw ES request rejects non-HTTPS endpoints before network side effects', () => {
  expect(() => createRawEsRequest({ endpoint: 'http://127.0.0.1:9200', username: 'elastic', password: 'password-secret' })).toThrow('RAG v2 runtime is not configured')
})

test('runtime sends one atomic batch and validates vector cardinality', async () => {
  const atomic = jest.fn().mockResolvedValue({ Data: [{ Embedding: [1, 2] }, { Embedding: [3, 4] }] })
  const runtime = createPostRagV2RuntimeFromEnv({ env, database: database as any, requestAtomicJson: atomic, requestJson: jest.fn() })
  await expect(runtime.embedTexts(['一粥一饭', '勤俭持家'])).resolves.toEqual([[1, 2], [3, 4]])
  expect(atomic).toHaveBeenCalledWith(expect.objectContaining({ embeddingModel: 'bge-base-zh-v1.5' }), 'GetTextEmbedding', { ModelName: 'bge-base-zh-v1.5', Texts: ['一粥一饭', '勤俭持家'] })
  atomic.mockResolvedValueOnce({ Data: [{ Embedding: [1, 2] }] })
  await expect(runtime.embedTexts(['a', 'b'])).rejects.toThrow('RAG embedding response is invalid')
})
