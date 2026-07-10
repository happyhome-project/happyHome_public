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
const createPage = read('miniprogram', 'src', 'pages', 'create', 'index.vue')

const figmaIconNodes = {
  family: '20040:4379',
  trade: '20040:4434',
  notice: '20040:4465',
  lost: '20040:4500',
  neighbor: '20040:4537',
  car: '20040:4559',
  calendar: '20023:1670',
  'save-draft': '20023:1552',
}

for (const [name, nodeId] of Object.entries(figmaIconNodes)) {
  const svg = read('miniprogram', 'src', 'static', 'publish-icons', `${name}.svg`)
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
  createPage.includes("import { resolveActivityAnnouncementMain } from '../../utils/create-form-layout'") &&
    createPage.includes("type: 'activityMain'") &&
    createPage.includes("block.type === 'activityMain'") &&
    createPage.includes('class="figma-activity-main-card"'),
  'activity announcement title and detail should render in one semantic main-content card.',
)

console.log('create publish UI static checks passed')
