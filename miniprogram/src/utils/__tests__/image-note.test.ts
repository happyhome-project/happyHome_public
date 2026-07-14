import { describe, expect, test } from 'vitest'
import type { Post, Section } from '../../../../cloud/shared/types'
import {
  buildImageNoteDetail,
  getImageNoteCard,
  isImageNoteSectionContract,
} from '../image-note'

function imageNoteSection(overrides: Partial<Section> = {}): Section {
  return {
    _id: 'section-image-note',
    communityId: 'community-1',
    name: '图文_new',
    icon: 'image',
    order: 1,
    enableComment: true,
    enableLike: true,
    createdAt: '2026-07-14T00:00:00.000Z',
    type: 'evergreen',
    status: 'active',
    displayTemplate: 'image_note',
    widgets: [
      { widgetId: 'image_note_images', type: 'image_group', label: '添加图片', fieldKey: 'images', required: true, order: 0, showInList: false, locked: true },
      { widgetId: 'image_note_title', type: 'short_text', label: '主题', fieldKey: 'title', required: true, order: 1, showInList: true, locked: true },
      { widgetId: 'image_note_body', type: 'rich_note', label: '正文', fieldKey: 'body', required: false, order: 2, showInList: false, locked: true },
      { widgetId: 'image_note_topics', type: 'topic', label: '话题', fieldKey: 'topics', required: false, order: 3, showInList: false, locked: true },
      { widgetId: 'image_note_location', type: 'location', label: '设置地点', fieldKey: 'location', required: false, order: 4, showInList: false, locked: true },
    ],
    ...overrides,
  }
}

function imageNotePost(content: Post['content'], overrides: Partial<Post> = {}): Post {
  return {
    _id: 'post-image-note',
    communityId: 'community-1',
    sectionId: 'section-image-note',
    authorId: 'user-1',
    authorNickname: '青山妈妈',
    authorAvatarUrl: 'cloud://env/avatar.jpg',
    status: 'active',
    content,
    commentCount: 3,
    likeCount: 12,
    createdAt: '2026-07-14T08:30:00.000Z',
    updatedAt: '2026-07-14T08:30:00.000Z',
    ...overrides,
  }
}

describe('image-note view models', () => {
  test('recognizes explicit templates and the fixed widget contract during rolling deployments', () => {
    expect(isImageNoteSectionContract(imageNoteSection())).toBe(true)
    expect(isImageNoteSectionContract(imageNoteSection({ displayTemplate: 'default' }))).toBe(true)
    expect(isImageNoteSectionContract(imageNoteSection({
      displayTemplate: 'default',
      name: '图文_new',
      widgets: imageNoteSection().widgets.slice(0, 4),
    }))).toBe(false)
    expect(isImageNoteSectionContract(imageNoteSection({
      displayTemplate: 'default',
      name: '图文_new',
      widgets: [],
    }))).toBe(false)
  })

  test('extracts the fixed five widgets plus feed metadata', () => {
    const body = {
      format: 'markdown' as const,
      markdown: '沿着溪边慢慢走，树荫很多。',
      html: '',
      text: '沿着溪边慢慢走，树荫很多。',
      imageFileIDs: [],
      schemaVersion: 1 as const,
    }
    const post = imageNotePost({
      image_note_images: ['cloud://env/cover.jpg', ' cloud://env/second.jpg ', 'cloud://env/cover.jpg'],
      image_note_title: '  夏日溪边散步  ',
      image_note_body: body,
      image_note_topics: [' #亲子出游 ', '成都周末', '#亲子出游'],
      image_note_location: {
        name: '青山溪谷',
        address: '四川省成都市青山路 1 号',
        lat: 30.6,
        lng: 104.1,
      },
    })

    expect(getImageNoteCard(post, imageNoteSection())).toEqual({
      coverImage: 'cloud://env/cover.jpg',
      images: ['cloud://env/cover.jpg', 'cloud://env/second.jpg'],
      title: '夏日溪边散步',
      authorName: '青山妈妈',
      authorAvatarUrl: 'cloud://env/avatar.jpg',
      likeCount: 12,
      createdAt: '2026-07-14T08:30:00.000Z',
    })

    expect(buildImageNoteDetail(post, imageNoteSection())).toEqual({
      coverImage: 'cloud://env/cover.jpg',
      images: ['cloud://env/cover.jpg', 'cloud://env/second.jpg'],
      title: '夏日溪边散步',
      authorName: '青山妈妈',
      authorAvatarUrl: 'cloud://env/avatar.jpg',
      likeCount: 12,
      createdAt: '2026-07-14T08:30:00.000Z',
      body: expect.objectContaining({ markdown: body.markdown, text: body.text }),
      topics: ['亲子出游', '成都周末'],
      location: {
        name: '青山溪谷',
        address: '四川省成都市青山路 1 号',
        lat: 30.6,
        lng: 104.1,
      },
    })
  })

  test('omits empty optional detail rows and provides stable author/count fallbacks', () => {
    const detail = buildImageNoteDetail(
      imageNotePost(
        {
          image_note_images: ['cloud://env/cover.jpg'],
          image_note_title: '只有必填内容',
          image_note_body: { format: 'markdown', markdown: '', html: '', text: '', imageFileIDs: [], schemaVersion: 1 },
          image_note_topics: [],
        },
        { authorNickname: ' ', authorAvatarUrl: ' ', likeCount: -2 },
      ),
      imageNoteSection(),
    )

    expect(detail.body).toBeNull()
    expect(detail.topics).toEqual([])
    expect(detail.location).toBeNull()
    expect(detail.authorName).toBe('社区邻居')
    expect(detail.authorAvatarUrl).toBe('')
    expect(detail.likeCount).toBe(0)
  })

  test('uses fieldKey fallback only for legacy sections explicitly marked image_note', () => {
    const legacyWidgets: Section['widgets'] = [
      { widgetId: 'legacy-photo', type: 'image_group', label: '旧图片', fieldKey: 'images', required: true, order: 0, showInList: false },
      { widgetId: 'legacy-subject', type: 'short_text', label: '旧主题', fieldKey: 'title', required: true, order: 1, showInList: true },
      { widgetId: 'legacy-copy', type: 'rich_note', label: '旧正文', fieldKey: 'body', required: false, order: 2, showInList: false },
      { widgetId: 'legacy-tags', type: 'topic', label: '旧话题', fieldKey: 'topics', required: false, order: 3, showInList: false },
      { widgetId: 'legacy-place', type: 'location', label: '旧地点', fieldKey: 'location', required: false, order: 4, showInList: false },
    ]
    const post = imageNotePost({
      'legacy-photo': ['cloud://env/legacy.jpg'],
      'legacy-subject': '旧图文',
      'legacy-copy': { format: 'markdown', markdown: '旧正文', html: '', text: '旧正文', imageFileIDs: [], schemaVersion: 1 },
      'legacy-tags': ['#旧话题'],
      'legacy-place': { name: '旧地点', address: '', lat: 30, lng: 104 },
    })

    expect(buildImageNoteDetail(post, imageNoteSection({ widgets: legacyWidgets }))).toMatchObject({
      images: ['cloud://env/legacy.jpg'],
      title: '旧图文',
      topics: ['旧话题'],
      location: { name: '旧地点', address: '', lat: 30, lng: 104 },
    })

    expect(buildImageNoteDetail(post, imageNoteSection({ displayTemplate: 'default', widgets: legacyWidgets }))).toMatchObject({
      images: [],
      title: '无标题',
      body: null,
      topics: [],
      location: null,
    })
  })

  test('fixed widget IDs take precedence over a duplicate legacy fieldKey', () => {
    const section = imageNoteSection({
      widgets: [
        ...imageNoteSection().widgets,
        { widgetId: 'legacy-title', type: 'short_text', label: '旧标题', fieldKey: 'title', required: false, order: 5, showInList: false },
      ],
    })
    const post = imageNotePost({
      image_note_images: ['cloud://env/fixed.jpg'],
      image_note_title: '固定主题',
      'legacy-title': '不应出现',
    })

    expect(getImageNoteCard(post, section).title).toBe('固定主题')
  })

  test('reads legacy content after member APIs prepend the fixed widgets', () => {
    const section = imageNoteSection({
      widgets: imageNoteSection().widgets.concat({
        widgetId: 'legacy-title',
        type: 'short_text',
        label: '旧主题',
        fieldKey: 'title',
        required: false,
        order: 5,
        showInList: false,
      }),
    })
    const post = imageNotePost({
      image_note_images: ['cloud://env/fixed.jpg'],
      'legacy-title': '旧内容仍可见',
    })

    expect(getImageNoteCard(post, section).title).toBe('旧内容仍可见')
  })
})
