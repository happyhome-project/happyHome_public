import { dirname, isAbsolute, normalize } from 'node:path'
import MarkdownIt from 'markdown-it'

export function requiredPublicDocumentPaths() {
  return ['README.md', 'AGENTS.md', 'CLAUDE.md', 'PRODUCT.md', 'TASKS.md', 'docs/README.md']
}

const ENTRYPOINTS = new Set(['README.md', 'AGENTS.md', 'CLAUDE.md', 'TASKS.md', 'docs/README.md'])
const CANONICAL_OPERATIONS = new Set([
  'docs/SETUP.md',
  'docs/TESTING.md',
  'docs/admin-web-deploy.md',
  'docs/approval-notifications.md',
  'docs/h5-preview-runbook.md',
  'docs/post-rag-search.md',
  'docs/release-gate.md',
  'wechat-ops/README.md',
])
const CANONICAL_CURRENT = new Set([
  'PRODUCT.md',
  'docs/TESTING-PRINCIPLES.md',
  'docs/UX-PRINCIPLES.md',
])

const MARKDOWN = new MarkdownIt({ html: true, linkify: false, typographer: false })
const HISTORICAL_SECTION_TITLE = 'Original historical instructions (do not execute)'
const HTML_BLOCK_BREAK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'div', 'dl', 'dt', 'dd', 'fieldset', 'figcaption',
  'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav',
  'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
])

function parseMarkdown(source) {
  return MARKDOWN.parse(String(source || ''), {})
}

function inlineSegments(token) {
  const segments = [{ text: '', links: [] }]
  for (const child of token?.children || []) {
    if (child.type === 'softbreak' || child.type === 'hardbreak') {
      segments.push({ text: '', links: [] })
      continue
    }
    if (child.type === 'code_inline' || child.type === 'html_inline') continue
    if (child.type === 'link_open') {
      segments.at(-1).links.push(child.attrGet('href'))
    } else if (child.type === 'text') {
      segments.at(-1).text += child.content
    }
  }
  return segments
}

function visibleInlineEntries(tokens) {
  const entries = []
  let blockquoteDepth = 0
  for (const token of tokens) {
    if (token.type === 'blockquote_open') {
      blockquoteDepth += 1
    } else if (token.type === 'blockquote_close') {
      blockquoteDepth = Math.max(0, blockquoteDepth - 1)
    } else if (token.type === 'inline') {
      entries.push({ token, blockquoteDepth, segments: inlineSegments(token) })
    }
  }
  return entries
}

function visibleInlineText(token) {
  return inlineSegments(token).map(({ text }) => text).join('\n').trim()
}

function htmlTagEnd(source, start) {
  let quote = ''
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (character === quote) quote = ''
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '>') {
      return index
    }
  }
  return -1
}

function htmlTag(source, start, end) {
  const body = source.slice(start + 1, end).trimStart()
  const closing = body.startsWith('/')
  const name = body.slice(closing ? 1 : 0).trimStart().match(/^([a-z][a-z0-9:-]*)/i)?.[1]?.toLowerCase() || ''
  return { closing, name, selfClosing: /\/\s*$/.test(body) }
}

function visibleHtmlSegments(source) {
  const value = String(source || '')
  const lowerValue = value.toLowerCase()
  let text = ''
  let index = 0
  while (index < value.length) {
    if (value.startsWith('<!--', index)) {
      const commentEnd = value.indexOf('-->', index + 4)
      index = commentEnd >= 0 ? commentEnd + 3 : value.length
      continue
    }
    if (value[index] !== '<') {
      text += value[index]
      index += 1
      continue
    }
    const tagEnd = htmlTagEnd(value, index)
    if (tagEnd < 0) {
      text += value[index]
      index += 1
      continue
    }
    const tag = htmlTag(value, index, tagEnd)
    if (!tag.name) {
      index = tagEnd + 1
      continue
    }
    if (!tag.closing && !tag.selfClosing && (tag.name === 'script' || tag.name === 'style')) {
      const closingStart = lowerValue.indexOf(`</${tag.name}`, tagEnd + 1)
      if (closingStart < 0) break
      const closingEnd = htmlTagEnd(value, closingStart)
      index = closingEnd >= 0 ? closingEnd + 1 : value.length
      text += '\n'
      continue
    }
    text += HTML_BLOCK_BREAK_TAGS.has(tag.name) ? '\n' : ' '
    index = tagEnd + 1
  }
  return MARKDOWN.utils.unescapeAll(text)
    .split(/\r?\n/)
    .map((segment) => segment.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function explicitlyHistorical(source) {
  const tokens = parseMarkdown(source)
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.type === 'heading_open' && token.level === 0 && token.tag === 'h1') {
      const title = visibleInlineText(tokens[index + 1])
      if (/已废弃|已过时|\barchived\b|\bhistorical\b|\bsuperseded\b/i.test(title)) return true
      break
    }
  }
  return visibleInlineEntries(tokens).some(({ token, blockquoteDepth, segments }) => (
    blockquoteDepth > 0
    && token.map?.[0] < 12
    && segments.some(({ text }) => /(?:本文档|本文件|this (?:document|file)).*(?:已废弃|已过时|归档|archived|historical|superseded)|归档说明|historical and superseded/i.test(text))
  ))
}

export function classifyPublicDocument({ path, source }) {
  const normalizedPath = String(path || '').replace(/\\/g, '/')
  if (normalizedPath.startsWith('docs/generated/')) {
    return { category: 'generated', authority: 'non-authoritative' }
  }
  if (
    explicitlyHistorical(source)
    || normalizedPath.startsWith('docs/superpowers/plans/')
    || normalizedPath.startsWith('docs/superpowers/specs/')
    || normalizedPath.startsWith('docs/changes/')
    || normalizedPath.startsWith('docs/releases/')
    || normalizedPath.startsWith('news/')
    || normalizedPath.startsWith('prototype/')
  ) {
    return { category: 'historical', authority: 'record' }
  }
  if (ENTRYPOINTS.has(normalizedPath)) return { category: 'current', authority: 'entrypoint' }
  if (CANONICAL_OPERATIONS.has(normalizedPath)) return { category: 'operational', authority: 'canonical' }
  if (CANONICAL_CURRENT.has(normalizedPath)) return { category: 'current', authority: 'canonical' }
  return { category: 'reference', authority: 'supporting' }
}

export function requiresExplicitHistoricalHeader({ path, source }) {
  return classifyPublicDocument({ path, source }).category === 'historical'
}

export function findHistoricalHeaderProblems({ path, source, catalog = [] }) {
  if (!requiresExplicitHistoricalHeader({ path, source })) return []
  const tokens = parseMarkdown(source)
  const headerEntries = visibleInlineEntries(tokens).filter(({ token }) => token.map?.[0] < 12)
  const problems = []
  if (!headerEntries.some(({ segments }) => segments.some(({ text }) => /historical|point-in-time|历史|归档/i.test(text)))) {
    problems.push('missing explicit historical or point-in-time status in the header')
  }
  const authorityTargets = headerEntries.flatMap(({ segments }) => segments
    .filter(({ text }) => /(?:Current authority|当前权威)/i.test(text))
    .flatMap(({ links }) => links)
    .filter((target) => normalizeMarkdownTarget(target).kind !== 'other'))
  if (!authorityTargets.length) {
    problems.push('missing labeled current-authority Markdown link in the header')
  } else {
    const catalogByPath = new Map(catalog.map((document) => [String(document.path).replace(/\\/g, '/'), document]))
    for (const target of authorityTargets) {
      const normalizedTarget = normalizeMarkdownTarget(target, path)
      const resolved = normalizedTarget.kind === 'repository' ? normalizedTarget.path : null
      if (!resolved || !catalogByPath.has(resolved)) {
        if (!problems.includes('current-authority link must resolve to a cataloged repository document')) {
          problems.push('current-authority link must resolve to a cataloged repository document')
        }
        continue
      }
      if (resolved === String(path).replace(/\\/g, '/')) {
        if (!problems.includes('current-authority link must not point to the historical document itself')) {
          problems.push('current-authority link must not point to the historical document itself')
        }
        continue
      }
      const targetDocument = catalogByPath.get(resolved)
      const isCurrentAuthority = targetDocument.category === 'current'
        || (targetDocument.category === 'operational' && targetDocument.authority === 'canonical')
      if (!isCurrentAuthority && !problems.includes('current-authority link must point to current or canonical operational documentation')) {
        problems.push('current-authority link must point to current or canonical operational documentation')
      }
    }
  }
  if (hasDirectiveOutsideHistoricalSection(tokens)) {
    problems.push('agent execution directive is outside the original historical instructions section')
  }
  return problems
}

function isAgentDirective(text) {
  const value = String(text || '').trim()
  return /^(?:For (?:agentic workers|autonomous agents|agents)|REQUIRED SUB-SKILL)\s*:/i.test(value)
    || /\bUse\s+superpowers:[a-z0-9][a-z0-9-]*\b[^.!?\n]{0,160}\bexecute\b/i.test(value)
}

function hasDirectiveOutsideHistoricalSection(tokens) {
  let insideHistoricalInstructions = false
  let historicalInstructionsOpened = false
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.type === 'heading_open' && token.level === 0 && (token.tag === 'h1' || token.tag === 'h2')) {
      const isHistoricalInstructions = token.tag === 'h2'
        && visibleInlineText(tokens[index + 1]).toLowerCase() === HISTORICAL_SECTION_TITLE.toLowerCase()
      if (isHistoricalInstructions && !historicalInstructionsOpened) {
        insideHistoricalInstructions = true
        historicalInstructionsOpened = true
      } else {
        insideHistoricalInstructions = false
      }
    }
    const hasDirective = token.type === 'inline'
      ? inlineSegments(token).some(({ text }) => isAgentDirective(text))
      : token.type === 'html_block' && visibleHtmlSegments(token.content).some((text) => isAgentDirective(text))
    if (hasDirective && !insideHistoricalInstructions) {
      return true
    }
  }
  return false
}

function normalizeMarkdownTarget(target, sourcePath = '') {
  const value = String(target || '').trim()
  const suffixIndex = value.search(/[?#]/)
  const encodedPath = suffixIndex >= 0 ? value.slice(0, suffixIndex) : value
  let decodedPath
  try {
    decodedPath = decodeURIComponent(encodedPath)
  } catch {
    return /\.md$/i.test(encodedPath) ? { kind: 'invalid' } : { kind: 'other' }
  }
  if (!/\.md$/i.test(decodedPath)) return { kind: 'other' }
  if (/^[a-z][a-z0-9+.-]*:/i.test(decodedPath) || decodedPath.startsWith('//')) return { kind: 'external' }
  const resolved = normalize(`${dirname(sourcePath)}/${decodedPath}`).replace(/\\/g, '/')
  if (resolved === '..' || resolved.startsWith('../') || isAbsolute(resolved)) return { kind: 'outside', path: resolved }
  return { kind: 'repository', path: resolved }
}

export function findRelativeMarkdownLinks({ sourcePath, source, exists }) {
  const missing = []
  for (const token of parseMarkdown(source)) {
    if (token.type !== 'inline') continue
    for (const { links } of inlineSegments(token)) {
      for (const target of links) {
        const normalizedTarget = normalizeMarkdownTarget(target, sourcePath)
        if (normalizedTarget.kind === 'outside') {
          missing.push(normalizedTarget.path)
        } else if (normalizedTarget.kind === 'repository' && !exists(normalizedTarget.path)) {
          missing.push(normalizedTarget.path)
        }
      }
    }
  }
  return [...new Set(missing)]
}
