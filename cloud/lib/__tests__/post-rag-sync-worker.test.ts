const mockDb = {
  create: jest.fn(),
  getById: jest.fn(),
  getByIdOrNull: jest.fn(),
  query: jest.fn(),
  removeById: jest.fn(),
  updateById: jest.fn(),
}
jest.mock('../db', () => mockDb)

const mockRefreshPostSearchIndexById = jest.fn()
jest.mock('../post-search', () => ({
  refreshPostSearchIndexById: (...args: any[]) => mockRefreshPostSearchIndexById(...args),
}))

const mockComplete = jest.fn()
const mockFail = jest.fn()
jest.mock('../post-rag-sync', () => ({
  completePostRagSync: (...args: any[]) => mockComplete(...args),
  failPostRagSync: (...args: any[]) => mockFail(...args),
  claimPostRagSync: jest.fn(),
  listPostRagSyncCandidates: jest.fn(),
}))

const mockBuild = jest.fn()
const mockUpsertState = jest.fn()
jest.mock('../post-rag', () => ({
  POST_RAG_INDEX_STATE: 'post_rag_index_state',
  POST_RAG_WORKER_STATE: 'post_rag_worker_state',
  buildCurrentPostRagChunks: (...args: any[]) => mockBuild(...args),
  createTencentRagProviderFromEnv: jest.fn(),
  enqueueVideoRagAnalysisJobs: jest.fn(async () => ({ queuedCount: 0, skippedCount: 0 })),
  planVideoRagAnalysisJobsForPost: jest.fn(() => []),
  readVideoRagCostPolicyFromEnv: jest.fn(() => ({ analysisEnabled: false })),
  upsertPostRagIndexState: (...args: any[]) => mockUpsertState(...args),
}))

import { processClaimedPostRagSync } from '../post-rag-sync-worker'
import type { RefreshPostSearchIndexOptions } from '../post-search'

const claim = {
  _id: 'post-1', schemaVersion: 1 as const, postId: 'post-1', communityId: 'community-1', sectionId: 'section-1',
  desiredRevision: 1, status: 'processing' as const, attempts: 0, reason: 'post.updated',
  requestedAt: '2026-07-19T00:00:00.000Z', nextAttemptAt: '2026-07-19T00:00:00.000Z',
  leaseOwner: 'worker-1', leaseToken: 'lease-1', leaseExpiresAt: '2026-07-19T00:05:00.000Z',
  appliedSourceVersion: null, indexScope: null, lastErrorCode: null,
  createdAt: '2026-07-19T00:00:00.000Z', updatedAt: '2026-07-19T00:00:00.000Z',
}

function provider() {
  return {
    name: 'recording', isConfigured: jest.fn(() => true), search: jest.fn(), ensureIndex: jest.fn(),
    deletePostChunks: jest.fn(), upsertChunks: jest.fn(),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRefreshPostSearchIndexById.mockResolvedValue(undefined)
  mockDb.query.mockResolvedValue([])
  mockDb.updateById.mockResolvedValue({ stats: { updated: 1 } })
  mockComplete.mockResolvedValue({ applied: true })
  mockFail.mockResolvedValue({ applied: true })
})

test('a missing never-indexed post converges without any provider call', async () => {
  mockDb.getByIdOrNull.mockResolvedValue(null)
  const recording = provider()
  const result = await processClaimedPostRagSync(claim, { provider: recording, now: () => '2026-07-19T00:01:00.000Z' })
  expect(result).toMatchObject({ outcome: 'removed', providerCalled: false })
  expect(recording.deletePostChunks).not.toHaveBeenCalled()
  expect(recording.upsertChunks).not.toHaveBeenCalled()
  expect(mockRefreshPostSearchIndexById).toHaveBeenCalledTimes(1)
  expect(mockRefreshPostSearchIndexById).toHaveBeenCalledWith('post-1', { workerDesiredRevision: 1 })
  expect(mockComplete).toHaveBeenCalledWith(expect.objectContaining({ desiredRevision: 1, indexScope: null }))
})

test.each([
  [{ status: 'active' }, 'unclassified'],
  [{ status: 'active', ragIndexPolicy: 'excluded' }, 'excluded'],
  [{ status: 'active', ragIndexPolicy: 'business', fixtureKey: 'fixture' }, 'fixture'],
  [{ status: 'disabled', ragIndexPolicy: 'business' }, 'inactive'],
])('fails closed for %s community state', async (community, _label) => {
  mockDb.getByIdOrNull.mockImplementation(async (collection: string) => {
    if (collection === 'posts') return { _id: 'post-1', communityId: 'community-1', sectionId: 'section-1', status: 'active', auditStatus: 'pass' }
    if (collection === 'communities') return { _id: 'community-1', ...community }
    if (collection === 'sections') return { _id: 'section-1', communityId: 'community-1', status: 'active' }
    return null
  })
  const recording = provider()
  await expect(processClaimedPostRagSync(claim, { provider: recording })).resolves.toMatchObject({ outcome: 'removed' })
  expect(recording.upsertChunks).not.toHaveBeenCalled()
  expect(mockRefreshPostSearchIndexById).toHaveBeenCalledTimes(1)
  expect(mockRefreshPostSearchIndexById).toHaveBeenCalledWith('post-1', { workerDesiredRevision: 1 })
})

test('indexes current approved source with the policy scope and exact source version', async () => {
  const post = { _id: 'post-1', communityId: 'community-1', sectionId: 'section-1', status: 'active', auditStatus: 'pass', content: {}, createdAt: '2026-07-19T00:00:00.000Z', updatedAt: '2026-07-19T00:00:00.000Z' }
  const section = { _id: 'section-1', communityId: 'community-1', status: 'active', widgets: [] }
  mockDb.getByIdOrNull.mockImplementation(async (collection: string) => {
    if (collection === 'posts') return post
    if (collection === 'communities') return { _id: 'community-1', status: 'active', ragIndexPolicy: 'validation' }
    if (collection === 'sections') return section
    return null
  })
  mockBuild.mockResolvedValue({ sourceVersion: 'source-v1', chunks: [{ postId: 'post-1', sourceVersion: 'source-v1', indexScope: 'validation' }], videoRag: null })
  const recording = provider()
  const result = await processClaimedPostRagSync(claim, { provider: recording, now: () => '2026-07-19T00:01:00.000Z' })
  expect(result).toMatchObject({ outcome: 'indexed', chunkCount: 1 })
  expect(mockBuild).toHaveBeenCalledWith(expect.objectContaining({ _id: 'post-1' }), expect.objectContaining({ _id: 'section-1' }), 'validation', expect.any(String))
  expect(recording.deletePostChunks).toHaveBeenCalledWith('post-1')
  expect(recording.upsertChunks).toHaveBeenCalledWith([expect.objectContaining({ sourceVersion: 'source-v1', indexScope: 'validation' })])
  expect(mockUpsertState).toHaveBeenCalledWith('post-1', expect.objectContaining({ sourceVersion: 'source-v1', indexScope: 'validation' }))
  expect(mockRefreshPostSearchIndexById).toHaveBeenCalledTimes(1)
  expect(mockRefreshPostSearchIndexById).toHaveBeenCalledWith('post-1', { workerDesiredRevision: 1 })
  expect(mockComplete).toHaveBeenCalledWith(expect.objectContaining({ sourceVersion: 'source-v1', indexScope: 'validation' }))
})

test('a lexical refresh failure prevents completion and records a bounded retryable failure', async () => {
  const post = { _id: 'post-1', communityId: 'community-1', sectionId: 'section-1', status: 'active', auditStatus: 'pass', content: {}, createdAt: '2026-07-19T00:00:00.000Z', updatedAt: '2026-07-19T00:00:00.000Z' }
  const section = { _id: 'section-1', communityId: 'community-1', status: 'active', widgets: [] }
  mockDb.getByIdOrNull.mockImplementation(async (collection: string) => {
    if (collection === 'posts') return post
    if (collection === 'communities') return { _id: 'community-1', status: 'active', ragIndexPolicy: 'business' }
    if (collection === 'sections') return section
    return null
  })
  mockBuild.mockResolvedValue({ sourceVersion: 'source-v1', chunks: [], videoRag: null })
  mockRefreshPostSearchIndexById.mockRejectedValue(new Error('search backend unavailable'))

  await expect(processClaimedPostRagSync(claim, { provider: provider() })).resolves.toEqual({
    postId: 'post-1', outcome: 'failed', errorCode: 'PROVIDER_FAILED',
  })

  expect(mockRefreshPostSearchIndexById).toHaveBeenCalledWith('post-1', { workerDesiredRevision: 1 })
  expect(mockComplete).not.toHaveBeenCalled()
  expect(mockFail).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'PROVIDER_FAILED', retryable: true }))
  expect(JSON.stringify(mockFail.mock.calls)).not.toContain('search backend unavailable')
})

test('a transient lexical post read fails the worker instead of removing and completing', async () => {
  const post = { _id: 'post-1', communityId: 'community-1', sectionId: 'section-1', status: 'active', auditStatus: 'pass', content: {} }
  let postReads = 0
  mockDb.getByIdOrNull.mockImplementation(async (collection: string) => {
    if (collection === 'posts') {
      postReads += 1
      if (postReads > 1) throw new Error('temporary post read failure')
      return post
    }
    if (collection === 'communities') return { _id: 'community-1', status: 'active', ragIndexPolicy: 'business' }
    if (collection === 'sections') return { _id: 'section-1', communityId: 'community-1', status: 'active', widgets: [] }
    return null
  })
  mockDb.getById.mockRejectedValue(new Error('temporary post read failure'))
  mockRefreshPostSearchIndexById.mockImplementation((postId: string, options: RefreshPostSearchIndexOptions) => (
    jest.requireActual<typeof import('../post-search')>('../post-search').refreshPostSearchIndexById(postId, options)
  ))

  await expect(processClaimedPostRagSync(claim, { provider: provider() })).resolves.toEqual({
    postId: 'post-1', outcome: 'failed', errorCode: 'PROVIDER_FAILED',
  })

  expect(mockComplete).not.toHaveBeenCalled()
  expect(mockFail).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'PROVIDER_FAILED', retryable: true }))
})

test('a transient lexical section read fails the worker instead of removing and completing', async () => {
  const post = { _id: 'post-1', communityId: 'community-1', sectionId: 'section-1', status: 'active', auditStatus: 'pass', content: {} }
  let sectionReads = 0
  mockDb.getByIdOrNull.mockImplementation(async (collection: string) => {
    if (collection === 'posts') return post
    if (collection === 'communities') return { _id: 'community-1', status: 'active', ragIndexPolicy: 'business' }
    if (collection === 'sections') {
      sectionReads += 1
      if (sectionReads > 1) throw new Error('temporary section read failure')
      return { _id: 'section-1', communityId: 'community-1', status: 'active', widgets: [] }
    }
    return null
  })
  mockDb.getById.mockImplementation(async (collection: string) => {
    if (collection === 'posts') return post
    if (collection === 'sections') throw new Error('temporary section read failure')
    return null
  })
  mockRefreshPostSearchIndexById.mockImplementation((postId: string, options: RefreshPostSearchIndexOptions) => (
    jest.requireActual<typeof import('../post-search')>('../post-search').refreshPostSearchIndexById(postId, options)
  ))

  await expect(processClaimedPostRagSync(claim, { provider: provider() })).resolves.toEqual({
    postId: 'post-1', outcome: 'failed', errorCode: 'PROVIDER_FAILED',
  })

  expect(mockComplete).not.toHaveBeenCalled()
  expect(mockFail).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'PROVIDER_FAILED', retryable: true }))
})

test('provider failures are reduced to a bounded code without storing its secret message', async () => {
  const post = { _id: 'post-1', communityId: 'community-1', sectionId: 'section-1', status: 'active', auditStatus: 'pass', content: {}, createdAt: '2026-07-19T00:00:00.000Z', updatedAt: '2026-07-19T00:00:00.000Z' }
  mockDb.getByIdOrNull.mockImplementation(async (collection: string) => collection === 'posts' ? post : collection === 'communities' ? { _id: 'community-1', status: 'active', ragIndexPolicy: 'business' } : collection === 'sections' ? { _id: 'section-1', communityId: 'community-1', status: 'active', widgets: [] } : null)
  mockBuild.mockRejectedValue(new Error('secret credential leaked'))
  const result = await processClaimedPostRagSync(claim, { provider: provider() })
  expect(result).toEqual({ postId: 'post-1', outcome: 'failed', errorCode: 'PROVIDER_FAILED' })
  expect(mockFail).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'PROVIDER_FAILED', retryable: true }))
  expect(JSON.stringify(mockFail.mock.calls)).not.toContain('secret credential leaked')
})

test('a semantic retry reuses the lexical revision marker and a newer claim rebuilds it', async () => {
  const localDb = jest.requireActual<typeof import('../db.local')>('../db.local')
  const actualPostSearch = jest.requireActual<typeof import('../post-search')>('../post-search')
  localDb._resetAll()
  const post = {
    _id: 'post-1', communityId: 'community-1', sectionId: 'section-1', status: 'active', auditStatus: 'pass',
    content: { title: 'lexical revision title' }, createdAt: '2026-07-19T00:00:00.000Z', updatedAt: '2026-07-19T00:00:00.000Z',
  }
  const section = { _id: 'section-1', communityId: 'community-1', status: 'active', widgets: [] }
  await localDb.create('posts', post)
  await localDb.create('communities', { _id: 'community-1', status: 'active', ragIndexPolicy: 'business' })
  await localDb.create('sections', section)
  mockDb.getById.mockImplementation((...args: Parameters<typeof localDb.getById>) => localDb.getById(...args))
  mockDb.getByIdOrNull.mockImplementation((...args: Parameters<typeof localDb.getByIdOrNull>) => localDb.getByIdOrNull(...args))
  mockDb.query.mockImplementation((...args: Parameters<typeof localDb.query>) => localDb.query(...args))
  mockDb.create.mockImplementation((...args: Parameters<typeof localDb.create>) => localDb.create(...args))
  mockDb.updateById.mockImplementation((...args: Parameters<typeof localDb.updateById>) => localDb.updateById(...args))
  mockDb.removeById.mockImplementation((...args: Parameters<typeof localDb.removeById>) => localDb.removeById(...args))
  mockRefreshPostSearchIndexById.mockImplementation((postId: string, options: RefreshPostSearchIndexOptions) => (
    actualPostSearch.refreshPostSearchIndexById(postId, options)
  ))
  mockBuild.mockResolvedValue({ sourceVersion: 'source-v1', chunks: [], videoRag: null })
  const recording = provider()
  recording.upsertChunks.mockRejectedValueOnce(new Error('semantic backend unavailable'))

  await expect(processClaimedPostRagSync(claim, { provider: recording })).resolves.toMatchObject({ outcome: 'failed' })
  const removalsAfterFirstAttempt = mockDb.removeById.mock.calls.length

  await expect(processClaimedPostRagSync({ ...claim, leaseToken: 'lease-2' }, { provider: recording })).resolves.toMatchObject({ outcome: 'indexed' })
  expect(mockDb.removeById).toHaveBeenCalledTimes(removalsAfterFirstAttempt)

  await expect(processClaimedPostRagSync({ ...claim, desiredRevision: 2, leaseToken: 'lease-3' }, { provider: recording })).resolves.toMatchObject({ outcome: 'indexed' })
  expect(mockDb.removeById.mock.calls.length).toBeGreaterThan(removalsAfterFirstAttempt)
  expect(localDb._dump('post_search_index_state')[0]).toMatchObject({ workerLexicalDesiredRevision: 2 })
})
