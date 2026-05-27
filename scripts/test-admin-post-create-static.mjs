import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const postCreatePath = path.join(root, 'admin-web', 'src', 'views', 'CommunityAdmin', 'PostCreateAdmin.vue')
const apiPath = path.join(root, 'admin-web', 'src', 'api', 'cloud.ts')

const postCreate = fs.readFileSync(postCreatePath, 'utf8')
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

console.log('[admin-post-create-static] PASS')
