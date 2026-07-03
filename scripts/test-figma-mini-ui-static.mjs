import fs from 'fs'
import path from 'path'

const root = process.cwd()

function read(...segments) {
  return fs.readFileSync(path.join(root, ...segments), 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const app = read('miniprogram', 'src', 'App.vue')
const uniScss = read('miniprogram', 'src', 'uni.scss')
const tabbar = read('miniprogram', 'src', 'components', 'AppTabBar.vue')
const guideDetail = read('miniprogram', 'src', 'components', 'GuideRouteDetailView.vue')
const defaultDetail = read('miniprogram', 'src', 'components', 'DefaultDetailView.vue')
const detail = read('miniprogram', 'src', 'pages', 'detail', 'index.vue')
const home = read('miniprogram', 'src', 'pages', 'index', 'index.vue')
const search = read('miniprogram', 'src', 'pages', 'search', 'index.vue')
const create = read('miniprogram', 'src', 'pages', 'create', 'index.vue')
const profile = read('miniprogram', 'src', 'pages', 'profile', 'index.vue')
const section = read('miniprogram', 'src', 'pages', 'section', 'index.vue')
const figmaInventory = read('docs', 'figma-mini-0626-inventory.md')

for (const token of [
  '--hh-color-brand-primary',
  '--hh-color-brand-soft',
  '--hh-text-heading-lg-size',
  '--hh-text-heading-md-size',
  '--hh-text-heading-sm-size',
  '--hh-text-body-lg-size',
  '--hh-text-body-base-size',
  '--hh-text-caption-lg-size',
  '--hh-text-caption-base-size',
  '--hh-text-mark-size',
]) {
  assert(app.includes(token), `App.vue should expose Figma text/color CSS variable ${token}.`)
}

assert(
  app.includes('--hh-text-display-size: 64rpx') &&
    app.includes('--hh-text-heading-lg-size: 48rpx') &&
    app.includes('--hh-text-body-lg-size: 32rpx'),
  'App.vue should map Figma px text styles to matching rpx scale variables.'
)

assert(
  uniScss.includes('$hh-figma-green') &&
    uniScss.includes('#3DAD7D') &&
    uniScss.includes('$hh-radius-card-figma'),
  'uni.scss should define the Figma 0626 color/radius token layer.'
)

assert(
  tabbar.includes('var(--hh-color-brand-primary)') &&
    tabbar.includes('width: 112rpx') &&
    tabbar.includes('backdrop-filter: blur') &&
    tabbar.includes('env(safe-area-inset-bottom)'),
  'custom tabbar should use Figma green, 56px center action, blur, and safe-area aware layout.'
)

assert(
  tabbar.includes('class="publish-mask"') &&
    tabbar.includes('class="publish-sheet"') &&
    tabbar.includes('class="publish-grid"') &&
    tabbar.includes('class="publish-icon-image"') &&
    tabbar.includes('CREATE_SECTION_INTENT_KEY') &&
    tabbar.includes('/static/publish-icons/family.svg') &&
    tabbar.includes('rgba(0, 0, 0, 0.65)') &&
    tabbar.includes('isPublishableSection') &&
    tabbar.includes("systemKey === 'activity_invite'") &&
    tabbar.includes('min-height: 648rpx') &&
    tabbar.includes('padding: 48rpx 40rpx calc(64rpx + env(safe-area-inset-bottom))') &&
    tabbar.includes('width: 112rpx') &&
    tabbar.includes('width: 104rpx') &&
    tabbar.includes('margin: 96rpx auto 0'),
  'publish tab should open the Figma 3.1 bottom sheet, with 4-column section choices instead of directly switching to the old picker.'
)

assert(
  create.includes('CREATE_SECTION_INTENT_KEY') &&
    create.includes('consumeCreateSectionIntent') &&
    create.includes('happyhome:create-section-intent') &&
    create.includes('selectSection(target)'),
  'create page should consume the selected publish section intent and land directly on the matching form.'
)

for (const [name, source] of [
  ['home', home],
  ['section', section],
  ['search', search],
  ['create', create],
  ['profile', profile],
]) {
  assert(
    source.includes('var(--hh-color-brand-primary)') ||
      source.includes('$hh-figma-green') ||
      source.includes('$hh-accent'),
    `${name} page should participate in the shared green visual system.`
  )
}

assert(
  guideDetail.includes('class="guide-hero-swiper"') &&
    guideDetail.indexOf('class="guide-location"') < guideDetail.indexOf('v-for="(section, sectionIndex) in detail.bodySections"') &&
    guideDetail.includes('两步路轨迹编号') &&
    guideDetail.includes('class="guide-map-action-round"') &&
    guideDetail.includes('var(--hh-text-heading-lg-size)') &&
    guideDetail.includes('var(--hh-color-brand-primary)') &&
    guideDetail.includes('border-radius: var(--hh-radius-card)'),
  'guide route detail should place location/track before body and use Figma text tokens, brand color, and card radius.'
)

assert(
  defaultDetail.includes('var(--hh-text-heading-lg-size)') &&
    defaultDetail.includes('var(--hh-color-brand-primary)') &&
    defaultDetail.includes('border-radius: var(--hh-radius-card)') &&
    defaultDetail.includes('bodyBlockTitle'),
  'default detail should use Figma text tokens, brand color, card radius, and hide generic body labels.'
)

assert(
  detail.includes('renderPost') &&
    detail.includes(':post="renderPost"') &&
    detail.includes('buildGuideRouteDetail(renderPost') &&
    detail.includes('resolveDetailMediaUrls') &&
    detail.includes('detail-page--guide') &&
    detail.includes(':deep(.guide-route)'),
  'detail page should resolve cloud media into a render-only post and make guide details full-bleed.'
)

assert(
  section.includes('resolveCloudFileUrls') &&
    section.includes('resolvedGuideCoverUrls') &&
    section.includes('rawGuideCoverImages'),
  'section guide list should resolve cloud cover fileIDs before rendering cards.'
)

assert(
    home.includes('class="home-shell"') &&
    home.includes('class="home-quote"') &&
    home.includes('quoteText') &&
    home.includes('placeholder="搜索帖子、正文、视频"') &&
    home.includes('class="home-banner"') &&
    home.includes('homeBannerItems') &&
    home.includes('openHomeBanner') &&
    home.includes('resolvedHomeBannerCoverUrls') &&
    home.includes('rawHomeBannerCoverImages') &&
    home.includes('homeBannerActiveIndex') &&
    home.includes('suppressNextHomeBannerTap') &&
    home.includes('onHomeBannerPointerMove') &&
    home.includes('class="home-banner-slide"') &&
    home.includes(':class="{ active: i === homeBannerActiveIndex }"') &&
    !home.includes('<swiper') &&
    home.includes('class="notice-board"') &&
    home.includes('noticeRows') &&
    home.includes('{{ notice.kind }}') &&
    !home.includes('notice.sectionName || notice.label') &&
    home.includes('我的组局') &&
    home.includes('class="group-card"') &&
    home.includes('class="section-tabs"') &&
    home.includes('class="home-search-box"') &&
    home.includes('class="guide-feed"') &&
    home.includes('guideColumns') &&
    home.includes('selectArchiveGroup(g)') &&
    home.includes('GUIDE_NOTE_NAME_HINTS') &&
    home.includes('resolveArchiveDisplayTemplate') &&
    home.includes('resolvedHomeGuideCoverUrls') &&
    home.includes('rawHomeGuideCoverImages') &&
    home.includes('resolveCloudFileUrls') &&
    !home.includes(`<template v-if="g.displayTemplate === 'guide_note'">`),
  'home should follow Figma tabs plus two-column guide feed, and keep notice-board short labels controlled instead of binding long section names.'
)

assert(
  figmaInventory.includes('Figma 是 2026-06-30 起的小程序 UI/UX 新准则') &&
    figmaInventory.includes('与 Figma 冲突的旧单栏/非瀑布流判断全部废弃') &&
    figmaInventory.includes('首页亲子出游采用双列图文卡 Feed'),
  'Figma inventory should document the new source-of-truth rule and homepage two-column guide feed.'
)

assert(
  search.includes('class="search-nav"') &&
    search.includes('class="result-cover"') &&
    search.includes('resultAuthorAvatar') &&
    search.includes('avatar-') &&
    search.includes('border: 3rpx solid var(--hh-color-brand-primary)') &&
    !search.includes('search-capsule') &&
    !search.includes('capsule-dot') &&
    !search.includes('capsule-ring') &&
    !search.includes('•••') &&
    !search.includes('◎'),
  'search page should use the Figma search pill and result card without drawing WeChat native capsule chrome.'
)

assert(
  profile.includes('class="profile-shortcuts"') &&
    profile.includes('class="profile-switch"') &&
    profile.includes('linear-gradient(188deg') &&
    profile.includes('创建社区') &&
    profile.includes('加入社区'),
  'profile page should use the Figma-style user header and real community action shortcuts.'
)

console.log('[figma-mini-ui-static] PASS')
