import fs from 'fs'
import path from 'path'

const waterfallPath = path.join(
  process.cwd(),
  'miniprogram',
  'src',
  'components',
  'ArchiveWaterfall.vue',
)
const waterfall = fs.readFileSync(waterfallPath, 'utf8')
const waterfallRule = waterfall.match(/\.archive-waterfall\s*\{([^}]*)\}/)?.[1] || ''

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

console.log('[home-waterfall-surface-static] PASS')
