import fs from 'fs'
import path from 'path'

const root = process.cwd()
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8')
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const createPage = read('miniprogram', 'src', 'pages', 'create', 'index.vue')
const cover = read('miniprogram', 'src', 'components', 'TextNoteCover.vue')

assert(createPage.includes("section.displayTemplate === 'text_note'"), 'text_note must be selected by displayTemplate.')
assert(createPage.includes("const textNoteStep = ref<'compose' | 'cover'>('compose')"), 'text_note must use explicit compose and cover steps.')
assert(createPage.includes('class="text-note-compose"') && createPage.includes('class="text-note-cover-step"'), 'both text-note steps must render.')
assert(createPage.includes('<TextNoteCover') && createPage.includes('v-for="theme in TEXT_NOTE_THEMES"'), 'cover preview and six theme choices must use TextNoteCover.')
assert(/isTextNoteCreateMode\.value[\s\S]{0,120}return false/.test(createPage), 'rich-note images must be disabled in text-note mode.')
assert(/v-if="!isTextNoteCreateMode"[\s\S]{0,500}AI帮你写/.test(createPage), 'AI affordance must not render in the text-note branch.')
assert(createPage.includes('presentation: isTextNoteCreateMode.value') && createPage.includes('textNoteTheme: textNoteTheme.value'), 'text-note theme must be submitted as top-level presentation.')
assert(createPage.includes("section.displayTemplate === 'guide_note'") && createPage.includes("type: 'guideMain'") && createPage.includes("type: 'widget'"), 'default and guide authoring paths must remain present.')
assert(/\.text-note-cover-frame\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*5;/s.test(cover), 'TextNoteCover must keep a fixed 4:5 ratio.')
assert(['paper', 'mint', 'slate', 'headline', 'quote', 'notice'].every((theme) => cover.includes(`text-note-cover--${theme}`)), 'TextNoteCover must define all six themes.')
assert(cover.includes('通知公告') && cover.includes('overflow-wrap: anywhere'), 'notice label and overflow-safe text are required.')

console.log('text note authoring static checks passed')
