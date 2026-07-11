import { dirname, isAbsolute, normalize } from 'node:path'

export function requiredPublicDocumentPaths() {
  return ['README.md', 'AGENTS.md', 'CLAUDE.md', 'TASKS.md', 'docs/README.md']
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
  'docs/TESTING-PRINCIPLES.md',
  'docs/UX-PRINCIPLES.md',
])

function explicitlyHistorical(source) {
  const lines = String(source || '').split(/\r?\n/).slice(0, 12)
  const title = lines.find((line) => line.startsWith('# ')) || ''
  if (/已废弃|已过时|\barchived\b|\bhistorical\b|\bsuperseded\b/i.test(title)) return true
  return lines.some((line) => (
    /^>/.test(line)
    && /(?:本文档|本文件|this (?:document|file)).*(?:已废弃|已过时|归档|archived|historical|superseded)|归档说明|historical and superseded/i.test(line)
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

export function requiresExplicitHistoricalHeader(path) {
  const normalizedPath = String(path || '').replace(/\\/g, '/')
  return (
    /^docs\/superpowers\/(?:plans|specs)\/[^/]+\.md$/i.test(normalizedPath)
    || /^news\/[^/]+\/README\.md$/i.test(normalizedPath)
    || /^prototype\/[^/]+\/README\.md$/i.test(normalizedPath)
  )
}

export function findHistoricalHeaderProblems({ path, source }) {
  if (!requiresExplicitHistoricalHeader(path)) return []
  const header = String(source || '').split(/\r?\n/).slice(0, 12).join('\n')
  const problems = []
  if (!/historical|point-in-time|历史|归档/i.test(header)) {
    problems.push('missing explicit historical or point-in-time status in the header')
  }
  if (!/(?:Current authority|当前权威)[^\n]*\[[^\]]+\]\([^)]+\.md(?:#[^)]*)?\)/i.test(header)) {
    problems.push('missing labeled current-authority Markdown link in the header')
  }
  return problems
}

function isRelativeMarkdownTarget(target) {
  const value = String(target || '').trim()
  return value.endsWith('.md') && !value.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(value)
}

export function findRelativeMarkdownLinks({ sourcePath, source, exists }) {
  const missing = []
  const matcher = /\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g
  for (const match of String(source || '').matchAll(matcher)) {
    const target = match[1].split('#', 1)[0]
    if (!isRelativeMarkdownTarget(target)) continue
    const resolved = normalize(`${dirname(sourcePath)}/${target}`).replace(/\\/g, '/')
    if (resolved === '..' || resolved.startsWith('../') || isAbsolute(resolved)) {
      missing.push(resolved)
      continue
    }
    if (!exists(resolved)) missing.push(resolved)
  }
  return [...new Set(missing)]
}
