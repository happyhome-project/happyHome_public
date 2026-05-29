import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const projectRoot = process.cwd()
const distRoot = path.join(projectRoot, 'miniprogram', 'dist', 'build', 'mp-weixin')
const detailConfig = path.join(distRoot, 'pages', 'detail', 'index.json')
const detailDependencyChunks = [
  'pages/detail/index.js',
  'api/cloud.js',
  'components/LoginGuard.js',
  'components/widgets/WidgetRenderer.js',
  'components/widgets/RichNoteRenderer.js',
  'components/widgets/NoteBlocksRenderer.js',
  'components/widgets/VideoPlayerCard.js',
  'store/community.js',
  'store/user.js',
  'utils/rich-note.js',
  'utils/widget-form.js',
  'utils/widget.js',
  'utils/cloud-file-url.js',
  'utils/useBusyLock.js',
  'utils/video-actions.js',
  'utils/audio-manager.js',
  'store/audio.js',
]

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
  {
    name: 'Object.values',
    pattern: /Object\.values\s*\(/g,
  },
  {
    name: 'Array.from',
    pattern: /Array\.from\s*\(/g,
  },
  {
    name: 'nullish coalescing',
    pattern: /\?\?/g,
  },
  {
    name: 'collection spread',
    pattern: /[\[{]\s*\.{3}/g,
  },
]

const findings = []

if (!fs.existsSync(detailConfig)) {
  console.error(`Missing mp-weixin detail page config: ${detailConfig}`)
  console.error('Run npm.cmd --workspace miniprogram run build:mp-weixin first.')
  process.exit(1)
}

const detailJson = JSON.parse(fs.readFileSync(detailConfig, 'utf8'))
if (detailJson.usingComponents?.['widget-editor']) {
  findings.push({
    file: 'pages/detail/index.json',
    rule: 'read-only detail must not statically load WidgetEditor',
    offset: 0,
    snippet: JSON.stringify(detailJson.usingComponents),
  })
}

for (const relativePath of detailDependencyChunks) {
  const chunkPath = path.join(distRoot, relativePath)
  if (!fs.existsSync(chunkPath)) {
    console.error(`Missing mp-weixin detail dependency chunk: ${chunkPath}`)
    console.error('Run npm.cmd --workspace miniprogram run build:mp-weixin first.')
    process.exit(1)
  }

  const source = fs.readFileSync(chunkPath, 'utf8')
  for (const rule of rules) {
    for (const match of source.matchAll(rule.pattern)) {
      const start = Math.max(0, match.index - 80)
      const end = Math.min(source.length, match.index + 120)
      findings.push({
        file: relativePath,
        rule: rule.name,
        offset: match.index,
        snippet: source.slice(start, end).replace(/\s+/g, ' '),
      })
    }
  }
}

if (findings.length > 0) {
  console.error('mp-weixin detail dependency chunks contain syntax/runtime APIs that have caused blank detail pages in WeChat trial runtime:')
  for (const finding of findings) {
    console.error(`- ${finding.file}: ${finding.rule} at ${finding.offset}: ${finding.snippet}`)
  }
  process.exit(1)
}

console.log('mp-weixin detail dependency runtime syntax check passed')
