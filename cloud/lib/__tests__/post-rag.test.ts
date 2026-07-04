const mockDb = {
  count: jest.fn(),
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
  createTencentRagProvider,
  createTencentRagProviderFromEnv,
  createVideoRagAnalyzerFromEnv,
  enqueuePostRagJob,
  getPostRagIndexHealthForCommunity,
  hasRagEvidenceSignal,
  rankLkeapEvidenceCitations,
  selectLkeapCandidateCitations,
  POST_RAG_CHUNKS,
  POST_RAG_INDEX_STATE,
  POST_RAG_JOBS,
  POST_VIDEO_RAG_ASSETS,
  POST_VIDEO_RAG_JOBS,
  processPostRagJobBatch,
  processPostVideoRagJobBatch,
  readTencentLkeapRagConfigFromEnv,
  readVideoRagCostPolicyFromEnv,
  reconcilePostRagJobsForCommunityBatch,
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
    '勤儉',
    '节约',
    '家风',
    '家風',
    '家训',
    '朱子治家格言',
    '一粥一饭',
    '一粥一飯',
    '半丝半缕',
    '半絲半縷',
    '物力维艰',
    '物力維艱',
  ]))
  expect(query.expandedText).toContain('一粥一饭')
  expect(query.expandedText).toContain('一粥一飯')
  expect(query.expandedText).toContain('半丝半缕')
  expect(query.expandedText).toContain('半絲半縷')
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
    ensureIndex: jest.fn().mockResolvedValue({ created: false, indexName: 'test-index' }),
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
  expect(provider.ensureIndex).toHaveBeenCalledTimes(1)
  expect(provider.ensureIndex.mock.invocationCallOrder[0]).toBeLessThan(provider.upsertChunks.mock.invocationCallOrder[0])
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
    ensureIndex: jest.fn().mockResolvedValue({ created: false, indexName: 'test-index' }),
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
    ensureIndex: jest.fn().mockResolvedValue({ created: false, indexName: 'test-index' }),
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

test('processPostRagJobBatch treats missing posts as removed instead of failing stale upserts', async () => {
  const provider = {
    name: 'fake-rag',
    isConfigured: jest.fn(() => true),
    search: jest.fn(),
    upsertChunks: jest.fn(),
    deletePostChunks: jest.fn().mockResolvedValue(undefined),
  }
  mockDb.query.mockResolvedValue([
    {
      _id: 'job-stale-upsert',
      postId: 'post-gone',
      communityId: 'community-1',
      sectionId: 'section-1',
      action: 'upsert',
      attempts: 0,
    },
  ])
  mockDb.getById.mockRejectedValue(new Error('document.get:fail document with _id post-gone does not exist'))
  mockDb.updateById.mockResolvedValue({ stats: { updated: 1 } })

  const result = await processPostRagJobBatch({ provider, limit: 1 })

  expect(result.results).toEqual([{ jobId: 'job-stale-upsert', ok: true }])
  expect(provider.deletePostChunks).toHaveBeenCalledWith('post-gone')
  expect(provider.upsertChunks).not.toHaveBeenCalled()
  expect(mockDb.updateById).toHaveBeenCalledWith(POST_RAG_INDEX_STATE, 'post-gone', expect.objectContaining({
    status: 'removed',
    communityId: 'community-1',
    sectionId: 'section-1',
  }))
  expect(mockDb.updateById).toHaveBeenCalledWith(POST_RAG_JOBS, 'job-stale-upsert', expect.objectContaining({
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

test('reconcilePostRagJobsForCommunityBatch queues only missing stale and removable index jobs', async () => {
  mockDb.query.mockResolvedValueOnce([
    {
      _id: 'post-missing-state',
      communityId: 'community-1',
      sectionId: 'section-1',
      status: 'active',
      auditStatus: 'pass',
      updatedAt: '2026-07-04T10:00:00.000Z',
      createdAt: '2026-07-04T09:00:00.000Z',
    },
    {
      _id: 'post-fresh',
      communityId: 'community-1',
      sectionId: 'section-1',
      status: 'active',
      auditStatus: 'pass',
      updatedAt: '2026-07-04T08:00:00.000Z',
      createdAt: '2026-07-04T07:00:00.000Z',
    },
    {
      _id: 'post-stale',
      communityId: 'community-1',
      sectionId: 'section-1',
      status: 'active',
      auditStatus: 'pass',
      updatedAt: '2026-07-04T06:00:00.000Z',
      createdAt: '2026-07-04T05:00:00.000Z',
    },
    {
      _id: 'post-deleted',
      communityId: 'community-1',
      sectionId: 'section-1',
      status: 'deleted',
      auditStatus: 'pass',
      updatedAt: '2026-07-04T04:00:00.000Z',
      createdAt: '2026-07-04T03:00:00.000Z',
    },
  ])
  mockDb.getById
    .mockRejectedValueOnce(new Error('document.get:fail document does not exist'))
    .mockResolvedValueOnce({
      _id: 'post-fresh',
      postId: 'post-fresh',
      status: 'indexed',
      sourceUpdatedAt: '2026-07-04T08:00:00.000Z',
      chunkCount: 3,
    })
    .mockResolvedValueOnce({
      _id: 'post-stale',
      postId: 'post-stale',
      status: 'indexed',
      sourceUpdatedAt: '2026-07-03T06:00:00.000Z',
      chunkCount: 3,
    })
    .mockResolvedValueOnce({
      _id: 'post-deleted',
      postId: 'post-deleted',
      status: 'indexed',
      sourceUpdatedAt: '2026-07-04T04:00:00.000Z',
      chunkCount: 2,
    })
  mockDb.create.mockResolvedValue('job-id')

  const result = await reconcilePostRagJobsForCommunityBatch('community-1', { skip: 0, limit: 4 })

  expect(result).toMatchObject({
    communityId: 'community-1',
    scannedCount: 4,
    upsertQueuedCount: 2,
    deleteQueuedCount: 1,
    skippedCount: 1,
    missingStateCount: 1,
    staleStateCount: 1,
    removableStateCount: 1,
    failedCount: 0,
    hasMore: true,
    nextSkip: 4,
  })
  expect(mockDb.query).toHaveBeenCalledWith('posts', { communityId: 'community-1' }, {
    orderBy: ['updatedAt', 'desc'],
    skip: 0,
    limit: 4,
  })
  expect(mockDb.create).toHaveBeenCalledWith(POST_RAG_JOBS, expect.objectContaining({
    postId: 'post-missing-state',
    action: 'upsert',
    reason: 'rag.reconcile.missing_state',
  }))
  expect(mockDb.create).toHaveBeenCalledWith(POST_RAG_JOBS, expect.objectContaining({
    postId: 'post-stale',
    action: 'upsert',
    reason: 'rag.reconcile.stale_state',
  }))
  expect(mockDb.create).toHaveBeenCalledWith(POST_RAG_JOBS, expect.objectContaining({
    postId: 'post-deleted',
    action: 'delete',
    reason: 'rag.reconcile.removed_source',
  }))
  expect(mockDb.create).toHaveBeenCalledTimes(3)
})

test('getPostRagIndexHealthForCommunity exposes source coverage and job backlog counts', async () => {
  mockDb.count
    .mockResolvedValueOnce(6)
    .mockResolvedValueOnce(4)
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce(2)
    .mockResolvedValueOnce(1)

  const result = await getPostRagIndexHealthForCommunity('community-1')

  expect(result).toEqual({
    communityId: 'community-1',
    activePostCount: 6,
    indexedStateCount: 4,
    removedStateCount: 1,
    failedStateCount: 1,
    pendingJobCount: 2,
    failedJobCount: 1,
    potentialMissingActiveCount: 2,
    coverageRatio: 4 / 6,
  })
  expect(mockDb.count).toHaveBeenNthCalledWith(1, 'posts', {
    communityId: 'community-1',
    status: 'active',
  })
  expect(mockDb.count).toHaveBeenNthCalledWith(2, POST_RAG_INDEX_STATE, {
    communityId: 'community-1',
    status: 'indexed',
  })
  expect(mockDb.count).toHaveBeenNthCalledWith(5, POST_RAG_JOBS, {
    communityId: 'community-1',
    status: 'pending',
  })
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
  expect(hasRagEvidenceSignal({ semanticScore: 0.2, lexicalScore: 0, rerankScore: 0.1 })).toBe(false)
  expect(hasRagEvidenceSignal({ semanticScore: 0.2, lexicalScore: 0, rerankScore: 0.55 })).toBe(true)
  expect(hasRagEvidenceSignal({ semanticScore: 0.5, lexicalScore: 0, rerankScore: 0.1 })).toBe(false)
  expect(hasRagEvidenceSignal({ semanticScore: 0.5, lexicalScore: 0, rerankScore: -3 })).toBe(false)
  expect(hasRagEvidenceSignal({ semanticScore: 0.5, lexicalScore: 0 })).toBe(true)
})

test('selectLkeapCandidateCitations keeps lexical evidence even when semantic candidates are ahead', () => {
  const semanticOnly = Array.from({ length: 20 }, (_, index) => ({
    postId: `semantic-${index}`,
    chunkId: `semantic-chunk-${index}`,
    communityId: 'community-1',
    title: `semantic ${index}`,
    fieldLabel: '正文',
    fieldType: 'rich_note',
    preview: '普通内容',
    score: 0.9 - index * 0.01,
    semanticScore: 0.9 - index * 0.01,
    lexicalScore: 0,
  }))
  const lexicalEvidence = {
    postId: 'thrift-post',
    chunkId: 'thrift-chunk',
    communityId: 'community-1',
    title: '第50次明士课程资料',
    fieldLabel: '图文资料',
    fieldType: 'rich_note',
    preview: '一粥一飯，當思來處不易；半絲半縷，恆念物力維艱。',
    score: 0.2,
    semanticScore: 0.2,
    lexicalScore: 3,
  }

  const selected = selectLkeapCandidateCitations([...semanticOnly, lexicalEvidence], 5)

  expect(selected.some((citation) => citation.chunkId === 'thrift-chunk')).toBe(true)
})

test('rankLkeapEvidenceCitations drops negative rerank noise and keeps lexical evidence first', () => {
  const ranked = rankLkeapEvidenceCitations([
    {
      postId: 'noise-post',
      chunkId: 'noise-chunk',
      communityId: 'community-1',
      title: 'tst',
      fieldLabel: '标题',
      fieldType: 'short_text',
      preview: 'tst',
      score: -1,
      semanticScore: 0.55,
      lexicalScore: 0,
      rerankScore: -4.9,
    },
    {
      postId: 'thrift-post',
      chunkId: 'thrift-chunk',
      communityId: 'community-1',
      title: '第50次明士课程资料',
      fieldLabel: '图文资料',
      fieldType: 'rich_note',
      preview: '一粥一飯，當思來處不易；半絲半縷，恆念物力維艱。',
      score: -3,
      semanticScore: 0.2,
      lexicalScore: 3,
      rerankScore: -5.5,
    },
  ], 5)

  expect(ranked.map((citation) => citation.chunkId)).toEqual(['thrift-chunk'])
})

test('createTencentRagProviderFromEnv selects LKEAP provider when configured', () => {
  const previousEnv = { ...process.env }
  try {
    process.env.TENCENT_RAG_PROVIDER = 'lkeap-cloudbase'
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

test('createTencentRagProviderFromEnv ignores legacy lkeap flag and keeps ES as formal RAG provider', () => {
  const previousEnv = { ...process.env }
  try {
    process.env.TENCENT_RAG_PROVIDER = 'lkeap'
    process.env.TENCENT_RAG_ES_ENDPOINT = 'https://es.example.com'
    process.env.TENCENT_RAG_ES_USERNAME = 'elastic'
    process.env.TENCENT_RAG_ES_PASSWORD = 'secret-test'
    process.env.TENCENT_RAG_INDEX_NAME = 'happyhome_post_rag_chunks'
    process.env.TENCENT_RAG_EMBEDDING_INFERENCE_ID = 'embedding-endpoint'
    process.env.TENCENT_RAG_RERANK_INFERENCE_ID = 'rerank-endpoint'
    process.env.TENCENT_RAG_LLM_INFERENCE_ID = 'llm-endpoint'

    const provider = createTencentRagProviderFromEnv()

    expect(provider.name).toBe('tencent-es-ai-search')
    expect(provider.isConfigured()).toBe(true)
  } finally {
    process.env = previousEnv
  }
})

test('Tencent ES provider uses rank_fusion hybrid retrieval and filters weak evidence before LLM answer', async () => {
  const calls: Array<{ method: string; path: string; body: any }> = []
  const requestJson = jest.fn(async (_config: any, method: string, path: string, body?: any) => {
    calls.push({ method, path, body })
    if (path.startsWith('_inference/text_embedding/')) {
      return { embedding: [{ result: [0.11, 0.22, 0.33] }] }
    }
    if (path.endsWith('/_search')) {
      return {
        hits: {
          total: { value: 2 },
          hits: [
            {
              _id: 'thrift-chunk',
              _score: 12,
              _source: {
                postId: 'thrift-post',
                chunkId: 'thrift-chunk',
                communityId: 'community-1',
                sectionId: 'section-1',
                sectionName: '明士班',
                title: '第50次明士课程资料',
                fieldLabel: '图文资料',
                fieldType: 'rich_note',
                preview: '一粥一饭，当思来处不易；半丝半缕，恒念物力维艰。',
                text: '一粥一饭，当思来处不易；半丝半缕，恒念物力维艰。',
                visibility: 'public',
                sourceUpdatedAt: '2026-06-25T00:00:00.000Z',
              },
            },
            {
              _id: 'noise-chunk',
              _score: 9,
              _source: {
                postId: 'noise-post',
                chunkId: 'noise-chunk',
                communityId: 'community-1',
                sectionId: 'section-1',
                sectionName: '明士班',
                title: '实木书桌 + 椅子',
                fieldLabel: '标题',
                fieldType: 'title',
                preview: '实木书桌 + 椅子',
                text: '实木书桌 + 椅子',
                visibility: 'public',
                sourceUpdatedAt: '2026-06-25T00:00:00.000Z',
              },
            },
          ],
        },
      }
    }
    if (path.startsWith('_inference/rerank/')) {
      return {
        rerank: [
          { index: 0, relevance_score: 0.87 },
          { index: 1, relevance_score: -2.4 },
        ],
      }
    }
    if (path.startsWith('_inference/completion/')) {
      return { completion: [{ result: '有，最相关的是《第50次明士课程资料》。' }] }
    }
    throw new Error(`unexpected request path: ${path}`)
  })
  const provider = createTencentRagProvider({
    endpoint: 'https://es.example.com',
    username: 'elastic',
    password: 'secret-test',
    indexName: 'happyhome_post_rag_chunks',
    vectorField: 'embedding',
    embeddingInferenceId: 'embedding-endpoint',
    rerankInferenceId: 'rerank-endpoint',
    llmInferenceId: 'llm-endpoint',
  }, { requestJson: requestJson as any })

  const result = await provider.search({
    communityId: 'community-1',
    sectionId: '',
    query: '勤俭持家',
    skip: 0,
    limit: 10,
    includeMemberOnly: false,
    ragQuery: buildRagQuery('勤俭持家'),
  })

  const searchCall = calls.find((call) => call.path.endsWith('/_search'))
  expect(searchCall?.body.query).toBeUndefined()
  expect(searchCall?.body.knn).toBeUndefined()
  expect(searchCall?.body.retriever.rank_fusion.retrievers).toEqual(expect.arrayContaining([
    expect.objectContaining({ standard: expect.any(Object) }),
    expect.objectContaining({ knn: expect.objectContaining({ field: 'embedding' }) }),
  ]))
  expect(searchCall?.body.retriever.rank_fusion.retrievers[0].standard.query.bool.filter).toEqual(expect.arrayContaining([
    { term: { communityId: 'community-1' } },
    { term: { visibility: 'public' } },
  ]))
  expect(result.citations.map((citation) => citation.chunkId)).toEqual(['thrift-chunk'])
  expect(result.items.map((item) => item.postId)).toEqual(['thrift-post'])
  expect(result.answer).toContain('第50次明士课程资料')
  expect(requestJson).toHaveBeenCalledWith(
    expect.any(Object),
    'POST',
    expect.stringContaining('_inference/completion/'),
    expect.any(Object),
  )
})

test('Tencent ES provider can use Tencent atomic APIs for embedding rerank and answer without ES inference endpoints', async () => {
  const esCalls: Array<{ method: string; path: string; body: any }> = []
  const atomicCalls: Array<{ action: string; body: any }> = []
  const requestJson = jest.fn(async (_config: any, method: string, path: string, body?: any) => {
    esCalls.push({ method, path, body })
    if (path.endsWith('/_search')) {
      return {
        hits: {
          total: { value: 1 },
          hits: [{
            _id: 'atomic-thrift-chunk',
            _score: 10,
            _source: {
              postId: 'atomic-thrift-post',
              chunkId: 'atomic-thrift-chunk',
              communityId: 'community-1',
              sectionId: 'section-1',
              sectionName: '明士班',
              title: '朱子治家格言共读',
              fieldLabel: '正文',
              fieldType: 'rich_note',
              preview: '一粥一饭，当思来处不易；半丝半缕，恒念物力维艰。',
              text: '一粥一饭，当思来处不易；半丝半缕，恒念物力维艰。',
              visibility: 'public',
              sourceUpdatedAt: '2026-06-25T00:00:00.000Z',
            },
          }],
        },
      }
    }
    throw new Error(`unexpected ES request path: ${path}`)
  })
  const requestAtomicJson = jest.fn(async (_config: any, action: string, body: any) => {
    atomicCalls.push({ action, body })
    if (action === 'GetTextEmbedding') {
      return { Response: { Data: [{ Embedding: [0.12, 0.23, 0.34] }] } }
    }
    if (action === 'RunRerank') {
      return { Response: { Data: [{ Index: 0, RelevanceScore: 0.93 }] } }
    }
    if (action === 'ChatCompletions') {
      return { Response: { Choices: [{ Message: { Content: '有，相关帖子提到了朱子治家格言中的勤俭家风。' } }] } }
    }
    throw new Error(`unexpected atomic action: ${action}`)
  })
  const provider = createTencentRagProvider({
    endpoint: 'https://es.example.com',
    username: 'elastic',
    password: 'secret-test',
    indexName: 'happyhome_post_rag_chunks',
    vectorField: 'embedding',
    atomicSecretId: 'AKIDtest',
    atomicSecretKey: 'atomic-secret',
    atomicRegion: 'ap-beijing',
    embeddingModel: 'bge-base-zh-v1.5',
    rerankModel: 'bge-reranker-large',
    llmModel: 'deepseek-v3',
  } as any, { requestJson: requestJson as any, requestAtomicJson: requestAtomicJson as any } as any)

  expect(provider.isConfigured()).toBe(true)

  const result = await provider.search({
    communityId: 'community-1',
    sectionId: '',
    query: '有没有讲节俭家风的帖子？',
    skip: 0,
    limit: 10,
    includeMemberOnly: false,
    ragQuery: buildRagQuery('有没有讲节俭家风的帖子？'),
  })

  expect(esCalls[0]?.path).toBe('happyhome_post_rag_chunks/_search')
  expect(esCalls[0]?.body.retriever.rank_fusion.retrievers).toEqual(expect.arrayContaining([
    expect.objectContaining({ standard: expect.any(Object) }),
    expect.objectContaining({ knn: expect.objectContaining({ query_vector: [0.12, 0.23, 0.34] }) }),
  ]))
  expect(atomicCalls.map((call) => call.action)).toEqual(['GetTextEmbedding', 'RunRerank', 'ChatCompletions'])
  expect(atomicCalls[0]?.body).toEqual(expect.objectContaining({
    ModelName: 'bge-base-zh-v1.5',
    Texts: [expect.stringContaining('朱子治家格言')],
  }))
  expect(atomicCalls[1]?.body).toEqual(expect.objectContaining({
    ModelName: 'bge-reranker-large',
    Query: '有没有讲节俭家风的帖子？',
    Documents: ['一粥一饭，当思来处不易；半丝半缕，恒念物力维艰。'],
    ReturnDocuments: false,
  }))
  expect(atomicCalls[2]?.body).toEqual(expect.objectContaining({
    ModelName: 'deepseek-v3',
    Stream: false,
  }))
  expect(result.citations.map((citation) => citation.chunkId)).toEqual(['atomic-thrift-chunk'])
  expect(result.answer).toContain('勤俭家风')
})

test('Tencent ES provider can create the private index mapping from cloud runtime', async () => {
  const requestJson = jest.fn(async (_config: any, method: string, path: string, body?: any) => {
    if (method === 'HEAD' && path === 'happyhome_post_rag_chunks') {
      throw new Error('Tencent RAG request failed: 404 index_not_found_exception')
    }
    if (method === 'PUT' && path === 'happyhome_post_rag_chunks') {
      return { acknowledged: true, body }
    }
    throw new Error(`unexpected ES request: ${method} ${path}`)
  })
  const requestAtomicJson = jest.fn(async (_config: any, action: string) => {
    if (action === 'GetTextEmbedding') {
      return { Response: { Data: [{ Embedding: [0.1, 0.2, 0.3] }] } }
    }
    throw new Error(`unexpected atomic action: ${action}`)
  })
  const provider = createTencentRagProvider({
    endpoint: 'http://10.89.2.4:9200',
    username: 'elastic',
    password: 'secret-test',
    indexName: 'happyhome_post_rag_chunks',
    vectorField: 'embedding',
    atomicSecretId: 'sid',
    atomicSecretKey: 'skey',
    atomicRegion: 'ap-shanghai',
    embeddingModel: 'bge-base-zh-v1.5',
    rerankModel: 'bge-reranker-large',
    llmModel: 'deepseek-v3',
  } as any, { requestJson: requestJson as any, requestAtomicJson: requestAtomicJson as any } as any)

  const result = await provider.ensureIndex?.()

  expect(result).toEqual({
    created: true,
    indexName: 'happyhome_post_rag_chunks',
    dims: 3,
  })
  expect(requestJson).toHaveBeenCalledWith(expect.any(Object), 'PUT', 'happyhome_post_rag_chunks', expect.objectContaining({
    mappings: expect.objectContaining({
      properties: expect.objectContaining({
        chunkId: { type: 'keyword' },
        embedding: expect.objectContaining({
          type: 'dense_vector',
          dims: 3,
          index: true,
          similarity: 'cosine',
        }),
      }),
    }),
  }))
})

test('Tencent ES provider treats delete on a missing index as idempotent cleanup', async () => {
  const requestJson = jest.fn(async (_config: any, method: string, path: string) => {
    if (method === 'POST' && path === 'happyhome_post_rag_chunks/_delete_by_query') {
      throw new Error('Tencent RAG request failed: 404 index_not_found_exception')
    }
    throw new Error(`unexpected ES request: ${method} ${path}`)
  })
  const provider = createTencentRagProvider({
    endpoint: 'http://10.89.2.4:9200',
    username: 'elastic',
    password: 'secret-test',
    indexName: 'happyhome_post_rag_chunks',
    vectorField: 'embedding',
    atomicSecretId: 'sid',
    atomicSecretKey: 'skey',
    atomicRegion: 'ap-shanghai',
    embeddingModel: 'bge-base-zh-v1.5',
    rerankModel: 'bge-reranker-large',
    llmModel: 'deepseek-v3',
  } as any, { requestJson: requestJson as any } as any)

  await expect(provider.deletePostChunks?.('post-deleted-before-index')).resolves.toBeUndefined()

  expect(requestJson).toHaveBeenCalledWith(expect.any(Object), 'POST', 'happyhome_post_rag_chunks/_delete_by_query', {
    query: { term: { postId: 'post-deleted-before-index' } },
  })
})

test('Tencent ES provider reranks a single semantic candidate before evidence filtering', async () => {
  const requestJson = jest.fn(async (_config: any, _method: string, path: string) => {
    if (path.startsWith('_inference/text_embedding/')) {
      return { embedding: [{ result: [0.44, 0.55, 0.66] }] }
    }
    if (path.endsWith('/_search')) {
      return {
        hits: {
          total: { value: 1 },
          hits: [{
            _id: 'semantic-chunk',
            _score: 8,
            _source: {
              postId: 'semantic-post',
              chunkId: 'semantic-chunk',
              communityId: 'community-1',
              sectionId: 'section-1',
              sectionName: '明士班',
              title: '生活札记',
              fieldLabel: '正文',
              fieldType: 'rich_note',
              preview: '每周记账，减少冲动消费，把更多资源留给家庭长期目标。',
              text: '每周记账，减少冲动消费，把更多资源留给家庭长期目标。',
              visibility: 'public',
              sourceUpdatedAt: '2026-06-25T00:00:00.000Z',
            },
          }],
        },
      }
    }
    if (path.startsWith('_inference/rerank/')) {
      return { rerank: [{ index: 0, relevance_score: 0.73 }] }
    }
    if (path.startsWith('_inference/completion/')) {
      return { completion: [{ result: '有，找到一篇关于家庭节制消费的帖子。' }] }
    }
    throw new Error(`unexpected request path: ${path}`)
  })
  const provider = createTencentRagProvider({
    endpoint: 'https://es.example.com',
    username: 'elastic',
    password: 'secret-test',
    indexName: 'happyhome_post_rag_chunks',
    vectorField: 'embedding',
    embeddingInferenceId: 'embedding-endpoint',
    rerankInferenceId: 'rerank-endpoint',
    llmInferenceId: 'llm-endpoint',
  }, { requestJson: requestJson as any })

  const result = await provider.search({
    communityId: 'community-1',
    sectionId: '',
    query: '有没有讲家庭长期节制消费的帖子',
    skip: 0,
    limit: 10,
    includeMemberOnly: false,
    ragQuery: buildRagQuery('有没有讲家庭长期节制消费的帖子'),
  })

  expect(result.citations.map((citation) => citation.chunkId)).toEqual(['semantic-chunk'])
  expect(requestJson).toHaveBeenCalledWith(
    expect.any(Object),
    'POST',
    expect.stringContaining('_inference/rerank/'),
    expect.objectContaining({ input: ['每周记账，减少冲动消费，把更多资源留给家庭长期目标。'] }),
  )
})

test('Tencent ES provider does not answer when rerank leaves only weak noise', async () => {
  const requestJson = jest.fn(async (_config: any, _method: string, path: string) => {
    if (path.startsWith('_inference/text_embedding/')) {
      return { embedding: [{ result: [0.44, 0.55, 0.66] }] }
    }
    if (path.endsWith('/_search')) {
      return {
        hits: {
          total: { value: 1 },
          hits: [{
            _id: 'noise-chunk',
            _score: 8,
            _source: {
              postId: 'noise-post',
              chunkId: 'noise-chunk',
              communityId: 'community-1',
              sectionId: 'section-1',
              sectionName: '明士班',
              title: '实木书桌 + 椅子',
              fieldLabel: '标题',
              fieldType: 'short_text',
              preview: '实木书桌 + 椅子',
              text: '实木书桌 + 椅子',
              visibility: 'public',
              sourceUpdatedAt: '2026-06-25T00:00:00.000Z',
            },
          }],
        },
      }
    }
    if (path.startsWith('_inference/rerank/')) {
      return { rerank: [{ index: 0, relevance_score: 0.1 }] }
    }
    if (path.startsWith('_inference/completion/')) {
      throw new Error('LLM must not be called for weak evidence')
    }
    throw new Error(`unexpected request path: ${path}`)
  })
  const provider = createTencentRagProvider({
    endpoint: 'https://es.example.com',
    username: 'elastic',
    password: 'secret-test',
    indexName: 'happyhome_post_rag_chunks',
    vectorField: 'embedding',
    embeddingInferenceId: 'embedding-endpoint',
    rerankInferenceId: 'rerank-endpoint',
    llmInferenceId: 'llm-endpoint',
  }, { requestJson: requestJson as any })

  const result = await provider.search({
    communityId: 'community-1',
    sectionId: '',
    query: '勤俭持家',
    skip: 0,
    limit: 10,
    includeMemberOnly: false,
    ragQuery: buildRagQuery('勤俭持家'),
  })

  expect(result.citations).toEqual([])
  expect(result.items).toEqual([])
  expect(result.answer).toBe('')
  expect(requestJson).not.toHaveBeenCalledWith(
    expect.any(Object),
    'POST',
    expect.stringContaining('_inference/completion/'),
    expect.any(Object),
  )
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
