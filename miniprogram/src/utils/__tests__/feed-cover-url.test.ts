import { describe, expect, test, vi } from 'vitest'
import { applyResolvedFeedCovers, collectFeedCoverSources, resolveFeedCovers } from '../feed-cover-url'
import * as feedCoverUrl from '../feed-cover-url'

type TestCard = {
  postId: string
  cover:
    | { kind: 'image' | 'video'; src: string; source?: string }
    | { kind: 'audio'; src: string; source?: string; fallback: string }
    | { kind: 'text'; theme: string }
}
type TestColumns = [TestCard[], TestCard[]]

function columns(): TestColumns {
  return [[
    { postId: 'image', cover: { kind: 'image', src: 'cloud://image.jpg' } },
    { postId: 'video', cover: { kind: 'video', src: 'cloud://video.jpg' } },
    { postId: 'audio', cover: { kind: 'audio', src: 'cloud://audio-cover.jpg', fallback: '/static/audio/default-audio-cover.jpg' } },
  ], [
    { postId: 'external-video', cover: { kind: 'video', src: 'https://cdn.example/video.jpg' } },
    { postId: 'placeholder', cover: { kind: 'video', src: '' } },
    { postId: 'text', cover: { kind: 'text', theme: 'paper' } },
  ]]
}

describe('feed cover URL assembly', () => {
  test('collects image and video cover sources without placeholders or text cards', () => {
    expect(collectFeedCoverSources(columns())).toEqual([
      'cloud://image.jpg',
      'cloud://video.jpg',
      'cloud://audio-cover.jpg',
      'https://cdn.example/video.jpg',
    ])
  })

  test('applies resolved URLs to both cover kinds and keeps external video covers', () => {
    const cards = columns()
    applyResolvedFeedCovers(cards, {
      'cloud://image.jpg': 'https://tmp.example/image.jpg',
      'cloud://video.jpg': 'https://tmp.example/video.jpg',
      'cloud://audio-cover.jpg': 'https://tmp.example/audio-cover.jpg',
      'https://cdn.example/video.jpg': 'https://cdn.example/video.jpg',
    })

    expect(cards[0][0].cover).toEqual({
      kind: 'image',
      source: 'cloud://image.jpg',
      src: 'https://tmp.example/image.jpg',
    })
    expect(cards[0][1].cover).toEqual({
      kind: 'video',
      source: 'cloud://video.jpg',
      src: 'https://tmp.example/video.jpg',
    })
    expect(cards[1][0].cover).toEqual({
      kind: 'video',
      source: 'https://cdn.example/video.jpg',
      src: 'https://cdn.example/video.jpg',
    })
    expect(collectFeedCoverSources(cards)).toEqual([
      'cloud://image.jpg',
      'cloud://video.jpg',
      'cloud://audio-cover.jpg',
      'https://cdn.example/video.jpg',
    ])
    expect(cards[0][2].cover).toEqual({
      kind: 'audio',
      source: 'cloud://audio-cover.jpg',
      src: 'https://tmp.example/audio-cover.jpg',
      fallback: '/static/audio/default-audio-cover.jpg',
    })
  })

  test('turns unresolved cloud video covers into placeholders without breaking image fallback', () => {
    const cards = columns()
    applyResolvedFeedCovers(cards, {
      'cloud://image.jpg': 'cloud://image.jpg',
      'cloud://video.jpg': 'cloud://video.jpg',
    })

    expect(cards[0][0].cover).toEqual({ kind: 'image', source: 'cloud://image.jpg', src: '' })
    expect(cards[0][1].cover).toEqual({ kind: 'video', source: 'cloud://video.jpg', src: '' })
    expect(cards[0][2].cover).toEqual({
      kind: 'audio',
      source: 'cloud://audio-cover.jpg',
      src: '/static/audio/default-audio-cover.jpg',
      fallback: '/static/audio/default-audio-cover.jpg',
    })
  })

  test('keeps the page usable with placeholders instead of rendering unresolved cloud IDs', async () => {
    const cards = columns()
    const resolver = vi.fn(async () => { throw new Error('temporary URL unavailable') })

    await expect(resolveFeedCovers(cards, resolver)).resolves.toBe(cards)
    expect(cards[0][0].cover).toEqual({ kind: 'image', source: 'cloud://image.jpg', src: '' })
    expect(cards[0][1].cover).toEqual({ kind: 'video', source: 'cloud://video.jpg', src: '' })
    expect(cards[0][2].cover).toEqual({
      kind: 'audio',
      source: 'cloud://audio-cover.jpg',
      src: '/static/audio/default-audio-cover.jpg',
      fallback: '/static/audio/default-audio-cover.jpg',
    })
    expect(cards[1][0].cover).toEqual({
      kind: 'video',
      source: 'https://cdn.example/video.jpg',
      src: 'https://cdn.example/video.jpg',
    })
  })

  test('returns a broken signed audio cover to the bundled fallback while keeping its canonical source', () => {
    const fallbackFeedCoverAfterError = (feedCoverUrl as any).fallbackFeedCoverAfterError
    expect(typeof fallbackFeedCoverAfterError).toBe('function')
    const cover = {
      kind: 'audio' as const,
      source: 'cloud://audio-cover.jpg',
      src: 'https://tmp.example/expired.jpg',
      fallback: '/static/audio/default-audio-cover.jpg',
    }

    fallbackFeedCoverAfterError(cover)

    expect(cover).toEqual({
      kind: 'audio',
      source: 'cloud://audio-cover.jpg',
      src: '/static/audio/default-audio-cover.jpg',
      fallback: '/static/audio/default-audio-cover.jpg',
    })
  })

  test('does not send the bundled audio fallback through cloud signing or promote it to a canonical source', async () => {
    const fallbackOnly: TestColumns = [[{
      postId: 'audio-fallback',
      cover: {
        kind: 'audio',
        src: '/static/audio/default-audio-cover.jpg',
        fallback: '/static/audio/default-audio-cover.jpg',
      },
    }], []]
    const resolver = vi.fn(async () => ({}))

    await resolveFeedCovers(fallbackOnly, resolver)

    expect(resolver).not.toHaveBeenCalled()
    expect(fallbackOnly[0][0].cover).toEqual({
      kind: 'audio',
      src: '/static/audio/default-audio-cover.jpg',
      fallback: '/static/audio/default-audio-cover.jpg',
    })
  })

  test('keeps the two-attempt cap across fallback loads and repeated bad refreshed URLs', () => {
    const claimFeedCoverRetry = (feedCoverUrl as any).claimFeedCoverRetry
    const recordFeedCoverLoad = (feedCoverUrl as any).recordFeedCoverLoad
    const fallbackFeedCoverAfterError = (feedCoverUrl as any).fallbackFeedCoverAfterError
    expect(typeof claimFeedCoverRetry).toBe('function')
    expect(typeof recordFeedCoverLoad).toBe('function')
    const attempts = new Map<string, number>()
    const key = 'audio-post:cloud://audio-cover.jpg'
    const cover = {
      kind: 'audio' as const,
      source: 'cloud://audio-cover.jpg',
      src: 'https://tmp.example/bad-1.jpg',
      fallback: '/static/audio/default-audio-cover.jpg',
    }

    expect(claimFeedCoverRetry(attempts, key)).toBe(1)
    fallbackFeedCoverAfterError(cover)
    recordFeedCoverLoad(attempts, key, cover)
    expect(attempts.get(key)).toBe(1)

    cover.src = 'https://tmp.example/bad-2.jpg'
    expect(claimFeedCoverRetry(attempts, key)).toBe(2)
    fallbackFeedCoverAfterError(cover)
    recordFeedCoverLoad(attempts, key, cover)

    expect(attempts.get(key)).toBe(2)
    expect(claimFeedCoverRetry(attempts, key)).toBeNull()
  })

  test('clears retry attempts after real audio, image, and video covers load', () => {
    const recordFeedCoverLoad = (feedCoverUrl as any).recordFeedCoverLoad
    expect(typeof recordFeedCoverLoad).toBe('function')
    const attempts = new Map<string, number>([
      ['audio', 2],
      ['image', 1],
      ['video', 1],
    ])

    recordFeedCoverLoad(attempts, 'audio', {
      kind: 'audio',
      source: 'cloud://audio.jpg',
      src: 'https://tmp.example/audio.jpg',
      fallback: '/static/audio/default-audio-cover.jpg',
    })
    recordFeedCoverLoad(attempts, 'image', { kind: 'image', src: 'https://tmp.example/image.jpg' })
    recordFeedCoverLoad(attempts, 'video', { kind: 'video', src: 'https://tmp.example/video.jpg' })

    expect(attempts.size).toBe(0)
  })
})
