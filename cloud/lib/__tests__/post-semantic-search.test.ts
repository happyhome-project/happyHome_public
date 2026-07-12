import { createPostSemanticSearchService, createPostSemanticSearchServiceFromEnv, isPostSemanticSearchError } from '../post-semantic-search'

const post = (overrides: Record<string, any> = {}) => ({
  _id: 'p1', communityId: 'c1', sectionId: 's1', status: 'active', auditStatus: 'pass',
  authorId: 'u1', authorNickname: '阿福', authorAvatarUrl: 'avatar', content: {},
  createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-02T00:00:00.000Z', ...overrides,
})
const section = (overrides: Record<string, any> = {}) => ({ _id: 's1', communityId: 'c1', name: '家风', status: 'active', widgets: [{ widgetId: 'w1', fieldKey: 'body', visibility: 'public' }], ...overrides })
const state = (overrides: Record<string, any> = {}) => ({ _id: 'p1', schemaVersion: 2, postId: 'p1', state: 'active', sourceVersion: 'sv1', ...overrides })
const versions = (overrides: Record<string, any> = {}) => ({ _id: 'c1', communityId: 'c1', contentVersion: 3, aclVersion: 4, ...overrides })
const hit = (overrides: Record<string, any> = {}) => ({
  _id: 'p1:sv1:ch1', _score: 2.5, _source: {
    postId: 'p1', communityId: 'c1', sectionId: 's1', sourceVersion: 'sv1', chunkId: 'ch1',
    visibility: 'public', title: '一粥一饭，当思来处不易', text: '一粥一饭，当思来处不易。勤俭是我们的家风。', preview: '一粥一饭，当思来处不易',
    widgetId: 'w1', fieldKey: 'body', fieldLabel: '正文', sectionName: '家风', ...overrides,
  },
})
async function expectSafeFailure(promise: Promise<unknown>) {
  const error = await promise.catch((value: unknown) => value)
  expect(isPostSemanticSearchError(error)).toBe(true)
}

function fixture(options: { hits?: any[]; docs?: Record<string, any>; now?: () => number } = {}) {
  const docs = options.docs || { 'rag_community_versions:c1': versions(), 'posts:p1': post(), 'sections:s1': section(), 'post_rag_index_state_v2:p1': state() }
  const database = {
    getById: jest.fn(async (collection: string, id: string) => {
      const value = docs[`${collection}:${id}`]
      if (!value) throw new Error('missing')
      return value
    }),
    getByIds: jest.fn(async (collection: string, ids: string[]) => ids.map(id => docs[`${collection}:${id}`]).filter(Boolean)),
  }
  const requestJson = jest.fn(async (_method: string, _path: string, _body?: any) => ({ hits: { hits: options.hits || [hit()] } }))
  const embedTexts = jest.fn(async () => [[0.1, 0.2]])
  return { database, requestJson, embedTexts, service: createPostSemanticSearchService({ database, requestJson, embedTexts, indexName: 'rag-index', vectorField: 'embedding', embeddingModel: 'bge-base-zh-v1.5', retrievalIndexVersion: 'post-rag-v2-c260-o40', now: options.now }) }
}

test('bounds a stalled provider request and returns a safe error', async () => {
  const f = fixture()
  const service = createPostSemanticSearchService({ database: f.database, requestJson: f.requestJson, embedTexts: async () => new Promise<number[][]>(() => {}), indexName: 'rag-index', vectorField: 'embedding', embeddingModel: 'bge-base-zh-v1.5', operationTimeoutMs: 10 })
  const error = await service.search({ communityId: 'c1', query: '勤俭', includeMemberOnly: false }).catch((value: unknown) => value)
  expect(isPostSemanticSearchError(error)).toBe(true)
})

test('issues one bounded BM25+dense RRF request and returns a semantically related current post', async () => {
  const f = fixture()
  const result = await f.service.search({ communityId: 'c1', query: '勤俭持家', includeMemberOnly: false })
  expect(f.embedTexts).toHaveBeenCalledWith(['勤俭持家'])
  expect(f.requestJson).toHaveBeenCalledTimes(1)
  expect(f.requestJson).toHaveBeenCalledWith('POST', 'rag-index/_search', expect.objectContaining({
    size: 40,
    _source: ['postId', 'communityId', 'sectionId', 'sourceVersion', 'chunkId', 'visibility', 'widgetId', 'fieldKey', 'title', 'text', 'preview', 'fieldLabel', 'sectionName'],
    query: { bool: { must: [{ multi_match: { query: '勤俭持家', fields: ['text^3', 'preview^2', 'title^4', 'fieldLabel', 'sectionName'], type: 'best_fields' } }], filter: [{ term: { communityId: 'c1' } }, { term: { visibility: 'public' } }] } },
    knn: { field: 'embedding', query_vector: [0.1, 0.2], k: 40, num_candidates: 100, filter: { bool: { filter: [{ term: { communityId: 'c1' } }, { term: { visibility: 'public' } }] } } },
    rank: { rrf: { rank_window_size: 40, rank_constant: 60 } },
  }))
  expect(result).toMatchObject({ protocolVersion: 2, query: '勤俭持家', total: 1, skip: 0, limit: 10, items: [{ postId: 'p1', title: '一粥一饭，当思来处不易', matchedField: '正文', sectionName: '家风' }] })
  expect(result.items[0].matchedSnippet).toContain('一粥一饭')
  expect(result.tookMs).toBeGreaterThanOrEqual(0)
})

test('adds section filter and allows member chunks only for members', async () => {
  const f = fixture({ hits: [hit({ visibility: 'member' })] })
  const result = await f.service.search({ communityId: 'c1', sectionId: 's1', query: '家风', includeMemberOnly: true })
  const body = f.requestJson.mock.calls[0][2]
  expect(body.query.bool.filter).toEqual([{ term: { communityId: 'c1' } }, { term: { sectionId: 's1' } }])
  expect(result.total).toBe(1)
})

test.each([
  ['deleted post', { 'posts:p1': post({ status: 'deleted' }) }],
  ['pending post', { 'posts:p1': post({ auditStatus: 'pending' }) }],
  ['cross-community post', { 'posts:p1': post({ communityId: 'other' }) }],
  ['inactive section', { 'sections:s1': section({ status: 'archived' }) }],
  ['stale source', { 'post_rag_index_state_v2:p1': state({ sourceVersion: 'newer' }) }],
  ['removed state', { 'post_rag_index_state_v2:p1': state({ state: 'removed' }) }],
])('drops %s during every real-time recheck', async (_name, changed) => {
  const base = { 'rag_community_versions:c1': versions(), 'posts:p1': post(), 'sections:s1': section(), 'post_rag_index_state_v2:p1': state(), ...changed }
  const f = fixture({ docs: base })
  await expect(f.service.search({ communityId: 'c1', query: '勤俭', includeMemberOnly: false })).resolves.toMatchObject({ total: 0, items: [] })
})

test('strictly rejects the whole ES response when any bounded hit is malformed', async () => {
  const f = fixture({ hits: [hit(), { _id: 'bad', _score: 1, _source: { postId: 'p1' } }] })
  const error = await f.service.search({ communityId: 'c1', query: '勤俭', includeMemberOnly: false }).catch((value: unknown) => value)
  expect(isPostSemanticSearchError(error)).toBe(true)
})

test('rechecks current widget identity and visibility even when public candidates are cached', async () => {
  const docs: Record<string, any> = { 'rag_community_versions:c1': versions(), 'posts:p1': post(), 'sections:s1': section(), 'post_rag_index_state_v2:p1': state() }
  const f = fixture({ docs })
  const guest = { communityId: 'c1', query: '家风', includeMemberOnly: false }
  await expect(f.service.search(guest)).resolves.toMatchObject({ total: 1 })
  docs['sections:s1'].widgets[0].visibility = 'member'
  await expect(f.service.search(guest)).resolves.toMatchObject({ total: 0 })
  expect(f.requestJson).toHaveBeenCalledTimes(1)
  await expect(f.service.search({ ...guest, includeMemberOnly: true })).resolves.toMatchObject({ total: 1 })
  docs['sections:s1'].widgets = []
  await expect(f.service.search({ ...guest, includeMemberOnly: true })).resolves.toMatchObject({ total: 0 })
})

test('accepts canonical repeated field suffixes for the authoritative widget', async () => {
  const f = fixture({ hits: [hit({ fieldKey: 'body.2' })] })
  await expect(f.service.search({ communityId: 'c1', query: '家风', includeMemberOnly: false })).resolves.toMatchObject({ total: 1 })
})

test.each(['body.foo', 'body.02', 'other.2', 'body.1'])('drops non-canonical repeated field key %s', async fieldKey => {
  const f = fixture({ hits: [hit({ fieldKey })] })
  await expect(f.service.search({ communityId: 'c1', query: '家风', includeMemberOnly: false })).resolves.toMatchObject({ total: 0 })
})

test('accepts rank-fusion hits that expose _rank with a null _score', async () => {
  const ranked = hit() as any
  ranked._score = null
  ranked._rank = 1
  const f = fixture({ hits: [ranked] })
  await expect(f.service.search({ communityId: 'c1', query: '勤俭', includeMemberOnly: false })).resolves.toMatchObject({ total: 1 })
})

test('groups at most two chunks per post, ranks by best score and paginates posts', async () => {
  const docs: Record<string, any> = { 'rag_community_versions:c1': versions() }
  const hits: any[] = []
  for (let p = 1; p <= 3; p++) {
    docs[`posts:p${p}`] = post({ _id: `p${p}` })
    docs[`post_rag_index_state_v2:p${p}`] = state({ _id: `p${p}`, postId: `p${p}` })
    for (let c = 1; c <= 3; c++) hits.push(hit({ postId: `p${p}`, chunkId: `ch${c}`, text: `p${p}-${c}` , preview: `p${p}-${c}` , ...(p === 1 ? {} : {}) , }))
  }
  docs['sections:s1'] = section()
  const f = fixture({ docs, hits })
  const result = await f.service.search({ communityId: 'c1', query: '家风', skip: 1, limit: 1, includeMemberOnly: false })
  expect(result.total).toBe(3); expect(result.items).toHaveLength(1)
})

test('caches embeddings for 24h and candidates for 10m but rechecks DB; version changes invalidate candidates', async () => {
  let time = 1_000
  const f = fixture({ now: () => time })
  const input = { communityId: 'c1', query: '勤俭', includeMemberOnly: false }
  await f.service.search(input); await f.service.search(input)
  expect(f.embedTexts).toHaveBeenCalledTimes(1); expect(f.requestJson).toHaveBeenCalledTimes(1)
  expect(f.database.getByIds).toHaveBeenCalledTimes(6)
  ;(f.database.getById as jest.Mock).mockResolvedValueOnce(versions({ contentVersion: 4 }))
  await f.service.search(input)
  expect(f.requestJson).toHaveBeenCalledTimes(2)
})

test.each(['', '   ', 'x'.repeat(81)])('rejects invalid query without side effects', async query => {
  const f = fixture()
  const error = await f.service.search({ communityId: 'c1', query, includeMemberOnly: false }).catch((value: unknown) => value)
  expect(isPostSemanticSearchError(error)).toBe(true)
  expect(f.embedTexts).not.toHaveBeenCalled(); expect(f.requestJson).not.toHaveBeenCalled()
})

test('wraps provider failures safely without keyword fallback or leaking provider text', async () => {
  const f = fixture(); f.requestJson.mockRejectedValueOnce(new Error('secret response body 一粥一饭'))
  const error = await f.service.search({ communityId: 'c1', query: '勤俭', includeMemberOnly: false }).catch((value: unknown) => value)
  expect(isPostSemanticSearchError(error)).toBe(true)
  if (!isPostSemanticSearchError(error)) throw new Error('expected authenticated semantic search error')
  expect(error.message).toBe('Semantic post search failed')
  expect(f.requestJson).toHaveBeenCalledTimes(1)
})

test('timed-out embedding cannot warm cache or proceed to ES', async () => {
  let release!: (value: number[][]) => void
  const f = fixture()
  const embedTexts = jest.fn()
    .mockImplementationOnce(() => new Promise<number[][]>(resolve => { release = resolve }))
    .mockResolvedValueOnce([[0.1, 0.2]])
  const service = createPostSemanticSearchService({ database: f.database, requestJson: f.requestJson, embedTexts, indexName: 'rag-index', vectorField: 'embedding', embeddingModel: 'model', operationTimeoutMs: 10 })
  const input = { communityId: 'c1', query: '勤俭', includeMemberOnly: false }
  await expectSafeFailure(service.search(input))
  release([[9, 9]]); await new Promise(resolve => setTimeout(resolve, 0))
  await expect(service.search(input)).resolves.toMatchObject({ total: 1 })
  expect(embedTexts).toHaveBeenCalledTimes(2); expect(f.requestJson).toHaveBeenCalledTimes(1)
})

test('timed-out ES cannot warm candidate cache or proceed to DB recheck', async () => {
  let release!: (value: any) => void
  const f = fixture()
  f.requestJson.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const service = createPostSemanticSearchService({ database: f.database, requestJson: f.requestJson, embedTexts: f.embedTexts, indexName: 'rag-index', vectorField: 'embedding', embeddingModel: 'model', operationTimeoutMs: 10 })
  const input = { communityId: 'c1', query: '勤俭', includeMemberOnly: false }
  await expectSafeFailure(service.search(input))
  release({ hits: { hits: [hit()] } }); await new Promise(resolve => setTimeout(resolve, 0))
  await expect(service.search(input)).resolves.toMatchObject({ total: 1 })
  expect(f.requestJson).toHaveBeenCalledTimes(2)
  expect(f.database.getByIds).toHaveBeenCalledTimes(3)
})

test('production factory rejects HTTP before any provider side effect', () => {
  const requestJson = jest.fn(); const atomic = jest.fn()
  const env = { TENCENT_RAG_ES_ENDPOINT: 'http://127.0.0.1:9200', TENCENT_RAG_ES_USERNAME: 'u', TENCENT_RAG_ES_PASSWORD: 'p', TENCENT_RAG_INDEX_NAME: 'idx', TENCENT_RAG_VECTOR_FIELD: 'embedding', TENCENT_RAG_EMBEDDING_MODEL: 'model', TENCENT_RAG_ATOMIC_SECRET_ID: 'id', TENCENT_RAG_ATOMIC_SECRET_KEY: 'key', TENCENT_RAG_ATOMIC_REGION: 'ap-shanghai' }
  expect(() => createPostSemanticSearchServiceFromEnv({ env, database: fixture().database, requestJson, requestAtomicJson: atomic })).toThrow('Semantic post search failed')
  expect(requestJson).not.toHaveBeenCalled(); expect(atomic).not.toHaveBeenCalled()
})

test('production search factory rejects a vector field different from the writer contract', () => {
  const env = { TENCENT_RAG_ES_ENDPOINT:'https://es.example.com',TENCENT_RAG_ES_USERNAME:'u',TENCENT_RAG_ES_PASSWORD:'p',TENCENT_RAG_INDEX_NAME:'idx',TENCENT_RAG_VECTOR_FIELD:'other_vector',TENCENT_RAG_EMBEDDING_MODEL:'model',TENCENT_RAG_ATOMIC_SECRET_ID:'id',TENCENT_RAG_ATOMIC_SECRET_KEY:'key',TENCENT_RAG_ATOMIC_REGION:'ap-shanghai' }
  expect(()=>createPostSemanticSearchServiceFromEnv({env,database:fixture().database,requestJson:jest.fn(),requestAtomicJson:jest.fn()})).toThrow('Semantic post search failed')
})

test.each([
  ['control query', { communityId: 'c1', query: '勤俭\u0000', includeMemberOnly: false }],
  ['unpaired surrogate', { communityId: 'c1', query: '勤俭\uD800', includeMemberOnly: false }],
  ['negative skip', { communityId: 'c1', query: '勤俭', skip: -1, includeMemberOnly: false }],
  ['skip outside launch window', { communityId: 'c1', query: '勤俭', skip: 20, includeMemberOnly: false }],
  ['page outside launch window', { communityId: 'c1', query: '勤俭', skip: 10, limit: 11, includeMemberOnly: false }],
])('rejects %s before side effects', async (_name, input) => {
  const f = fixture()
  await expectSafeFailure(f.service.search(input as any))
  expect(f.database.getById).not.toHaveBeenCalled(); expect(f.embedTexts).not.toHaveBeenCalled(); expect(f.requestJson).not.toHaveBeenCalled()
})
