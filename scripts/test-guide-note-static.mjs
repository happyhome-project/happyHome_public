import fs from 'fs'
import path from 'path'

const root = process.cwd()
const sectionList = fs.readFileSync(path.join(root, 'admin-web', 'src', 'views', 'CommunityAdmin', 'SectionList.vue'), 'utf8')
const adminApi = fs.readFileSync(path.join(root, 'admin-web', 'src', 'api', 'cloud.ts'), 'utf8')
const homePage = fs.readFileSync(path.join(root, 'miniprogram', 'src', 'pages', 'index', 'index.vue'), 'utf8')
const detailPage = fs.readFileSync(path.join(root, 'miniprogram', 'src', 'pages', 'detail', 'index.vue'), 'utf8')
const widgetRenderer = fs.readFileSync(path.join(root, 'miniprogram', 'src', 'components', 'widgets', 'WidgetRenderer.vue'), 'utf8')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(
  sectionList.includes('displayTemplate') && sectionList.includes('value="guide_note"'),
  'SectionList must expose a displayTemplate selector with a guide-note option.'
)

assert(
  adminApi.includes("displayTemplate?: 'default' | 'guide_note'"),
  'admin-web section API types must include displayTemplate.'
)

assert(
  homePage.includes('getGuideNoteCard') && homePage.includes('guide-card'),
  'mini program home must render guide_note sections with guide cards.'
)

assert(
  detailPage.includes('isGuideNoteDetail') && detailPage.includes('variant="isGuideNoteDetail'),
  'mini program detail must pass guide_note variant into WidgetRenderer.'
)

assert(
  widgetRenderer.includes("variant?: 'default' | 'guide_note'") && widgetRenderer.includes('is-guide-note'),
  'WidgetRenderer must provide a guide_note detail presentation variant.'
)

assert(
  !homePage.includes('photo-count'),
  'guide note cards must not display photo-count badges.'
)

console.log('[guide-note-static] PASS')
