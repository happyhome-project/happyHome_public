const mockDb = {
  create: jest.fn(),
  getById: jest.fn(),
  query: jest.fn(),
  removeById: jest.fn(),
  updateById: jest.fn(),
}

jest.mock('../db', () => mockDb)

import {
  backfillPostRagJobsForSectionBatch,
  buildNoEvidenceRagResult,
  buildRagQuery,
  createTencentLkeapCloudBaseProvider,
  createTencentRagProviderFromEnv,
  enqueuePostRagJob,
  hasRagEvidenceSignal,
  POST_RAG_CHUNKS,
  POST_RAG_INDEX_STATE,
  POST_RAG_JOBS,
  processPostRagJobBatch,
  readTencentLkeapRagConfigFromEnv,
  searchPostsWithRag,
} from '../post-rag'

beforeEach(() => {
  jest.clearAllMocks()
})

test('buildRagQuery expands thrift family-style intent into classical family-rule evidence terms', () => {
  const query = buildRagQuery('有没有讲节俭家风的帖子？')

  expect(query.normalized).toContain('节俭家风')
  expect(query.expansionTerms).toEqual(expect.arrayContaining([
    '节俭',
    '勤俭',
    '节约',
    '家风',
    '家训',
    '朱子治家格言',
    '一粥一饭',
    '半丝半缕',
    '物力维艰',
  ]))
  expect(query.expandedText).toContain('一粥一饭')
  expect(query.expandedText).toContain('半丝半缕')
})

test('enqueuePostRagJob records a pending async index job with fixed metadata', async () => {
  mockDb.create.mockResolvedValue('job-1')

  const result = await enqueuePostRagJob({
    postId: 'post-1',
    communityId: 'community-1',
    sectionId: 'section-1',
    action: 'upsert',
    reason: 'post.audit.pass',
  })

  expect(result.queued).toBe(true)
  expect(mockDb.create).toHaveBeenCalledWith(POST_RAG_JOBS, expect.objectContaining({
    postId: 'post-1',
    communityId: 'community-1',
    sectionId: 'section-1',
    action: 'upsert',
    reason: 'post.audit.pass',
    status: 'pending',
    attempts: 0,
  }))
})

test('processPostRagJobBatch chunks approved post content and upserts through provider', async () => {
  const provider = {
    name: 'fake-rag',
    isConfigured: jest.fn(() => true),
    search: jest.fn(),
    upsertChunks: jest.fn().mockResolvedValue(undefined),
    deletePostChunks: jest.fn(),
  }
  mockDb.query.mockResolvedValue([
    { _id: 'job-1', postId: 'post-1', action: 'upsert', attempts: 0 },
  ])
  mockDb.getById
    .mockResolvedValueOnce({
      _id: 'post-1',
      communityId: 'community-1',
      sectionId: 'section-1',
      authorId: 'user-1',
      status: 'active',
      auditStatus: 'pass',
      content: { title: '朱子治家格言', body: '一粥一饭，当思来处不易。' },
      commentCount: 0,
      likeCount: 0,
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z',
    })
    .mockResolvedValueOnce({
      _id: 'section-1',
      communityId: 'community-1',
      name: '论语',
      icon: 'book',
      order: 1,
      enableComment: true,
      enableLike: true,
      type: 'evergreen',
      status: 'active',
      widgets: [
        { widgetId: 'title', type: 'short_text', label: '标题', fieldKey: 'title', showInList: true, order: 0 },
        { widgetId: 'body', type: 'rich_note', label: '正文', fieldKey: 'body', showInList: true, order: 1 },
      ],
    })
  mockDb.updateById.mockResolvedValue({ stats: { updated: 1 } })

  const result = await processPostRagJobBatch({ provider, limit: 1 })

  expect(result.scannedCount).toBe(1)
  expect(provider.deletePostChunks).toHaveBeenCalledWith('post-1')
  expect(provider.upsertChunks).toHaveBeenCalledWith(expect.arrayContaining([
    expect.objectContaining({
      postId: 'post-1',
      communityId: 'community-1',
      sectionId: 'section-1',
      fieldLabel: expect.stringMatching(/标题|正文/),
      sourceUpdatedAt: '2026-06-25T00:00:00.000Z',
      visibility: 'member',
    }),
  ]))
  expect(mockDb.updateById).toHaveBeenCalledWith(POST_RAG_INDEX_STATE, 'post-1', expect.objectContaining({
    status: 'indexed',
    chunkCount: expect.any(Number),
  }))
  expect(mockDb.updateById).toHaveBeenCalledWith(POST_RAG_JOBS, 'job-1', expect.objectContaining({
    status: 'completed',
  }))
})

test('processPostRagJobBatch can target pending jobs for one post', async () => {
  const provider = {
    name: 'fake-rag',
    isConfigured: jest.fn(() => true),
    search: jest.fn(),
    upsertChunks: jest.fn(),
    deletePostChunks: jest.fn(),
  }
  mockDb.query.mockResolvedValue([])

  const result = await processPostRagJobBatch({ provider, limit: 3, postId: 'post-1' })

  expect(result.scannedCount).toBe(0)
  expect(mockDb.query).toHaveBeenCalledWith(POST_RAG_JOBS, {
    status: 'pending',
    postId: 'post-1',
  }, {
    orderBy: ['createdAt', 'asc'],
    limit: 3,
  })
})

test('backfillPostRagJobsForSectionBatch enqueues upsert and delete jobs without embedding inline', async () => {
  mockDb.getById.mockResolvedValue({
    _id: 'section-1',
    communityId: 'community-1',
    widgets: [],
  })
  mockDb.query.mockResolvedValue([
    {
      _id: 'post-1',
      communityId: 'community-1',
      sectionId: 'section-1',
      status: 'active',
      auditStatus: 'pass',
    },
    {
      _id: 'post-2',
      communityId: 'community-1',
      sectionId: 'section-1',
      status: 'deleted',
      auditStatus: 'pass',
    },
  ])
  mockDb.create.mockResolvedValue('job-id')

  const result = await backfillPostRagJobsForSectionBatch('section-1', { skip: 0, limit: 2 })

  expect(result.scannedCount).toBe(2)
  expect(result.upsertQueuedCount).toBe(1)
  expect(result.deleteQueuedCount).toBe(1)
  expect(mockDb.create).toHaveBeenCalledWith(POST_RAG_JOBS, expect.objectContaining({
    postId: 'post-1',
    action: 'upsert',
    reason: 'rag.backfill.section',
  }))
  expect(mockDb.create).toHaveBeenCalledWith(POST_RAG_JOBS, expect.objectContaining({
    postId: 'post-2',
    action: 'delete',
    reason: 'rag.backfill.section',
  }))
})

test('searchPostsWithRag falls back explicitly when Tencent RAG provider is not configured', async () => {
  const result = await searchPostsWithRag({
    communityId: 'community-1',
    query: '有没有讲节俭家风的帖子？',
    limit: 10,
  }, {
    provider: null,
    fallbackSearch: async () => ({
      query: '有没有讲节俭家风的帖子？',
      communityId: 'community-1',
      sectionId: '',
      total: 1,
      skip: 0,
      limit: 10,
      items: [
        {
          postId: 'post-1',
          communityId: 'community-1',
          sectionId: 'section-1',
          sectionName: '论语',
          title: '朱子治家格言',
          score: 12,
          matchedFields: [
            { fieldLabel: '正文', fieldType: 'rich_note', preview: '一粥一饭，当思来处不易。' },
          ],
          createdAt: '2026-06-25T00:00:00.000Z',
          updatedAt: '2026-06-25T00:00:00.000Z',
        },
      ],
    }),
  })

  expect(result.mode).toBe('fallback')
  expect(result.answer).toBe('')
  expect(result.citations).toEqual([])
  expect(result.items[0].postId).toBe('post-1')
})

test('searchPostsWithRag returns no_answer instead of inventing an answer without citations', async () => {
  const result = buildNoEvidenceRagResult({
    query: '有没有讲节俭家风的帖子？',
    communityId: 'community-1',
    sectionId: '',
    skip: 0,
    limit: 10,
  })

  expect(result.mode).toBe('no_answer')
  expect(result.answer).toContain('没有找到足够相关的帖子')
  expect(result.citations).toEqual([])
  expect(result.items).toEqual([])
})

test('hasRagEvidenceSignal rejects weak unrelated candidates and accepts real evidence signals', () => {
  expect(hasRagEvidenceSignal({ semanticScore: 0.2, lexicalScore: 0, rerankScore: -3 })).toBe(false)
  expect(hasRagEvidenceSignal({ semanticScore: 0.2, lexicalScore: 1, rerankScore: -3 })).toBe(true)
  expect(hasRagEvidenceSignal({ semanticScore: 0.2, lexicalScore: 0, rerankScore: 0.1 })).toBe(true)
  expect(hasRagEvidenceSignal({ semanticScore: 0.5, lexicalScore: 0, rerankScore: -3 })).toBe(true)
})

test('createTencentRagProviderFromEnv selects LKEAP provider when configured', () => {
  const previousEnv = { ...process.env }
  try {
    process.env.TENCENT_RAG_PROVIDER = 'lkeap'
    process.env.TENCENTCLOUD_SECRETID = 'AKIDtest'
    process.env.TENCENTCLOUD_SECRETKEY = 'secret-test'
    process.env.TENCENT_LKEAP_REGION = 'ap-guangzhou'

    const provider = createTencentRagProviderFromEnv()

    expect(provider.name).toBe('tencent-lkeap-cloudbase')
    expect(provider.isConfigured()).toBe(true)
  } finally {
    process.env = previousEnv
  }
})

test('readTencentLkeapRagConfigFromEnv prefers explicit LKEAP secrets over CloudBase runtime secrets', () => {
  const config = readTencentLkeapRagConfigFromEnv({
    TENCENTCLOUD_SECRETID: 'runtime-secret-id',
    TENCENTCLOUD_SECRETKEY: 'runtime-secret-key',
    TENCENT_LKEAP_SECRET_ID: 'lkeap-secret-id',
    TENCENT_LKEAP_SECRET_KEY: 'lkeap-secret-key',
  } as NodeJS.ProcessEnv)

  expect(config.secretId).toBe('lkeap-secret-id')
  expect(config.secretKey).toBe('lkeap-secret-key')
})

test('LKEAP provider deletes all CloudBase chunks for a post across pages', async () => {
  const provider = createTencentLkeapCloudBaseProvider({
    secretId: 'AKIDtest',
    secretKey: 'secret-test',
    region: 'ap-guangzhou',
    embeddingModel: 'lke-text-embedding-v2',
    rerankModel: 'lke-reranker-base',
    chatModel: 'deepseek-v3-0324',
    chunkPageSize: 100,
    maxCandidateChunks: 200,
  })
  mockDb.query
    .mockResolvedValueOnce(Array.from({ length: 100 }, (_, index) => ({ _id: `chunk-${index}` })))
    .mockResolvedValueOnce([{ _id: 'chunk-100' }, { chunkId: 'chunk-101' }])
  mockDb.removeById.mockResolvedValue({})

  await provider.deletePostChunks?.('post-1')

  expect(mockDb.query).toHaveBeenCalledTimes(2)
  expect(mockDb.query).toHaveBeenNthCalledWith(1, POST_RAG_CHUNKS, { postId: 'post-1' }, { limit: 100 })
  expect(mockDb.query).toHaveBeenNthCalledWith(2, POST_RAG_CHUNKS, { postId: 'post-1' }, { limit: 100 })
  expect(mockDb.removeById).toHaveBeenCalledTimes(102)
  expect(mockDb.removeById).toHaveBeenCalledWith(POST_RAG_CHUNKS, 'chunk-101')
})
