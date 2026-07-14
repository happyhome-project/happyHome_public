export const COMMUNITY_AVATAR_BACKGROUND = '#E8F8F0'
export const COMMUNITY_AVATAR_FOREGROUND = '#1F7A50'
export const COMMUNITY_AVATAR_FONT_WEIGHT = 600

interface GraphemeSegmenter {
  segment(value: string): Iterable<{ segment: string }>
}

interface SegmenterHost {
  Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => GraphemeSegmenter
}

interface CommunityInitialOptions {
  segmenter?: GraphemeSegmenter | null
  intl?: SegmenterHost | null
}

const inRange = (value: number, start: number, end: number): boolean => value >= start && value <= end

const isExtension = (value: string): boolean => {
  const codePoint = value.codePointAt(0) ?? 0
  return (
    inRange(codePoint, 0x0300, 0x036f) ||
    inRange(codePoint, 0x1ab0, 0x1aff) ||
    inRange(codePoint, 0x1dc0, 0x1dff) ||
    inRange(codePoint, 0x20d0, 0x20ff) ||
    inRange(codePoint, 0xfe20, 0xfe2f) ||
    codePoint === 0xfe0e ||
    codePoint === 0xfe0f ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef) ||
    (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)
  )
}

const readCodePoint = (value: string, offset: number): { text: string; width: number } => {
  const first = value.charCodeAt(offset)
  if (inRange(first, 0xd800, 0xdbff) && offset + 1 < value.length) {
    const second = value.charCodeAt(offset + 1)
    if (inRange(second, 0xdc00, 0xdfff)) return { text: value.slice(offset, offset + 2), width: 2 }
  }
  return { text: value.charAt(offset), width: 1 }
}

const fallbackFirstGrapheme = (value: string): string => {
  let offset = 0
  let result = ''
  const appendCodePoint = (): string => {
    const current = readCodePoint(value, offset)
    result += current.text
    offset += current.width
    return current.text
  }

  appendCodePoint()
  while (offset < value.length && isExtension(readCodePoint(value, offset).text)) appendCodePoint()
  while (offset < value.length && readCodePoint(value, offset).text === '\u200d') {
    appendCodePoint()
    if (offset >= value.length) break
    appendCodePoint()
    while (offset < value.length && isExtension(readCodePoint(value, offset).text)) appendCodePoint()
  }

  return result
}

const nativeSegmenter = (host: SegmenterHost | null): GraphemeSegmenter | null => {
  const Segmenter = host?.Segmenter
  if (!Segmenter) return null
  try {
    return new Segmenter(undefined, { granularity: 'grapheme' })
  } catch (_error) {
    return null
  }
}

export const communityInitial = (
  value: string | null | undefined,
  options: CommunityInitialOptions = {},
): string => {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return '群'

  const host = options.intl === undefined
    ? (typeof Intl === 'undefined' ? null : Intl as unknown as SegmenterHost)
    : options.intl
  const segmenter = options.segmenter === undefined ? nativeSegmenter(host) : options.segmenter
  if (segmenter) return segmenter.segment(trimmed)[Symbol.iterator]().next().value?.segment ?? '群'

  return fallbackFirstGrapheme(trimmed)
}
