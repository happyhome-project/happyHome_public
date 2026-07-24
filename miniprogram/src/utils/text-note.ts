import { htmlToMarkdown, markdownToText } from './rich-note'

export const TEXT_NOTE_THEMES = ['paper', 'mint', 'slate', 'headline', 'quote', 'notice'] as const

export type TextNoteTheme = typeof TEXT_NOTE_THEMES[number]
export type TextNoteBodySize = 'large' | 'medium' | 'small'
export type TextNoteLayout = 'memo' | 'fresh' | 'night' | 'newspaper' | 'quotation' | 'bulletin'
export type TextNoteDisplayVariant = 'cover' | 'document'
export type TextNotePageKind = 'cover' | 'body'

export interface TextNoteThemePresentation {
  kicker: string
  layout: TextNoteLayout
  titleTone: 'handwritten' | 'friendly' | 'modern' | 'editorial' | 'literary' | 'official'
  ornament: 'pin' | 'leaf' | 'stars' | 'rule' | 'quote' | 'stamp'
}

const TEXT_NOTE_THEME_PRESENTATIONS: Record<TextNoteTheme, TextNoteThemePresentation> = {
  paper: { kicker: '社区便签', layout: 'memo', titleTone: 'handwritten', ornament: 'pin' },
  mint: { kicker: '邻里日常', layout: 'fresh', titleTone: 'friendly', ornament: 'leaf' },
  slate: { kicker: '今日记录', layout: 'night', titleTone: 'modern', ornament: 'stars' },
  headline: { kicker: '社区小报', layout: 'newspaper', titleTone: 'editorial', ornament: 'rule' },
  quote: { kicker: '一句话', layout: 'quotation', titleTone: 'literary', ornament: 'quote' },
  notice: { kicker: '通知公告', layout: 'bulletin', titleTone: 'official', ornament: 'stamp' },
}

export interface TextNoteBodySafeRect {
  x: number
  y: number
  width: number
  height: number
}

export interface TextNoteBodyLayout {
  safeRect: Readonly<TextNoteBodySafeRect>
  fontFamily: string
  fontSize: number
  lineHeight: number
  unitsPerLine: number
  maxLines: number
  referenceCapacity: number
  safeCapacity: number
}

function createTextNoteBodyLayout(
  safeRect: TextNoteBodySafeRect,
  fontFamily: string,
  unitsPerLine: number,
  maxLines: number,
): Readonly<TextNoteBodyLayout> {
  const referenceCapacity = unitsPerLine * maxLines
  return Object.freeze({
    safeRect: Object.freeze(safeRect),
    fontFamily,
    fontSize: 16,
    lineHeight: 24,
    unitsPerLine,
    maxLines,
    referenceCapacity,
    safeCapacity: referenceCapacity - 1,
  })
}

const TEXT_NOTE_BODY_SANS = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
const TEXT_NOTE_BODY_SERIF = '"Songti SC", "Noto Serif SC", SimSun, serif'

export const TEXT_NOTE_BODY_LAYOUTS: Readonly<Record<TextNoteTheme, Readonly<TextNoteBodyLayout>>> = Object.freeze({
  paper: createTextNoteBodyLayout({ x: 32, y: 48, width: 306, height: 384 }, TEXT_NOTE_BODY_SANS, 19, 16),
  mint: createTextNoteBodyLayout({ x: 32, y: 52, width: 306, height: 384 }, TEXT_NOTE_BODY_SANS, 19, 16),
  slate: createTextNoteBodyLayout({ x: 36, y: 58, width: 298, height: 384 }, TEXT_NOTE_BODY_SANS, 18, 16),
  headline: createTextNoteBodyLayout({ x: 36, y: 94, width: 298, height: 360 }, TEXT_NOTE_BODY_SERIF, 18, 15),
  quote: createTextNoteBodyLayout({ x: 40, y: 92, width: 290, height: 360 }, TEXT_NOTE_BODY_SERIF, 18, 15),
  notice: createTextNoteBodyLayout({ x: 36, y: 54, width: 298, height: 384 }, TEXT_NOTE_BODY_SERIF, 18, 16),
})

export function getTextNoteBodyLayout(value: unknown): Readonly<TextNoteBodyLayout> {
  return TEXT_NOTE_BODY_LAYOUTS[normalizeTextNoteTheme(value)]
}

// Keep the exported custom-pagination defaults stable for callers that override
// only one dimension. Production theme pagination reads TEXT_NOTE_BODY_LAYOUTS.
export const TEXT_NOTE_BODY_UNITS_PER_LINE = 17
export const TEXT_NOTE_BODY_MAX_LINES = 15

export interface PostPresentation {
  textNoteTheme?: TextNoteTheme
}

export interface TextNoteContent {
  title: string
  body: string
}

export interface TextNoteCard extends TextNoteContent {
  theme: TextNoteTheme
}

export interface TextNotePage {
  kind: TextNotePageKind
  kicker: string
  title: string
  body: string
  sourceBody: string
  pageNumber: number
  totalPages: number
}

export interface TextNoteDeck {
  theme: TextNoteTheme
  label: string
  pages: TextNotePage[]
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim()
}

interface TextNoteCodePoint {
  character: string
  code: number
  length: number
}

interface TextNoteGraphemeSegmenter {
  segment(value: string): Iterable<{ segment: string }>
}

interface TextNoteSegmenterHost {
  Segmenter?: new (
    locale?: string,
    options?: { granularity: 'grapheme' },
  ) => TextNoteGraphemeSegmenter
}

function readTextNoteCodePoint(text: string, index: number): TextNoteCodePoint {
  const first = text.charCodeAt(index)
  const second = text.charCodeAt(index + 1)
  if (first >= 0xd800 && first <= 0xdbff && second >= 0xdc00 && second <= 0xdfff) {
    return {
      character: text.charAt(index) + text.charAt(index + 1),
      code: ((first - 0xd800) * 0x400) + (second - 0xdc00) + 0x10000,
      length: 2,
    }
  }
  return {
    character: text.charAt(index),
    code: first,
    length: 1,
  }
}

const TEXT_NOTE_COMBINING_MARK_RANGES: ReadonlyArray<readonly [number, number]> = [
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
  [0x1ab0, 0x1aff],
  [0x1cd0, 0x1cd2], [0x1cd4, 0x1ce8], [0x1ced, 0x1ced], [0x1cf4, 0x1cf4], [0x1cf7, 0x1cf9],
  [0x1dc0, 0x1dff], [0x20d0, 0x20ff], [0xfe20, 0xfe2f],
]

function isTextNoteCombiningCodePoint(code: number): boolean {
  return TEXT_NOTE_COMBINING_MARK_RANGES.some(([start, end]) => code >= start && code <= end)
}

type TextNoteHangulType = 'L' | 'V' | 'T' | 'LV' | 'LVT' | null

function textNoteHangulType(code: number): TextNoteHangulType {
  if ((code >= 0x1100 && code <= 0x115f) || (code >= 0xa960 && code <= 0xa97c)) return 'L'
  if ((code >= 0x1160 && code <= 0x11a7) || (code >= 0xd7b0 && code <= 0xd7c6)) return 'V'
  if ((code >= 0x11a8 && code <= 0x11ff) || (code >= 0xd7cb && code <= 0xd7fb)) return 'T'
  if (code >= 0xac00 && code <= 0xd7a3) {
    return (code - 0xac00) % 28 === 0 ? 'LV' : 'LVT'
  }
  return null
}

function shouldJoinTextNoteHangul(previous: TextNoteHangulType, next: TextNoteHangulType): boolean {
  if (!previous || !next) return false
  if (previous === 'L') return next === 'L' || next === 'V' || next === 'LV' || next === 'LVT'
  if (previous === 'LV' || previous === 'V') return next === 'V' || next === 'T'
  return (previous === 'LVT' || previous === 'T') && next === 'T'
}

function isTextNoteVariationSelector(code: number): boolean {
  return (code >= 0xfe00 && code <= 0xfe0f) || (code >= 0xe0100 && code <= 0xe01ef)
}

function isTextNoteEmojiModifier(code: number): boolean {
  return code >= 0x1f3fb && code <= 0x1f3ff
}

function isTextNoteEmojiTag(code: number): boolean {
  return code >= 0xe0020 && code <= 0xe007f
}

function isTextNoteRegionalIndicator(code: number): boolean {
  return code >= 0x1f1e6 && code <= 0x1f1ff
}

// Unicode 17.0 Grapheme_Cluster_Break=Prepend. Keep this explicit because the
// compiled mini-program policy forbids Unicode property escape regexes.
const TEXT_NOTE_PREPEND_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0600, 0x0605],
  [0x06dd, 0x06dd],
  [0x070f, 0x070f],
  [0x0890, 0x0891],
  [0x08e2, 0x08e2],
  [0x0d4e, 0x0d4e],
  [0x110bd, 0x110bd],
  [0x110cd, 0x110cd],
  [0x111c2, 0x111c3],
  [0x113d1, 0x113d1],
  [0x1193f, 0x1193f],
  [0x11941, 0x11941],
  [0x11a84, 0x11a89],
  [0x11d46, 0x11d46],
  [0x11f02, 0x11f02],
]

function isTextNotePrependCodePoint(code: number): boolean {
  return TEXT_NOTE_PREPEND_RANGES.some(([start, end]) => code >= start && code <= end)
}

const TEXT_NOTE_GRAPHEME_CONTROL_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x0009],
  [0x000a, 0x000a],
  [0x000b, 0x000c],
  [0x000d, 0x000d],
  [0x000e, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad],
  [0x061c, 0x061c],
  [0x180e, 0x180e],
  [0x200b, 0x200b],
  [0x200e, 0x200f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0xfeff, 0xfeff],
  [0xfff0, 0xfffb],
  [0x13430, 0x1343f],
  [0x1bca0, 0x1bca3],
  [0x1d173, 0x1d17a],
  [0xe0000, 0xe001f],
  [0xe0080, 0xe00ff],
  [0xe01f0, 0xe0fff],
]

function isTextNoteGraphemeControl(code: number): boolean {
  return TEXT_NOTE_GRAPHEME_CONTROL_RANGES.some(
    ([start, end]) => code >= start && code <= end,
  )
}

function isTextNoteTrailingCodePoint(code: number): boolean {
  return (
    isTextNoteCombiningCodePoint(code) ||
    isTextNoteVariationSelector(code) ||
    isTextNoteEmojiModifier(code) ||
    isTextNoteEmojiTag(code) ||
    code === 0x20e3
  )
}

const TEXT_NOTE_INDIC_LINKERS = new Set([
  0x094d, 0x09cd, 0x0a4d, 0x0acd, 0x0b4d, 0x0bcd, 0x0c4d, 0x0ccd,
  0x0d3b, 0x0d3c, 0x0d4d, 0x0dca, 0x0e3a, 0x0f84, 0x1039, 0x103a,
  0x1714, 0x1734, 0x17d2, 0x1a60, 0x1b44, 0x1baa, 0x1bab, 0xa806,
  0xa8c4, 0xa953, 0xa9c0, 0xaaf6, 0x10a3f, 0x11046, 0x110b9,
  0x11133, 0x111c0, 0x11235, 0x1134d, 0x11442, 0x114c2, 0x115bf,
  0x1163f, 0x116b6, 0x1172b, 0x11839, 0x1193d, 0x1193e, 0x119e0,
  0x11a34, 0x11a47, 0x11a99, 0x11c3f, 0x11d44, 0x11d45, 0x11d97,
  0x11f42,
])

const TEXT_NOTE_INDIC_SCRIPT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0900, 0x0dff],
  [0x0f00, 0x109f],
  [0x1700, 0x17ff],
  [0x1a00, 0x1cff],
  [0xa800, 0xabff],
  [0x11000, 0x11fff],
]

function isTextNoteIndicBase(code: number): boolean {
  return (
    !isTextNoteCombiningCodePoint(code) &&
    !TEXT_NOTE_INDIC_LINKERS.has(code) &&
    TEXT_NOTE_INDIC_SCRIPT_RANGES.some(([start, end]) => code >= start && code <= end)
  )
}

const TEXT_NOTE_MAX_GRAPHEME_CODE_POINTS = 16

interface TextNoteCharacterUnit {
  character: string
  hardPageBreakBefore: boolean
}

function fallbackTextNoteCharacterUnits(value: unknown): TextNoteCharacterUnit[] {
  const text = String(value || '')
  const characters: TextNoteCharacterUnit[] = []

  let index = 0
  let hardPageBreakBefore = false
  while (index < text.length) {
    const first = readTextNoteCodePoint(text, index)
    let character = first.character
    let hangulType = textNoteHangulType(first.code)
    let lastCode = first.code
    let indicBaseCount = isTextNoteIndicBase(first.code) ? 1 : 0
    let prependSequence = isTextNotePrependCodePoint(first.code)
    let clusterCodePoints = 1
    let forcedSplit = false
    index += first.length

    if (first.code === 0x000d && index < text.length) {
      const lineFeed = readTextNoteCodePoint(text, index)
      if (lineFeed.code === 0x000a) {
        character += lineFeed.character
        clusterCodePoints += 1
        index += lineFeed.length
      }
    } else if (isTextNoteRegionalIndicator(first.code) && index < text.length) {
      const regionalPair = readTextNoteCodePoint(text, index)
      if (
        clusterCodePoints < TEXT_NOTE_MAX_GRAPHEME_CODE_POINTS
        && isTextNoteRegionalIndicator(regionalPair.code)
      ) {
        character += regionalPair.character
        clusterCodePoints += 1
        index += regionalPair.length
      }
    }

    let joining = !isTextNoteGraphemeControl(first.code)
    while (joining && index < text.length) {
      const next = readTextNoteCodePoint(text, index)
      const nextHangulType = textNoteHangulType(next.code)
      if (prependSequence && !isTextNoteGraphemeControl(next.code)) {
        if (clusterCodePoints >= TEXT_NOTE_MAX_GRAPHEME_CODE_POINTS) {
          forcedSplit = true
          break
        }
        character += next.character
        clusterCodePoints += 1
        prependSequence = isTextNotePrependCodePoint(next.code)
        hangulType = nextHangulType
        lastCode = next.code
        if (isTextNoteIndicBase(next.code)) indicBaseCount += 1
        index += next.length
        continue
      }
      if (shouldJoinTextNoteHangul(hangulType, nextHangulType)) {
        if (clusterCodePoints >= TEXT_NOTE_MAX_GRAPHEME_CODE_POINTS) {
          forcedSplit = true
          break
        }
        character += next.character
        clusterCodePoints += 1
        hangulType = nextHangulType
        lastCode = next.code
        index += next.length
        continue
      }
      if (isTextNoteTrailingCodePoint(next.code)) {
        if (clusterCodePoints >= TEXT_NOTE_MAX_GRAPHEME_CODE_POINTS) {
          forcedSplit = true
          break
        }
        character += next.character
        clusterCodePoints += 1
        lastCode = next.code
        index += next.length
        continue
      }
      if (next.code === 0x200d && index + next.length < text.length) {
        if (clusterCodePoints + 2 > TEXT_NOTE_MAX_GRAPHEME_CODE_POINTS) {
          // Keep the joiner with the preceding fragment when one slot remains,
          // so the next render page starts with the visible joined character.
          if (clusterCodePoints < TEXT_NOTE_MAX_GRAPHEME_CODE_POINTS) {
            character += next.character
            clusterCodePoints += 1
            index += next.length
          }
          forcedSplit = true
          break
        }
        character += next.character
        clusterCodePoints += 1
        index += next.length
        const joined = readTextNoteCodePoint(text, index)
        character += joined.character
        clusterCodePoints += 1
        hangulType = textNoteHangulType(joined.code)
        lastCode = joined.code
        if (isTextNoteIndicBase(joined.code)) indicBaseCount += 1
        index += joined.length
        continue
      }
      if (
        TEXT_NOTE_INDIC_LINKERS.has(lastCode) &&
        indicBaseCount < 8 &&
        isTextNoteIndicBase(next.code)
      ) {
        if (clusterCodePoints >= TEXT_NOTE_MAX_GRAPHEME_CODE_POINTS) {
          forcedSplit = true
          break
        }
        character += next.character
        clusterCodePoints += 1
        lastCode = next.code
        indicBaseCount += 1
        index += next.length
        continue
      }
      joining = false
    }
    characters.push({
      character,
      hardPageBreakBefore,
    })
    hardPageBreakBefore = forcedSplit
  }

  return characters
}

let cachedTextNoteSegmenter: TextNoteGraphemeSegmenter | null | undefined
let cachedTextNoteSegmenterConstructor: TextNoteSegmenterHost['Segmenter'] | undefined
let hasCachedTextNoteSegmenter = false

function nativeTextNoteSegmenter(): TextNoteGraphemeSegmenter | null {
  const host = typeof Intl === 'undefined' ? null : Intl as unknown as TextNoteSegmenterHost
  const Segmenter = host?.Segmenter
  if (hasCachedTextNoteSegmenter && Segmenter === cachedTextNoteSegmenterConstructor) {
    return cachedTextNoteSegmenter || null
  }
  hasCachedTextNoteSegmenter = true
  cachedTextNoteSegmenterConstructor = Segmenter
  if (!Segmenter) {
    cachedTextNoteSegmenter = null
    return cachedTextNoteSegmenter
  }
  try {
    cachedTextNoteSegmenter = new Segmenter(undefined, { granularity: 'grapheme' })
  } catch (_error) {
    cachedTextNoteSegmenter = null
  }
  return cachedTextNoteSegmenter
}

function textNoteCodePointCount(value: string): number {
  let count = 0
  for (let index = 0; index < value.length;) {
    const current = readTextNoteCodePoint(value, index)
    count += 1
    index += current.length
  }
  return count
}

function boundOverlongTextNoteSegment(segment: string): TextNoteCharacterUnit[] {
  const units = fallbackTextNoteCharacterUnits(segment)
  const boundedUnits: TextNoteCharacterUnit[] = []
  let currentCodePoints = 0

  for (const unit of units) {
    const codePoints = textNoteCodePointCount(unit.character)
    const hardPageBreakBefore = unit.hardPageBreakBefore
      || (
        currentCodePoints > 0
        && currentCodePoints + codePoints > TEXT_NOTE_MAX_GRAPHEME_CODE_POINTS
      )
    if (hardPageBreakBefore) currentCodePoints = 0
    boundedUnits.push({
      character: unit.character,
      hardPageBreakBefore,
    })
    currentCodePoints += codePoints
  }

  return boundedUnits
}

function textNoteCharacterUnits(value: unknown): TextNoteCharacterUnit[] {
  const text = String(value || '')
  const segmenter = nativeTextNoteSegmenter()
  if (!segmenter) return fallbackTextNoteCharacterUnits(text)

  const characters: TextNoteCharacterUnit[] = []
  for (const item of segmenter.segment(text)) {
    const segment = item.segment
    // An unbounded conjunct cannot fit on a fixed card. Preserve normal UAX
    // clusters, but use bounded render-safe units for pathological clusters.
    if (textNoteCodePointCount(segment) > TEXT_NOTE_MAX_GRAPHEME_CODE_POINTS) {
      characters.push(...boundOverlongTextNoteSegment(segment))
    } else {
      characters.push({
        character: segment,
        hardPageBreakBefore: false,
      })
    }
  }
  return characters
}

function textNoteCharacters(value: unknown): string[] {
  return textNoteCharacterUnits(value).map((unit) => unit.character)
}

export function normalizeTextNoteTitle(value: unknown, maxLength = 48): string {
  return textNoteCharacters(normalizeText(value)).slice(0, maxLength).join('')
}

function firstVisibleMarkdownParagraph(markdown: string): string {
  const blocks = String(markdown || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)
  for (const block of blocks) {
    const visibleText = markdownToText(block)
    if (visibleText) return visibleText
  }
  return ''
}

function richNoteText(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const note = value as { markdown?: unknown; html?: unknown; text?: unknown }
    if (typeof note.markdown === 'string' && note.markdown.trim()) {
      const fromMarkdown = firstVisibleMarkdownParagraph(note.markdown)
      if (fromMarkdown) return fromMarkdown
    }
    if (typeof note.html === 'string' && note.html.trim()) {
      const fromHtml = firstVisibleMarkdownParagraph(htmlToMarkdown(note.html))
      if (fromHtml) return fromHtml
    }
    const text = note.text
    if (typeof text === 'string') return text
  }
  return normalizeText(value)
}

export function normalizeTextNoteTheme(value: unknown): TextNoteTheme {
  return TEXT_NOTE_THEMES.includes(value as TextNoteTheme) ? value as TextNoteTheme : 'paper'
}

export function getTextNoteThemePresentation(value: unknown): TextNoteThemePresentation {
  return TEXT_NOTE_THEME_PRESENTATIONS[normalizeTextNoteTheme(value)]
}

export function normalizeTextNoteBody(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function textNoteNonEmojiClusterWeight(value: string): number {
  let visibleBases = 0
  let sawHangul = false
  let onlyHangulAndExtensions = true

  for (let index = 0; index < value.length;) {
    const current = readTextNoteCodePoint(value, index)
    index += current.length
    if (current.code === 0x200d || isTextNoteTrailingCodePoint(current.code)) continue

    const hangulType = textNoteHangulType(current.code)
    if (hangulType) {
      sawHangul = true
    } else {
      onlyHangulAndExtensions = false
    }
    visibleBases += 1
  }

  if (sawHangul && onlyHangulAndExtensions) return 1
  return Math.max(1, visibleBases)
}

function textNoteCharacterVisualWeight(character: string): number {
  if (character === '\n') return 0
  if (/^\s$/.test(character)) return 0.3
  if (/^[\x00-\x7f]$/.test(character)) {
    if (/^[MWmw@#%&]$/.test(character)) return 1
    if (/^[ilI1.,'`:;!|]$/.test(character)) return 0.35
    if (/^[A-Z0-9]$/.test(character)) return 0.72
    return 0.65
  }
  const first = readTextNoteCodePoint(character, 0)
  const isEmoji = first.code >= 0x1f000 || character.indexOf('\u200d') >= 0 || character.indexOf('\ufe0f') >= 0
  return isEmoji ? 1.6 : textNoteNonEmojiClusterWeight(character)
}

interface TextNotePageMetrics {
  completedLines: number
  currentLineUnits: number
  visualUnits: number
}

function emptyTextNotePageMetrics(): TextNotePageMetrics {
  return {
    completedLines: 0,
    currentLineUnits: 0,
    visualUnits: 0,
  }
}

function appendTextNotePageMetrics(
  metrics: TextNotePageMetrics,
  character: string,
  unitsPerLine: number,
): TextNotePageMetrics {
  if (character === '\n') {
    return {
      completedLines: metrics.completedLines + 1,
      currentLineUnits: 0,
      visualUnits: metrics.visualUnits,
    }
  }

  const weight = textNoteCharacterVisualWeight(character)
  const wraps = metrics.currentLineUnits > 0
    && metrics.currentLineUnits + weight > unitsPerLine
  return {
    completedLines: metrics.completedLines + (wraps ? 1 : 0),
    currentLineUnits: wraps ? weight : metrics.currentLineUnits + weight,
    visualUnits: metrics.visualUnits + weight,
  }
}

function textNoteMetricsFit(
  metrics: TextNotePageMetrics,
  maxLines: number,
  maxVisualUnits: number,
): boolean {
  const lineCount = metrics.completedLines + (metrics.currentLineUnits > 0 ? 1 : 0)
  return lineCount <= maxLines && metrics.visualUnits <= maxVisualUnits
}

function tryAppendTextNoteUnits(
  metrics: TextNotePageMetrics,
  units: TextNoteCharacterUnit[],
  unitsPerLine: number,
  maxLines: number,
  maxVisualUnits: number,
): TextNotePageMetrics | null {
  let candidate = metrics
  for (const unit of units) {
    candidate = appendTextNotePageMetrics(candidate, unit.character, unitsPerLine)
    if (!textNoteMetricsFit(candidate, maxLines, maxVisualUnits)) return null
  }
  return candidate
}

function isTextNoteSentenceBoundary(character: string): boolean {
  return character === '\n' || '。！？!?；;'.indexOf(character) >= 0
}

function textNoteAtomicSegments(value: string): TextNoteCharacterUnit[][] {
  const segments: TextNoteCharacterUnit[][] = []
  let current: TextNoteCharacterUnit[] = []
  const characters = textNoteCharacterUnits(value)
  for (const unit of characters) {
    if (unit.hardPageBreakBefore && current.length) {
      segments.push(current)
      current = []
    }
    current.push(unit)
    if (isTextNoteSentenceBoundary(unit.character)) {
      segments.push(current)
      current = []
    }
  }
  if (current.length) segments.push(current)
  return segments
}

export function paginateTextNoteBody(
  value: unknown,
  options: {
    theme?: unknown
    unitsPerLine?: number
    maxLines?: number
    maxVisualUnits?: number
  } = {},
): string[] {
  const normalized = normalizeTextNoteBody(value)
  if (!normalized) return []

  const themeLayout = getTextNoteBodyLayout(options.theme)
  const requestedUnitsPerLine = Number(options.unitsPerLine)
  const requestedMaxLines = Number(options.maxLines)
  const requestedMaxVisualUnits = Number(options.maxVisualUnits)
  const hasUnitsOverride = Number.isFinite(requestedUnitsPerLine) && requestedUnitsPerLine > 0
  const hasLinesOverride = Number.isFinite(requestedMaxLines) && requestedMaxLines > 0
  const unitsPerLine = Math.max(
    1,
    hasUnitsOverride
      ? requestedUnitsPerLine
      : hasLinesOverride
        ? TEXT_NOTE_BODY_UNITS_PER_LINE
        : themeLayout.unitsPerLine,
  )
  const maxLines = Math.max(
    1,
    hasLinesOverride
      ? Math.floor(requestedMaxLines)
      : hasUnitsOverride
        ? TEXT_NOTE_BODY_MAX_LINES
        : themeLayout.maxLines,
  )
  const maxVisualUnits = Math.max(
    1,
    Number.isFinite(requestedMaxVisualUnits) && requestedMaxVisualUnits > 0
      ? requestedMaxVisualUnits
      : (hasUnitsOverride || hasLinesOverride)
        ? unitsPerLine * maxLines
        : themeLayout.safeCapacity,
  )
  const atomicSegments = textNoteAtomicSegments(normalized)
  const pages: string[] = []
  let currentParts: string[] = []
  let currentMetrics = emptyTextNotePageMetrics()

  const flushCurrentPage = () => {
    if (!currentParts.length) return
    pages.push(currentParts.join(''))
    currentParts = []
    currentMetrics = emptyTextNotePageMetrics()
  }

  const appendUnit = (unit: TextNoteCharacterUnit) => {
    if (unit.hardPageBreakBefore && currentParts.length) flushCurrentPage()
    let nextMetrics = appendTextNotePageMetrics(
      currentMetrics,
      unit.character,
      unitsPerLine,
    )
    if (
      currentParts.length
      && !textNoteMetricsFit(nextMetrics, maxLines, maxVisualUnits)
    ) {
      flushCurrentPage()
      nextMetrics = appendTextNotePageMetrics(
        currentMetrics,
        unit.character,
        unitsPerLine,
      )
    }
    // A normal grapheme is indivisible. Production capacities always fit one
    // unit; retaining it on an otherwise empty page guarantees progress for
    // artificially tiny caller-provided budgets as well.
    currentParts.push(unit.character)
    currentMetrics = nextMetrics
  }

  for (const segment of atomicSegments) {
    if (segment[0]?.hardPageBreakBefore && currentParts.length) flushCurrentPage()

    const packedMetrics = tryAppendTextNoteUnits(
      currentMetrics,
      segment,
      unitsPerLine,
      maxLines,
      maxVisualUnits,
    )
    if (packedMetrics) {
      for (const unit of segment) currentParts.push(unit.character)
      currentMetrics = packedMetrics
      continue
    }

    if (currentParts.length) flushCurrentPage()
    const emptyPageMetrics = tryAppendTextNoteUnits(
      currentMetrics,
      segment,
      unitsPerLine,
      maxLines,
      maxVisualUnits,
    )
    if (emptyPageMetrics) {
      for (const unit of segment) currentParts.push(unit.character)
      currentMetrics = emptyPageMetrics
      continue
    }

    for (const unit of segment) appendUnit(unit)
  }
  flushCurrentPage()
  return pages
}

const TEXT_NOTE_SALUTATION_PATTERN = /^(各位|大家|邻居们?|居民们?|业主们?|朋友们?|家人们?)[^。！？!?]{0,8}[：:]$/

export function selectTextNoteCoverExcerpt(value: unknown): string {
  const normalized = normalizeTextNoteBody(value)
  if (!normalized) return ''
  const rawParagraphs = normalized.split(/\n{2,}/)
  const paragraphs: string[] = []
  for (const rawParagraph of rawParagraphs) {
    const paragraph = rawParagraph.trim()
    if (paragraph) paragraphs.push(paragraph)
  }
  let selected = paragraphs[0] || ''
  for (const paragraph of paragraphs) {
    if (!TEXT_NOTE_SALUTATION_PATTERN.test(paragraph)) {
      selected = paragraph
      break
    }
  }
  const coverText = selected.replace(/\s*\n\s*/g, ' ').replace(/[ \t]+/g, ' ').trim()
  return truncateTextNoteBody(coverText, 64)
}

export function createTextNoteDeck(input: { title?: unknown; body?: unknown; theme?: unknown } = {}): TextNoteDeck {
  const theme = normalizeTextNoteTheme(input.theme)
  const presentation = getTextNoteThemePresentation(theme)
  const title = normalizeTextNoteTitle(input.title)
  const body = normalizeTextNoteBody(input.body)
  const basePages: Array<Omit<TextNotePage, 'pageNumber' | 'totalPages'>> = [{
    kind: 'cover',
    kicker: presentation.kicker,
    title,
    body: '',
    sourceBody: '',
  }]

  const bodyPages = paginateTextNoteBody(body, { theme })
  const sourceCompletePages = bodyPages.length ? bodyPages : ['']
  for (const pageBody of sourceCompletePages) {
    basePages.push({
      kind: 'body',
      kicker: presentation.kicker,
      title: '',
      // A page boundary already supplies the visual paragraph separation.
      // Keep boundary whitespace in sourceBody for lossless reconstruction, but
      // do not spend scarce card rows on an invisible leading/trailing break.
      body: pageBody.trim(),
      sourceBody: pageBody,
    })
  }

  const totalPages = basePages.length
  const pages: TextNotePage[] = []
  for (let index = 0; index < basePages.length; index += 1) {
    const page = basePages[index]
    pages.push({
      kind: page.kind,
      kicker: page.kicker,
      title: page.title,
      body: page.body,
      sourceBody: page.sourceBody,
      pageNumber: index + 1,
      totalPages,
    })
  }
  return {
    theme,
    label: presentation.kicker,
    pages,
  }
}

function richNotePlainTextWithBreaks(markdown: string): string {
  return String(markdown || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => markdownToText(line))
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function extractTextNoteFullBody(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const note = value as { markdown?: unknown; html?: unknown; text?: unknown }
    if (typeof note.markdown === 'string' && note.markdown.trim()) return richNotePlainTextWithBreaks(note.markdown)
    if (typeof note.html === 'string' && note.html.trim()) return richNotePlainTextWithBreaks(htmlToMarkdown(note.html))
    if (typeof note.text === 'string') return note.text.trim()
  }
  return normalizeText(value)
}

export function needsTextNoteFullBody(value: unknown): boolean {
  const fullBody = extractTextNoteFullBody(value)
  const coverBody = extractTextNoteFirstParagraph(value)
  return textNoteCharacters(fullBody).length > 64 || fullBody !== coverBody
}

export function extractTextNoteFirstParagraph(value: unknown): string {
  const normalized = richNoteText(value).replace(/\r\n?/g, '\n').trim()
  const firstParagraph = normalized.split(/\n\s*\n/)[0] || ''
  return firstParagraph.replace(/\s*\n\s*/g, ' ').replace(/[ \t]+/g, ' ').trim()
}

export function extractTextNoteContent(content: Record<string, unknown> | null | undefined): TextNoteContent {
  const title = content?.text_title ?? content?.title
  const body = getTextNoteBodyValue(content)
  return {
    title: normalizeTextNoteTitle(title),
    body: selectTextNoteCoverExcerpt(extractTextNoteFullBody(body)),
  }
}

export function getTextNoteBodyValue(content: Record<string, unknown> | null | undefined): unknown {
  return content?.text_body ?? content?.body
}

export function getTextNoteCard(post: { content?: Record<string, unknown>; presentation?: PostPresentation } | null | undefined): TextNoteCard {
  const content = extractTextNoteContent(post?.content)
  return {
    title: content.title,
    body: content.body,
    theme: normalizeTextNoteTheme(post?.presentation?.textNoteTheme),
  }
}

export function truncateTextNoteBody(value: string, maxLength = 64): string {
  const characters = textNoteCharacters(value)
  if (characters.length <= maxLength) return characters.join('')
  return `${characters.slice(0, Math.max(0, maxLength - 1)).join('')}…`
}

export function resolveTextNoteDisplayBody(value: unknown, variant: TextNoteDisplayVariant = 'cover'): string {
  const normalized = String(value || '').trim()
  return variant === 'document' ? normalized : truncateTextNoteBody(normalized)
}

export function resolveTextNoteBodySize(value: string): TextNoteBodySize {
  const length = textNoteCharacters(value).length
  if (length <= 20) return 'large'
  if (length <= 40) return 'medium'
  return 'small'
}
