import fs from 'fs'
import path from 'path'

const home = fs.readFileSync(
  path.join(process.cwd(), 'miniprogram', 'src', 'pages', 'index', 'index.vue'),
  'utf8',
)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function styleBlock(selector) {
  const escaped = selector.replaceAll('.', '\\.')
  return home.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] || ''
}

const section = styleBlock('.group-section')
const sectionTitle = styleBlock('.group-section-title')
const card = styleBlock('.group-card')
const ribbonCard = styleBlock('.group-card--with-ribbon')
const icon = styleBlock('.group-icon')
const iconImage = styleBlock('.group-icon-image')
const body = styleBlock('.group-body')
const meta = styleBlock('.group-meta')

assert(
  home.includes(":class=\"{ 'group-card--with-ribbon': item.isPinned || item.isFeatured }\""),
  'activity cards should bind the ribbon safe-area modifier only when a ribbon exists.',
)
assert(section.includes('margin: 0 24rpx 34rpx'), 'activity section should use the Figma 12px page gutter.')
assert(
  sectionTitle.includes('margin-bottom: 32rpx') &&
    sectionTitle.includes('font-size: var(--hh-text-heading-md-size)') &&
    sectionTitle.includes('line-height: var(--hh-text-heading-md-line)'),
  'activity section heading should use the Figma 20px type and 16px content gap.',
)
assert(
  card.includes('box-sizing: border-box') &&
    card.includes('min-height: 160rpx') &&
    card.includes('padding: 32rpx') &&
    card.includes('border-radius: 24rpx') &&
    card.includes('gap: 24rpx') &&
    card.includes('border: 0') &&
    card.includes('box-shadow: none') &&
    !card.includes('padding: 18rpx 104rpx 18rpx 18rpx'),
  'ordinary activity cards should use the Figma 80px height and symmetric 16px padding.',
)
assert(
  ribbonCard.includes('padding-right: 104rpx'),
  'only ribbon cards should reserve a right-side text safe area.',
)
assert(
  icon.includes('width: 96rpx') &&
    icon.includes('height: 96rpx') &&
    icon.includes('border-radius: 24rpx'),
  'activity icons should use the Figma 48px square and 12px radius.',
)
assert(
  iconImage.includes('width: 70rpx') && iconImage.includes('height: 56rpx'),
  'the car asset should use the Figma vector bounds inside its icon container.',
)
assert(
  body.includes('display: flex') && body.includes('flex-direction: column') && body.includes('gap: 8rpx'),
  'activity title and metadata should use the Figma 4px vertical gap.',
)
assert(
  !meta.includes('margin-top: 4rpx'),
  'metadata spacing should come from the body stack rather than an extra margin.',
)
assert(
  !/\.group-card,\s*\.sch-card,/.test(home),
  'the shared card-theme rule should not override the collaboration card radius and shadow.',
)

console.log('Home collaboration Figma layout static checks passed.')
