import fs from 'fs'
import path from 'path'

const root = process.cwd()

function read(...segments) {
  return fs.readFileSync(path.join(root, ...segments), 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const home = read('miniprogram', 'src', 'pages', 'index', 'index.vue')
const section = read('miniprogram', 'src', 'pages', 'section', 'index.vue')

assert(
  home.includes("import { getImageNoteCard } from '../../utils/image-note'") &&
    section.includes("import { getImageNoteCard } from '../../utils/image-note'"),
  'home and section feeds should consume the shared image-note card view model.',
)

assert(
  home.includes("section?.displayTemplate === 'image_note'") &&
    section.includes("section.value?.displayTemplate === 'image_note'"),
  'image-note feed selection must use the explicit displayTemplate contract.',
)

assert(
  !home.includes('IMAGE_NOTE_NAME_HINTS') && !section.includes('IMAGE_NOTE_NAME_HINTS'),
  'image-note feeds must never be inferred from section names.',
)

assert(
  home.includes("displayTemplate: 'default' | 'guide_note' | 'image_note'") &&
    home.includes("activeArchiveGroup.displayTemplate === 'image_note'") &&
    home.includes("'image-note-feed': activeArchiveGroup.displayTemplate === 'image_note'") &&
    home.includes('const imageNoteColumns = computed<ArchiveItem[][]>'),
  'home should render image_note as an explicit two-column visual feed.',
)

assert(
  section.includes('v-else-if="isImageNote"') &&
    section.includes('class="image-note-feed"') &&
    section.includes('const imageNoteColumns = computed<SectionListItem[][]>'),
  'section page should render image_note as an explicit two-column visual feed.',
)

for (const [source, label] of [[home, 'home'], [section, 'section']]) {
  assert(
    /class="[^"]*image-note-cover/.test(source) &&
      /class="[^"]*image-note-title/.test(source) &&
      /class="[^"]*image-note-author-avatar/.test(source) &&
      /class="[^"]*image-note-author-name/.test(source) &&
      /class="[^"]*image-note-like/.test(source),
    `${label} image-note cards should contain cover, title, author avatar/name, and like count.`,
  )
}

const homeImageNoteTemplate = home.match(
  /<template v-if="activeArchiveGroup\.displayTemplate === 'image_note'">([\s\S]*?)<template v-else>/,
)?.[1] || ''
const sectionImageNoteTemplate = section.match(
  /v-else-if="isImageNote"([\s\S]*?)<view v-else class="post-list">/,
)?.[1] || ''

for (const [template, label] of [[homeImageNoteTemplate, 'home'], [sectionImageNoteTemplate, 'section']]) {
  assert(template, `${label} should have a dedicated image-note template branch.`)
  assert(
    !/driveDuration|routeStats|altitude|climb|location|地点|海拔|爬升/.test(template),
    `${label} image-note cards must not expose route statistics or location.`,
  )
}

assert(
  home.includes('@error="onHomeGuideImageError(item, $event)"') &&
    section.includes('@error="onSectionImageError(item.coverImage)"'),
  'image-note covers should fall back cleanly when resolved images fail.',
)

console.log('[image-note-static] PASS')
