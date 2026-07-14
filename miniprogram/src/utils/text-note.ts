import { htmlToMarkdown, markdownToText } from './rich-note'

export const TEXT_NOTE_THEMES = ['paper', 'mint', 'slate', 'headline', 'quote', 'notice'] as const

export type TextNoteTheme = typeof TEXT_NOTE_THEMES[number]
export type TextNoteBodySize = 'large' | 'medium' | 'small'

export interface PostPresentation {
  textNoteTheme?: TextNoteTheme
}

export interface TextNoteContent {
  title: string
  body: string
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim()
}

export function normalizeTextNoteTitle(value: unknown, maxLength = 48): string {
  return Array.from(normalizeText(value)).slice(0, maxLength).join('')
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

export function truncateTextNoteBody(value: string, maxLength = 64): string {
  const characters = Array.from(String(value || ''))
  if (characters.length <= maxLength) return characters.join('')
  return `${characters.slice(0, Math.max(0, maxLength - 1)).join('')}…`
}

export function resolveTextNoteBodySize(value: string): TextNoteBodySize {
  const length = Array.from(String(value || '')).length
  if (length <= 20) return 'large'
  if (length <= 40) return 'medium'
  return 'small'
}
