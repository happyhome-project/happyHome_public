import type { Post, Section } from '../../shared/types'

const post: Post = {
  _id: 'post-upsert',
  communityId: 'community-1',
  sectionId: 'section-1',
  authorId: 'author-1',
  status: 'active',
  auditStatus: 'pass',
  content: {
    title: '鲲鹏',
  },
  commentCount: 0,
  likeCount: 0,
  createdAt: '2026-06-24T08:00:00.000Z',
  updatedAt: '2026-06-24T08:00:00.000Z',
}

const section: Section = {
  _id: 'section-1',
  communityId: 'community-1',
  name: '视频课',
  icon: 'play',
  order: 1,
  enableComment: true,
  enableLike: true,
  createdAt: '2026-06-24T00:00:00.000Z',
  type: 'evergreen',
  status: 'active',
  widgets: [
    {
      widgetId: 'title',
      type: 'short_text',
      label: '标题',
      fieldKey: 'title',
      required: true,
      order: 0,
      showInList: true,
    },
  ],
}

test('indexPostForSearch creates derived rows when updateById reports zero updated rows', async () => {
  jest.resetModules()
  const dbMock = {
    query: jest.fn().mockResolvedValue([]),
    updateById: jest.fn().mockResolvedValue({ stats: { updated: 0 } }),
    create: jest.fn().mockResolvedValue('created'),
    removeById: jest.fn().mockResolvedValue({ stats: { removed: 0 } }),
  }
  jest.doMock('../db', () => dbMock)

  const { indexPostForSearch, POST_SEARCH_DOCUMENTS, POST_SEARCH_TERMS } = await import('../post-search')
  const result = await indexPostForSearch(post, section)

  expect(result.indexed).toBe(true)
  expect(dbMock.create).toHaveBeenCalledWith(
    POST_SEARCH_DOCUMENTS,
    expect.objectContaining({ _id: 'post-upsert', postId: 'post-upsert' }),
  )
  expect(dbMock.create).toHaveBeenCalledWith(
    POST_SEARCH_TERMS,
    expect.objectContaining({ postId: 'post-upsert', term: '鲲鹏' }),
  )
})

test('searchPostIndex surfaces database query failures instead of returning fake empty results', async () => {
  jest.resetModules()
  const dbMock = {
    query: jest.fn().mockRejectedValue(new Error('CloudBase unavailable')),
  }
  jest.doMock('../db', () => dbMock)

  const { searchPostIndex } = await import('../post-search')

  await expect(searchPostIndex({
    communityId: 'community-1',
    query: '鲲鹏',
  })).rejects.toThrow('CloudBase unavailable')
})

test('searchPostIndex retrieves candidate chunks instead of scanning all community documents', async () => {
  jest.resetModules()
  const dbMock = {
    query: jest.fn(async (collectionName: string, where: Record<string, any>) => {
      if (collectionName === 'post_search_terms') {
        return where.term === '鲲鹏'
          ? [{ _id: 'term-1', communityId: 'community-1', sectionId: 'section-1', postId: 'post-1', chunkId: 'chunk-1', term: '鲲鹏' }]
          : []
      }
      if (collectionName === 'post_search_vector_terms') return []
      if (collectionName === 'post_search_documents') {
        throw new Error('document collection should not be scanned')
      }
      return []
    }),
    getById: jest.fn(async (collectionName: string, id: string) => {
      if (collectionName === 'post_search_chunks' && id === 'chunk-1') {
        return {
          _id: 'chunk-1',
          collection: 'post_search_chunks',
          postId: 'post-1',
          communityId: 'community-1',
          sectionId: 'section-1',
          sectionName: '视频课',
          title: '鲲鹏讲座',
          fieldKey: 'videos',
          fieldLabel: '视频',
          fieldType: 'video_group',
          chunkIndex: 0,
          text: '鲲鹏',
          preview: '鲲鹏',
          searchText: '鲲鹏',
          compactText: '鲲鹏',
          terms: ['鲲鹏'],
          sparseVector: [{ term: '鲲鹏', weight: 1 }],
          createdAt: '2026-06-24T08:00:00.000Z',
          updatedAt: '2026-06-24T08:00:00.000Z',
          sourceUpdatedAt: '2026-06-24T08:00:00.000Z',
        }
      }
      if (collectionName === 'post_search_documents' && id === 'post-1') {
        return {
          _id: 'post-1',
          postId: 'post-1',
          communityId: 'community-1',
          sectionId: 'section-1',
          sectionName: '视频课',
          title: '鲲鹏讲座',
          fields: [],
          searchText: '鲲鹏讲座 鲲鹏',
          compactText: '鲲鹏讲座鲲鹏',
          terms: ['鲲鹏'],
          chunkCount: 1,
          createdAt: '2026-06-24T08:00:00.000Z',
          updatedAt: '2026-06-24T08:00:00.000Z',
          sourceUpdatedAt: '2026-06-24T08:00:00.000Z',
        }
      }
      throw new Error(`unexpected getById ${collectionName}/${id}`)
    }),
  }
  jest.doMock('../db', () => dbMock)

  const { searchPostIndex } = await import('../post-search')
  const result = await searchPostIndex({ communityId: 'community-1', query: '鲲鹏' })

  expect(result.items).toEqual([
    expect.objectContaining({
      postId: 'post-1',
      title: '鲲鹏讲座',
      matchedFields: [
        expect.objectContaining({
          fieldLabel: '视频',
          preview: '鲲鹏',
        }),
      ],
    }),
  ])
  expect(dbMock.query).not.toHaveBeenCalledWith(
    'post_search_documents',
    expect.anything(),
    expect.anything(),
  )
})
