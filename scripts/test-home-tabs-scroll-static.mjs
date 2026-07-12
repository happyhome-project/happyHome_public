import fs from 'fs'
import path from 'path'

const homePath = path.join(process.cwd(), 'miniprogram', 'src', 'pages', 'index', 'index.vue')
const home = fs.readFileSync(homePath, 'utf8')
const stickyTabsRule = home.match(/\.section-tabs--sticky\s*\{([^}]*)\}/)?.[1] || ''

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(
  (home.match(/class="section-tabs section-tabs--sticky"/g) || []).length === 1,
  'home should render exactly one in-flow sticky section tabs control.'
)
assert(!home.includes('class="home-fixed-controls"'), 'home should not duplicate controls in a fixed wrapper.')
assert(!home.includes('showHomeFixedControls'), 'home should not track fixed-controls visibility.')
assert(!home.includes('homeFixedControlsThresholdPx'), 'home should not track a fixed-controls threshold.')
assert(!home.includes('measureHomeFixedControlsThreshold'), 'home should not measure a fixed-controls threshold.')
assert(!home.includes('scheduleHomeFixedControlsMeasure'), 'home should not schedule fixed-controls measurement.')
assert(!home.includes('is-shadowed-by-fixed'), 'home should not reserve space for duplicated fixed controls.')
assert(!home.includes('section-tabs--flow'), 'home should not retain the old flow tabs modifier.')
assert(!home.includes('section-tabs--fixed'), 'home should not retain the old fixed tabs modifier.')
assert(stickyTabsRule.includes('position: sticky'), 'home sticky tabs rule should use sticky positioning.')
assert(stickyTabsRule.includes('env(safe-area-inset-top)'), 'home sticky tabs rule should respect the top safe area.')

console.log('[home-tabs-scroll-static] PASS')
