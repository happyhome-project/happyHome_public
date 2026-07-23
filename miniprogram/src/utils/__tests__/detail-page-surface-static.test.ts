import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const detailPage = readFileSync(resolve(__dirname, '../../pages/detail/index.vue'), 'utf8')

describe('detail page surface', () => {
  test('keeps every detail template on one full-viewport white surface', () => {
    const rootRule = detailPage.match(/\.detail-page\s*\{([^}]*)\}/s)?.[1] || ''

    expect(rootRule).toMatch(/background:\s*var\(--hh-color-card\)/)
    expect(rootRule).not.toMatch(/background:\s*var\(--hh-color-page\)/)
    expect(rootRule).toMatch(/min-height:\s*100vh/)
    expect(detailPage).toContain("'detail-page--guide': isGuideNoteDetail")
    expect(detailPage).toContain("'detail-page--image-note': isImageNoteDetail")
  })
})
