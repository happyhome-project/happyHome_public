import type { Post, Section } from '../../shared/types'
import {
  _dump,
  _resetAll,
} from '../db.local'
import {
  backfillPostSearchIndexesForCommunity,
  backfillPostSearchIndexesForSection,
  indexPostForSearch,
  refreshPostSearchIndexById,
  removePostSearchIndexesForSection,
  removePostSearchIndex,
  searchPostIndex,
} from '../post-search'
import * as db from '../db.local'

const section: Section = {
  _id: 'section-course',
  communityId: 'community-1',
  name: '明士课堂',
  icon: 'class',
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
    {
      widgetId: 'body',
      type: 'rich_note',
      label: '正文',
      fieldKey: 'body',
      required: false,
      order: 1,
      showInList: false,
    },
    {
      widgetId: 'videos',
      type: 'video_group',
      label: '视频',
      fieldKey: 'videos',
      required: false,
      order: 2,
      showInList: false,
    },
  ],
}

function post(overrides: Partial<Post> = {}): Post {
  return {
    _id: 'post-1',
    communityId: 'community-1',
    sectionId: 'section-course',
    authorId: 'author-1',
    status: 'active',
    auditStatus: 'pass',
    content: {
      title: '明士课堂第一讲',
      body: {
        format: 'markdown',
        markdown: '朱子治家格言：一粥一饭，当思来处不易。',
        html: '',
        text: '朱子治家格言：一粥一饭，当思来处不易。',
        imageFileIDs: [],
        schemaVersion: 1,
      },
      videos: [
        {
          itemId: 'video-1',
          source: 'cos',
          title: '鲲鹏',
          fileID: 'cloud://env/videos/kunpeng.mp4',
        },
      ],
    },
    commentCount: 0,
    likeCount: 0,
    createdAt: '2026-06-24T08:00:00.000Z',
    updatedAt: '2026-06-24T08:00:00.000Z',
    ...overrides,
  } as Post
}

beforeEach(() => {
  _resetAll()
})

test('searchPostIndex returns visible current-community posts with matched field previews', async () => {
  await indexPostForSearch(post(), section)
  await indexPostForSearch(post({
    _id: 'post-pending',
    auditStatus: 'pending',
    content: { title: 'Pending 一粥一饭' },
  } as any), section)
  await indexPostForSearch(post({
    _id: 'post-other-community',
    communityId: 'community-2',
    content: { title: 'Other 鲲鹏' },
  } as any), { ...section, communityId: 'community-2' })

  const phraseResult = await searchPostIndex({
    communityId: 'community-1',
    query: '一粥一饭，当思来处不易',
  })
  expect(phraseResult.total).toBe(1)
  expect(phraseResult.items[0]).toMatchObject({
    postId: 'post-1',
    sectionId: 'section-course',
    sectionName: '明士课堂',
    title: '明士课堂第一讲',
  })
  expect(phraseResult.items[0].matchedFields).toEqual([
    expect.objectContaining({
      fieldLabel: '正文',
      fieldType: 'rich_note',
    }),
  ])

  const videoResult = await searchPostIndex({
    communityId: 'community-1',
    query: '鲲鹏',
  })
  expect(videoResult.items.map((item) => item.postId)).toEqual(['post-1'])
  expect(videoResult.items[0].matchedFields[0]).toMatchObject({
    fieldLabel: '视频',
    fieldType: 'video_group',
  })
})

test('indexPostForSearch writes chunk, vector, and index-state rows for RAG retrieval', async () => {
  const result = await indexPostForSearch(post(), section)

  const chunks = _dump('post_search_chunks')
  const vectorTerms = _dump('post_search_vector_terms')
  const stateRows = _dump('post_search_index_state')

  expect(result).toMatchObject({
    indexed: true,
    postId: 'post-1',
    chunkCount: chunks.length,
  })
  expect(chunks.length).toBeGreaterThanOrEqual(3)
  expect(chunks).toEqual(expect.arrayContaining([
    expect.objectContaining({
      postId: 'post-1',
      fieldLabel: '正文',
      text: expect.stringContaining('一粥一饭'),
    }),
    expect.objectContaining({
      postId: 'post-1',
      fieldLabel: '视频',
      text: '鲲鹏',
    }),
  ]))
  expect(vectorTerms.length).toBeGreaterThan(0)
  expect(vectorTerms[0]).toEqual(expect.objectContaining({
    communityId: 'community-1',
    postId: 'post-1',
    chunkId: expect.any(String),
    term: expect.any(String),
    weight: expect.any(Number),
  }))
  expect(stateRows).toEqual([
    expect.objectContaining({
      _id: 'post-1',
      postId: 'post-1',
      status: 'indexed',
      chunkCount: chunks.length,
      termCount: expect.any(Number),
      vectorTermCount: vectorTerms.length,
    }),
  ])
})

test('removePostSearchIndex removes document and term rows for one post', async () => {
  await indexPostForSearch(post(), section)
  expect(_dump('post_search_documents')).toHaveLength(1)
  expect(_dump('post_search_terms').length).toBeGreaterThan(0)
  expect(_dump('post_search_chunks').length).toBeGreaterThan(0)
  expect(_dump('post_search_vector_terms').length).toBeGreaterThan(0)

  await removePostSearchIndex('post-1')

  expect(_dump('post_search_documents')).toHaveLength(0)
  expect(_dump('post_search_terms')).toHaveLength(0)
  expect(_dump('post_search_chunks')).toHaveLength(0)
  expect(_dump('post_search_vector_terms')).toHaveLength(0)
  expect(_dump('post_search_index_state')).toEqual([
    expect.objectContaining({
      _id: 'post-1',
      postId: 'post-1',
      status: 'removed',
    }),
  ])
})

test('refreshPostSearchIndexById reads current post and section state', async () => {
  await db.create('sections', section)
  await db.create('posts', post())

  const result = await refreshPostSearchIndexById('post-1')

  expect(result.indexed).toBe(true)
  expect(_dump('post_search_documents')[0]).toMatchObject({
    postId: 'post-1',
    sectionName: '明士课堂',
  })
})

test('refreshPostSearchIndexById removes stale index when post is deleted', async () => {
  await indexPostForSearch(post(), section)
  await db.create('sections', section)
  await db.create('posts', post({ status: 'deleted' }))

  const result = await refreshPostSearchIndexById('post-1')

  expect(result.indexed).toBe(false)
  expect(_dump('post_search_documents')).toHaveLength(0)
  expect(_dump('post_search_terms')).toHaveLength(0)
  expect(_dump('post_search_chunks')).toHaveLength(0)
  expect(_dump('post_search_vector_terms')).toHaveLength(0)
  expect(_dump('post_search_index_state')[0]).toMatchObject({
    postId: 'post-1',
    status: 'removed',
  })
})

test('backfillPostSearchIndexesForCommunity rebuilds visible posts and clears invisible posts', async () => {
  await db.create('sections', section)
  await db.create('posts', post())
  await db.create('posts', post({ _id: 'post-review', auditStatus: 'review', content: { title: '待审 鲲鹏' } }))
  await indexPostForSearch(post({ _id: 'post-review', content: { title: '旧索引 鲲鹏' } }), section)

  const result = await backfillPostSearchIndexesForCommunity('community-1')
  const searchResult = await searchPostIndex({ communityId: 'community-1', query: '鲲鹏' })

  expect(result).toMatchObject({
    scannedCount: 2,
    indexedCount: 1,
    removedCount: 1,
    failedCount: 0,
  })
  expect(searchResult.items.map((item) => item.postId)).toEqual(['post-1'])
})

test('searchPostIndex still finds exact phrases beyond the term cap in long posts', async () => {
  const filler = Array.from({ length: 180 }, (_, index) => `前文填充${index}`).join(' ')
  const terminalPhrase = '山长水远终有归期'
  await indexPostForSearch(post({
    _id: 'post-long',
    content: {
      title: '长正文',
      body: {
        format: 'markdown',
        markdown: `${filler} ${terminalPhrase}`,
        html: '',
        text: `${filler} ${terminalPhrase}`,
        imageFileIDs: [],
        schemaVersion: 1,
      },
      videos: [],
    },
  } as any), section)

  const result = await searchPostIndex({
    communityId: 'community-1',
    query: terminalPhrase,
  })

  expect(result.items.map((item) => item.postId)).toEqual(['post-long'])
  expect(result.items[0].matchedFields[0]).toMatchObject({
    fieldLabel: '正文',
    fieldType: 'rich_note',
  })
})

test('refreshPostSearchIndexById replaces stale chunk terms after a post edit passes audit', async () => {
  await db.create('sections', section)
  await db.create('posts', post())
  await refreshPostSearchIndexById('post-1')

  await db.updateById('posts', 'post-1', {
    content: {
      title: '明士课堂第二讲',
      body: {
        format: 'markdown',
        markdown: '新的正文写到麒麟与修身。',
        html: '',
        text: '新的正文写到麒麟与修身。',
        imageFileIDs: [],
        schemaVersion: 1,
      },
      videos: [],
    },
    updatedAt: '2026-06-24T10:00:00.000Z',
  })
  await refreshPostSearchIndexById('post-1')

  expect((await searchPostIndex({ communityId: 'community-1', query: '鲲鹏' })).items).toHaveLength(0)
  const newResult = await searchPostIndex({ communityId: 'community-1', query: '麒麟' })
  expect(newResult.items.map((item) => item.postId)).toEqual(['post-1'])
  expect(_dump('post_search_chunks')).toEqual(expect.arrayContaining([
    expect.objectContaining({ text: expect.stringContaining('麒麟') }),
  ]))
})

test('backfillPostSearchIndexesForSection refreshes section and widget metadata', async () => {
  await db.create('sections', section)
  await db.create('posts', post())
  await refreshPostSearchIndexById('post-1')
  await db.updateById('sections', 'section-course', {
    name: '新课堂',
    widgets: section.widgets.map((widget) => (
      widget.widgetId === 'body'
        ? { ...widget, label: '新正文' }
        : widget
    )),
  })

  const result = await backfillPostSearchIndexesForSection('section-course')
  const searchResult = await searchPostIndex({ communityId: 'community-1', query: '一粥一饭' })

  expect(result).toMatchObject({
    sectionId: 'section-course',
    scannedCount: 1,
    indexedCount: 1,
    failedCount: 0,
  })
  expect(searchResult.items[0]).toMatchObject({
    sectionName: '新课堂',
  })
  expect(searchResult.items[0].matchedFields[0]).toMatchObject({
    fieldLabel: '新正文',
  })
})

test('removePostSearchIndexesForSection clears stale documents for deleted sections', async () => {
  await indexPostForSearch(post(), section)

  const result = await removePostSearchIndexesForSection('section-course')

  expect(result.removedDocumentCount).toBe(1)
  expect(result.removedTermCount).toBeGreaterThan(0)
  expect(_dump('post_search_documents')).toHaveLength(0)
  expect(_dump('post_search_terms')).toHaveLength(0)
})
