import { describe, expect, test } from 'vitest'

import { normalizeSectionIconValue, resolveSectionIconGlyph } from '../section-icon'

describe('section-icon', () => {
  test('renders semantic icon keys as user-facing glyphs', () => {
    expect(resolveSectionIconGlyph('car')).toBe('🚗')
    expect(resolveSectionIconGlyph('book')).toBe('📚')
    expect(resolveSectionIconGlyph('family')).toBe('👨‍👩‍👧')
  })

  test('keeps legacy raw emoji and aliases compatible', () => {
    expect(resolveSectionIconGlyph('🚗')).toBe('🚗')
    expect(resolveSectionIconGlyph('books')).toBe('📚')
    expect(normalizeSectionIconValue('walk')).toBe('family')
  })

  test('uses fallback for empty values and preserves custom glyphs', () => {
    expect(resolveSectionIconGlyph('', '告')).toBe('告')
    expect(resolveSectionIconGlyph('🌱')).toBe('🌱')
  })

  test('does not leak unknown internal string values into the UI', () => {
    expect(resolveSectionIconGlyph('object')).toBe('·')
    expect(resolveSectionIconGlyph('video')).toBe('🎬')
    expect(resolveSectionIconGlyph('test')).toBe('🧪')
  })
})
