import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const postCreatePath = path.join(root, 'admin-web', 'src', 'views', 'CommunityAdmin', 'PostCreateAdmin.vue')
const postEditPath = path.join(root, 'admin-web', 'src', 'views', 'CommunityAdmin', 'PostEditAdmin.vue')
const formPath = path.join(root, 'admin-web', 'src', 'utils', 'postAdminForm.ts')
const apiPath = path.join(root, 'admin-web', 'src', 'api', 'cloud.ts')
const imageGroupEditorPath = path.join(root, 'admin-web', 'src', 'components', 'ImageGroupAdminEditor.vue')
const postManagementPath = path.join(root, 'admin-web', 'src', 'views', 'CommunityAdmin', 'PostManagement.vue')

const postCreate = fs.readFileSync(postCreatePath, 'utf8')
const postEdit = fs.readFileSync(postEditPath, 'utf8')
const form = fs.readFileSync(formPath, 'utf8')
const api = fs.readFileSync(apiPath, 'utf8')
const imageGroupEditor = fs.readFileSync(imageGroupEditorPath, 'utf8')
const postManagement = fs.readFileSync(postManagementPath, 'utf8')

function assertIncludes(source, needle, message) {
  if (!source.includes(needle)) {
    throw new Error(message)
  }
}

assertIncludes(
  postCreate,
  "'note_blocks'",
  'PostCreateAdmin must include note_blocks in the admin-creatable widget path.'
)
assertIncludes(
  postCreate,
  'NoteBlocksAdminEditor',
  'PostCreateAdmin must render a dedicated note_blocks editor.'
)
assertIncludes(
  api,
  'imageApi',
  'admin-web API must expose image upload metadata for note_blocks image blocks.'
)
assertIncludes(
  form,
  "'image_group'",
  'Admin post form must allow image_group widgets so guide-note posts can require covers.'
)
assertIncludes(
  form,
  "'location'",
  'Admin post form must allow location widgets so guide-note posts can store route locations.'
)
assertIncludes(
  postCreate,
  'ImageGroupAdminEditor',
  'PostCreateAdmin must render image_group editor.'
)
assertIncludes(
  postCreate,
  'LocationAdminEditor',
  'PostCreateAdmin must render location editor.'
)
assertIncludes(
  postCreate,
  ':allow-images="!isGuideNoteTemplate"',
  'PostCreateAdmin guide-note rich_note body must not expose inline image insertion.'
)
assertIncludes(
  postEdit,
  'ImageGroupAdminEditor',
  'PostEditAdmin must render image_group editor.'
)
assertIncludes(
  postEdit,
  'LocationAdminEditor',
  'PostEditAdmin must render location editor.'
)
assertIncludes(
  postEdit,
  ':allow-images="!isGuideNoteTemplate"',
  'PostEditAdmin guide-note rich_note body must not expose inline image insertion.'
)
assertIncludes(
  imageGroupEditor,
  'mediaApi.getUrls',
  'ImageGroupAdminEditor must resolve cloud:// image_group fileIDs to temporary URLs for admin preview.'
)
assertIncludes(
  imageGroupEditor,
  ':initial-index="previewIndexFor(image)"',
  'ImageGroupAdminEditor preview must open from the clicked image instead of always starting at the cover.'
)
assertIncludes(
  imageGroupEditor,
  'vuedraggable',
  'ImageGroupAdminEditor must support drag-and-drop image ordering instead of up/down buttons.'
)
assertIncludes(
  imageGroupEditor,
  'delete-button',
  'ImageGroupAdminEditor must expose a hover delete button on the image thumbnail.'
)
if (imageGroupEditor.includes('上移') || imageGroupEditor.includes('下移')) {
  throw new Error('ImageGroupAdminEditor should not use visible up/down ordering buttons.')
}
assertIncludes(
  postManagement,
  `field.type === 'image_group'`,
  'PostManagement detail must render image_group as images, not a raw comma-separated value.'
)
assertIncludes(
  postManagement,
  'detailImageUrl',
  'PostManagement detail must resolve cloud:// image_group fileIDs before rendering thumbnails.'
)
assertIncludes(
  postManagement,
  ':initial-index="detailImagePreviewIndex(field.rawValue, image)"',
  'PostManagement image_group detail preview must open from the clicked image instead of always starting at the first image.'
)
if (imageGroupEditor.includes('{{ image }}')) {
  throw new Error('ImageGroupAdminEditor must not display raw image URLs in the admin form.')
}
if (postManagement.includes('image-detail-url') || postManagement.includes(':title="image"')) {
  throw new Error('PostManagement detail must not display raw image URLs for image_group fields.')
}

console.log('[admin-post-create-static] PASS')
