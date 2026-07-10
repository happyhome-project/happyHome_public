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

function firstCodePoint(value: string): number {
  const first = value.charCodeAt(0)
  if (first >= 0xd800 && first <= 0xdbff && value.length > 1) {
    const second = value.charCodeAt(1)
    if (second >= 0xdc00 && second <= 0xdfff) {
      return (first - 0xd800) * 0x400 + second - 0xdc00 + 0x10000
    }
  }
  return first
}

function isCustomEmojiGlyph(value: string): boolean {
  const codePoint = firstCodePoint(value)
  return (
    (codePoint >= 0x1f000 && codePoint <= 0x1faff) ||
    (codePoint >= 0x2600 && codePoint <= 0x27bf) ||
    (codePoint >= 0x2b00 && codePoint <= 0x2bff) ||
    [0x00a9, 0x00ae, 0x203c, 0x2049, 0x2122, 0x2139, 0x3030, 0x303d, 0x3297, 0x3299].includes(codePoint)
  )
}

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
  return sectionIconByValue.get(normalized) || legacySectionIconGlyphs[normalized] || (isCustomEmojiGlyph(raw) ? raw : fallback)
}
