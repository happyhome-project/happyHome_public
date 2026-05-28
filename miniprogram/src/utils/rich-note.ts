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
  return {
    format: 'markdown',
    markdown: '',
    html: '',
    text: '',
    imageFileIDs: [],
    schemaVersion: SCHEMA_VERSION,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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

function stripHtmlNoise(html: string): string {
  return html
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, '')
    .trim()
}

function extractHtmlImageFileIDs(html: string): string[] {
  const ids: string[] = []
  const imgPattern = /<img\b[^>]*\bsrc\s*=\s*(['"])(.*?)\1[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = imgPattern.exec(html))) {
    const src = String(match[2] || '').trim()
    if (src.startsWith('cloud://') && !ids.includes(src)) ids.push(src)
  }
  return ids
}

function extractHtmlImageSources(html: string): string[] {
  const ids: string[] = []
  const imgPattern = /<img\b[^>]*\bsrc\s*=\s*(['"])(.*?)\1[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = imgPattern.exec(html))) {
    const src = String(match[2] || '').trim()
    if (src && !ids.includes(src)) ids.push(src)
  }
  return ids
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

function extractMarkdownImageSources(markdown: string): string[] {
  const ids: string[] = []
  const imgPattern = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  let match: RegExpExecArray | null
  while ((match = imgPattern.exec(markdown))) {
    const src = String(match[1] || '').trim()
    if (src && !ids.includes(src)) ids.push(src)
  }
  return ids
}

export function extractRichNoteImageFileIDs(value: string): string[] {
  return Array.from(new Set([
    ...extractMarkdownImageFileIDs(value),
    ...extractHtmlImageFileIDs(value),
  ]))
}

export function extractRichNoteImageSources(value: string): string[] {
  return Array.from(new Set([
    ...extractMarkdownImageSources(value),
    ...extractHtmlImageSources(value),
  ]))
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
  let listBuffer: string[] = []
  let orderedListBuffer: string[] = []
  let paragraphBuffer: string[] = []

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return
    blocks.push(`<p>${renderInline(paragraphBuffer.join(' '))}</p>`)
    paragraphBuffer = []
  }
  const flushList = () => {
    if (listBuffer.length > 0) {
      blocks.push(`<ul>${listBuffer.map((line) => `<li>${renderInline(line)}</li>`).join('')}</ul>`)
      listBuffer = []
    }
    if (orderedListBuffer.length > 0) {
      blocks.push(`<ol>${orderedListBuffer.map((line) => `<li>${renderInline(line)}</li>`).join('')}</ol>`)
      orderedListBuffer = []
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
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

    const unordered = /^[-*]\s+(.+)$/.exec(line)
    if (unordered) {
      flushParagraph()
      orderedListBuffer = []
      listBuffer.push(unordered[1])
      continue
    }

    const ordered = /^\d+[.)]\s+(.+)$/.exec(line)
    if (ordered) {
      flushParagraph()
      listBuffer = []
      orderedListBuffer.push(ordered[1])
      continue
    }

    const quote = /^>\s+(.+)$/.exec(line)
    if (quote) {
      flushParagraph()
      flushList()
      blocks.push(`<blockquote>${renderInline(quote[1])}</blockquote>`)
      continue
    }

    paragraphBuffer.push(line)
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
    .replace(/[_`]/g, '')
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

function cleanInlineHtmlToMarkdown(value: string): string {
  return decodeHtml(value)
    .replace(/<strong\b[^>]*>(.*?)<\/strong>/gis, '**$1**')
    .replace(/<b\b[^>]*>(.*?)<\/b>/gis, '**$1**')
    .replace(/<em\b[^>]*>(.*?)<\/em>/gis, '*$1*')
    .replace(/<i\b[^>]*>(.*?)<\/i>/gis, '*$1*')
    .replace(/<u\b[^>]*>(.*?)<\/u>/gis, '$1')
    .replace(/<a\b[^>]*href\s*=\s*(['"])(.*?)\1[^>]*>(.*?)<\/a>/gis, '[$3]($2)')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeMarkdownLines(lines: string[]): string {
  const clean = lines.map((line) => line.trim()).filter(Boolean)
  const result: string[] = []
  for (const line of clean) {
    const prev = result[result.length - 1] || ''
    if (/^[-*]\s+/.test(prev) && /^[-*]\s+/.test(line)) {
      result[result.length - 1] = `${prev}\n${line}`
    } else if (/^\d+[.)]\s+/.test(prev) && /^\d+[.)]\s+/.test(line)) {
      result[result.length - 1] = `${prev}\n${line}`
    } else {
      result.push(line)
    }
  }
  return result.join('\n\n')
}

export function htmlToMarkdown(html: string): string {
  let working = String(html || '').replace(/\r\n/g, '\n')

  working = working.replace(/<img\b[^>]*\bsrc\s*=\s*(['"])(.*?)\1[^>]*>/gi, (_all, _quote, src) =>
    `\n\n![图片](${String(src || '').trim()})\n\n`
  )

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

  return normalizeMarkdownLines(working.split('\n').map(cleanInlineHtmlToMarkdown).filter(Boolean))
}

export function buildRichNoteContentFromMarkdown(markdown: string): RichNoteContent {
  const normalizedMarkdown = String(markdown || '').trim()
  return {
    format: 'markdown',
    markdown: normalizedMarkdown,
    html: markdownToHtml(normalizedMarkdown),
    text: markdownToText(normalizedMarkdown),
    imageFileIDs: extractRichNoteImageFileIDs(normalizedMarkdown),
    schemaVersion: SCHEMA_VERSION,
  }
}

export function buildRichNoteContentFromHtml(html: string): RichNoteContent {
  return buildRichNoteContentFromMarkdown(htmlToMarkdown(html))
}

export async function uploadRichNoteImages(
  value: unknown,
  uploadImage: (path: string) => Promise<string>,
): Promise<RichNoteContent> {
  const normalized = normalizeRichNoteContent(value)
  const sources = extractRichNoteImageSources(`${normalized.markdown}\n${normalized.html}`)
    .filter((src) => src && !src.startsWith('cloud://'))
  if (sources.length === 0) return normalized

  const replacements = new Map<string, string>()
  for (const src of sources) {
    if (!replacements.has(src)) replacements.set(src, await uploadImage(src))
  }

  let markdown = normalized.markdown
  for (const [src, fileID] of replacements) {
    if (!fileID) continue
    markdown = markdown.split(src).join(fileID)
  }
  return buildRichNoteContentFromMarkdown(markdown)
}

export function isRichNoteContent(value: unknown): value is RichNoteContent {
  return isRecord(value)
}

export function normalizeRichNoteContent(value: unknown): RichNoteContent {
  if (!isRecord(value)) return emptyRichNoteContent()
  const markdown = typeof value.markdown === 'string'
    ? value.markdown
    : (typeof value.html === 'string' ? htmlToMarkdown(value.html) : '')
  const content = buildRichNoteContentFromMarkdown(markdown)
  const html = typeof value.html === 'string' && value.html.trim() ? value.html : content.html
  const text = typeof value.text === 'string' && value.text.trim() ? value.text : content.text
  const fromList = Array.isArray(value.imageFileIDs)
    ? value.imageFileIDs.map((item) => String(item || '').trim()).filter((item) => item.startsWith('cloud://'))
    : []
  return {
    format: 'markdown',
    markdown: content.markdown,
    html,
    text,
    imageFileIDs: Array.from(new Set([...fromList, ...extractRichNoteImageFileIDs(content.markdown), ...extractRichNoteImageFileIDs(html)])),
    schemaVersion: SCHEMA_VERSION,
  }
}

export function isRichNoteEmpty(value: unknown): boolean {
  const normalized = normalizeRichNoteContent(value)
  return (
    normalized.markdown.trim() === '' &&
    normalized.text.trim() === '' &&
    stripHtmlNoise(normalized.html) === '' &&
    normalized.imageFileIDs.length === 0
  )
}
