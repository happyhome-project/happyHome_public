import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function source(relativePath) {
  return readFileSync(path.join(adminRoot, relativePath), 'utf8')
}

test('板块 API 和管理页识别 image_note 与图文_new', () => {
  assert.match(source('src/api/cloud.ts'), /'default'\s*\|\s*'guide_note'[\s\S]*'image_note'/)
  const sectionList = source('src/views/CommunityAdmin/SectionList.vue')
  assert.match(sectionList, /value="image_note">图文_new<\/el-radio>/)
  assert.match(sectionList, /添加图片、主题、正文、话题、设置地点/)
})

test('固定图文模板控件和话题类型在控件编辑器中可识别但不可改', () => {
  const widgetEditor = source('src/views/CommunityAdmin/WidgetEditor.vue')
  assert.doesNotMatch(widgetEditor, /\.\.\/\.\.\/\.\.\/\.\.\/cloud\//)
  assert.match(widgetEditor, /value="topic"/)
  for (const widgetId of [
    'image_note_images',
    'image_note_title',
    'image_note_body',
    'image_note_topics',
    'image_note_location',
  ]) {
    assert.match(widgetEditor, new RegExp(widgetId))
  }
  assert.match(widgetEditor, /v-if="!isFixedTemplate"[^>]*@click="addWidget"/)
  assert.match(widgetEditor, /function addWidget\(\)\s*\{\s*if \(isFixedTemplate\.value\) return/)
})

test('后台发帖和编辑页都接入话题编辑器', () => {
  assert.equal(existsSync(path.join(adminRoot, 'src/components/TopicAdminEditor.vue')), true)
  const postForm = source('src/utils/postAdminForm.ts')
  assert.match(postForm, /['"]topic['"]/)
  for (const view of ['PostCreateAdmin.vue', 'PostEditAdmin.vue']) {
    const content = source(`src/views/CommunityAdmin/${view}`)
    assert.match(content, /TopicAdminEditor/)
    assert.match(content, /widget\.type === 'topic'/)
  }
})
