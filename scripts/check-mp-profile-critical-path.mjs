import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const projectRoot = process.cwd()
const profileChunk = path.join(
  projectRoot,
  'miniprogram',
  'dist',
  'build',
  'mp-weixin',
  'pages',
  'profile',
  'index.js',
)

if (!fs.existsSync(profileChunk)) {
  console.error(`Missing mp-weixin profile chunk: ${profileChunk}`)
  console.error('Run npm.cmd --workspace miniprogram run build:mp-weixin first.')
  process.exit(1)
}

const source = fs.readFileSync(profileChunk, 'utf8')
const headerEnd = source.indexOf('defineComponent')
const topLevelRequireHeader = source.slice(0, headerEnd > 0 ? headerEnd : 1200)
const forbiddenCriticalRequires = [
  'utils/profile-admin-tools',
  'utils/profile-notifications',
]

const findings = forbiddenCriticalRequires.filter((needle) => topLevelRequireHeader.includes(needle))

if (findings.length > 0) {
  console.error('profile page critical path still statically loads post-login/admin-only helpers:')
  for (const finding of findings) {
    console.error(`- ${finding}`)
  }
  console.error('Keep the profile first screen small enough to render version/login/community shell first.')
  process.exit(1)
}

console.log('mp-weixin profile critical path check passed')
