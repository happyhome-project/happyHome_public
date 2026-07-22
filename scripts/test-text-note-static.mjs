import fs from 'fs'
import path from 'path'

const root = process.cwd()
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8')
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const createPage = read('miniprogram', 'src', 'pages', 'create', 'index.vue')
const cover = read('miniprogram', 'src', 'components', 'TextNoteCover.vue')
const textNoteUtils = read('miniprogram', 'src', 'utils', 'text-note.ts')
const homePage = read('miniprogram', 'src', 'pages', 'index', 'index.vue')
const sectionPage = read('miniprogram', 'src', 'pages', 'section', 'index.vue')
const detailPage = read('miniprogram', 'src', 'pages', 'detail', 'index.vue')
const defaultDetail = read('miniprogram', 'src', 'components', 'DefaultDetailView.vue')
const createTemplate = createPage.split('<script setup')[0]
const coverAssetDir = path.join(root, 'miniprogram', 'src', 'static', 'text-note-covers')
const coverAssetNames = ['paper', 'mint', 'slate', 'headline', 'quote', 'notice']

assert(createPage.includes("section.displayTemplate === 'text_note'"), 'text_note must be selected by displayTemplate.')
assert(createPage.includes("const textNoteStep = ref<'compose' | 'cover'>('compose')"), 'text_note must use explicit compose and cover steps.')
assert(createPage.includes('class="text-note-compose"') && createPage.includes('class="text-note-cover-step"'), 'both text-note steps must render.')
assert(/textNoteBodyWidget[\s\S]{0,500}guide-role="body"[\s\S]{0,240}placeholder="添加正文内容"/.test(createPage), 'text-note body must reuse the guide-style plain writing surface.')
assert(createPage.includes('<TextNoteCover') && createPage.includes('v-for="theme in TEXT_NOTE_THEMES"'), 'cover preview and six theme choices must use TextNoteCover.')
assert(createPage.includes('.text-note-theme-option :deep(.text-note-cover-kicker)') && !createPage.includes('.text-note-theme-option :deep(.text-note-cover-signature)'), 'theme thumbnails must scale dynamic text without redrawing the signature embedded in the SVG background.')
assert(/isTextNoteCreateMode\.value[\s\S]{0,120}return false/.test(createPage), 'rich-note images must be disabled in text-note mode.')
assert(!createTemplate.includes('AI帮你写') && !createTemplate.includes('figma-ai-write'), 'unavailable AI writing affordance must not render in any authoring mode.')
assert(createPage.includes('presentation: isTextNoteCreateMode.value') && createPage.includes('textNoteTheme: textNoteTheme.value'), 'text-note theme must be submitted as top-level presentation.')
assert(createPage.includes("section.displayTemplate === 'guide_note'") && createPage.includes("type: 'guideMain'") && createPage.includes("type: 'widget'"), 'default and guide authoring paths must remain present.')
assert(/\.text-note-cover-frame\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*5;/s.test(cover), 'TextNoteCover must keep a fixed 4:5 ratio.')
assert(['paper', 'mint', 'slate', 'headline', 'quote', 'notice'].every((theme) => cover.includes(`text-note-cover--${theme}`)), 'TextNoteCover must define all six themes.')
assert(['paper', 'mint', 'slate', 'headline', 'quote', 'notice'].every((theme) => new RegExp(`text-note-cover--${theme} \\.text-note-cover-(title|body|content|rule|kicker)`).test(cover)), 'every theme must change typography or layout in addition to its background.')
assert(coverAssetNames.every((theme) => cover.includes(`/static/text-note-covers/${theme}.svg`)), 'every text-note theme must use its exported Figma SVG background.')
assert(coverAssetNames.every((theme) => {
  const assetPath = path.join(coverAssetDir, `${theme}.svg`)
  return fs.existsSync(assetPath) && fs.readFileSync(assetPath, 'utf8').trimStart().startsWith('<svg')
}), 'all six Figma text-note SVG backgrounds must be committed as valid SVG files.')
assert(coverAssetNames.reduce((total, theme) => total + fs.statSync(path.join(coverAssetDir, `${theme}.svg`)).size, 0) < 1024 * 1024, 'optimized text-note SVG backgrounds must stay below 1 MiB combined.')
assert(!cover.includes('text-note-cover-decoration'), 'legacy CSS ornaments must not render over the exported Figma backgrounds.')
assert(textNoteUtils.includes("kicker: '通知公告'") && cover.includes('overflow-wrap: anywhere'), 'notice label and overflow-safe text are required.')
assert(homePage.includes("displayTemplate === 'text_note'") && homePage.includes('class="text-note-feed"') && homePage.includes('<TextNoteCover'), 'home must use a dedicated text-note two-column cover feed.')
assert(sectionPage.includes("displayTemplate === 'text_note'") && sectionPage.includes('class="text-note-section-grid"') && sectionPage.includes('<TextNoteCover'), 'section page must use a dedicated text-note grid.')
assert(!/text_note[\s\S]{0,160}guide-cover/.test(homePage), 'text-note home cards must not enter guide image rendering.')
assert(detailPage.includes("displayTemplate === 'text_note'") && detailPage.includes('return false'), 'text-note detail must remain outside guide-route rendering.')
assert(defaultDetail.includes('isTextNoteDetail') && defaultDetail.includes('<TextNoteCover') && defaultDetail.includes('class="text-note-detail-cover"'), 'text-note detail must render its body as the selected visual cover.')
assert(defaultDetail.includes('needsTextNoteFullBody') && defaultDetail.includes('class="text-note-full-body"'), 'long text notes must keep an accessible full-text continuation after the cover.')

console.log('text note authoring static checks passed')
