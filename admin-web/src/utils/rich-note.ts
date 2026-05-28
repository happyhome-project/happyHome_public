export interface RichNoteContent {
  format: 'markdown'
  markdown: string
  html: string
  text: string
  imageFileIDs: string[]
  schemaVersion: 1
}

const SCHEMA_VERSION = 1 as const

export function emptyRichNoteContent(): RichNoteContent {
  return { format: 'markdown', markdown: '', html: '', text: '', imageFileIDs: [], schemaVersion: SCHEMA_VERSION }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
}

function renderInline(markdown: string): string {
  let html = escapeHtml(markdown)
  html = html.replace(/!\[([^\]]*)]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_all, alt, src) =>
    `<img src="${src}" alt="${escapeHtml(String(alt || ''))}">`
  )
  html = html.replace(/\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  return html
}

export function markdownToHtml(markdown: string): string {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n')
  const blocks: string[] = []
  let list: string[] = []
  let orderedList: string[] = []
  let paragraph: string[] = []

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(`<p>${paragraph.map((line) => renderInline(line)).join('<br>')}</p>`)
      paragraph = []
    }
  }
  const flushList = () => {
    if (list.length > 0) {
      blocks.push(`<ul>${list.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`)
      list = []
    }
    if (orderedList.length > 0) {
      blocks.push(`<ol>${orderedList.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ol>`)
      orderedList = []
    }
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      flushParagraph()
      flushList()
      continue
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push(`<h${heading[1].length}>${renderInline(heading[2])}</h${heading[1].length}>`)
      continue
    }
    const image = /^!\[([^\]]*)]\(([^)\s]+)(?:\s+"[^"]*")?\)$/.exec(line)
    if (image) {
      flushParagraph()
      flushList()
      blocks.push(`<p><img src="${escapeHtml(image[2])}" alt="${escapeHtml(image[1] || '图片')}"></p>`)
      continue
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line)
    if (bullet) {
      flushParagraph()
      orderedList = []
      list.push(bullet[1])
      continue
    }
    const ordered = /^\d+[.)]\s+(.+)$/.exec(line)
    if (ordered) {
      flushParagraph()
      list = []
      orderedList.push(ordered[1])
      continue
    }
    const quote = /^>\s+(.+)$/.exec(line)
    if (quote) {
      flushParagraph()
      flushList()
      blocks.push(`<blockquote>${renderInline(quote[1])}</blockquote>`)
      continue
    }
    paragraph.push(line)
  }
  flushParagraph()
  flushList()
  return blocks.join('')
}

export function markdownToText(markdown: string): string {
  return String(markdown || '')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^\d+[.)]\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

export type MarkdownToolbarAction =
  | 'bold'
  | 'italic'
  | 'heading'
  | 'unordered-list'
  | 'ordered-list'
  | 'quote'
  | 'line-break'
  | 'link'
  | 'image'

export interface MarkdownToolbarPayload {
  text?: string
  url?: string
  alt?: string
  src?: string
}

export interface MarkdownToolbarResult {
  markdown: string
  selectionStart: number
  selectionEnd: number
}

function normalizeSelection(markdown: string, start?: number, end?: number) {
  const length = markdown.length
  const safeStart = Math.max(0, Math.min(Number(start ?? length), length))
  const safeEnd = Math.max(safeStart, Math.min(Number(end ?? safeStart), length))
  return { start: safeStart, end: safeEnd }
}

function replaceSelection(
  markdown: string,
  start: number,
  end: number,
  replacement: string,
  innerOffset = replacement.length,
): MarkdownToolbarResult {
  const next = `${markdown.slice(0, start)}${replacement}${markdown.slice(end)}`
  const cursor = start + innerOffset
  return { markdown: next, selectionStart: cursor, selectionEnd: cursor }
}

function formatSelectedLines(text: string, fallback: string, formatter: (line: string, index: number) => string) {
  const source = text || fallback
  return source
    .split(/\r?\n/)
    .map((line, index) => formatter(line.trim() || fallback, index))
    .join('\n')
}

function insertMarkdownBlock(
  markdown: string,
  start: number,
  end: number,
  block: string,
): MarkdownToolbarResult {
  const before = markdown.slice(0, start).replace(/[ \t]+$/g, '')
  const after = markdown.slice(end).replace(/^[ \t]+/g, '')
  const prefix = before ? (before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n') : ''
  const suffix = after ? (after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n') : ''
  const next = `${before}${prefix}${block}${suffix}${after}`
  const cursor = `${before}${prefix}${block}`.length
  return { markdown: next, selectionStart: cursor, selectionEnd: cursor }
}

export function applyMarkdownToolbarAction(
  markdown: string,
  action: MarkdownToolbarAction,
  selectionStart?: number,
  selectionEnd?: number,
  payload: MarkdownToolbarPayload = {},
): MarkdownToolbarResult {
  const source = String(markdown || '')
  const { start, end } = normalizeSelection(source, selectionStart, selectionEnd)
  const selected = source.slice(start, end)

  if (action === 'bold') {
    const text = selected || payload.text || '加粗文字'
    return replaceSelection(source, start, end, `**${text}**`, selected ? `**${text}**`.length : 2)
  }
  if (action === 'italic') {
    const text = selected || payload.text || '斜体文字'
    return replaceSelection(source, start, end, `*${text}*`, selected ? `*${text}*`.length : 1)
  }
  if (action === 'heading') {
    return insertMarkdownBlock(source, start, end, `## ${selected || payload.text || '标题'}`)
  }
  if (action === 'unordered-list') {
    return insertMarkdownBlock(source, start, end, formatSelectedLines(selected, '列表项', (line) => `- ${line.replace(/^[-*]\s+/, '')}`))
  }
  if (action === 'ordered-list') {
    return insertMarkdownBlock(source, start, end, formatSelectedLines(selected, '列表项', (line, index) => `${index + 1}. ${line.replace(/^\d+[.)]\s+/, '')}`))
  }
  if (action === 'quote') {
    return insertMarkdownBlock(source, start, end, formatSelectedLines(selected, '引用内容', (line) => `> ${line.replace(/^>\s+/, '')}`))
  }
  if (action === 'line-break') {
    return replaceSelection(source, start, end, selected ? `${selected}\n` : '\n')
  }
  if (action === 'link') {
    const text = selected || payload.text || '链接文字'
    const url = payload.url || 'https://'
    return replaceSelection(source, start, end, `[${text}](${url})`)
  }
  if (action === 'image') {
    const alt = payload.alt || '图片'
    const src = payload.src || ''
    return insertMarkdownBlock(source, start, end, `![${alt}](${src})`)
  }

  return { markdown: source, selectionStart: start, selectionEnd: end }
}

function imgSrcFromTag(tag: string): string {
  const fileId = /\bdata-file-id\s*=\s*(['"])(.*?)\1/i.exec(tag)?.[2]
  if (fileId) return fileId
  return /\bsrc\s*=\s*(['"])(.*?)\1/i.exec(tag)?.[2] || ''
}

function cleanInlineHtmlToMarkdown(value: string): string {
  return decodeHtml(value)
    .replace(/<strong\b[^>]*>(.*?)<\/strong>/gis, '**$1**')
    .replace(/<b\b[^>]*>(.*?)<\/b>/gis, '**$1**')
    .replace(/<em\b[^>]*>(.*?)<\/em>/gis, '*$1*')
    .replace(/<i\b[^>]*>(.*?)<\/i>/gis, '*$1*')
    .replace(/<a\b[^>]*href\s*=\s*(['"])(.*?)\1[^>]*>(.*?)<\/a>/gis, '[$3]($2)')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function htmlToMarkdown(html: string): string {
  let working = String(html || '')
  working = working.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = imgSrcFromTag(tag)
    return src ? `\n\n![图片](${src})\n\n` : '\n\n'
  })
  working = working
    .replace(/<h1\b[^>]*>(.*?)<\/h1>/gis, (_all, inner) => `\n\n# ${cleanInlineHtmlToMarkdown(inner)}\n\n`)
    .replace(/<h2\b[^>]*>(.*?)<\/h2>/gis, (_all, inner) => `\n\n## ${cleanInlineHtmlToMarkdown(inner)}\n\n`)
    .replace(/<h3\b[^>]*>(.*?)<\/h3>/gis, (_all, inner) => `\n\n### ${cleanInlineHtmlToMarkdown(inner)}\n\n`)
    .replace(/<blockquote\b[^>]*>(.*?)<\/blockquote>/gis, (_all, inner) => `\n\n> ${cleanInlineHtmlToMarkdown(inner)}\n\n`)
    .replace(/<li\b[^>]*>(.*?)<\/li>/gis, (_all, inner) => `\n- ${cleanInlineHtmlToMarkdown(inner)}\n`)
    .replace(/<\/?(ul|ol)\b[^>]*>/gi, '\n')
    .replace(/<p\b[^>]*>(.*?)<\/p>/gis, (_all, inner) => {
      const text = cleanInlineHtmlToMarkdown(inner)
      return text ? `\n\n${text}\n\n` : '\n\n'
    })
    .replace(/<br\s*\/?>/gi, '\n')
  return working.split('\n').map(cleanInlineHtmlToMarkdown).filter(Boolean).join('\n\n')
}

function extractMarkdownImageFileIDs(markdown: string): string[] {
  const ids: string[] = []
  const imgPattern = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  let match: RegExpExecArray | null
  while ((match = imgPattern.exec(markdown))) {
    const src = String(match[1] || '').trim()
    if (src.startsWith('cloud://') && !ids.includes(src)) ids.push(src)
  }
  return ids
}

export function buildRichNoteContentFromMarkdown(markdown: string): RichNoteContent {
  const normalizedMarkdown = String(markdown || '').replace(/\r\n/g, '\n')
  return {
    format: 'markdown',
    markdown: normalizedMarkdown,
    html: markdownToHtml(normalizedMarkdown),
    text: markdownToText(normalizedMarkdown),
    imageFileIDs: extractMarkdownImageFileIDs(normalizedMarkdown),
    schemaVersion: SCHEMA_VERSION,
  }
}

export function buildRichNoteContentFromHtml(html: string): RichNoteContent {
  return buildRichNoteContentFromMarkdown(htmlToMarkdown(html))
}

export function normalizeRichNoteContent(value: unknown): RichNoteContent {
  if (!isRecord(value)) return emptyRichNoteContent()
  if (typeof value.markdown === 'string') return buildRichNoteContentFromMarkdown(value.markdown)
  if (typeof value.html === 'string') return buildRichNoteContentFromHtml(value.html)
  return emptyRichNoteContent()
}

export function isRichNoteEmpty(value: unknown): boolean {
  const normalized = normalizeRichNoteContent(value)
  return normalized.markdown.trim() === '' && normalized.text.trim() === '' && normalized.imageFileIDs.length === 0
}
