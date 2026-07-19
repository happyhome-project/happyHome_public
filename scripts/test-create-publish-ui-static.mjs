import fs from 'fs'
import path from 'path'

const root = process.cwd()

function read(...segments) {
  return fs.readFileSync(path.join(root, ...segments), 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const tabbar = read('miniprogram', 'src', 'components', 'AppTabBar.vue')
const widgetEditor = read('miniprogram', 'src', 'components', 'widgets', 'WidgetEditor.vue')
const topicPicker = read('miniprogram', 'src', 'components', 'widgets', 'TopicPicker.vue')
const videoPublishEditorPath = path.join(root, 'miniprogram', 'src', 'components', 'widgets', 'VideoPublishEditor.vue')
const videoPublishEditor = fs.existsSync(videoPublishEditorPath) ? fs.readFileSync(videoPublishEditorPath, 'utf8') : ''
const acceptVideoBlock = videoPublishEditor.slice(
  videoPublishEditor.indexOf('async function acceptVideo'),
  videoPublishEditor.indexOf('function startVideoUpload'),
)
const createPage = read('miniprogram', 'src', 'pages', 'create', 'index.vue')
const imageNoteCreate = read('miniprogram', 'src', 'utils', 'image-note-create.ts')
const pagesJson = read('miniprogram', 'src', 'pages.json')
const createPageManifest = JSON.parse(pagesJson).pages.find((page) => page.path === 'pages/create/index')

const figmaIconNodes = {
  family: '20040:4379',
  trade: '20040:4434',
  notice: '20040:4465',
  lost: '20040:4500',
  neighbor: '20040:4537',
  car: '20040:4559',
  calendar: '20023:1670',
  'save-draft': '20023:1552',
  general: '20001:14807',
  location: '20024:1714',
  'location-pin': '20024:1731',
}

for (const [name, nodeId] of Object.entries(figmaIconNodes)) {
  const assetPath = path.join(root, 'miniprogram', 'src', 'static', 'publish-icons', `${name}.svg`)
  assert(fs.existsSync(assetPath), `${name}.svg should exist.`)
  const svg = fs.readFileSync(assetPath, 'utf8')
  assert(
    svg.includes(`Figma node ${nodeId}`),
    `${name}.svg should be exported from Figma node ${nodeId}.`,
  )
}

assert(
  tabbar.includes('width: 104rpx') &&
    tabbar.includes('height: 104rpx') &&
    tabbar.includes('width: 72rpx') &&
    tabbar.includes('height: 72rpx') &&
    ['#fdf6e6', '#e3f0fb', '#e0fbf7', '#fef6e3', '#ddf6fc', '#def7ec']
      .every((color) => tabbar.toLowerCase().includes(color)),
  'publish sheet should keep the Figma 52px icon slot and 36px foreground asset.',
)
assert(
  createPageManifest?.style?.navigationStyle === 'custom' &&
    createPage.includes('class="create-custom-nav"') &&
    createPage.includes('@tap="handlePageExit"') &&
    createPage.includes('navigateBackOrHome') &&
    createPage.includes(':style="createCustomNavStyle"') &&
    createPage.includes('{{ createNavTitle }}') &&
    createPage.includes('computeCreateNavMetrics') &&
    createPage.includes('resolveCreateNavTitle') &&
    createPage.includes('isEditMode: isEditMode.value') &&
    createPage.includes('env(safe-area-inset-top)'),
  'create must use a controlled safe-area custom navigation bar.',
)

assert(
  tabbar.includes("{ key: 'media', label: '图文/视频'") &&
    /\.publish-label\s*\{[^}]*width:\s*100%/s.test(tabbar) &&
    tabbar.includes("mediaType: ['image', 'video']") &&
    tabbar.includes('accept="image/*,video/*"') &&
    tabbar.includes('storeArchiveMediaIntent') &&
    tabbar.includes("if (props.current === 'create')") &&
    tabbar.includes("type AppTabBarCurrent = AppTabKey | 'create'") &&
    tabbar.includes("emit('media-selected', token)") &&
    tabbar.includes('source: file') &&
    !tabbar.includes('source: URL.createObjectURL(file)') &&
    tabbar.includes('discardArchiveMediaIntent(token)') &&
    createPage.includes('@media-selected="handleInlineMediaIntent"') &&
    createPage.includes('transitionArchiveMediaEditorState') &&
    createPage.includes('hasArchiveMedia') &&
    createPage.includes('restoreArchiveMediaEditor') &&
    /handleBackToSectionPicker[\s\S]*archiveFormat\.value === 'image_text'[\s\S]*selectedSection\.value = null[\s\S]*return/.test(createPage) &&
    createPage.includes('切换后将清空当前素材'),
  'the first publishing choice must select real image/video media and route it through local intent storage.',
)

assert(
  createPage.includes("const archiveFormat = ref<'image_text' | 'text' | 'video' | ''>('')") &&
    createPage.includes("widgetId: 'archive_video_videos'") &&
    createPage.includes('<VideoPublishEditor') &&
    videoPublishEditor.includes('requestMemberVideoUpload') &&
    videoPublishEditor.includes('requestMemberVideoCoverUpload') &&
    videoPublishEditor.includes('deleteMemberVideoUpload') &&
    videoPublishEditor.includes('buildPlatformThumbnailFile') &&
    /requestMemberVideoUpload\(\{\s*communityId:\s*props\.communityId,\s*fileName:/.test(videoPublishEditor) &&
    /requestMemberVideoCoverUpload\(\{\s*communityId:\s*props\.communityId,\s*fileName:/.test(videoPublishEditor) &&
    /onBeforeUnmount\([\s\S]*cleanupPendingUploads/.test(videoPublishEditor) &&
    createPage.includes(':community-id="communityStore.currentCommunityId"') &&
    videoPublishEditor.includes('uploadCloudFile') &&
    videoPublishEditor.includes('onProgress') &&
    videoPublishEditor.includes('移除失败封面') &&
    videoPublishEditor.includes("emit('readiness'") &&
    videoPublishEditor.includes('shouldConsumeInitialVideo') &&
    videoPublishEditor.includes("emit('initial-state', 'pending',") &&
    videoPublishEditor.includes("emit('initial-state', 'failed',") &&
    videoPublishEditor.includes("emit('initial-state', 'resolved',") &&
    videoPublishEditor.includes("emit('selected-file'") &&
    videoPublishEditor.includes("emit('navigation-blocked', true)") &&
    videoPublishEditor.includes("emit('navigation-blocked', false)") &&
    /uploadGeneration \+= 1[\s\S]*cleanupPendingUploads[\s\S]*buildPlatformThumbnailFile[\s\S]*coverPending\.value = Boolean\(platformCover\)/.test(acceptVideoBlock) &&
    videoPublishEditor.includes('isVideoUploadResultCurrent') &&
    videoPublishEditor.includes('releasePreview(previewSource.value)') &&
    videoPublishEditor.includes('releasePreview(coverPreview.value)') &&
    createPage.includes('archiveVideoIntentState') &&
    createPage.includes('@initial-state="handleVideoInitialState"') &&
    createPage.includes('@selected-file="handleVideoSelectedFile"') &&
    createPage.includes('reduceArchiveVideoRetention') &&
    createPage.includes('@navigation-blocked="videoNavigationBlocked = $event"') &&
    createPage.includes('请重试或移除失败封面') &&
    createPage.includes('@readiness="videoPublishReady = $event.ready"') &&
    createPage.includes(':disabled="submitting || !videoPublishReady"'),
  'archive video publishing must have its own upload editor and server-owned upload paths.',
)
assert(
  createPage.includes("requestedArchiveFormat === 'image_text' || requestedArchiveFormat === 'text' || requestedArchiveFormat === 'video'") &&
    createPage.includes('onBackPress(') &&
    createPage.includes("window.addEventListener('beforeunload'") &&
    videoPublishEditor.indexOf('validateVideoCoverFile', videoPublishEditor.indexOf('async function uploadCover')) < videoPublishEditor.indexOf('requestMemberVideoCoverUpload'),
  'archive routes, native back, H5 unload, and cover validation must be guarded.',
)

assert(
  createPage.includes('createDraftStorageKey') &&
    createPage.includes('restoreDraft') &&
    createPage.includes('archiveFormat.value'),
  'create drafts must be isolated and restored by community plus archive format.',
)

assert(
  /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/.test(tabbar) &&
    /\.publish-sheet\s*\{[^}]*padding:[^;]*env\(safe-area-inset-bottom\)/s.test(tabbar) &&
    !/\.publish-sheet\s*\{[^}]*min-height:/s.test(tabbar) &&
    !tabbar.includes('min-height: 648rpx') &&
    /\.publish-close\s*\{[^}]*margin:\s*40rpx auto 0;/s.test(tabbar),
  'publish sheet height should follow one or two rows of content with safe-area padding and a compact close gap.',
)

assert(
  tabbar.includes("icon: '/static/publish-icons/trade.svg'") &&
    tabbar.includes("icon: '/static/publish-icons/lost.svg'") &&
    tabbar.includes("icon: '/static/publish-icons/neighbor.svg'"),
  'the three product-level choices should keep stable source icons.',
)

assert(
  widgetEditor.includes('/static/publish-icons/calendar.svg') &&
    widgetEditor.includes('class="datetime-field-icon"') &&
    widgetEditor.includes('选择日期时间') &&
    /\.widget-editor--line \.datetime-picker\s*\{[^}]*overflow:\s*visible;/s.test(widgetEditor) &&
    /\.widget-editor--figma\.widget-editor--datetime\s*\{[^}]*overflow:\s*visible;/s.test(widgetEditor) &&
    !/\.widget-editor--line \.datetime-picker\s*\{[^}]*overflow:\s*hidden;/s.test(widgetEditor),
  'all datetime widgets should use the shared Figma calendar field presentation.',
)

assert(
  createPage.includes('/static/publish-icons/save-draft.svg') &&
    createPage.includes('class="draft-icon"') &&
    !createPage.includes('<text class="draft-icon">▣</text>'),
  'the publish footer should use the exact Figma save-draft icon instead of a text glyph.',
)

assert(
  createPage.includes('class="section-picker"') &&
    !createPage.includes('class="create-back"') &&
    !/\.create-back(?:\s|:|\{)/.test(createPage),
  'create page should keep the initial section picker without duplicating native navigation inside the form.',
)

const locationMapPath = path.join(root, 'miniprogram', 'src', 'static', 'publish-icons', 'location-map.png')
assert(
  fs.existsSync(locationMapPath) && fs.statSync(locationMapPath).size > 0,
  'selected location should include the exported Figma map asset.',
)

assert(
  widgetEditor.includes('/static/publish-icons/location.svg') &&
    widgetEditor.includes('/static/publish-icons/location-pin.svg') &&
    widgetEditor.includes('/static/publish-icons/location-map.png') &&
    widgetEditor.includes('class="location-icon"') &&
    widgetEditor.includes('class="location-map-image"') &&
    widgetEditor.includes('class="location-card-pin-image"') &&
    !widgetEditor.includes('⌖') &&
    !widgetEditor.includes('●') &&
    !widgetEditor.includes('location-map-ghost') &&
    !widgetEditor.includes('repeating-linear-gradient'),
  'location widgets should use real Figma assets instead of text glyphs or CSS map art.',
)

assert(
  widgetEditor.includes('uni.chooseImage({') &&
  widgetEditor.includes('// #ifdef H5') &&
  !widgetEditor.includes('type="file"') &&
  !widgetEditor.includes('onH5ImageChange'),
  'H5 image widgets must use uni.chooseImage so the runtime creates a real native file chooser.'
)

assert(
  widgetEditor.includes('@tap="chooseLocation"') &&
    widgetEditor.includes('@tap.stop="clearLocation"') &&
    widgetEditor.includes("emit('update:modelValue'") &&
    widgetEditor.includes('name: res.name') &&
    widgetEditor.includes('address: res.address'),
  'location visual replacement must preserve selection, clearing, value shape, and update events.',
)

assert(
  createPage.includes("import { resolveActivityAnnouncementMain } from '../../utils/create-form-layout'") &&
    createPage.includes("type: 'activityMain'") &&
    createPage.includes("block.type === 'activityMain'") &&
    createPage.includes('class="figma-activity-main-card"'),
  'activity announcement title and detail should render in one semantic main-content card.',
)

assert(
  createPage.includes('isImageNoteSectionContract(selectedSection.value)') &&
    createPage.includes("block.type === 'imageNoteMain'") &&
    createPage.includes("block.type === 'imageNoteTools'") &&
    createPage.includes('variant="image-note-tool"') &&
    createPage.includes('placeholder="添加主题"') &&
    createPage.includes('placeholder="添加正文"'),
  'image_note should use the approved image/title/body canvas and compact topic/location tool row.',
)

assert(
  imageNoteCreate.includes("type: 'imageNoteMain'") &&
    imageNoteCreate.includes("type: 'imageNoteTools'") &&
    !imageNoteCreate.includes('customWidgets'),
  'image_note publishing should render only the two approved fixed-control blocks.',
)

assert(
  imageNoteCreate.includes("widgetId === 'image_note_topics'") ||
    imageNoteCreate.includes("findWidget(widgets, 'image_note_topics')"),
  'image-note publishing should resolve the fixed topic control by its stable widget ID.',
)

assert(
  !imageNoteCreate.includes("type: 'routeStats'") &&
    !imageNoteCreate.includes('altitude') &&
    !imageNoteCreate.includes('totalClimb'),
  'image_note must not inherit route distance, altitude, climb, or route-stat groups.',
)

assert(
  widgetEditor.includes("widget.type === 'topic'") &&
    widgetEditor.includes('TopicPicker') &&
    topicPicker.includes('v-if="pickerOpen"') &&
    topicPicker.includes('class="topic-picker-overlay"') &&
    topicPicker.includes('MAX_TOPIC_COUNT') &&
    topicPicker.includes('#{{ topic }}') &&
    topicPicker.includes('最多20个字'),
  'the reusable topic control should provide #话题 chips and a five-topic bottom picker.',
)

console.log('create publish UI static checks passed')
