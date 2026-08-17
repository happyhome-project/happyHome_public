import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
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
    expect(component).toContain('<AudioIcon')
    expect(component).not.toContain('<wd-icon')
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

  test('uses the locked local Wot icon-library font without a runtime font CDN', () => {
    const icon = source('src/components/AudioIcon.vue')
    expect(icon).toContain('@font-face')
    expect(icon).toContain('wot-design-uni/components/wd-icon/wd-icons.ttf')
    expect(icon).not.toMatch(/https?:\/\//i)
    const codepoints = {
      previous: '\\e6cd',
      next: '\\e6ca',
      'play-circle': '\\e70e',
      'play-circle-filled': '\\e703',
      pause: '\\e716',
      sound: '\\e680',
      'chart-bar': '\\e6b5',
    }
    for (const [name, codepoint] of Object.entries(codepoints)) {
      expect(icon).toContain(`'${name}'`)
      expect(icon).toContain(`content: "${codepoint}"`)
    }

    const compiledPath = resolve(process.cwd(), 'dist/build/mp-weixin/components/AudioIcon.wxss')
    if (existsSync(compiledPath)) {
      const compiled = readFileSync(compiledPath, 'utf8')
      expect(compiled).not.toMatch(/https?:\/\//i)
      const assetUrl = compiled.match(/url\((?:"|')?([^"')]+wd-icons[^"')]+\.ttf)(?:"|')?\)/)?.[1]
      expect(assetUrl).toBeTruthy()
      expect(existsSync(resolve(dirname(compiledPath), assetUrl || 'missing'))).toBe(true)
    }
  })

  test('uses fallback-aware retry accounting on both archive feed surfaces', () => {
    for (const path of ['src/pages/index/index.vue', 'src/pages/search/index.vue']) {
      const page = source(path)
      expect(page).toContain('claimFeedCoverRetry')
      expect(page).toContain('recordFeedCoverLoad')
    }
  })
})
