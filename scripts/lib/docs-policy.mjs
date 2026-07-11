import { dirname, normalize } from 'node:path'

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
    if (!exists(resolved)) missing.push(resolved)
  }
  return [...new Set(missing)]
}
