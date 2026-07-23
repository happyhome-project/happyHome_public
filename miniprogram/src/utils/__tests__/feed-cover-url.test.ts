import { describe, expect, test, vi } from 'vitest'
import { applyResolvedFeedCovers, collectFeedCoverSources, resolveFeedCovers } from '../feed-cover-url'

type TestCard = {
  postId: string
  cover: { kind: 'image' | 'video'; src: string; source?: string } | { kind: 'text'; theme: string }
}
type TestColumns = [TestCard[], TestCard[]]

function columns(): TestColumns {
  return [[
    { postId: 'image', cover: { kind: 'image', src: 'cloud://image.jpg' } },
    { postId: 'video', cover: { kind: 'video', src: 'cloud://video.jpg' } },
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
      'https://cdn.example/video.jpg',
    ])
  })

  test('applies resolved URLs to both cover kinds and keeps external video covers', () => {
    const cards = columns()
    applyResolvedFeedCovers(cards, {
      'cloud://image.jpg': 'https://tmp.example/image.jpg',
      'cloud://video.jpg': 'https://tmp.example/video.jpg',
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
      'https://cdn.example/video.jpg',
    ])
  })

  test('turns unresolved cloud video covers into placeholders without breaking image fallback', () => {
    const cards = columns()
    applyResolvedFeedCovers(cards, {
      'cloud://image.jpg': 'cloud://image.jpg',
      'cloud://video.jpg': 'cloud://video.jpg',
    })

    expect(cards[0][0].cover).toEqual({ kind: 'image', source: 'cloud://image.jpg', src: '' })
    expect(cards[0][1].cover).toEqual({ kind: 'video', source: 'cloud://video.jpg', src: '' })
  })

  test('keeps the page usable with placeholders instead of rendering unresolved cloud IDs', async () => {
    const cards = columns()
    const resolver = vi.fn(async () => { throw new Error('temporary URL unavailable') })

    await expect(resolveFeedCovers(cards, resolver)).resolves.toBe(cards)
    expect(cards[0][0].cover).toEqual({ kind: 'image', source: 'cloud://image.jpg', src: '' })
    expect(cards[0][1].cover).toEqual({ kind: 'video', source: 'cloud://video.jpg', src: '' })
    expect(cards[1][0].cover).toEqual({
      kind: 'video',
      source: 'https://cdn.example/video.jpg',
      src: 'https://cdn.example/video.jpg',
    })
  })
})
