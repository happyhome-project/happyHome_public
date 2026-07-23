import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const read = (...parts: string[]) => readFileSync(join(process.cwd(), 'src', ...parts), 'utf8')

describe('detail carousel gesture safety', () => {
  test('keeps image and guide swiper hitboxes away from the native back edge', () => {
    const imageNote = read('components', 'ImageNoteDetailView.vue')
    const guide = read('components', 'GuideRouteDetailView.vue')

    expect(imageNote).toMatch(/\.image-note-hero\s*\{[^}]*margin:\s*0 40rpx;[^}]*width:\s*auto;/s)
    expect(guide).toMatch(/\.guide-hero\s*\{[^}]*margin:\s*0 40rpx;[^}]*width:\s*auto;/s)
    expect(imageNote).toContain('@touchstart="onHeroPointerStart"')
    expect(imageNote).toContain('@touchmove="onHeroPointerMove"')
    expect(imageNote).toContain('@touchend="onHeroPointerEnd"')
    expect(guide).toContain('@touchstart="onHeroPointerStart"')
    expect(guide).toContain('@touchmove="onHeroPointerMove"')
    expect(guide).toContain('@touchend="onHeroPointerEnd"')
    expect(imageNote).not.toContain('.stop="onHeroPointer')
    expect(guide).not.toContain('.stop="onHeroPointer')
    expect(imageNote).not.toContain('navigateBack')
    expect(guide).not.toContain('navigateBack')
  })

  test('does not open image preview after a horizontal drag', () => {
    const imageNote = read('components', 'ImageNoteDetailView.vue')

    expect(imageNote).toContain('const HERO_SWIPE_THRESHOLD_PX = 8')
    expect(imageNote).toContain('heroSuppressNextPreview')
    expect(imageNote).toMatch(/function onHeroPointerMove[\s\S]*Math\.max\(dx, dy\) >= HERO_SWIPE_THRESHOLD_PX[\s\S]*heroSuppressNextPreview = true/)
    expect(imageNote).toMatch(/function previewImage[\s\S]*if \(heroSuppressNextPreview\)[\s\S]*return/)
  })

  test('renders text-note detail as title, visual deck, then author metadata', () => {
    const detail = read('components', 'DefaultDetailView.vue')
    const detailTemplate = detail.split('<script setup')[0]
    const page = read('pages', 'detail', 'index.vue')

    const titleIndex = detailTemplate.indexOf('class="detail-title"')
    const deckIndex = detailTemplate.indexOf('class="text-note-detail-deck"')
    const authorIndex = detailTemplate.indexOf('class="detail-author-row"')

    expect(titleIndex).toBeGreaterThanOrEqual(0)
    expect(deckIndex).toBeGreaterThan(titleIndex)
    expect(authorIndex).toBeGreaterThan(deckIndex)
    expect(detailTemplate).toContain('v-if="!isTextNoteDetail" class="section-line"')
    expect(page).toContain("'detail-page--text-note': isTextNoteDetail")
    expect(page).toMatch(/\.detail-page--text-note\s*\{[^}]*background:\s*var\(--hh-color-card\);/s)
  })
})
