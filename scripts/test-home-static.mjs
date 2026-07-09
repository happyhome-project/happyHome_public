import fs from 'fs'
import path from 'path'

const root = process.cwd()
const homePage = fs.readFileSync(
  path.join(root, 'miniprogram', 'src', 'pages', 'index', 'index.vue'),
  'utf8',
)
const pagesJson = JSON.parse(fs.readFileSync(
  path.join(root, 'miniprogram', 'src', 'pages.json'),
  'utf8',
))
const communitySwitchPage = fs.readFileSync(
  path.join(root, 'miniprogram', 'src', 'pages', 'community-switch', 'index.vue'),
  'utf8',
)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function styleBlock(selector) {
  const match = homePage.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)\\n\\}`))
  return match?.[1] || ''
}

const footStyle = styleBlock('.s1-foot')
const footWrapStyle = styleBlock('.s1-foot-wrap')

assert(
  homePage.includes('class="s1-foot-wrap"'),
  'home page should keep a wrapper that aligns the end marker with the archive card content width.',
)

assert(
  footWrapStyle.includes('margin: 0 32rpx') &&
    footWrapStyle.includes('padding: 4rpx 0 8rpx') &&
    footWrapStyle.includes('text-align: center') &&
    footStyle.includes('display: block') &&
    footStyle.includes('text-align: center') &&
    footStyle.includes('letter-spacing: $hh-tracking-mono') &&
    !footStyle.includes('background:') &&
    !footStyle.includes('border:') &&
    !footStyle.includes('border-radius:') &&
    !footStyle.includes('inline-flex') &&
    !footStyle.includes('padding: 44rpx 0 20rpx'),
  'home end marker should be plain compact text, aligned with archive cards.',
)

assert(
  homePage.includes('padding: 16rpx 0 112rpx'),
  'home page bottom padding should leave room for the custom tabbar without creating a large blank tail.',
)

assert(
  pagesJson.pages.some((page) => page.path === 'pages/community-switch/index'),
  'community switch should be registered as a standalone page.',
)

assert(
  homePage.includes("uni.navigateTo({ url: '/pages/community-switch/index' })") &&
    !homePage.includes('showSwitcher') &&
    !homePage.includes('switcher-mask') &&
    !homePage.includes('switcher-panel'),
  'home community switch should navigate to the standalone page, not open an inline modal.',
)

assert(
  communitySwitchPage.includes('communityStore.switchCommunity(id)') &&
    communitySwitchPage.includes("uni.switchTab({ url: '/pages/index/index' })") &&
    communitySwitchPage.includes('openOnboardingPreservingStack({ mode: \'discover\' })') &&
    communitySwitchPage.includes('if (!userStore.isLoggedIn)'),
  'community switch page should reuse the store switch action and return to home.',
)

console.log('[home-static] PASS')
