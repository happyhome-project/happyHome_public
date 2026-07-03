import fs from 'fs'
import path from 'path'

const root = process.cwd()
const sectionList = fs.readFileSync(path.join(root, 'admin-web', 'src', 'views', 'CommunityAdmin', 'SectionList.vue'), 'utf8')
const adminApi = fs.readFileSync(path.join(root, 'admin-web', 'src', 'api', 'cloud.ts'), 'utf8')
const adminWidgetEditor = fs.readFileSync(path.join(root, 'admin-web', 'src', 'views', 'CommunityAdmin', 'WidgetEditor.vue'), 'utf8')
const homePage = fs.readFileSync(path.join(root, 'miniprogram', 'src', 'pages', 'index', 'index.vue'), 'utf8')
const sectionPage = fs.readFileSync(path.join(root, 'miniprogram', 'src', 'pages', 'section', 'index.vue'), 'utf8')
const createPage = fs.readFileSync(path.join(root, 'miniprogram', 'src', 'pages', 'create', 'index.vue'), 'utf8')
const detailPage = fs.readFileSync(path.join(root, 'miniprogram', 'src', 'pages', 'detail', 'index.vue'), 'utf8')
const guideRouteDetail = fs.readFileSync(path.join(root, 'miniprogram', 'src', 'components', 'GuideRouteDetailView.vue'), 'utf8')
const widgetEditor = fs.readFileSync(path.join(root, 'miniprogram', 'src', 'components', 'widgets', 'WidgetEditor.vue'), 'utf8')
const widgetRenderer = fs.readFileSync(path.join(root, 'miniprogram', 'src', 'components', 'widgets', 'WidgetRenderer.vue'), 'utf8')
const locationAdminEditor = fs.readFileSync(path.join(root, 'admin-web', 'src', 'components', 'LocationAdminEditor.vue'), 'utf8')
const guideNoteWidgets = fs.readFileSync(path.join(root, 'cloud', 'shared', 'guide-note-widgets.ts'), 'utf8')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(
  sectionList.includes('displayTemplate') && sectionList.includes('value="guide_note"'),
  'SectionList must expose a displayTemplate selector with a guide-note option.'
)

assert(
  adminWidgetEditor.includes('guide_drive_duration') &&
    adminWidgetEditor.includes('guide_liangbulu_track_id') &&
    adminWidgetEditor.includes('guide_location'),
  'Admin widget editor must lock the guide drive-duration, LiangBuLu track-id, and route location fields.'
)

assert(
  adminApi.includes("displayTemplate?: 'default' | 'guide_note'"),
  'admin-web section API types must include displayTemplate.'
)

assert(
  adminApi.includes('geoApi') && adminApi.includes('geo.searchLocation'),
  'admin-web API must expose a geo.searchLocation wrapper for destination search.'
)

assert(
  homePage.includes('getGuideNoteCard') && homePage.includes('guide-card'),
  'mini program home must render guide_note sections with guide cards.'
)

assert(
  homePage.includes('driveDuration') &&
    sectionPage.includes('driveDuration') &&
    !homePage.includes('item.location') &&
    !sectionPage.includes('item.location'),
  'mini program guide cards must show drive duration instead of a precise location.'
)

assert(
  detailPage.includes('isGuideNoteDetail') && detailPage.includes('GuideRouteDetailView'),
  'mini program detail must render guide_note posts with the dedicated route-detail view.'
)

assert(
  detailPage.includes('GUIDE_NOTE_NAME_HINTS') && detailPage.includes('resolveGuideNoteDetailTemplate'),
  'mini program detail must use the same guide-note name fallback as the homepage for older sections.'
)

assert(
  guideRouteDetail.includes('<swiper') &&
    guideRouteDetail.includes('<swiper-item') &&
    guideRouteDetail.includes('@change="onHeroChange"') &&
    !guideRouteDetail.includes('<scroll-view scroll-x'),
  'guide route detail top images must use a snapping swiper, not a free horizontal scroll-view.'
)

assert(
  guideRouteDetail.includes('height: 72vh') &&
    guideRouteDetail.includes('min-height: 760rpx'),
  'guide route detail hero image must occupy a large first-screen area.'
)

assert(
  !guideRouteDetail.includes('guide-hero-mask') &&
    !guideRouteDetail.includes('guide-hero-copy') &&
    !guideRouteDetail.includes('text-shadow') &&
    guideRouteDetail.includes('class="guide-intro"'),
  'guide route detail hero must preserve original photo color and move title copy below the image.'
)

assert(
  !guideRouteDetail.includes('class="guide-drive"') &&
    !guideRouteDetail.includes('自驾到达') &&
    guideRouteDetail.includes('liangbuluTrackId') &&
    guideRouteDetail.indexOf('class="guide-location"') < guideRouteDetail.indexOf('guide-track') &&
    guideRouteDetail.indexOf('guide-track') < guideRouteDetail.indexOf('v-for="(section, sectionIndex) in detail.bodySections"'),
  'guide route detail must show optional LiangBuLu track-id copy UI near destination location and before body, without repeating drive duration.'
)

assert(
  guideRouteDetail.includes('currentImageIndex') &&
    guideRouteDetail.includes('#e64646'),
  'guide route detail image dots must track the current slide and use a red active dot.'
)

assert(
  guideRouteDetail.includes('HERO_SWIPE_THRESHOLD_PX') &&
    guideRouteDetail.includes('heroSuppressNextPreview') &&
    guideRouteDetail.includes('@touchmove="onHeroPointerMove"'),
  'guide route detail swiper must avoid opening image preview by gesture distance, not a fixed delay.'
)

assert(
  !guideRouteDetail.includes('lastHeroChangeAt') &&
    !guideRouteDetail.includes('lastHeroMoveAt') &&
    !guideRouteDetail.includes('setTimeout(() =>'),
  'guide route detail image preview must not be delayed by a fixed post-swipe timeout.'
)

assert(
  guideRouteDetail.includes('<text>位置</text>') &&
    guideRouteDetail.includes('openLocation') &&
    guideRouteDetail.includes('导航') &&
    !guideRouteDetail.includes('线路轨迹'),
  'guide route detail must present the map as destination navigation, not route track.'
)

assert(
  locationAdminEditor.includes('geoApi.searchLocation') &&
    locationAdminEditor.includes('geoApi.getMapConfig') &&
    locationAdminEditor.includes('searchCandidates') &&
    locationAdminEditor.includes('adjusted') &&
    locationAdminEditor.includes('mapContainer') &&
    locationAdminEditor.includes('draggable: true') &&
    locationAdminEditor.includes('mapDialogVisible') &&
    locationAdminEditor.includes('openMapDialog') &&
    locationAdminEditor.includes('<el-dialog'),
  'admin location editor must search Amap candidates and support large-dialog map micro-adjustment with runtime Amap config.'
)

assert(
  locationAdminEditor.includes('map-workbench-dialog') &&
    locationAdminEditor.includes('dialog-search-row') &&
    locationAdminEditor.includes('dialog-candidate-list') &&
    locationAdminEditor.includes('pendingLocation') &&
    locationAdminEditor.includes('confirmMapSelection') &&
    locationAdminEditor.includes('cancelMapSelection') &&
    locationAdminEditor.includes('AMap.Scale') &&
    locationAdminEditor.includes('AMap.ToolBar'),
  'admin location editor must use a full map workbench with search, candidates, pending selection, controls, and explicit confirm/cancel.'
)

assert(
  !locationAdminEditor.includes('class="search-row"') &&
    !locationAdminEditor.includes('class="candidate-list"') &&
    !locationAdminEditor.includes('class="map-entry"') &&
    !locationAdminEditor.includes('打开大地图微调'),
  'admin location editor outer form must not keep the old duplicate search/candidate/map-entry flow.'
)

assert(
  locationAdminEditor.includes('waitForMapContainer') &&
    locationAdminEditor.includes('requestAnimationFrame') &&
    locationAdminEditor.includes('await waitForMapContainer()'),
  'admin location editor must wait for the dialog map container before first Amap initialization.'
)

assert(
  locationAdminEditor.indexOf('window._AMapSecurityConfig') >= 0 &&
    locationAdminEditor.indexOf('window._AMapSecurityConfig') < locationAdminEditor.indexOf('if (window.AMap)'),
  'admin location editor must set Amap securityJsCode before reusing an existing window.AMap instance.'
)

assert(
  !locationAdminEditor.includes('selectCandidate(searchCandidates.value[0])'),
  'admin location search must not automatically overwrite the saved point with the first candidate.'
)

assert(
  locationAdminEditor.includes('scheduleMapResize') &&
    locationAdminEditor.includes('window.dispatchEvent(new Event') &&
    locationAdminEditor.includes('window.setTimeout') &&
    locationAdminEditor.includes('window.setInterval') &&
    locationAdminEditor.includes('window.clearInterval') &&
    locationAdminEditor.includes('PerformanceObserver') &&
    locationAdminEditor.includes('web_map\\/get_tile') &&
    locationAdminEditor.includes('syncMapCenter') &&
    locationAdminEditor.includes('setZoomAndCenter'),
  'admin location editor must refresh the Amap canvas after the large dialog opens.'
)

assert(
  !locationAdminEditor.includes('暂时按真实目的地人工填写') &&
    !locationAdminEditor.includes('地点名称或线路轨迹地址'),
  'admin location editor must not lead with manual coordinate entry or route-track wording.'
)

assert(
  adminWidgetEditor.includes('目的地位置') &&
    !adminWidgetEditor.includes('线路轨迹/地点'),
  'admin widget editor must describe the fixed guide location as destination position.'
)

assert(
  widgetEditor.includes("widget.type === 'image_group'") && widgetEditor.includes('chooseMedia'),
  'mini program post form must expose multi-image selection for image_group widgets.'
)

assert(
  createPage.includes("widget.type === 'image_group'") && createPage.includes('uploadImages(content[widget.widgetId])'),
  'mini program post create must upload image_group temp files before creating posts.'
)

assert(
  widgetRenderer.includes("variant?: 'default' | 'guide_note'") && widgetRenderer.includes('is-guide-note'),
  'WidgetRenderer must provide a guide_note detail presentation variant.'
)

assert(
  !homePage.includes('photo-count'),
  'guide note cards must not display photo-count badges.'
)

const lockedGuideWidgetSource = guideNoteWidgets
  .split('export const GUIDE_NOTE_LOCKED_WIDGETS')[1]
  .split('const GUIDE_NOTE_LOCKED_BY_ID')[0]
assert(
  ['guide_age', 'guide_duration', 'guide_fee', 'guide_cost', 'guide_tips', '适合年龄', '游玩时间', '游玩时长', '参考费用', '注意事项']
    .every((value) => !lockedGuideWidgetSource.includes(value)),
  'guide note locked widgets must not include retired parent-logistics fields.'
)

console.log('[guide-note-static] PASS')
