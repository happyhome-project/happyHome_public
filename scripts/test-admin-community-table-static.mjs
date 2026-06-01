import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sourcePath = resolve('admin-web/src/views/CommunityAdmin/CommunityList.vue')
const source = readFileSync(sourcePath, 'utf8')

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
