import { createPostRagV2RuntimeFromEnv, createRawEsRequest, PostRagV2RuntimeError } from '../post-rag-v2-runtime'

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
  await expect(runtime.embedTexts(['a', 'b'])).rejects.toThrow('RAG v2 embedding response is invalid')
})

function atomicRuntime(transport: any, options: Record<string, unknown> = {}) {
  return createPostRagV2RuntimeFromEnv({
    env,
    database: database as any,
    requestJson: jest.fn(),
    atomicTransport: transport,
    atomicTimeoutMs: 20,
    atomicMaxResponseBytes: 64,
    ...options,
  } as any)
}

test('v2 atomic embedding aborts a slow transport with a sanitized typed timeout', async () => {
  const transport = jest.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('secret transport timeout detail')), { once: true })
  }))
  const error = await atomicRuntime(transport).embedTexts(['勤俭持家']).catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(PostRagV2RuntimeError)
  expect(error).toMatchObject({ code: 'ATOMIC_TIMEOUT', message: 'RAG v2 embedding request timed out' })
  expect(JSON.stringify(error)).not.toMatch(/secret|transport timeout detail/)
})

test('v2 atomic embedding rejects response bodies above the byte cap', async () => {
  const transport = jest.fn(async () => ({ status: 200, body: (async function* () {
    yield Buffer.alloc(40, 0x61)
    yield Buffer.alloc(40, 0x62)
  })() }))
  const error = await atomicRuntime(transport).embedTexts(['勤俭持家']).catch((caught: unknown) => caught)
  expect(error).toMatchObject({ code: 'ATOMIC_RESPONSE_TOO_LARGE', message: 'RAG v2 embedding response exceeded the size limit' })
})

test.each([
  ['provider error', JSON.stringify({ Response: { Error: { Code: 'InternalError', Message: 'credential secret-id leaked by provider' } } }), 'ATOMIC_PROVIDER_ERROR'],
  ['invalid JSON', '{"Response":', 'ATOMIC_INVALID_RESPONSE'],
] as const)('v2 atomic embedding sanitizes %s responses', async (_label, body, code) => {
  const transport = jest.fn(async () => ({ status: 200, body: (async function* () { yield Buffer.from(body) })() }))
  const error = await atomicRuntime(transport, { atomicMaxResponseBytes: 1024 }).embedTexts(['勤俭持家']).catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(PostRagV2RuntimeError)
  expect(error).toMatchObject({ code })
  expect(JSON.stringify(error)).not.toMatch(/credential secret-id|leaked by provider|Response/)
})
