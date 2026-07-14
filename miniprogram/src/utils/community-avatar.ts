export const COMMUNITY_AVATAR_BACKGROUND = '#E8F8F0'
export const COMMUNITY_AVATAR_FOREGROUND = '#1F7A50'
export const COMMUNITY_AVATAR_FONT_WEIGHT = 600

interface GraphemeSegmenter {
  segment(value: string): Iterable<{ segment: string }>
}

interface CommunityInitialOptions {
  segmenter?: GraphemeSegmenter | null
}

const isExtension = (value: string): boolean => {
  const codePoint = value.codePointAt(0) ?? 0
  return (
    /\p{Mark}/u.test(value) ||
    codePoint === 0xfe0e ||
    codePoint === 0xfe0f ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef) ||
    (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)
  )
}

const fallbackFirstGrapheme = (value: string): string => {
  const codePoints = Array.from(value)
  let end = 1

  while (end < codePoints.length && isExtension(codePoints[end])) end += 1
  while (codePoints[end] === '\u200d' && end + 1 < codePoints.length) {
    end += 2
    while (end < codePoints.length && isExtension(codePoints[end])) end += 1
  }

  return codePoints.slice(0, end).join('')
}

const nativeSegmenter = (): GraphemeSegmenter | null => {
  const Segmenter = (
    Intl as unknown as {
      Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => GraphemeSegmenter
    }
  ).Segmenter
  return Segmenter ? new Segmenter(undefined, { granularity: 'grapheme' }) : null
}

export const communityInitial = (
  value: string | null | undefined,
  options: CommunityInitialOptions = {},
): string => {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return '群'

  const segmenter = options.segmenter === undefined ? nativeSegmenter() : options.segmenter
  if (segmenter) return segmenter.segment(trimmed)[Symbol.iterator]().next().value?.segment ?? '群'

  return fallbackFirstGrapheme(trimmed)
}
