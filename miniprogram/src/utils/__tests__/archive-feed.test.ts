import { describe, expect, test } from 'vitest'
import { appendArchivePage, normalizeArchiveCard } from '../archive-feed'

const post = (id: string, overrides: Record<string, any> = {}) => ({
  _id: id, format: 'text', content: { title: `标题${id}`, body: { text: '正文' } }, topics: [],
  author: { nickName: '邻居' }, createdAt: '2026-07-14T00:00:00.000Z', ...overrides,
})

describe('archive feed state', () => {
  test('appends to the shorter logical column without reshuffling existing cards', () => {
    const left = [normalizeArchiveCard(post('left', { format: 'image_text', content: { title: '图文', images: ['a.jpg'] } }))]
    const right = [normalizeArchiveCard(post('right'))]
    const result = appendArchivePage([left, right], [post('next-1'), post('next-2')])
    expect(result[0][0].postId).toBe('left')
    expect(result[1][0].postId).toBe('right')
    expect(result.flat().map(card => card.postId).sort()).toEqual(['left', 'next-1', 'next-2', 'right'])
  })

  test('suppresses duplicate posts across pages', () => {
    const first = normalizeArchiveCard(post('same'))
    expect(appendArchivePage([[first], []], [post('same'), post('new')]).flat().map(card => card.postId).sort())
      .toEqual(['new', 'same'])
  })

  test('uses first image and deterministic text-cover fallback', () => {
    expect(normalizeArchiveCard(post('image', { format: 'image_text', content: { title: '图文', images: ['one.jpg', 'two.jpg'] } })).cover)
      .toEqual({ kind: 'image', src: 'one.jpg' })
    expect(normalizeArchiveCard(post('legacy')).cover).toEqual(normalizeArchiveCard(post('legacy')).cover)
    expect(normalizeArchiveCard(post('legacy')).cover.kind).toBe('text')
  })

  test('accepts semantic result ids and keeps the original post image', () => {
    const resultItem = {
      postId: 'search-post',
      format: 'image_text',
      content: {
        title: '云盖村竹林轻徒步',
        images: ['cloud://env/posts/yungaicun-original.jpg'],
      },
      topics: ['亲子出游'],
      authorName: '路线邻居',
      createdAt: '2026-07-28T00:00:00.000Z',
    }

    const firstPage = appendArchivePage([[], []], [resultItem])
    const secondPage = appendArchivePage(firstPage, [resultItem])

    expect(firstPage.flat()).toHaveLength(1)
    expect(firstPage.flat()[0]).toMatchObject({
      postId: 'search-post',
      title: '云盖村竹林轻徒步',
      authorName: '路线邻居',
      cover: { kind: 'image', src: 'cloud://env/posts/yungaicun-original.jpg' },
    })
    expect(secondPage.flat()).toHaveLength(1)
  })

  test('keeps native video cards distinct and uses their explicit cover', () => {
    const card = normalizeArchiveCard(post('video-cover', {
      format: 'video',
      content: {
        title: '夏夜电影',
        videos: [{ source: 'cos', itemId: 'video-1', title: '夏夜电影', fileID: 'cloud://video.mp4', cover: 'cloud://cover.jpg' }],
      },
    }))

    expect(card.format).toBe('video')
    expect(card.cover).toEqual({ kind: 'video', src: 'cloud://cover.jpg' })
  })

  test('uses a deterministic video placeholder without treating unknown formats as video', () => {
    const withoutCover = post('video-placeholder', {
      format: 'video',
      content: { title: '没有封面', videos: [{ source: 'cos', itemId: 'video-1', title: '没有封面', fileID: 'cloud://video.mp4' }] },
    })
    const first = normalizeArchiveCard(withoutCover)
    const second = normalizeArchiveCard(withoutCover)
    const unknown = normalizeArchiveCard(post('future-format', { format: 'future' }))

    expect(first.format).toBe('video')
    expect(first.cover).toEqual(second.cover)
    expect(first.cover.kind).toBe('video')
    expect(first.cover.src).toBe('')
    expect(unknown.format).toBe('text')
    expect(unknown.cover.kind).toBe('text')
  })

  test('preserves native audio cards and derives their first cover, count, and positive duration sum', () => {
    const card = normalizeArchiveCard(post('audio-card', {
      format: 'audio',
      content: {
        title: '寒山钟声与西湖春',
        audios: [
          { fileID: 'cloud://audio/one.mp3', title: '寒山钟声', duration: 61.2, size: 1024, ext: 'mp3', cover: '  ' },
          { fileID: 'cloud://audio/two.m4a', title: '西湖春', duration: 30.8, size: 2048, ext: 'm4a', cover: 'cloud://covers/west-lake.jpg' },
          { fileID: 'cloud://audio/invalid.wav', title: '待修复', duration: 0, size: 4096, ext: 'wav' },
        ],
      },
    }))

    expect(card).toMatchObject({
      format: 'audio',
      title: '寒山钟声与西湖春',
      cover: { kind: 'audio', src: 'cloud://covers/west-lake.jpg' },
      trackCount: 3,
      totalDuration: 92,
    })
  })

  test('uses the bundled audio cover when no track has a display cover', () => {
    const card = normalizeArchiveCard(post('audio-fallback', {
      format: 'audio',
      content: {
        title: '无封面音频',
        audios: [{ fileID: 'cloud://audio/one.aac', title: '第一轨', duration: 18, size: 1024, ext: 'aac' }],
      },
    }))

    expect(card.cover).toEqual({
      kind: 'audio',
      src: '/static/audio/default-audio-cover.jpg',
      fallback: '/static/audio/default-audio-cover.jpg',
    })
  })
})
