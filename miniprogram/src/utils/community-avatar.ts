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

const COMBINING_MARK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0300, 0x036f],
  [0x0483, 0x0489],
  [0x0591, 0x05bd], [0x05bf, 0x05bf], [0x05c1, 0x05c2], [0x05c4, 0x05c5], [0x05c7, 0x05c7],
  [0x0610, 0x061a], [0x064b, 0x065f], [0x0670, 0x0670], [0x06d6, 0x06dc],
  [0x06df, 0x06e4], [0x06e7, 0x06e8], [0x06ea, 0x06ed],
  [0x0711, 0x0711], [0x0730, 0x074a], [0x07a6, 0x07b0], [0x07eb, 0x07f3],
  [0x0816, 0x0819], [0x081b, 0x0823], [0x0825, 0x0827], [0x0829, 0x082d],
  [0x0859, 0x085b], [0x08d3, 0x0903],
  [0x093a, 0x093c], [0x093e, 0x094f], [0x0951, 0x0957], [0x0962, 0x0963],
  [0x0981, 0x0983], [0x09bc, 0x09bc], [0x09be, 0x09c4], [0x09c7, 0x09c8],
  [0x09cb, 0x09cd], [0x09d7, 0x09d7], [0x09e2, 0x09e3],
  [0x0a01, 0x0a03], [0x0a3c, 0x0a3c], [0x0a3e, 0x0a42], [0x0a47, 0x0a48],
  [0x0a4b, 0x0a4d], [0x0a51, 0x0a51], [0x0a70, 0x0a71], [0x0a75, 0x0a75],
  [0x0a81, 0x0a83], [0x0abc, 0x0abc], [0x0abe, 0x0ac5], [0x0ac7, 0x0ac9],
  [0x0acb, 0x0acd], [0x0ae2, 0x0ae3],
  [0x0b01, 0x0b03], [0x0b3c, 0x0b3c], [0x0b3e, 0x0b44], [0x0b47, 0x0b48],
  [0x0b4b, 0x0b4d], [0x0b55, 0x0b57], [0x0b62, 0x0b63],
  [0x0b82, 0x0b82], [0x0bbe, 0x0bc2], [0x0bc6, 0x0bc8], [0x0bca, 0x0bcd], [0x0bd7, 0x0bd7],
  [0x0c00, 0x0c04], [0x0c3c, 0x0c44], [0x0c46, 0x0c48], [0x0c4a, 0x0c4d],
  [0x0c55, 0x0c56], [0x0c62, 0x0c63],
  [0x0c81, 0x0c83], [0x0cbc, 0x0cbc], [0x0cbe, 0x0cc4], [0x0cc6, 0x0cc8],
  [0x0cca, 0x0ccd], [0x0cd5, 0x0cd6], [0x0ce2, 0x0ce3],
  [0x0d00, 0x0d03], [0x0d3b, 0x0d44], [0x0d46, 0x0d48], [0x0d4a, 0x0d4d],
  [0x0d57, 0x0d57], [0x0d62, 0x0d63],
  [0x0e31, 0x0e31], [0x0e34, 0x0e3a], [0x0e47, 0x0e4e],
  [0x0eb1, 0x0eb1], [0x0eb4, 0x0ebc], [0x0ec8, 0x0ecd],
  [0x0f18, 0x0f19], [0x0f35, 0x0f35], [0x0f37, 0x0f37], [0x0f39, 0x0f39],
  [0x0f71, 0x0f84], [0x0f86, 0x0f87], [0x0f8d, 0x0fbc],
  [0x102b, 0x103e], [0x1056, 0x1059], [0x105e, 0x1060], [0x1062, 0x1064],
  [0x1067, 0x106d], [0x1071, 0x1074], [0x1082, 0x108d], [0x108f, 0x108f],
  [0x135d, 0x135f], [0x1712, 0x1715], [0x1732, 0x1734], [0x1752, 0x1753],
  [0x1772, 0x1773], [0x17b4, 0x17d3], [0x17dd, 0x17dd], [0x180b, 0x180f],
  [0x1885, 0x1886], [0x18a9, 0x18a9], [0x1a17, 0x1a1b], [0x1a55, 0x1a7f],
  [0x1ab0, 0x1aff], [0x1dc0, 0x1dff], [0x20d0, 0x20ff], [0xfe20, 0xfe2f],
]

const isExtension = (value: string): boolean => {
  const codePoint = value.codePointAt(0) ?? 0
  return (
    COMBINING_MARK_RANGES.some((range) => inRange(codePoint, range[0], range[1])) ||
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

  const first = appendCodePoint()
  if (inRange(first.codePointAt(0) ?? 0, 0x1f1e6, 0x1f1ff) && offset < value.length) {
    const next = readCodePoint(value, offset).text
    if (inRange(next.codePointAt(0) ?? 0, 0x1f1e6, 0x1f1ff)) appendCodePoint()
  }
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
