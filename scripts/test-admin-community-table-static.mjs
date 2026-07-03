import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sourcePath = resolve('admin-web/src/views/CommunityAdmin/CommunityList.vue')
const source = readFileSync(sourcePath, 'utf8')
const apiSource = readFileSync(resolve('admin-web/src/api/cloud.ts'), 'utf8')

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

assert(
  source.includes('data-testid="community-description-cell"'),
  'description column should render a wrapping cell with a stable test id',
)
assert(
  source.includes('data-testid="community-motto-cell"'),
  'motto column should render a wrapping cell with a stable test id',
)
assert(
  source.includes('data-testid="community-motto-button"') &&
    source.includes('data-testid="community-banner-button"') &&
    source.includes('data-testid="community-banner-dialog"') &&
    source.includes('data-testid="community-banner-cover-editor"') &&
    source.includes('openBannerManager') &&
    source.includes('saveHomeBanners'),
  'community list should expose separate motto and homepage banner management entries',
)
assert(
  source.includes('title="编辑格言"') &&
    !source.includes('data-testid="community-home-cover-editor"') &&
    !source.includes('封面图会显示为小程序首页“新人必看”的大图'),
  'motto editor should remain text-only and not mention homepage banner covers',
)
assert(
  apiSource.includes('updateHomeBanners') && apiSource.includes('community.updateHomeBanners'),
  'admin community API should expose a dedicated home banner update action',
)
assert(
  source.includes('@header-dragend="handleColumnDragEnd"'),
  'community table should persist column width changes from header drag events',
)
assert(
  source.includes('COMMUNITY_TABLE_COLUMN_WIDTHS_KEY'),
  'community table should use a stable localStorage key for column widths',
)
assert(
  !source.includes('prop="description" label="描述" min-width="220" show-overflow-tooltip'),
  'description column should not be forced into single-line overflow tooltip mode',
)
assert(
  source.includes('.wrapping-table-cell'),
  'wrapping table cell CSS should be present',
)

console.log('[community-table-static] ok')
