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
  defaultDetailView.includes('getPostHomeTitle') &&
    defaultDetailView.includes('{{ titleText }}'),
  'default detail should derive its primary heading from the shared post-title helper.',
)

const detailTitleIndex = defaultDetailView.indexOf('class="detail-title"')
const detailAuthorIndex = defaultDetailView.indexOf('class="detail-author-row"')
const sectionLabelIndex = defaultDetailView.indexOf('class="section-line"')
const detailBodyIndex = defaultDetailView.indexOf('class="detail-body"')

assert(
  detailTitleIndex >= 0 &&
    detailTitleIndex < detailAuthorIndex &&
    detailAuthorIndex < detailBodyIndex,
  'default detail should render the post title, then author/date metadata, then body content.',
)

assert(
  sectionLabelIndex > detailTitleIndex,
  'default detail section labels must remain secondary to the post title.',
)

assert(
  defaultDetailView.includes('class="detail-author-avatar"') &&
    defaultDetailView.includes('class="detail-author-name"') &&
    defaultDetailView.includes('class="detail-publish-date"'),
  'default detail metadata should expose the author avatar, name, and publish date.',
)

assert(
  !defaultDetailView.includes('contentShapeLabel') &&
    !defaultDetailView.includes('shape-label'),
  'default detail header must not expose automatic/internal content-shape labels.',
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
