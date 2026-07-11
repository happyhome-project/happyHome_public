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

export function requiresExplicitHistoricalHeader({ path, source }) {
  return classifyPublicDocument({ path, source }).category === 'historical'
}

export function findHistoricalHeaderProblems({ path, source, catalog = [] }) {
  if (!requiresExplicitHistoricalHeader({ path, source })) return []
  const header = String(source || '').split(/\r?\n/).slice(0, 12).join('\n')
  const problems = []
  if (!/historical|point-in-time|历史|归档/i.test(header)) {
    problems.push('missing explicit historical or point-in-time status in the header')
  }
  const authorityLines = header.split(/\r?\n/).filter((line) => /(?:Current authority|当前权威)/i.test(line))
  const authorityTargets = authorityLines.flatMap((line) => (
    [...line.matchAll(/\[[^\]]+\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)].map((match) => match[1])
  )).filter((target) => /\.md(?:#.*)?$/i.test(target))
  if (!authorityTargets.length) {
    problems.push('missing labeled current-authority Markdown link in the header')
  } else {
    const catalogByPath = new Map(catalog.map((document) => [String(document.path).replace(/\\/g, '/'), document]))
    for (const target of authorityTargets) {
      const resolved = resolveRepositoryMarkdownTarget(path, target)
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
  const fullSource = String(source || '')
  let insideHistoricalInstructions = false
  for (const line of fullSource.split(/\r?\n/)) {
    if (/^##(?:\s|$)/.test(line)) {
      insideHistoricalInstructions = /^## Original historical instructions \(do not execute\)\s*$/i.test(line)
    }
    if (/For agentic workers|REQUIRED SUB-SKILL/i.test(line) && !insideHistoricalInstructions) {
      problems.push('agent execution directive is outside the original historical instructions section')
      break
    }
  }
  return problems
}

function isRelativeMarkdownTarget(target) {
  const value = String(target || '').trim()
  return value.endsWith('.md') && !value.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(value)
}

function resolveRepositoryMarkdownTarget(sourcePath, target) {
  const value = String(target || '').trim().split('#', 1)[0]
  if (!isRelativeMarkdownTarget(value)) return null
  const resolved = normalize(`${dirname(sourcePath)}/${value}`).replace(/\\/g, '/')
  if (resolved === '..' || resolved.startsWith('../') || isAbsolute(resolved)) return null
  return resolved
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
