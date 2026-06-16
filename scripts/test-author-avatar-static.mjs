import fs from 'fs'
import path from 'path'

const root = process.cwd()
const helper = fs.readFileSync(path.join(root, 'cloud', 'shared', 'simulated-author-avatars.ts'), 'utf8')
const avatarRoots = [
  path.join(root, 'miniprogram', 'src', 'static', 'ai-avatars'),
  path.join(root, 'admin-web', 'public', 'static', 'ai-avatars'),
]

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(
  helper.includes('SIMULATED_AUTHOR_AVATAR_COUNT = 50') &&
    helper.includes('/static/ai-avatars/avatar-'),
  'simulated author avatar helper should keep a 50-item /static/ai-avatars pool.',
)

for (const avatarRoot of avatarRoots) {
  const files = fs.readdirSync(avatarRoot).filter((file) => /^avatar-\d{2}\.svg$/.test(file)).sort()
  assert(files.length === 50, `${avatarRoot} should contain exactly 50 avatar SVG files.`)
  assert(files[0] === 'avatar-01.svg' && files[49] === 'avatar-50.svg', `${avatarRoot} should use avatar-01.svg through avatar-50.svg.`)

  for (const file of [files[0], files[17], files[34], files[49]]) {
    const svg = fs.readFileSync(path.join(avatarRoot, file), 'utf8')
    assert(svg.includes('<svg') && svg.includes('viewBox="0 0 160 160"'), `${file} should be a 160x160 SVG.`)
    assert(svg.includes('<ellipse') && svg.includes('<path') && svg.includes('<circle'), `${file} should render an illustrated face, not a blank placeholder.`)
  }
}

console.log('[author-avatar-static] PASS')
