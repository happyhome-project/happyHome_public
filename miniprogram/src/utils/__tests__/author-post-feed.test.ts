import { describe, expect, test } from 'vitest'
import { appendAuthorPosts, normalizeAuthorPostCard } from '../author-post-feed'

describe('author post feed', () => {
  test('uses the first image as a cover for native archive and section image notes', () => {
    const archive = normalizeAuthorPostCard({
      _id: 'archive-1', area: 'archive', format: 'image_text',
      content: { title: '周末散步', images: ['cloud://cover.jpg', 'cloud://second.jpg'] },
      communityName: '阳光花园', sectionName: '图文',
    })
    const sectionPost = normalizeAuthorPostCard({
      _id: 'section-1', content: { photos: ['cloud://section-cover.jpg'], headline: '亲子活动' },
      displayTemplate: 'image_note', sectionName: '亲子出游', communityName: '阳光花园',
      section: { displayTemplate: 'image_note', widgets: [
        { widgetId: 'photos', fieldKey: 'images', type: 'image_group' },
        { widgetId: 'headline', fieldKey: 'title', type: 'short_text' },
      ] },
    })

    expect(archive.cover).toEqual({ kind: 'image', src: 'cloud://cover.jpg' })
    expect(sectionPost.cover).toEqual({ kind: 'image', src: 'cloud://section-cover.jpg' })
  })

  test('uses a text cover and keeps ownership metadata for text posts', () => {
    const card = normalizeAuthorPostCard({
      _id: 'text-1', area: 'archive', format: 'text',
      content: { title: '今天的记录', body: { text: '正文摘要' } },
      presentation: { textNoteTheme: 'mint' }, communityName: '阳光花园', sectionName: '文字',
      likeCount: 3, commentCount: 2, auditStatus: 'pending',
    })

    expect(card.cover).toEqual({ kind: 'text', theme: 'mint' })
    expect(card.communityLabel).toBe('阳光花园 · 文字')
    expect(card.likeCount).toBe(3)
    expect(card.commentCount).toBe(2)
    expect(card.auditStatus).toBe('pending')
  })

  test('appends unique posts to the shorter stable column', () => {
    const result = appendAuthorPosts([[], []], [
      { _id: 'one', area: 'archive', format: 'image_text', content: { title: '1', images: ['1.jpg'] } },
      { _id: 'two', area: 'archive', format: 'text', content: { title: '2', body: { text: '2' } } },
      { _id: 'one', area: 'archive', format: 'image_text', content: { title: '1', images: ['1.jpg'] } },
    ])
    expect(result.flat().map(card => card.postId).sort()).toEqual(['one', 'two'])
  })

  test('keeps archive video cover semantics and ownership metadata', () => {
    const card = normalizeAuthorPostCard({
      _id: 'video-1', area: 'archive', format: 'video',
      content: {
        title: '运动会', body: { text: '冲线时刻' },
        videos: [{ source: 'cos', itemId: 'clip-1', title: '运动会', fileID: 'cloud://video.mp4', cover: 'cloud://cover.jpg' }],
      },
      communityName: '阳光花园', sectionName: '视频', likeCount: 8, commentCount: 5, auditStatus: 'review',
    })

    expect(card.format).toBe('video')
    expect(card.cover).toEqual({ kind: 'video', src: 'cloud://cover.jpg' })
    expect(card.bodyText).toBe('冲线时刻')
    expect(card.communityLabel).toBe('阳光花园 · 视频')
    expect({ likeCount: card.likeCount, commentCount: card.commentCount, auditStatus: card.auditStatus })
      .toEqual({ likeCount: 8, commentCount: 5, auditStatus: 'review' })
  })

  test('uses a stable video placeholder and safely leaves unknown formats as text cards', () => {
    const input = {
      _id: 'video-placeholder', area: 'archive', format: 'video',
      content: { title: '无封面', videos: [{ source: 'cos', itemId: 'clip-1', title: '无封面', fileID: 'cloud://video.mp4' }] },
    }
    const first = normalizeAuthorPostCard(input)
    const second = normalizeAuthorPostCard(input)
    const unknown = normalizeAuthorPostCard({ _id: 'future', area: 'archive', format: 'future', content: { title: '未来格式' } })

    expect(first.cover).toEqual(second.cover)
    expect(first.cover.kind).toBe('video')
    expect(first.cover.src).toBe('')
    expect(unknown.format).toBe('text')
    expect(unknown.cover.kind).toBe('text')
  })
})
