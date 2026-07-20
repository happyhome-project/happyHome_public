import { describe, expect, test } from 'vitest'
import { buildNativeArchiveDetailSection, normalizeNativeArchiveDetailPost } from '../archive-detail'

const richBody = { format: 'markdown', markdown: '正文', html: '<p>正文</p>', text: '正文', imageFileIDs: [], schemaVersion: 1 }

describe('native archive detail adapter', () => {
  test('maps a native video post into the default detail widget contract', () => {
    const video = { source: 'cos', itemId: 'clip-1', title: '晚霞', fileID: 'cloud://video.mp4', cover: 'cloud://cover.jpg' }
    const input = {
      _id: 'video-post', area: 'archive', format: 'video', communityId: 'community-1',
      content: { title: '河边晚霞', body: richBody, videos: [video], location: { name: '河畔', address: '滨河路', lat: 31, lng: 121 } },
    }
    const normalized = normalizeNativeArchiveDetailPost(input)
    const section = buildNativeArchiveDetailSection(normalized)

    expect(section.displayTemplate).toBe('default')
    expect(section.widgets.map((widget: any) => [widget.widgetId, widget.type])).toEqual([
      ['archive_video_title', 'short_text'],
      ['archive_video_body', 'rich_note'],
      ['archive_video_videos', 'video_group'],
      ['archive_video_location', 'location'],
    ])
    expect(normalized.content).toMatchObject({
      archive_video_title: '河边晚霞',
      archive_video_body: richBody,
      archive_video_videos: [video],
      archive_video_location: { name: '河畔', address: '滨河路', lat: 31, lng: 121 },
    })
  })

  test('maps native text topics and location into text-note detail widgets', () => {
    const input = {
      _id: 'text-post', area: 'archive', format: 'text', communityId: 'community-1', topics: ['社区活动'],
      content: { title: '周六见', body: richBody, location: { name: '社区活动中心', lat: 30, lng: 104 } },
    }
    const normalized = normalizeNativeArchiveDetailPost(input)
    const section = buildNativeArchiveDetailSection(normalized)

    expect(section.widgets.map((widget: any) => [widget.widgetId, widget.type])).toEqual([
      ['title', 'short_text'],
      ['body', 'rich_note'],
      ['archive_text_topics', 'topic'],
      ['archive_text_location', 'location'],
    ])
    expect(normalized.content).toMatchObject({
      archive_text_topics: ['社区活动'],
      archive_text_location: { name: '社区活动中心', lat: 30, lng: 104 },
    })
  })

  test('preserves image, text, section-backed, and unknown posts', () => {
    const image = { area: 'archive', format: 'image_text', content: { title: '图文', images: ['one.jpg'] } }
    const text = { area: 'archive', format: 'text', content: { title: '文字', body: richBody } }
    const sectionBacked = { area: 'archive', sectionId: 'section-1', format: 'video', content: { title: '板块视频' } }
    const unknown = { area: 'archive', format: 'future', content: { title: '未来格式' } }

    expect(normalizeNativeArchiveDetailPost(text)).not.toBe(text)
    expect(normalizeNativeArchiveDetailPost(sectionBacked)).toBe(sectionBacked)
    expect(normalizeNativeArchiveDetailPost(unknown)).toBe(unknown)
    expect(buildNativeArchiveDetailSection(image).displayTemplate).toBe('image_note')
    expect(buildNativeArchiveDetailSection(text).displayTemplate).toBe('text_note')
    expect(buildNativeArchiveDetailSection(unknown).displayTemplate).toBe('text_note')
  })
})
