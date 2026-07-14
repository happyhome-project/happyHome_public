import fs from 'fs'
import path from 'path'

const homePath = path.join(process.cwd(), 'miniprogram', 'src', 'pages', 'index', 'index.vue')
const home = fs.readFileSync(homePath, 'utf8')
const homeShellRule = home.match(/\.home-shell\s*\{([^}]*)\}/)?.[1] || ''
const homeTopbarRule = home.match(/\.home-topbar\s*\{([^}]*)\}/)?.[1] || ''
const homeSearchRule = home.match(/\.home-shell \.home-search\s*\{([^}]*)\}/)?.[1] || ''
const stickyTabsShellRule = home.match(/\.section-tabs-sticky-shell\s*\{([^}]*)\}/)?.[1] || ''

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(
  (home.match(/class="section-tabs-sticky-shell"/g) || []).length === 1,
  'home should render exactly one sticky shell around the tabs control.'
)
assert(
  (home.match(/class="section-tabs"/g) || []).length === 1,
  'home should render exactly one horizontal section tabs control.'
)
assert(!home.includes('class="home-fixed-controls"'), 'home should not duplicate controls in a fixed wrapper.')
assert(!home.includes('showHomeFixedControls'), 'home should not track fixed-controls visibility.')
assert(!home.includes('homeFixedControlsThresholdPx'), 'home should not track a fixed-controls threshold.')
assert(!home.includes('measureHomeFixedControlsThreshold'), 'home should not measure a fixed-controls threshold.')
assert(!home.includes('scheduleHomeFixedControlsMeasure'), 'home should not schedule fixed-controls measurement.')
assert(!home.includes('is-shadowed-by-fixed'), 'home should not reserve space for duplicated fixed controls.')
assert(!home.includes('section-tabs--flow'), 'home should not retain the old flow tabs modifier.')
assert(!home.includes('section-tabs--fixed'), 'home should not retain the old fixed tabs modifier.')
assert(
  homeShellRule.includes('padding: calc(150rpx + env(safe-area-inset-top))'),
  'home content should reserve the fixed masthead height exactly once.',
)
assert(homeTopbarRule.includes('position: fixed'), 'home masthead should remain pinned beyond the hero shell boundary.')
assert(
  homeTopbarRule.includes('top: 0') && homeTopbarRule.includes('left: 0') && homeTopbarRule.includes('right: 0'),
  'home masthead should cover the full viewport width from the top edge.',
)
assert(
  homeTopbarRule.includes('padding: calc(86rpx + env(safe-area-inset-top)) var(--hh-page-x) 0'),
  'home masthead content should retain the existing top and horizontal insets.',
)
assert(
  !homeSearchRule.includes('position: sticky') && !homeSearchRule.includes('position: fixed'),
  'home search should remain in normal flow and scroll away.',
)
assert(stickyTabsShellRule.includes('position: sticky'), 'home sticky shell should use sticky positioning.')
assert(
  stickyTabsShellRule.includes('top: calc(150rpx + env(safe-area-inset-top))'),
  'home tabs should pin directly below the 86rpx inset and 64rpx masthead.',
)

console.log('[home-tabs-scroll-static] PASS')
