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
  buildVideoRagCacheKey,
  buildVideoRagChunksForPost,
  planVideoRagAnalysisJobsForPost,
  createTencentLkeapCloudBaseProvider,
  createTencentRagProviderFromEnv,
  createVideoRagAnalyzerFromEnv,
  enqueuePostRagJob,
  hasRagEvidenceSignal,
  POST_RAG_CHUNKS,
  POST_RAG_INDEX_STATE,
  POST_RAG_JOBS,
  POST_VIDEO_RAG_ASSETS,
  POST_VIDEO_RAG_JOBS,
  processPostRagJobBatch,
  processPostVideoRagJobBatch,
  readTencentLkeapRagConfigFromEnv,
  readVideoRagCostPolicyFromEnv,
  searchPostsWithRag,
} from '../post-rag'

beforeEach(() => {
  jest.resetAllMocks()
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
        { widgetId: 'body', type: 'rich_text', label: '正文', fieldKey: 'body', showInList: true, order: 1, visibility: 'member' },
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
      visibility: expect.any(String),
    }),
  ]))
  const chunks = (provider.upsertChunks as jest.Mock).mock.calls[0][0]
  expect(chunks).toEqual(expect.arrayContaining([
    expect.objectContaining({ fieldLabel: '标题', visibility: 'public' }),
    expect.objectContaining({ fieldLabel: '正文', visibility: 'member' }),
  ]))
  expect(mockDb.updateById).toHaveBeenCalledWith(POST_RAG_INDEX_STATE, 'post-1', expect.objectContaining({
    status: 'indexed',
    chunkCount: expect.any(Number),
  }))
  expect(mockDb.updateById).toHaveBeenCalledWith(POST_RAG_JOBS, 'job-1', expect.objectContaining({
    status: 'completed',
  }))
})

test('processPostRagJobBatch creates index state when CloudBase update misses the document', async () => {
  const provider = {
    name: 'fake-rag',
    isConfigured: jest.fn(() => true),
    search: jest.fn(),
    upsertChunks: jest.fn().mockResolvedValue(undefined),
    deletePostChunks: jest.fn(),
  }
  mockDb.query.mockResolvedValue([
    { _id: 'job-missing-state', postId: 'post-missing-state', action: 'upsert', attempts: 0 },
  ])
  mockDb.getById
    .mockResolvedValueOnce({
      _id: 'post-missing-state',
      communityId: 'community-1',
      sectionId: 'section-1',
      authorId: 'user-1',
      status: 'active',
      auditStatus: 'pass',
      content: { title: '明士课程', body: '一粥一饭，当思来处不易。' },
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    })
    .mockResolvedValueOnce({
      _id: 'section-1',
      communityId: 'community-1',
      name: '明士课堂',
      type: 'evergreen',
      status: 'active',
      widgets: [
        { widgetId: 'title', type: 'short_text', label: '标题', fieldKey: 'title', showInList: true, order: 0 },
        { widgetId: 'body', type: 'rich_text', label: '正文', fieldKey: 'body', showInList: true, order: 1 },
      ],
    })
  mockDb.updateById
    .mockResolvedValueOnce({ stats: { updated: 0 } })
    .mockResolvedValueOnce({ stats: { updated: 1 } })
  mockDb.create.mockResolvedValue('state-created')

  await processPostRagJobBatch({ provider, limit: 1 })

  expect(mockDb.create).toHaveBeenCalledWith(POST_RAG_INDEX_STATE, expect.objectContaining({
    _id: 'post-missing-state',
    postId: 'post-missing-state',
    communityId: 'community-1',
    sectionId: 'section-1',
    status: 'indexed',
    chunkCount: expect.any(Number),
  }))
})

test('processPostRagJobBatch records community metadata when delete jobs remove index state', async () => {
  const provider = {
    name: 'fake-rag',
    isConfigured: jest.fn(() => true),
    search: jest.fn(),
    upsertChunks: jest.fn(),
    deletePostChunks: jest.fn().mockResolvedValue(undefined),
  }
  mockDb.query.mockResolvedValue([
    {
      _id: 'job-delete',
      postId: 'post-deleted',
      communityId: 'community-1',
      sectionId: 'section-1',
      action: 'delete',
      attempts: 0,
    },
  ])
  mockDb.updateById
    .mockResolvedValueOnce({ stats: { updated: 0 } })
    .mockResolvedValueOnce({ stats: { updated: 1 } })
  mockDb.create.mockResolvedValue('state-created')

  await processPostRagJobBatch({ provider, limit: 1 })

  expect(provider.deletePostChunks).toHaveBeenCalledWith('post-deleted')
  expect(mockDb.create).toHaveBeenCalledWith(POST_RAG_INDEX_STATE, expect.objectContaining({
    _id: 'post-deleted',
    postId: 'post-deleted',
    communityId: 'community-1',
    sectionId: 'section-1',
    status: 'removed',
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

test('processPostRagJobBatch adds video metadata chunks and cost-gated analysis jobs', async () => {
  const provider = {
    name: 'fake-rag',
    isConfigured: jest.fn(() => true),
    search: jest.fn(),
    upsertChunks: jest.fn().mockResolvedValue(undefined),
    deletePostChunks: jest.fn(),
  }
  mockDb.query
    .mockResolvedValueOnce([{ _id: 'job-1', postId: 'post-video', action: 'upsert', attempts: 0 }])
    .mockResolvedValueOnce([])
  mockDb.getById
    .mockResolvedValueOnce({
      _id: 'post-video',
      communityId: 'community-1',
      sectionId: 'section-1',
      authorId: 'user-1',
      status: 'active',
      auditStatus: 'pass',
      content: {
        title: '视频帖子',
        videos: [
          {
            itemId: 'video-1',
            source: 'cos',
            title: '家风',
            description: '',
            fileID: 'cloud://env/posts/videos/family-video.mp4',
            duration: 96,
          },
        ],
      },
      commentCount: 0,
      likeCount: 0,
      createdAt: '2026-06-30T00:00:00.000Z',
      updatedAt: '2026-06-30T01:00:00.000Z',
    })
    .mockResolvedValueOnce({
      _id: 'section-1',
      communityId: 'community-1',
      name: '视频课',
      icon: 'video',
      order: 1,
      enableComment: true,
      enableLike: true,
      type: 'evergreen',
      status: 'active',
      widgets: [
        { widgetId: 'title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, showInList: true, order: 0 },
        { widgetId: 'videos', type: 'video_group', label: '视频', fieldKey: 'videos', required: false, showInList: false, order: 1 },
      ],
    })
  mockDb.updateById.mockResolvedValue({ stats: { updated: 1 } })
  mockDb.create.mockResolvedValue('video-job-1')

  const result = await processPostRagJobBatch({
    provider,
    limit: 1,
    videoPolicy: {
      analysisEnabled: true,
      maxJobsPerPost: 1,
      maxCostUnitsPerPost: 8,
      maxFramesPerVideo: 4,
      maxAsrSecondsPerVideo: 120,
      minMetadataTextCharsForAnalysis: 24,
    },
  })

  expect(result.scannedCount).toBe(1)
  expect(provider.upsertChunks).toHaveBeenCalledWith(expect.arrayContaining([
    expect.objectContaining({
      postId: 'post-video',
      fieldLabel: '视频',
      fieldType: 'video_group',
      text: expect.stringContaining('文件名：family-video.mp4'),
      metadata: expect.objectContaining({
        evidenceSource: 'video_metadata',
        costTier: 'free',
      }),
    }),
  ]))
  expect(mockDb.create).toHaveBeenCalledWith(POST_VIDEO_RAG_JOBS, expect.objectContaining({
    postId: 'post-video',
    status: 'pending',
    requestedAnalyses: ['cover_ocr', 'keyframe_vision', 'asr'],
    estimatedCostUnits: 8,
  }))
  expect(mockDb.updateById).toHaveBeenCalledWith(POST_RAG_INDEX_STATE, 'post-video', expect.objectContaining({
    status: 'indexed',
    videoRag: expect.objectContaining({
      metadataChunkCount: 1,
      analysisChunkCount: 0,
      analysisJobQueuedCount: 1,
      analysisEnabled: true,
    }),
  }))
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

test('searchPostsWithRag drops member-only citations and generated answer for public readers', async () => {
  const provider = {
    name: 'fake-rag',
    isConfigured: jest.fn(() => true),
    search: jest.fn().mockResolvedValue({
      total: 2,
      answer: '秘密联系方式：13800000000',
      citations: [
        {
          postId: 'post-public',
          chunkId: 'chunk-public',
          communityId: 'community-1',
          title: '公开家风笔记',
          sectionId: 'section-1',
          sectionName: '论语',
          fieldLabel: '正文',
          fieldType: 'rich_note',
          preview: '一粥一饭，当思来处不易。',
          score: 0.9,
          visibility: 'public',
        },
        {
          postId: 'post-member',
          chunkId: 'chunk-member',
          communityId: 'community-1',
          title: '成员联系资料',
          sectionId: 'section-1',
          sectionName: '论语',
          fieldLabel: '联系方式',
          fieldType: 'rich_note',
          preview: '秘密联系方式：13800000000',
          score: 0.95,
          visibility: 'member',
        },
      ],
      items: [],
      mode: 'rag',
    }),
  }

  const result = await searchPostsWithRag({
    communityId: 'community-1',
    query: '联系方式',
    limit: 10,
    includeMemberOnly: false,
  }, { provider })

  expect(provider.search).toHaveBeenCalledWith(expect.objectContaining({
    includeMemberOnly: false,
  }))
  expect(result.mode).toBe('rag')
  expect(result.answer).not.toContain('13800000000')
  expect(result.citations).toHaveLength(1)
  expect(result.citations[0]).toMatchObject({ postId: 'post-public', visibility: 'public' })
  expect(result.items.map((item) => item.postId)).toEqual(['post-public'])
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

test('createVideoRagAnalyzerFromEnv selects TokenHub multimodal analyzer when configured', () => {
  const analyzer = createVideoRagAnalyzerFromEnv({
    POST_VIDEO_RAG_TOKENHUB_API_KEY: 'tokenhub-key',
    POST_VIDEO_RAG_TOKENHUB_MODEL: 'youtu-vita',
  } as NodeJS.ProcessEnv)

  expect(analyzer.name).toBe('tokenhub-video-rag-analyzer')
  expect(analyzer.isConfigured()).toBe(true)
})

test('createVideoRagAnalyzerFromEnv prefers Tencent ASR analyzer for audio-first video analysis', () => {
  const analyzer = createVideoRagAnalyzerFromEnv({
    POST_VIDEO_RAG_ASR_SECRET_ID: 'asr-secret-id',
    POST_VIDEO_RAG_ASR_SECRET_KEY: 'asr-secret-key',
  } as NodeJS.ProcessEnv)

  expect(analyzer.name).toBe('tencent-asr-video-rag-analyzer')
  expect(analyzer.isConfigured()).toBe(true)
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

test('buildVideoRagChunksForPost adds low-cost metadata and cached OCR ASR frame evidence', () => {
  const section = {
    _id: 'section-1',
    communityId: 'community-1',
    name: '家风课堂',
    icon: 'video',
    order: 1,
    enableComment: true,
    enableLike: true,
    type: 'evergreen',
    status: 'active',
    widgets: [
      { widgetId: 'title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, showInList: true, order: 0 },
      { widgetId: 'videos', type: 'video_group', label: '视频', fieldKey: 'videos', required: false, showInList: false, order: 1 },
    ],
  } as any
  const video = {
    itemId: 'video-1',
    source: 'cos',
    title: '朱子家风视频课',
    description: '讲勤俭持家',
    hint: '节俭家风',
    fileID: 'cloud://env/posts/videos/zhuzi-family.mp4',
    cover: 'cloud://env/posts/covers/zhuzi-cover.jpg',
    duration: 96,
  }
  const post = {
    _id: 'post-video',
    communityId: 'community-1',
    sectionId: 'section-1',
    content: { title: '视频帖子', videos: [video] },
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T01:00:00.000Z',
  } as any
  const cacheKey = buildVideoRagCacheKey(video)
  const chunks = buildVideoRagChunksForPost(post, section, {
    now: '2026-06-30T02:00:00.000Z',
    assetsByCacheKey: new Map([[cacheKey, {
      cacheKey,
      status: 'ready',
      visualSummary: '关键帧显示朱子治家格言讲义。',
      ocrText: '一粥一饭，当思来处不易。',
      asrTranscript: '这段视频讲半丝半缕，恒念物力维艰。',
      frameSummaries: [
        { timeMs: 3000, summary: '老师展示节俭家风板书。', ocrText: '勤俭持家' },
      ],
      updatedAt: '2026-06-30T01:30:00.000Z',
    } as any]]),
  })

  expect(chunks).toEqual(expect.arrayContaining([
    expect.objectContaining({
      postId: 'post-video',
      fieldLabel: '视频',
      fieldType: 'video_group',
      text: expect.stringContaining('视频名称：朱子家风视频课'),
      metadata: expect.objectContaining({
        evidenceSource: 'video_metadata',
        costTier: 'free',
        cacheKey,
      }),
    }),
    expect.objectContaining({
      postId: 'post-video',
      fieldLabel: '视频理解',
      fieldType: 'video_group',
      text: expect.stringContaining('语音转写：这段视频讲半丝半缕'),
      metadata: expect.objectContaining({
        evidenceSource: 'video_analysis_cache',
        costTier: 'cached',
        cacheKey,
      }),
    }),
  ]))
  expect(chunks.map((chunk) => chunk.text).join('\n')).toContain('文件名：zhuzi-family.mp4')
  expect(chunks.map((chunk) => chunk.text).join('\n')).toContain('OCR：一粥一饭，当思来处不易。')
  expect(chunks.map((chunk) => chunk.text).join('\n')).toContain('关键帧 3s：老师展示节俭家风板书。 OCR：勤俭持家')
})

test('planVideoRagAnalysisJobsForPost queues only low-text missing-cache videos within cost policy', () => {
  const section = {
    _id: 'section-1',
    communityId: 'community-1',
    name: '家风课堂',
    widgets: [
      { widgetId: 'videos', type: 'video_group', label: '视频', fieldKey: 'videos', required: false, showInList: false, order: 1 },
    ],
  } as any
  const shortVideo = {
    itemId: 'video-short',
    source: 'cos',
    title: '家风',
    fileID: 'cloud://env/posts/videos/short.mp4',
    duration: 96,
  }
  const describedVideo = {
    itemId: 'video-described',
    source: 'cos',
    title: '朱子治家格言节俭家风完整讲解',
    description: '这个视频已经有很完整的文字描述，讲一粥一饭，当思来处不易，半丝半缕，恒念物力维艰。',
    fileID: 'cloud://env/posts/videos/described.mp4',
    duration: 600,
  }
  const cachedVideo = {
    itemId: 'video-cached',
    source: 'cos',
    title: '缓存视频',
    fileID: 'cloud://env/posts/videos/cached.mp4',
  }
  const post = {
    _id: 'post-video',
    communityId: 'community-1',
    sectionId: 'section-1',
    content: { videos: [shortVideo, describedVideo, cachedVideo] },
    updatedAt: '2026-06-30T01:00:00.000Z',
  } as any

  const jobs = planVideoRagAnalysisJobsForPost(post, section, {
    now: '2026-06-30T02:00:00.000Z',
    assetsByCacheKey: new Map([[buildVideoRagCacheKey(cachedVideo), { status: 'ready' } as any]]),
    policy: {
      analysisEnabled: true,
      maxJobsPerPost: 2,
      maxCostUnitsPerPost: 8,
      maxFramesPerVideo: 4,
      maxAsrSecondsPerVideo: 120,
      minMetadataTextCharsForAnalysis: 24,
    },
  })

  expect(jobs).toHaveLength(1)
  expect(jobs[0]).toEqual(expect.objectContaining({
    postId: 'post-video',
    communityId: 'community-1',
    sectionId: 'section-1',
    status: 'pending',
    reason: 'rag.video.low_text_signal',
    requestedAnalyses: ['cover_ocr', 'keyframe_vision', 'asr'],
    frameStrategy: expect.objectContaining({
      includeCover: true,
      maxFrames: 4,
    }),
    maxAsrSeconds: 120,
    estimatedCostUnits: 8,
    video: expect.objectContaining({
      itemId: 'video-short',
      title: '家风',
    }),
  }))
})

test('planVideoRagAnalysisJobsForPost does not queue ASR when video duration exceeds the ASR budget', () => {
  const section = {
    _id: 'section-1',
    communityId: 'community-1',
    name: '家风课堂',
    widgets: [
      { widgetId: 'videos', type: 'video_group', label: '视频', fieldKey: 'videos', required: false, showInList: false, order: 1 },
    ],
  } as any
  const post = {
    _id: 'post-video',
    communityId: 'community-1',
    sectionId: 'section-1',
    content: {
      videos: [{
        itemId: 'video-long',
        source: 'cos',
        title: '家风',
        fileID: 'cloud://env/posts/videos/long.mp4',
        duration: 3600,
      }],
    },
  } as any

  const jobs = planVideoRagAnalysisJobsForPost(post, section, {
    policy: {
      analysisEnabled: true,
      maxJobsPerPost: 1,
      maxCostUnitsPerPost: 8,
      maxFramesPerVideo: 0,
      maxAsrSecondsPerVideo: 120,
      minMetadataTextCharsForAnalysis: 24,
    },
  })

  expect(jobs).toEqual([])
})

test('readVideoRagCostPolicyFromEnv allows explicit one-hour ASR analysis budget', () => {
  const policy = readVideoRagCostPolicyFromEnv({
    POST_VIDEO_RAG_ANALYSIS_ENABLED: 'true',
    POST_VIDEO_RAG_MAX_JOBS_PER_POST: '1',
    POST_VIDEO_RAG_MAX_COST_UNITS_PER_POST: '120',
    POST_VIDEO_RAG_MAX_FRAMES_PER_VIDEO: '0',
    POST_VIDEO_RAG_MAX_ASR_SECONDS_PER_VIDEO: '3600',
  } as NodeJS.ProcessEnv)

  expect(policy).toEqual(expect.objectContaining({
    analysisEnabled: true,
    maxJobsPerPost: 1,
    maxCostUnitsPerPost: 120,
    maxFramesPerVideo: 0,
    maxAsrSecondsPerVideo: 3600,
  }))
})

test('processPostVideoRagJobBatch caches analyzer output and requeues post RAG indexing', async () => {
  const analyzer = {
    name: 'fake-video-analyzer',
    isConfigured: jest.fn(() => true),
    analyze: jest.fn(async () => ({
      visualSummary: '关键帧显示家训课程。',
      ocrText: '一粥一饭，当思来处不易。',
      asrTranscript: '老师讲到半丝半缕，恒念物力维艰。',
      frameSummaries: [
        { timeMs: 5000, summary: '画面出现节俭家风板书。', ocrText: '勤俭持家' },
      ],
    })),
  }
  mockDb.query.mockResolvedValueOnce([
    {
      _id: 'video-job-1',
      postId: 'post-video',
      communityId: 'community-1',
      sectionId: 'section-1',
      cacheKey: 'vrk-video-1',
      status: 'pending',
      attempts: 0,
      requestedAnalyses: ['cover_ocr', 'keyframe_vision', 'asr'],
      frameStrategy: { includeCover: true, maxFrames: 4, minSceneGapSeconds: 10 },
      maxAsrSeconds: 120,
      estimatedCostUnits: 8,
      video: {
        itemId: 'video-1',
        source: 'cos',
        title: '家风',
        fileID: 'cloud://env/posts/videos/family-video.mp4',
        duration: 96,
      },
    },
  ])
  mockDb.updateById.mockImplementation(async (collectionName: string) => {
    if (collectionName === POST_VIDEO_RAG_ASSETS) throw new Error('asset missing')
    return { stats: { updated: 1 } }
  })
  mockDb.create.mockResolvedValue('created')

  const result = await processPostVideoRagJobBatch({
    analyzer,
    limit: 1,
    policy: {
      analysisEnabled: true,
      maxJobsPerPost: 1,
      maxCostUnitsPerPost: 8,
      maxFramesPerVideo: 4,
      maxAsrSecondsPerVideo: 120,
      minMetadataTextCharsForAnalysis: 48,
    },
  })

  expect(result).toEqual({
    scannedCount: 1,
    results: [{ jobId: 'video-job-1', ok: true }],
  })
  expect(analyzer.analyze).toHaveBeenCalledWith(expect.objectContaining({
    cacheKey: 'vrk-video-1',
    video: expect.objectContaining({ title: '家风' }),
  }))
  expect(mockDb.create).toHaveBeenCalledWith(POST_VIDEO_RAG_ASSETS, expect.objectContaining({
    _id: 'vrk-video-1',
    cacheKey: 'vrk-video-1',
    status: 'ready',
    visualSummary: '关键帧显示家训课程。',
    ocrText: '一粥一饭，当思来处不易。',
    asrTranscript: '老师讲到半丝半缕，恒念物力维艰。',
    provider: 'fake-video-analyzer',
  }))
  expect(mockDb.updateById).toHaveBeenCalledWith(POST_VIDEO_RAG_JOBS, 'video-job-1', expect.objectContaining({
    status: 'completed',
  }))
  expect(mockDb.create).toHaveBeenCalledWith(POST_RAG_JOBS, expect.objectContaining({
    postId: 'post-video',
    communityId: 'community-1',
    sectionId: 'section-1',
    action: 'upsert',
    reason: 'rag.video.analysis.ready',
    status: 'pending',
  }))
})

test('processPostVideoRagJobBatch rejects legacy ASR jobs without duration before calling analyzer', async () => {
  const analyzer = {
    name: 'fake-asr-analyzer',
    isConfigured: jest.fn(() => true),
    analyze: jest.fn(),
  }
  mockDb.query.mockResolvedValue([
    {
      _id: 'video-job-legacy',
      postId: 'post-video',
      communityId: 'community-1',
      sectionId: 'section-1',
      cacheKey: 'vrk-video-legacy',
      status: 'pending',
      attempts: 0,
      requestedAnalyses: ['asr'],
      frameStrategy: { includeCover: false, maxFrames: 0, minSceneGapSeconds: 10 },
      maxAsrSeconds: 3600,
      estimatedCostUnits: 120,
      video: {
        itemId: 'video-legacy',
        source: 'cos',
        title: '未知时长视频',
        fileID: 'cloud://env/posts/videos/legacy.mp4',
        duration: 0,
      },
    },
  ])
  mockDb.updateById.mockResolvedValue({ stats: { updated: 1 } })

  const result = await processPostVideoRagJobBatch({
    analyzer,
    limit: 1,
    policy: {
      analysisEnabled: true,
      maxJobsPerPost: 1,
      maxCostUnitsPerPost: 120,
      maxFramesPerVideo: 0,
      maxAsrSecondsPerVideo: 3600,
      minMetadataTextCharsForAnalysis: 48,
    },
  })

  expect(analyzer.analyze).not.toHaveBeenCalled()
  expect(result.results).toEqual([{
    jobId: 'video-job-legacy',
    ok: false,
    error: 'video_rag_asr_duration_unknown',
  }])
  expect(mockDb.updateById).toHaveBeenCalledWith(POST_VIDEO_RAG_JOBS, 'video-job-legacy', expect.objectContaining({
    status: 'failed',
    errorMessage: 'video_rag_asr_duration_unknown',
  }))
})

test('processPostVideoRagJobBatch keeps async ASR jobs processing without reindexing too early', async () => {
  const analyzer = {
    name: 'fake-asr-analyzer',
    isConfigured: jest.fn(() => true),
    analyze: jest.fn(async () => ({
      pending: true as const,
      providerTaskId: '123456',
      providerStatus: 'processing',
    })),
  }
  mockDb.query
    .mockResolvedValueOnce([
      {
        _id: 'video-job-1',
        postId: 'post-video',
        communityId: 'community-1',
        sectionId: 'section-1',
        cacheKey: 'vrk-video-1',
        status: 'pending',
        attempts: 0,
        requestedAnalyses: ['asr'],
        frameStrategy: { includeCover: false, maxFrames: 0, minSceneGapSeconds: 10 },
        maxAsrSeconds: 3600,
        estimatedCostUnits: 120,
        video: {
          itemId: 'video-1',
          source: 'cos',
          title: '家风课',
          fileID: 'cloud://env/posts/videos/family-video.mp4',
          duration: 3600,
        },
      },
    ])
    .mockResolvedValueOnce([])
  mockDb.updateById.mockResolvedValue({ stats: { updated: 1 } })
  mockDb.create.mockResolvedValue('created')

  const result = await processPostVideoRagJobBatch({
    analyzer,
    limit: 1,
    policy: {
      analysisEnabled: true,
      maxJobsPerPost: 1,
      maxCostUnitsPerPost: 120,
      maxFramesPerVideo: 0,
      maxAsrSecondsPerVideo: 3600,
      minMetadataTextCharsForAnalysis: 48,
    },
  })

  expect(result.results).toEqual([{ jobId: 'video-job-1', ok: true, pending: true }])
  expect(mockDb.updateById).toHaveBeenCalledWith(POST_VIDEO_RAG_JOBS, 'video-job-1', expect.objectContaining({
    status: 'processing',
    providerTaskId: '123456',
    providerStatus: 'processing',
  }))
  expect(mockDb.create).not.toHaveBeenCalledWith(POST_RAG_JOBS, expect.anything())
})

test('processPostVideoRagJobBatch polls processing ASR jobs and indexes completed transcript', async () => {
  const analyzer = {
    name: 'fake-asr-analyzer',
    isConfigured: jest.fn(() => true),
    analyze: jest.fn(async () => ({
      asrTranscript: '老师讲到勤俭持家，也讲一粥一饭，当思来处不易。',
      visualSummary: '',
      ocrText: '',
      frameSummaries: [],
    })),
  }
  mockDb.query
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      {
        _id: 'video-job-1',
        postId: 'post-video',
        communityId: 'community-1',
        sectionId: 'section-1',
        cacheKey: 'vrk-video-1',
        status: 'processing',
        attempts: 0,
        requestedAnalyses: ['asr'],
        frameStrategy: { includeCover: false, maxFrames: 0, minSceneGapSeconds: 10 },
        maxAsrSeconds: 3600,
        estimatedCostUnits: 120,
        providerTaskId: '123456',
        providerStatus: 'created',
        video: {
          itemId: 'video-1',
          source: 'cos',
          title: '家风课',
          fileID: 'cloud://env/posts/videos/family-video.mp4',
        },
      },
    ])
  mockDb.updateById.mockImplementation(async (collectionName: string) => {
    if (collectionName === POST_VIDEO_RAG_ASSETS) throw new Error('asset missing')
    return { stats: { updated: 1 } }
  })
  mockDb.create.mockResolvedValue('created')

  const result = await processPostVideoRagJobBatch({ analyzer, limit: 1 })

  expect(result.results).toEqual([{ jobId: 'video-job-1', ok: true }])
  expect(analyzer.analyze).toHaveBeenCalledWith(expect.objectContaining({
    status: 'processing',
    providerTaskId: '123456',
  }))
  expect(mockDb.create).toHaveBeenCalledWith(POST_VIDEO_RAG_ASSETS, expect.objectContaining({
    _id: 'vrk-video-1',
    status: 'ready',
    asrTranscript: '老师讲到勤俭持家，也讲一粥一饭，当思来处不易。',
    provider: 'fake-asr-analyzer',
  }))
  expect(mockDb.updateById).toHaveBeenCalledWith(POST_VIDEO_RAG_JOBS, 'video-job-1', expect.objectContaining({
    status: 'completed',
  }))
  expect(mockDb.create).toHaveBeenCalledWith(POST_RAG_JOBS, expect.objectContaining({
    postId: 'post-video',
    action: 'upsert',
    reason: 'rag.video.analysis.ready',
  }))
})
