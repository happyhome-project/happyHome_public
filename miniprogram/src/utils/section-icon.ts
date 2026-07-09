export const SECTION_ICON_OPTIONS = [
  { value: '', glyph: '·', label: '系统默认' },
  { value: 'notice', glyph: '📣', label: '通知' },
  { value: 'car', glyph: '🚗', label: '出行' },
  { value: 'food', glyph: '🍲', label: '美食' },
  { value: 'trade', glyph: '🛍️', label: '闲置' },
  { value: 'book', glyph: '📚', label: '学习' },
  { value: 'activity', glyph: '🏃', label: '活动' },
  { value: 'pet', glyph: '🐾', label: '宠物' },
  { value: 'family', glyph: '👨‍👩‍👧', label: '亲子' },
  { value: 'chat', glyph: '💬', label: '交流' },
] as const

const sectionIconByValue: Map<string, string> = new Map(
  SECTION_ICON_OPTIONS.map((option) => [option.value, option.glyph]),
)

const legacySectionIconAliases: Record<string, string> = {
  '📣': 'notice',
  '🚗': 'car',
  '🍲': 'food',
  '🛍️': 'trade',
  '📚': 'book',
  '🏃': 'activity',
  '🐾': 'pet',
  '👨‍👩‍👧': 'family',
  '💬': 'chat',
  books: 'book',
  letter: 'book',
  walk: 'family',
  travel: 'car',
  video: 'video',
  play: 'video',
  class: 'book',
  star: 'star',
  child: 'family',
  test: 'test',
}

const legacySectionIconGlyphs: Record<string, string> = {
  video: '🎬',
  star: '⭐',
  test: '🧪',
}

const CUSTOM_ICON_GLYPH_RE = /\p{Extended_Pictographic}/u

export function normalizeSectionIconValue(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (sectionIconByValue.has(raw)) return raw
  return legacySectionIconAliases[raw] || raw
}

export function resolveSectionIconGlyph(value: unknown, fallback = '·'): string {
  const raw = String(value || '').trim()
  if (!raw) return fallback
  const normalized = normalizeSectionIconValue(raw)
  return sectionIconByValue.get(normalized) || legacySectionIconGlyphs[normalized] || (CUSTOM_ICON_GLYPH_RE.test(raw) ? raw : fallback)
}
