import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function source(relativePath) {
  return readFileSync(path.join(adminRoot, relativePath), 'utf8')
}

test('global collaboration template management is a super-admin-only system-management page', () => {
  const pagePath = path.join(adminRoot, 'src/views/SuperAdmin/CollaborationTemplateList.vue')
  assert.equal(existsSync(pagePath), true, 'global collaboration template page is missing')

  const router = source('src/router/index.ts')
  assert.match(router, /path:\s*'collaboration-templates'/)
  assert.match(router, /name:\s*'collaboration-templates'[\s\S]*requiresRole:\s*'superAdmin'/)

  const layout = source('src/views/Layout.vue')
  assert.ok(layout.indexOf('menu-collaboration-templates') > layout.indexOf('system-management-toggle'))
  assert.match(layout, /v-if="systemManagementExpanded"[\s\S]*data-testid="menu-collaboration-templates"/)
  assert.match(layout, /index="\/collaboration-templates"/)
})

test('admin API exposes global CRUD and the page reuses the widget editor', () => {
  const api = source('src/api/cloud.ts')
  for (const action of [
    'collaborationTemplate.listAdmin',
    'collaborationTemplate.getAdmin',
    'collaborationTemplate.createAdmin',
    'collaborationTemplate.updateAdmin',
    'collaborationTemplate.disableAdmin',
    'collaborationTemplate.deleteAdmin',
  ]) {
    assert.match(api, new RegExp(action.replace('.', '\\.')))
  }

  const page = source('src/views/SuperAdmin/CollaborationTemplateList.vue')
  assert.match(page, /collaborationTemplateApi/)
  assert.match(page, /<WidgetEditor/)
  assert.match(page, /:collaboration-template-id=/)
})

test('community post management includes collaboration posts while per-community UI cannot create realtime sections', () => {
  const posts = source('src/views/CommunityAdmin/PostManagement.vue')
  assert.match(posts, /collaborationTemplateApi\.listAdmin/)
  assert.match(posts, /collaborationTemplateId/)
  assert.match(posts, /area:\s*filters\.value\.area/)

  const sections = source('src/views/CommunityAdmin/SectionList.vue')
  assert.doesNotMatch(sections, />新建实时板块</)
})
