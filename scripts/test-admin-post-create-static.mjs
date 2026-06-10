import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const postCreatePath = path.join(root, 'admin-web', 'src', 'views', 'CommunityAdmin', 'PostCreateAdmin.vue')
const postEditPath = path.join(root, 'admin-web', 'src', 'views', 'CommunityAdmin', 'PostEditAdmin.vue')
const formPath = path.join(root, 'admin-web', 'src', 'utils', 'postAdminForm.ts')
const apiPath = path.join(root, 'admin-web', 'src', 'api', 'cloud.ts')

const postCreate = fs.readFileSync(postCreatePath, 'utf8')
const postEdit = fs.readFileSync(postEditPath, 'utf8')
const form = fs.readFileSync(formPath, 'utf8')
const api = fs.readFileSync(apiPath, 'utf8')

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

console.log('[admin-post-create-static] PASS')
