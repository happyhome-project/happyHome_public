import fs from 'fs'
import path from 'path'

const waterfallPath = path.join(
  process.cwd(),
  'miniprogram',
  'src',
  'components',
  'ArchiveWaterfall.vue',
)
const homePath = path.join(
  process.cwd(),
  'miniprogram',
  'src',
  'pages',
  'index',
  'index.vue',
)
const waterfall = fs.readFileSync(waterfallPath, 'utf8')
const home = fs.readFileSync(homePath, 'utf8')
const waterfallRule = waterfall.match(/\.archive-waterfall\s*\{([^}]*)\}/)?.[1] || ''
const archiveShellRule = home.match(/\.archive-topic-shell\s*\{([^}]*)\}/)?.[1] || ''

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(
  waterfallRule.includes('background: var(--hh-color-card)'),
  'home waterfall surface should use the white card token so column and card gaps stay white.',
)

assert(
  !waterfallRule.includes('background: #f7f7f7'),
  'home waterfall surface should not expose the legacy gray page background.',
)

assert(
  archiveShellRule.includes('background: var(--hh-color-card)'),
  'home archive shell should keep the short-feed tail white after the waterfall content ends.',
)

assert(
  archiveShellRule.includes(
    'min-height: calc(100vh - 150rpx - env(safe-area-inset-top) - 98rpx)',
  ),
  'home archive shell should cover the viewport below the pinned masthead and search controls.',
)

console.log('[home-waterfall-surface-static] PASS')
