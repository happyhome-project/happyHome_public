import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

describe('archive video card rendering', () => {
  test.each([
    ['ArchiveWaterfall', '../../components/ArchiveWaterfall.vue'],
    ['AuthorPostColumns', '../../components/AuthorPostColumns.vue'],
  ])('%s renders either the explicit cover or placeholder with a persistent play marker', (_name, path) => {
    const component = source(path)
    expect(component).toContain("card.cover.kind === 'video'")
    expect(component).toContain('card.cover.src')
    expect(component).toContain('video-placeholder')
    expect(component).toContain('video-play')
    expect(component).toContain('▶')
  })

  test('detail routes native archive normalization through the tested adapter and existing default renderer', () => {
    const component = source('../../pages/detail/index.vue')
    const defaultDetail = source('../../components/DefaultDetailView.vue')
    expect(component).toContain("from '../../utils/archive-detail'")
    expect(component).toContain('normalizeNativeArchiveDetailPost(res.post)')
    expect(component).toContain('buildNativeArchiveDetailSection(post.value)')
    expect(component).toContain('<DefaultDetailView')
    expect(defaultDetail).toContain('<VideoPlayerCard')
    expect(defaultDetail).toContain("widget.type === 'video_group'")
  })

  test('home archive and my-posts resolve image and video covers through the shared assembler', () => {
    const home = source('../../pages/index/index.vue')
    const myPosts = source('../../pages/my-posts/index.vue')
    for (const component of [home, myPosts]) {
      expect(component).toContain("from '../../utils/feed-cover-url'")
      expect(component).toContain('resolveFeedCovers(')
    }
  })
})
