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

const TEXT_NOTE_THEME_CAPACITIES: Record<TextNoteTheme, { cover: number; body: number }> = {
  paper: { cover: 90, body: 170 },
  mint: { cover: 82, body: 158 },
  slate: { cover: 94, body: 176 },
  headline: { cover: 78, body: 150 },
  quote: { cover: 58, body: 142 },
  notice: { cover: 78, body: 154 },
}

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

function isTextNoteCombiningCodePoint(code: number): boolean {
  return (
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x1ab0 && code <= 0x1aff) ||
    (code >= 0x1dc0 && code <= 0x1dff) ||
    (code >= 0x20d0 && code <= 0x20ff) ||
    (code >= 0xfe20 && code <= 0xfe2f)
  )
}

function isTextNoteVariationSelector(code: number): boolean {
  return (code >= 0xfe00 && code <= 0xfe0f) || (code >= 0xe0100 && code <= 0xe01ef)
}

function isTextNoteEmojiModifier(code: number): boolean {
  return code >= 0x1f3fb && code <= 0x1f3ff
}

function isTextNoteRegionalIndicator(code: number): boolean {
  return code >= 0x1f1e6 && code <= 0x1f1ff
}

function isTextNoteTrailingCodePoint(code: number): boolean {
  return (
    isTextNoteCombiningCodePoint(code) ||
    isTextNoteVariationSelector(code) ||
    isTextNoteEmojiModifier(code) ||
    code === 0x20e3
  )
}

function textNoteCharacters(value: unknown): string[] {
  const text = String(value || '')
  const characters: string[] = []

  let index = 0
  while (index < text.length) {
    const first = readTextNoteCodePoint(text, index)
    let character = first.character
    index += first.length

    if (isTextNoteRegionalIndicator(first.code) && index < text.length) {
      const regionalPair = readTextNoteCodePoint(text, index)
      if (isTextNoteRegionalIndicator(regionalPair.code)) {
        character += regionalPair.character
        index += regionalPair.length
      }
    }

    let joining = true
    while (joining && index < text.length) {
      const next = readTextNoteCodePoint(text, index)
      if (isTextNoteTrailingCodePoint(next.code)) {
        character += next.character
        index += next.length
        continue
      }
      if (next.code === 0x200d && index + next.length < text.length) {
        character += next.character
        index += next.length
        const joined = readTextNoteCodePoint(text, index)
        character += joined.character
        index += joined.length
        continue
      }
      joining = false
    }
    characters.push(character)
  }

  return characters
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

function textNoteVisualWeight(value: unknown): number {
  let total = 0
  const characters = textNoteCharacters(value)
  for (const character of characters) {
    if (character === '\n') {
      // A manual break consumes the unused remainder of a visual line.
      // Charging one conservative CJK line prevents many short lines from
      // passing a scalar character budget and overflowing the fixed card.
      total += 18
      continue
    }
    if (/^\s$/.test(character)) {
      total += 0.3
      continue
    }
    if (/^[\x00-\x7f]$/.test(character)) {
      total += 0.55
      continue
    }
    const first = readTextNoteCodePoint(character, 0)
    const isEmoji = first.code >= 0x1f000 || character.indexOf('\u200d') >= 0 || character.indexOf('\ufe0f') >= 0
    total += isEmoji ? 1.6 : 1
  }
  return total
}

function splitTextNoteByCapacity(value: string, capacity: number): string[] {
  const chunks: string[] = []
  const characters = textNoteCharacters(value)
  let current = ''
  let currentWeight = 0
  for (const character of characters) {
    const weight = textNoteVisualWeight(character)
    if (current && currentWeight + weight > capacity) {
      chunks.push(current)
      current = ''
      currentWeight = 0
    }
    current += character
    currentWeight += weight
  }
  if (current) chunks.push(current)
  return chunks
}

function isTextNoteSentenceBoundary(character: string): boolean {
  return character === '\n' || '。！？!?；;'.indexOf(character) >= 0
}

function textNoteAtomicSegments(value: string, capacity: number): string[] {
  const segments: string[] = []
  let current = ''
  const characters = textNoteCharacters(value)
  for (const character of characters) {
    current += character
    if (isTextNoteSentenceBoundary(character)) {
      const parts = textNoteVisualWeight(current) > capacity
        ? splitTextNoteByCapacity(current, capacity)
        : [current]
      for (const part of parts) segments.push(part)
      current = ''
    }
  }
  if (current) {
    const parts = textNoteVisualWeight(current) > capacity
      ? splitTextNoteByCapacity(current, capacity)
      : [current]
    for (const part of parts) segments.push(part)
  }
  return segments
}

export function paginateTextNoteBody(value: unknown, options: { capacity?: number } = {}): string[] {
  const normalized = normalizeTextNoteBody(value)
  if (!normalized) return []

  const requestedCapacity = Number(options.capacity)
  const capacity = Math.max(12, Number.isFinite(requestedCapacity) && requestedCapacity > 0 ? requestedCapacity : TEXT_NOTE_THEME_CAPACITIES.paper.body)
  const segments = textNoteAtomicSegments(normalized, capacity)
  const pages: string[] = []
  let current = ''
  let currentWeight = 0

  for (const segment of segments) {
    const weight = textNoteVisualWeight(segment)
    if (current && currentWeight + weight > capacity) {
      pages.push(current)
      current = ''
      currentWeight = 0
    }
    current += segment
    currentWeight += weight
  }
  if (current) pages.push(current)
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
  const capacity = TEXT_NOTE_THEME_CAPACITIES[theme]
  const title = normalizeTextNoteTitle(input.title)
  const body = normalizeTextNoteBody(input.body)
  const isShort = textNoteVisualWeight(body) <= capacity.cover
  const basePages: Array<Omit<TextNotePage, 'pageNumber' | 'totalPages'>> = [{
    kind: 'cover',
    kicker: presentation.kicker,
    title,
    body: isShort ? body : selectTextNoteCoverExcerpt(body),
    sourceBody: '',
  }]

  if (!isShort) {
    const bodyPages = paginateTextNoteBody(body, { capacity: capacity.body })
    for (const pageBody of bodyPages) {
      basePages.push({
        kind: 'body',
        kicker: presentation.kicker,
        title,
        body: pageBody,
        sourceBody: pageBody,
      })
    }
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
