import fs from 'fs'
import path from 'path'

const root = process.cwd()

function read(...segments) {
  return fs.readFileSync(path.join(root, ...segments), 'utf8')
}

function fileSize(...segments) {
  return fs.statSync(path.join(root, ...segments)).size
}

function fileExists(...segments) {
  return fs.existsSync(path.join(root, ...segments))
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
const homeStickyTabsRule = home.match(/\.section-tabs-sticky-shell\s*\{([^}]*)\}/)?.[1] || ''
const search = read('miniprogram', 'src', 'pages', 'search', 'index.vue')
const create = read('miniprogram', 'src', 'pages', 'create', 'index.vue')
const profile = read('miniprogram', 'src', 'pages', 'profile', 'index.vue')
const section = read('miniprogram', 'src', 'pages', 'section', 'index.vue')
const widgetEditor = read('miniprogram', 'src', 'components', 'widgets', 'WidgetEditor.vue')
const noteBlocksEditor = read('miniprogram', 'src', 'components', 'widgets', 'NoteBlocksEditor.vue')
const figmaInventory = read('docs', 'figma-mini-0626-inventory.md')
const expectedLiveSectionHeading = '<text class="group-section-title">活动召集</text>'
const olderLiveSectionHeading = '<text class="group-section-title">我的组局</text>'

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
  'uni.scss should define the Figma 0709_v2 color/radius token layer.'
)

assert(
  tabbar.includes('var(--hh-color-brand-primary)') &&
    tabbar.includes('width: 112rpx') &&
    tabbar.includes('backdrop-filter: blur') &&
    tabbar.includes('env(safe-area-inset-bottom)') &&
    tabbar.includes('HOME_TAB_RETAP_EVENT') &&
    tabbar.includes('$emit?.(HOME_TAB_RETAP_EVENT)'),
  'custom tabbar should use Figma green, 56px center action, blur, safe-area aware layout, and retap home to scroll the homepage back to top.'
)

assert(
  tabbar.includes('{{ option.label }}') &&
    tabbar.includes('displayPublishSectionName') &&
    !tabbar.includes('{{ option.section.name }}') &&
    !tabbar.includes('/邀约|组局/'),
  'publish sheet should normalize retired labels without broadly rewriting valid future section names.'
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
    tabbar.includes('/static/publish-icons/general.svg') &&
    tabbar.includes('rgba(0, 0, 0, 0.65)') &&
    tabbar.includes('isPublishableSection') &&
    tabbar.includes("systemKey === 'activity_invite'") &&
    tabbar.includes('grid-template-columns: repeat(4, minmax(0, 1fr))') &&
    !tabbar.includes('min-height: 648rpx') &&
    tabbar.includes('padding: 48rpx 40rpx calc(40rpx + env(safe-area-inset-bottom))') &&
    tabbar.includes('width: 112rpx') &&
    tabbar.includes('width: 104rpx') &&
    tabbar.includes('margin: 40rpx auto 0') &&
    !tabbar.includes('resolvePublishMeta(section?.name, index)') &&
    !tabbar.includes('index % tones.length'),
  'publish tab should open a content-driven, safe-area-aware 4-column sheet with one stable neutral fallback icon.'
)

assert(
  create.includes('CREATE_SECTION_INTENT_KEY') &&
    create.includes('consumeCreateSectionIntent') &&
    create.includes('happyhome:create-section-intent') &&
    create.includes('createReturnTo') &&
    create.includes('class="section-picker"') &&
    !create.includes('class="create-form-nav"') &&
    !create.includes('class="create-back"') &&
    create.includes('openHierarchyParent(returnTo)') &&
    create.includes('selectSection(target, { returnTo: intent.returnTo })'),
  'create page should consume the selected publish section intent and preserve its parent without duplicating native navigation inside the form.'
)

assert(
  widgetEditor.includes('/static/publish-icons/location.svg') &&
    widgetEditor.includes('/static/publish-icons/location-map.png') &&
    widgetEditor.includes('/static/publish-icons/location-pin.svg') &&
    !widgetEditor.includes('location-map-ghost') &&
    !widgetEditor.includes('repeating-linear-gradient') &&
    !widgetEditor.includes('⌖') &&
    !widgetEditor.includes('●'),
  'Figma location fields should render exported source assets instead of glyphs or CSS map art.'
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
  !home.includes('class="home-banner"') &&
    !home.includes('homeBannerItems') &&
    !home.includes('class="notice-board"') &&
    !home.includes('noticeRows') &&
    !home.includes('<text class="home-banner-title">新人必看</text>') &&
    home.includes(expectedLiveSectionHeading) &&
    home.includes('class="section-tabs-sticky-shell"') &&
    home.includes('class="active-archive-body"'),
  'home should remove banner and notice display regions while preserving live and archive content.'
)

assert(
    home.includes('class="home-shell"') &&
    !home.includes('class="home-brandbar"') &&
    !home.includes('class="home-brand-title"') &&
    home.includes('class="home-quote"') &&
    home.includes('quoteText') &&
    home.includes("'Source Han Serif SC', 'Noto Serif CJK SC', '思源宋体'") &&
    home.includes('placeholder="试试搜周边亲子游路线"') &&
    home.includes("imageKey: buildHomeImageKey('guide', `${section._id}:${p._id || idx}`)") &&
    home.includes('class="home-search home-search--primary"') &&
    (home.match(/class="section-tabs-sticky-shell"/g) || []).length === 1 &&
    (home.match(/class="section-tabs"/g) || []).length === 1 &&
    !home.includes('class="home-fixed-controls"') &&
    !home.includes('showHomeFixedControls') &&
    !home.includes('homeFixedControlsThresholdPx') &&
    !home.includes('measureHomeFixedControlsThreshold') &&
    !home.includes('scheduleHomeFixedControlsMeasure') &&
    home.includes('HOME_TAB_RETAP_EVENT') &&
    home.includes('scrollHomeToTop') &&
    !home.includes('is-shadowed-by-fixed') &&
    !home.includes('section-tabs--flow') &&
    !home.includes('section-tabs--fixed') &&
    homeStickyTabsRule.includes('position: sticky') &&
    homeStickyTabsRule.includes('env(safe-area-inset-top)') &&
    home.includes(expectedLiveSectionHeading) &&
    home.includes('class="group-card"') &&
    home.includes('class="home-search-box"') &&
    home.includes('class="home-search-icon-ring"') &&
    home.includes('class="home-search-icon-handle"') &&
    home.includes('class="switch-icon"') &&
    home.includes('class="switch-icon-line switch-icon-line--top"') &&
    home.includes('class="switch-icon-line switch-icon-line--bottom"') &&
    home.includes('gap: 12px;') &&
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
    home.includes("group?.displayTemplate === 'guide_note' && archivePreviewMinHeightPx.value > 0") &&
    home.includes("return 'min-height: 100vh;'") &&
    home.includes('class="active-archive-body"') &&
    home.includes('active-archive--default .arc-card') &&
    home.includes('.active-archive--default .arc-card::before') &&
    home.includes('content: none;') &&
    home.includes('.active-archive--default .arc-item') &&
    home.includes('min-height: 78rpx;') &&
    home.includes('min-height: 0;') &&
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
  'home should use the custom continuous Figma-style top area and tabs plus two-column guide feed while keeping tab switching height and scroll stable.'
)

assert(
  pagesConfig.pages.some((page) =>
    page.path === 'pages/index/index' && page.style?.navigationStyle === 'custom'
  ),
  'home page should use a custom navigation area so the title and hero background can visually connect instead of showing a white native bar.'
)

assert(
  figmaInventory.includes('Figma 是 2026-07-09 起的小程序 UI/UX 当前准则') &&
    figmaInventory.includes('与 Figma 冲突的旧单栏/非瀑布流判断全部废弃') &&
    figmaInventory.includes('首页亲子出游采用双列图文卡 Feed'),
  'Figma inventory should document the new source-of-truth rule and homepage two-column guide feed.'
)

assert(
  home.includes(expectedLiveSectionHeading) &&
    !home.includes(olderLiveSectionHeading),
  'home live section should use 活动召集 instead of 我的组局.'
)

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

assert(
  pagesConfig.pages.some((page) =>
    page.path === 'pages/profile/index' && page.style?.navigationStyle === 'custom'
  ) &&
    profile.includes('class="profile-custom-nav"') &&
    profile.includes('class="profile-custom-nav-title"') &&
    profile.includes('env(safe-area-inset-top)') &&
    !profile.includes('profile-native-capsule'),
  'profile should own a safe-area-aware custom title over the continuous Figma background without drawing fake WeChat chrome.'
)

assert(
    profile.includes('class="profile-shortcut-decoration"') &&
    profile.includes('class="shortcut-icon-image"') &&
    profile.includes('/static/profile/switch.svg') &&
    profile.includes('/static/profile/edit-arrow.svg') &&
    profile.includes('/static/profile/create-community.svg') &&
    profile.includes('/static/profile/join-community-back.svg') &&
    profile.includes('/static/profile/join-community-front.svg') &&
    profile.includes('/static/profile/join-community-pin.svg') &&
    profile.includes('/static/profile/shortcut-create-bg.svg') &&
    profile.includes('/static/profile/shortcut-join-bg.svg'),
  'profile create/join shortcuts should use the Figma icon and decorative background assets.'
)

assert(
  !profile.includes('mode="scaleToFill"') &&
    (profile.match(/shortcut-icon-image--join-[^\n]+[\s\S]*?mode="aspectFit"/g) || []).length === 3,
  'profile join shortcut SVG layers should use the mini-program-compatible aspectFit mode.'
)

assert(
  profile.includes('iconSrc:') &&
    profile.includes('class="profile-tool-icon-image"') &&
    profile.includes('class="avatar-edit-camera"') &&
    !profile.includes('📷') &&
    !profile.includes("icon: '♡'") &&
    !profile.includes("icon: '♧'") &&
    !profile.includes("icon: '▣'") &&
    !profile.includes("icon: '✦'") &&
    !profile.includes("icon: '✎'") &&
    !profile.includes("icon: '✓'") &&
    !profile.includes("icon: '☏'"),
  'profile tool entries should render local Figma assets instead of character glyph approximations.'
)

for (const iconFile of [
  'create-community.svg',
  'switch.svg',
  'edit-arrow.svg',
  'join-community-back.svg',
  'join-community-front.svg',
  'join-community-pin.svg',
  'shortcut-create-bg.svg',
  'shortcut-join-bg.svg',
  'favorite.svg',
  'like.svg',
  'archive.svg',
  'activity.svg',
  'posts.svg',
  'checkin.svg',
  'service.svg',
]) {
  assert(
    fileExists('miniprogram', 'src', 'static', 'profile', iconFile),
    `profile Figma asset ${iconFile} should be persisted locally.`
  )
}

console.log('[figma-mini-ui-static] PASS')
