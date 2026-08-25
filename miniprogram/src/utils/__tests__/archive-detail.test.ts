import { describe, expect, test } from 'vitest'
import { buildNativeArchiveDetailSection, normalizeNativeArchiveDetailPost } from '../archive-detail'
import * as archiveDetail from '../archive-detail'

const richBody = { format: 'markdown', markdown: '正文', html: '<p>正文</p>', text: '正文', imageFileIDs: [], schemaVersion: 1 }

describe('native archive detail adapter', () => {
  test('routes a native video post into the dedicated video-note detail contract', () => {
    const video = { source: 'cos', itemId: 'clip-1', title: '晚霞', fileID: 'cloud://video.mp4', cover: 'cloud://cover.jpg' }
    const input = {
      _id: 'video-post', area: 'archive', format: 'video', communityId: 'community-1',
      content: { title: '河边晚霞', body: richBody, videos: [video], location: { name: '河畔', address: '滨河路', lat: 31, lng: 121 } },
    }
    const normalized = normalizeNativeArchiveDetailPost(input)
    const section = buildNativeArchiveDetailSection(normalized)

    expect(section.displayTemplate).toBe('video_note')
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

  test('builds the video-note view model from canonical native archive fields', () => {
    const video = {
      source: 'cos', itemId: 'clip-1', title: '鲲鹏', fileID: 'https://cdn.example/video.mp4',
      cover: 'https://cdn.example/cover.jpg', allowDownload: false, allowShare: false,
    }
    const input = {
      _id: 'video-post', area: 'archive', format: 'video', communityId: 'community-1', topics: ['明士课堂'],
      authorNickname: '明士班资料员', authorAvatarUrl: 'https://cdn.example/avatar.jpg',
      createdAt: '2026-08-17T05:58:47.065Z',
      content: {
        title: '第50次明士课程资料｜视频：鲲鹏', body: richBody, videos: [video],
        location: { name: '明士课堂', address: '教室', lat: 30, lng: 104 },
      },
    }
    const buildVideoNoteDetail = (archiveDetail as any).buildNativeArchiveVideoDetail

    expect(buildVideoNoteDetail?.(input)).toEqual({
      video,
      title: '第50次明士课程资料｜视频：鲲鹏',
      body: richBody,
      topics: ['明士课堂'],
      location: { name: '明士课堂', address: '教室', lat: 30, lng: 104 },
      authorName: '明士班资料员',
      authorAvatarUrl: 'https://cdn.example/avatar.jpg',
      createdAt: '2026-08-17T05:58:47.065Z',
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

  test('gives native audio an empty synthetic section while preserving canonical cloud file IDs', () => {
    const audios = [
      { fileID: 'cloud://audio/one.mp3', title: '寒山钟声', duration: 318, size: 1024, ext: 'mp3', cover: 'cloud://covers/one.jpg' },
      { fileID: 'cloud://audio/two.m4a', title: '西湖春', duration: 311, size: 2048, ext: 'm4a' },
    ]
    const input = {
      _id: 'audio-post', area: 'archive', format: 'audio', communityId: 'community-1',
      content: { title: '寒山钟声与西湖春', audios },
    }

    const normalized = normalizeNativeArchiveDetailPost(input)
    const section = buildNativeArchiveDetailSection(normalized)

    expect(normalized).toBe(input)
    expect(normalized.content.audios).toBe(audios)
    expect(normalized.content.audios.map((track: any) => track.fileID)).toEqual([
      'cloud://audio/one.mp3',
      'cloud://audio/two.m4a',
    ])
    expect(section).toMatchObject({ displayTemplate: 'default', widgets: [] })
  })

  test('selects only the native archive audio discriminator and leaves legacy audio_group posts generic', () => {
    const isNativeArchiveAudioPost = (archiveDetail as any).isNativeArchiveAudioPost
    expect(typeof isNativeArchiveAudioPost).toBe('function')
    expect(isNativeArchiveAudioPost({ area: 'archive', format: 'audio' })).toBe(true)
    expect(isNativeArchiveAudioPost({ area: 'archive', sectionId: 'legacy', content: { recordings: [] } })).toBe(false)
    expect(isNativeArchiveAudioPost({ area: 'collaboration', format: 'audio' })).toBe(false)
  })

  test('selects only native archive video posts for the video-note view', () => {
    const isNativeArchiveVideoPost = (archiveDetail as any).isNativeArchiveVideoPost
    expect(isNativeArchiveVideoPost?.({ area: 'archive', format: 'video' })).toBe(true)
    expect(isNativeArchiveVideoPost?.({ area: 'archive', sectionId: 'legacy', format: 'video' })).toBe(false)
    expect(isNativeArchiveVideoPost?.({ area: 'collaboration', format: 'video' })).toBe(false)
  })
})
