import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const layout = readFileSync(resolve('admin-web/src/views/Layout.vue'), 'utf8')
const communityList = readFileSync(resolve('admin-web/src/views/CommunityAdmin/CommunityList.vue'), 'utf8')
const sectionList = readFileSync(resolve('admin-web/src/views/CommunityAdmin/SectionList.vue'), 'utf8')
const widgetEditor = readFileSync(resolve('admin-web/src/views/CommunityAdmin/WidgetEditor.vue'), 'utf8')
const postCreate = readFileSync(resolve('admin-web/src/views/CommunityAdmin/PostCreateAdmin.vue'), 'utf8')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(
  !layout.includes('data-testid="menu-community-create"') &&
    !layout.includes('data-testid="menu-disabled-communities"'),
  'left navigation should not expose separate create-community or disabled-community entries',
)

assert(
  communityList.includes('v-model="communityTab"') &&
    communityList.includes('data-testid="community-tab-all"') &&
    communityList.includes('data-testid="community-tab-active"') &&
    communityList.includes('data-testid="community-tab-disabled"'),
  'community list should expose all/active/disabled tabs',
)

assert(
  communityList.includes('communityApi.listDisabled') &&
    communityList.includes('restoreCommunity') &&
    communityList.includes('hardDeleteCommunity') &&
    communityList.includes('data-testid="community-more-actions"'),
  'community list should integrate disabled community restore/delete and compact more-actions menu',
)

assert(
  communityList.includes('data-testid="community-members-button"') &&
    communityList.includes('data-testid="community-join-type-toggle"') &&
    communityList.includes('watch(communityTab') &&
    communityList.includes("statusFilter.value = 'all'"),
  'community compact actions should preserve stable selectors and reset stale status filters on tab changes',
)

assert(
  sectionList.includes('data-testid="section-back-button"') &&
    sectionList.includes('data-testid="widget-config-dialog"') &&
    sectionList.includes('width="min(1180px, calc(100vw - 48px))"') &&
    sectionList.includes('openWidgetEditor') &&
    sectionList.includes('<WidgetEditor') &&
    !sectionList.includes("router.push({ name: 'widgets'"),
  'section management should have a back button and open widget configuration in a dialog',
)

assert(
  widgetEditor.includes('defineProps') &&
    widgetEditor.includes('embedded') &&
    widgetEditor.includes('low-code-workbench') &&
    widgetEditor.includes('property-panel') &&
    widgetEditor.includes('selectedWidget') &&
    widgetEditor.includes('@media (max-width: 1100px)'),
  'widget editor should support embedded low-code configuration mode',
)

assert(
  postCreate.includes('useRouter') &&
    postCreate.includes("router.push({ name: 'posts'") &&
    !postCreate.includes('window.location.assign'),
  'post-create secondary-page back action should use vue-router rather than hard navigation',
)

console.log('[admin-community-management-static] ok')
