import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const postCreatePath = path.join(root, 'admin-web', 'src', 'views', 'CommunityAdmin', 'PostCreateAdmin.vue')
const postEditPath = path.join(root, 'admin-web', 'src', 'views', 'CommunityAdmin', 'PostEditAdmin.vue')
const postFormPath = path.join(root, 'admin-web', 'src', 'utils', 'postAdminForm.ts')
const apiPath = path.join(root, 'admin-web', 'src', 'api', 'cloud.ts')

const postCreate = fs.readFileSync(postCreatePath, 'utf8')
const postEdit = fs.readFileSync(postEditPath, 'utf8')
const postForm = fs.readFileSync(postFormPath, 'utf8')
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
  postForm,
  "'image_group'",
  'Admin post form utilities must treat image_group as an editable widget.'
)
assertIncludes(
  postCreate,
  'ImageGroupAdminEditor',
  'PostCreateAdmin must render a dedicated image_group editor for manual multi-image upload.'
)
assertIncludes(
  postEdit,
  'ImageGroupAdminEditor',
  'PostEditAdmin must render a dedicated image_group editor for manual multi-image editing.'
)
assertIncludes(
  api,
  'image.requestUpload',
  'admin-web API must expose image upload metadata for image_group uploads.'
)

console.log('[admin-post-create-static] PASS')
