import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const projectRoot = process.cwd()
const detailChunk = path.join(projectRoot, 'miniprogram', 'dist', 'build', 'mp-weixin', 'pages', 'detail', 'index.js')

const rules = [
  {
    name: 'array destructuring arrow parameter',
    pattern: /\(\s*\[[^\]]+\]\s*\)\s*=>/g,
  },
  {
    name: 'array destructuring callback parameter',
    pattern: /\(\s*\[[^\]]+\]\s*,/g,
  },
  {
    name: 'array destructuring declaration',
    pattern: /\b(?:const|let|var)\s*\[[^\]]+\]\s*=/g,
  },
  {
    name: 'Object.fromEntries',
    pattern: /Object\.fromEntries\s*\(/g,
  },
]

if (!fs.existsSync(detailChunk)) {
  console.error(`Missing mp-weixin detail chunk: ${detailChunk}`)
  console.error('Run npm.cmd --workspace miniprogram run build:mp-weixin first.')
  process.exit(1)
}

const source = fs.readFileSync(detailChunk, 'utf8')
const findings = []

for (const rule of rules) {
  for (const match of source.matchAll(rule.pattern)) {
    const start = Math.max(0, match.index - 80)
    const end = Math.min(source.length, match.index + 120)
    findings.push({
      rule: rule.name,
      offset: match.index,
      snippet: source.slice(start, end).replace(/\s+/g, ' '),
    })
  }
}

if (findings.length > 0) {
  console.error('mp-weixin detail chunk contains syntax that has caused blank detail pages in WeChat runtime:')
  for (const finding of findings) {
    console.error(`- ${finding.rule} at ${finding.offset}: ${finding.snippet}`)
  }
  process.exit(1)
}

console.log('mp-weixin detail runtime syntax check passed')
