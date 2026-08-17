import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

function source(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('native archive audio feed presentation', () => {
  test.each([
    ['ArchiveWaterfall', 'src/components/ArchiveWaterfall.vue'],
    ['AuthorPostColumns', 'src/components/AuthorPostColumns.vue'],
  ])('%s renders an audio poster with icon-library marker, count, and duration', (_name, path) => {
    const component = source(path)
    expect(component).toContain("card.cover.kind === 'audio'")
    expect(component).toContain('<wd-icon')
    expect(component).toMatch(/name="(?:play-circle-filled|sound)"/)
    expect(component).toContain('card.trackCount')
    expect(component).toContain('formatAudioDuration(card.totalDuration)')
  })

  test('keeps playback and progress out of the home and author cards', () => {
    for (const path of ['src/components/ArchiveWaterfall.vue', 'src/components/AuthorPostColumns.vue']) {
      const component = source(path)
      expect(component).not.toContain('useAudioStore')
      expect(component).not.toContain('<wd-slider')
      expect(component).not.toContain('@tap.stop="play')
    }
    expect(source('src/components/ArchiveWaterfall.vue')).toContain('@tap="$emit(\'post\', card)"')
    expect(source('src/components/AuthorPostColumns.vue')).toContain('@tap="emit(\'open\', card.postId)"')
  })

  test('uses fallback-aware retry accounting on both archive feed surfaces', () => {
    for (const path of ['src/pages/index/index.vue', 'src/pages/search/index.vue']) {
      const page = source(path)
      expect(page).toContain('claimFeedCoverRetry')
      expect(page).toContain('recordFeedCoverLoad')
    }
  })
})
