import fs from 'fs'
import path from 'path'

const root = process.cwd()

function read(...segments) {
  return fs.readFileSync(path.join(root, ...segments), 'utf8')
}

function fileSize(...segments) {
  return fs.statSync(path.join(root, ...segments)).size
}

function pngDimensions(...segments) {
  const buffer = fs.readFileSync(path.join(root, ...segments))
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const app = read('miniprogram', 'src', 'App.vue')
const pagesJson = read('miniprogram', 'src', 'pages.json')
const pagesConfig = JSON.parse(pagesJson)
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
const widgetEditor = read('miniprogram', 'src', 'components', 'widgets', 'WidgetEditor.vue')
const noteBlocksEditor = read('miniprogram', 'src', 'components', 'widgets', 'NoteBlocksEditor.vue')
const figmaInventory = read('docs', 'figma-mini-0626-inventory.md')
const retiredGroupTitle = ['我的', '组局'].join('')

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
    tabbar.includes('class="tab-icon"') &&
    tabbar.includes("tabIconSrc('home')") &&
    tabbar.includes("tabIconSrc('profile')") &&
    tabbar.includes('/static/tab-home-active.png') &&
    tabbar.includes('/static/tab-home.png') &&
    tabbar.includes('/static/tab-profile-active.png') &&
    tabbar.includes('/static/tab-profile.png') &&
    tabbar.includes('首页') &&
    tabbar.includes('我的') &&
    !tabbar.includes('active-dot') &&
    !tabbar.includes('/static/tab-icons/') &&
    !tabbar.includes('&nbsp;'),
  'custom tabbar should follow the Figma three-column nav: PNG icon + label selected/unselected states, without the old active dot, SVG runtime paths, or spaced labels.'
)

for (const iconFile of [
  'tab-home.png',
  'tab-home-active.png',
  'tab-profile.png',
  'tab-profile-active.png',
]) {
  const size = fileSize('miniprogram', 'src', 'static', iconFile)
  const dimensions = pngDimensions('miniprogram', 'src', 'static', iconFile)
  assert(
    size > 900 && size < 40 * 1024 && dimensions.width === 81 && dimensions.height === 81,
    `${iconFile} should be a real native-tab fallback icon, not the old tiny placeholder block.`
  )
}

assert(
  pagesConfig.tabBar?.list?.some((item) =>
    item.pagePath === 'pages/index/index' &&
    item.iconPath === 'static/tab-home.png' &&
    item.selectedIconPath === 'static/tab-home-active.png'
  ) &&
    pagesConfig.tabBar?.list?.some((item) =>
      item.pagePath === 'pages/profile/index' &&
      item.iconPath === 'static/tab-profile.png' &&
      item.selectedIconPath === 'static/tab-profile-active.png'
    ),
  'native tabBar fallback should be wired to the real PNG home/profile icons in pages.json.'
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
    create.includes('createReturnTo') &&
    create.includes('class="create-form-nav"') &&
    create.includes('openHierarchyParent(returnTo)') &&
    create.includes('selectSection(target, { returnTo: intent.returnTo })'),
  'create page should consume the selected publish section intent, preserve its parent, and expose a real form-level back affordance.'
)

assert(
  widgetEditor.includes(`:minimal="variant === 'figma'"`) &&
    widgetEditor.includes('useMultilineTextInput') &&
    widgetEditor.includes("activity_invite_title") &&
    widgetEditor.includes('widget-editor--multiline-text') &&
    widgetEditor.includes('.widget-editor--line .input-wrap') &&
    widgetEditor.includes('min-width: 0;') &&
    widgetEditor.includes(':deep(.uni-date-editor)') &&
    create.includes('overflow-x: hidden;'),
  'Figma create form fields should be width-constrained, and activity invite titles should use a multiline block field instead of clipping inside a short row.'
)

assert(
    noteBlocksEditor.includes('v-if="minimal"') &&
    noteBlocksEditor.includes('class="note-simple-textarea"') &&
    noteBlocksEditor.includes('updateMinimalText') &&
    noteBlocksEditor.includes('v-if="allowImages" class="note-simple-actions"') &&
    create.includes('allowImagesForWidget') &&
    create.includes('ACTIVITY_INVITE_WIDGET_IDS.note') &&
    !noteBlocksEditor.match(/v-if="minimal"[\s\S]*添加文字[\s\S]*粘贴文字[\s\S]*<template v-else>/),
  'Figma create note_blocks should use a direct textarea, and activity invite notes should not expose image/text-block editor controls.'
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
    home.includes('class="home-brandbar"') &&
    home.includes('class="home-brand-title"') &&
    home.includes('社群助手') &&
    home.includes('class="home-quote"') &&
    home.includes('quoteText') &&
    home.includes('placeholder="搜索帖子、正文、视频"') &&
    home.includes('class="home-banner"') &&
    home.includes('homeBannerItems') &&
    home.includes('openHomeBanner') &&
    home.includes('resolvedHomeBannerCoverUrls') &&
    home.includes('rawHomeBannerCoverImages') &&
    home.includes('homeBannerActiveIndex') &&
    home.includes('<swiper') &&
    home.includes('<swiper-item') &&
    home.includes('class="home-banner-swiper"') &&
    home.includes('class="home-banner-slide"') &&
    home.includes(':current="homeBannerActiveIndex"') &&
    home.includes(':circular="homeBannerItems.length > 1"') &&
    home.includes(':duration="260"') &&
    home.includes('@change="onHomeBannerChange"') &&
    home.includes('@touchstart="onHomeBannerGestureStart"') &&
    home.includes('@touchmove="onHomeBannerGestureMove"') &&
    home.includes('@touchend="onHomeBannerGestureEnd"') &&
    home.includes('HOME_BANNER_SWIPE_THRESHOLD_PX') &&
    home.includes('HOME_BANNER_TAP_SUPPRESS_MS') &&
    home.includes('Math.max(dx, dy)') &&
    home.includes('suppressHomeBannerTapTemporarily') &&
    home.includes('event?.detail?.source === \'touch\'') &&
    home.includes('suppressNextHomeBannerTap') &&
    !home.includes('onHomeBannerPointerMove') &&
    !home.includes('homeBannerPointerMoved') &&
    !home.includes('const step = deltaX < 0 ? 1 : -1') &&
    !home.includes('homeBannerActiveIndex.value = (homeBannerActiveIndex.value + step + length) % length') &&
    !/class="home-banner-slide"[\s\S]{0,120}:class="\{ active: i === homeBannerActiveIndex \}"/.test(home) &&
    !home.includes('.home-banner-slide.active') &&
    home.includes('class="notice-board"') &&
    home.includes('noticeRows') &&
    home.includes('{{ notice.kind }}') &&
    !home.includes('notice.sectionName || notice.label') &&
    home.includes('活动召集') &&
    home.includes('class="group-card"') &&
    home.includes('class="section-tabs"') &&
    home.includes('class="home-search-box"') &&
    home.includes('class="home-search-icon-ring"') &&
    home.includes('class="home-search-icon-handle"') &&
    home.includes('min-height: 90rpx;') &&
    home.includes('padding: 0 8rpx 0 30rpx;') &&
    home.includes('flex: 0 0 150rpx;') &&
    home.includes('height: 75rpx;') &&
    home.includes('font-weight: $hh-font-weight-medium;') &&
    !home.includes('<text class="home-search-icon">⌕</text>') &&
    home.includes('class="guide-feed"') &&
    home.includes('onPageScroll') &&
    home.includes('archivePreviewMinHeightPx') &&
    home.includes('scheduleArchivePreviewMeasure') &&
    home.includes('shouldCaptureHeight') &&
    home.includes('class="active-archive-body"') &&
    home.includes('active-archive--default .arc-card') &&
    home.includes('restoreArchiveSwitchScroll') &&
    home.includes('uni.pageScrollTo') &&
    !home.includes('active-archive-head') &&
    !home.includes('active-archive-count') &&
    !home.includes('active-archive-arrow') &&
    home.includes('guideColumns') &&
    home.includes('selectArchiveGroup(g)') &&
    home.includes('GUIDE_NOTE_NAME_HINTS') &&
    home.includes('resolveArchiveDisplayTemplate') &&
    home.includes('resolvedHomeGuideCoverUrls') &&
    home.includes('rawHomeGuideCoverImages') &&
    home.includes('resolveCloudFileUrls') &&
    !home.includes(`<template v-if="g.displayTemplate === 'guide_note'">`),
  'home should use the custom continuous Figma-style top area, tabs plus two-column guide feed, keep tab switching height/scroll stable, and keep notice-board short labels controlled instead of binding long section names.'
)

assert(
  pagesConfig.pages.some((page) =>
    page.path === 'pages/index/index' && page.style?.navigationStyle === 'custom'
  ),
  'home page should use a custom navigation area so the title and hero background can visually connect instead of showing a white native bar.'
)

assert(
  figmaInventory.includes('Figma 是 2026-06-30 起的小程序 UI/UX 新准则') &&
    figmaInventory.includes('与 Figma 冲突的旧单栏/非瀑布流判断全部废弃') &&
    figmaInventory.includes('首页亲子出游采用双列图文卡 Feed'),
  'Figma inventory should document the new source-of-truth rule and homepage two-column guide feed.'
)

for (const [name, source] of [
  ['home', home],
  ['tabbar', tabbar],
  ['Figma inventory', figmaInventory],
]) {
  assert(
    !source.includes(retiredGroupTitle),
    `${name} should use 活动召集 instead of the retired activity wording.`
  )
}

assert(
  search.includes('class="search-nav"') &&
    search.includes('isInitialSearchLayout') &&
    search.includes('const isInitialSearchLayout = computed(() => !searched.value && !loading.value)') &&
    search.includes('compactQueryChipStyle') &&
    search.includes('class="search-query-field"') &&
    search.includes('search-query-field--compact') &&
    search.includes('width: `${Math.min(203, Math.max(64, queryWidth + 49))}px`') &&
    search.includes('height: 116px') &&
    search.includes('flex: 0 1 227px') &&
    search.includes('max-width: 227px') &&
    search.includes('height: 36px') &&
    search.includes('background: #f7f7f7') &&
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
