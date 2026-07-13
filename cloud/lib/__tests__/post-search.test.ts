import type { Post, Section } from '../../shared/types'
import {
  POST_SEARCH_CHUNKS,
  POST_SEARCH_INDEX_STATE,
  POST_SEARCH_VECTOR_TERMS,
  buildPostSearchDocument,
  buildPostSearchChunks,
  buildSearchQuery,
  buildSparseVectorTerms,
  extractPostSearchFields,
} from '../post-search'

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
    {
      widgetId: 'audios',
      type: 'audio_group',
      label: '音频',
      fieldKey: 'audios',
      required: false,
      order: 3,
      showInList: false,
    },
    {
      widgetId: 'notes',
      type: 'note_blocks',
      label: '图文笔记',
      fieldKey: 'notes',
      required: false,
      order: 4,
      showInList: false,
    },
    {
      widgetId: 'place',
      type: 'location',
      label: '地点',
      fieldKey: 'place',
      required: false,
      order: 5,
      showInList: false,
    },
  ],
}

const post: Post = {
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
      html: '<p>朱子治家格言：一粥一饭，当思来处不易。</p>',
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
    audios: [
      {
        title: '文化苍生音频',
        fileID: 'cloud://env/audios/culture.mp3',
        duration: 120,
        size: 1024,
        ext: 'mp3',
      },
    ],
    notes: [
      { blockId: 'block-1', type: 'text', text: '图文笔记里也有可搜索句子' },
    ],
    place: {
      name: '青山书院',
      address: '四川省绵竹市青山村',
      lat: 31.1,
      lng: 104.1,
      coordSystem: 'gcj02',
      source: 'amap',
    },
  },
  commentCount: 0,
  likeCount: 0,
  createdAt: '2026-06-24T08:00:00.000Z',
  updatedAt: '2026-06-24T08:00:00.000Z',
}

test('extractPostSearchFields extracts rich text, media titles, note text, and location text', () => {
  const fields = extractPostSearchFields(post, section)

  expect(fields.map((field) => field.text)).toEqual(expect.arrayContaining([
    '明士课堂第一讲',
    '朱子治家格言：一粥一饭，当思来处不易。',
    '鲲鹏',
    '文化苍生音频',
    '图文笔记里也有可搜索句子',
    '青山书院',
    '四川省绵竹市青山村',
  ]))
  expect(fields.find((field) => field.text === '鲲鹏')).toMatchObject({
    fieldLabel: '视频',
    fieldType: 'video_group',
  })
})

test('buildPostSearchDocument supports Chinese sentence and video-title retrieval', () => {
  const document = buildPostSearchDocument(post, section)

  expect(document.title).toBe('明士课堂第一讲')
  expect(document.chunkCount).toBeGreaterThanOrEqual(4)
  expect(document.searchText).toContain('朱子治家格言')
  expect(document.compactText).toContain('一粥一饭当思来处不易')
  expect(document.terms).toEqual(expect.arrayContaining(['朱子', '治家', '格言', '鲲鹏', '文化']))
  expect(document.fields.some((field) => field.preview.includes('一粥一饭'))).toBe(true)
})

test('member-only title never leaks into public chunk metadata', () => {
  const memberTitleSection = { ...section, widgets: section.widgets.map((widget: any) => widget.fieldKey === 'title' ? { ...widget, visibility: 'member' } : widget) }
  const document = buildPostSearchDocument(post, memberTitleSection)
  expect(document.title).not.toBe('明士课堂第一讲')
  expect(buildPostSearchChunks(document).filter(chunk => chunk.visibility === 'public').every(chunk => chunk.title !== '明士课堂第一讲')).toBe(true)
})

test('buildPostSearchChunks creates RAG evidence chunks with stable ids and field metadata', () => {
  const document = buildPostSearchDocument(post, section, '2026-06-24T09:00:00.000Z')
  const chunks = buildPostSearchChunks(document)

  expect(chunks.map((chunk) => chunk.collection)).toEqual(
    expect.arrayContaining([POST_SEARCH_CHUNKS])
  )
  expect(chunks.some((chunk) => chunk.text.includes('一粥一饭'))).toBe(true)
  expect(chunks.find((chunk) => chunk.text === '鲲鹏')).toMatchObject({
    postId: 'post-1',
    communityId: 'community-1',
    sectionId: 'section-course',
    fieldLabel: '视频',
    fieldType: 'video_group',
    visibility: 'public',
    chunkIndex: expect.any(Number),
    terms: expect.arrayContaining(['鲲鹏']),
    sparseVector: expect.arrayContaining([
      expect.objectContaining({ term: '鲲鹏', weight: expect.any(Number) }),
    ]),
  })
  expect(new Set(chunks.map((chunk) => chunk._id)).size).toBe(chunks.length)
})

test('buildPostSearchChunks preserves member-only widget visibility', () => {
  const memberSection = {
    ...section,
    widgets: section.widgets.map((widget) => (
      widget.widgetId === 'body' ? { ...widget, visibility: 'member' as const } : widget
    )),
  }
  const document = buildPostSearchDocument(post, memberSection, '2026-06-24T09:00:00.000Z')
  const chunks = buildPostSearchChunks(document)

  expect(chunks.find((chunk) => chunk.fieldKey === 'title')).toMatchObject({
    visibility: 'public',
  })
  expect(chunks.find((chunk) => chunk.fieldKey === 'body')).toMatchObject({
    visibility: 'member',
    text: expect.stringContaining('一粥一饭'),
  })
})

test('buildSparseVectorTerms produces bounded weighted terms for local semantic fallback', () => {
  const vector = buildSparseVectorTerms(['朱子治家格言', '一粥一饭，当思来处不易。'])

  expect(vector.length).toBeGreaterThan(0)
  expect(vector).toEqual(expect.arrayContaining([
    expect.objectContaining({ term: '朱子', weight: expect.any(Number) }),
    expect.objectContaining({ term: '一粥', weight: expect.any(Number) }),
  ]))
  expect(vector[0].weight).toBeGreaterThanOrEqual(vector[vector.length - 1].weight)
})

test('buildSearchQuery normalizes phrase queries for compact text matching', () => {
  const query = buildSearchQuery('一粥一饭，当思来处不易')

  expect(query.normalized).toBe('一粥一饭 当思来处不易')
  expect(query.compact).toBe('一粥一饭当思来处不易')
  expect(query.terms).toEqual(expect.arrayContaining(['一粥', '粥一', '来处', '不易']))
})

test('collection constants document the RAG index layers', () => {
  expect(POST_SEARCH_CHUNKS).toBe('post_search_chunks')
  expect(POST_SEARCH_VECTOR_TERMS).toBe('post_search_vector_terms')
  expect(POST_SEARCH_INDEX_STATE).toBe('post_search_index_state')
})
