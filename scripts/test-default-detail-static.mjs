import fs from 'fs'
import path from 'path'

const root = process.cwd()
const defaultDetailView = fs.readFileSync(
  path.join(root, 'miniprogram', 'src', 'components', 'DefaultDetailView.vue'),
  'utf8',
)
const detailPage = fs.readFileSync(
  path.join(root, 'miniprogram', 'src', 'pages', 'detail', 'index.vue'),
  'utf8',
)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(
  defaultDetailView.includes('{{ sectionName }}'),
  'default detail header should keep the user-facing section name.',
)

assert(
  !defaultDetailView.includes('contentShapeLabel') &&
    !defaultDetailView.includes('shape-label'),
  'default detail header must not expose automatic/internal content-shape labels.',
)

assert(
  !defaultDetailView.includes('class="byline"'),
  'default detail header must not reserve top space for the author byline.',
)

assert(
  defaultDetailView.includes('class="lead-card"') &&
    defaultDetailView.includes('class="lead-label"') &&
    defaultDetailView.includes('{{ leadLabel }}:'),
  'default detail lead text should render as a labeled compact card.',
)

assert(
  defaultDetailView.includes('{{ fact.label }}:'),
  'default detail fact rows should append a colon after the label.',
)

assert(
  detailPage.includes('meta-author-avatar') &&
    detailPage.includes('authorAvatarUrl') &&
    detailPage.includes('resolvedAvatarUrl(detailAuthorAvatarUrl)'),
  'detail footer should render the real author avatar beside the publish date.',
)

console.log('[default-detail-static] PASS')
