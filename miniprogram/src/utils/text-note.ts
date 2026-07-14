import { htmlToMarkdown, markdownToText } from './rich-note'

export const TEXT_NOTE_THEMES = ['paper', 'mint', 'slate', 'headline', 'quote', 'notice'] as const

export type TextNoteTheme = typeof TEXT_NOTE_THEMES[number]
export type TextNoteBodySize = 'large' | 'medium' | 'small'
export type TextNoteLayout = 'memo' | 'fresh' | 'night' | 'newspaper' | 'quotation' | 'bulletin'

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

function normalizeText(value: unknown): string {
  return String(value ?? '').trim()
}

function textNoteCharacters(value: unknown): string[] {
  const text = String(value || '')
  const characters: string[] = []
  for (let index = 0; index < text.length; index += 1) {
    let character = text.charAt(index)
    const code = text.charCodeAt(index)
    const nextCode = text.charCodeAt(index + 1)
    if (code >= 0xd800 && code <= 0xdbff && nextCode >= 0xdc00 && nextCode <= 0xdfff) {
      character += text.charAt(index + 1)
      index += 1
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
  return {
    title: normalizeTextNoteTitle(content?.text_title),
    body: extractTextNoteFirstParagraph(content?.text_body),
  }
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

export function resolveTextNoteBodySize(value: string): TextNoteBodySize {
  const length = textNoteCharacters(value).length
  if (length <= 20) return 'large'
  if (length <= 40) return 'medium'
  return 'small'
}
