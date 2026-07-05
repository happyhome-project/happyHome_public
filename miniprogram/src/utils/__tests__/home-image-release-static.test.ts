import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const root = resolve(__dirname, '../..')

describe('home image release guard', () => {
  test('home page exposes image render diagnostics and explicit image failure handlers', () => {
    const source = readFileSync(resolve(root, 'pages/index/index.vue'), 'utf8')

    expect(source).toContain('function getReleaseHomeImageProbe()')
    expect(source).toContain('home.banner.image.fail')
    expect(source).toContain('home.guide.image.fail')
    expect(source).toContain('@load="onHomeBannerImageLoad(banner)"')
    expect(source).toContain('@error="onHomeBannerImageError(banner, $event)"')
    expect(source).toContain('isHomeBannerImageFailed(banner.imageKey)')
    expect(source).toContain('isHomeGuideImageFailed(item.imageKey)')
  })
})
