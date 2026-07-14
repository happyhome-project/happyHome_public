import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const root = resolve(__dirname, '../..')

describe('home image release guard', () => {
  test('home page exposes render diagnostics only for the remaining hero and guide images', () => {
    const source = readFileSync(resolve(root, 'pages/index/index.vue'), 'utf8')

    expect(source).toContain('function getReleaseHomeImageProbe()')
    expect(source).toContain('defineExpose({')
    expect(source).toContain('getReleaseHomeImageProbe,')
    expect(source).toContain('home.hero.image.fail')
    expect(source).toContain('home.guide.image.fail')
    expect(source).not.toContain('home.banner.image.fail')
    expect(source).not.toContain('onHomeBannerImageLoad')
    expect(source).not.toContain('onHomeBannerImageError')
    expect(source).not.toContain('isHomeBannerImageFailed')
    expect(source).toContain('isHomeGuideImageFailed(item.imageKey)')
  })
})
