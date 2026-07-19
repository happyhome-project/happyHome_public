import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(resolve(root, relative), 'utf8')

test('后台新建帖子暴露三种媒体形态和两种实时协作模板', () => {
  const view = read('src/views/CommunityAdmin/PostCreateAdmin.vue')
  assert.match(view, /图文/)
  assert.match(view, /图片/)
  assert.match(view, /视频/)
  assert.match(view, /collaborationTemplateApi\.listAdmin/)
  assert.match(view, /area:\s*'archive'/)
  assert.match(view, /area:\s*'collaboration'/)
  assert.match(view, /collaborationTemplateId/)
})

test('后台提交前移除未填写的可选地点，避免二次编辑产生非法零坐标', () => {
  const form = read('src/utils/postAdminForm.ts')
  for (const viewName of ['PostCreateAdmin.vue', 'PostEditAdmin.vue']) {
    assert.match(read(`src/views/CommunityAdmin/${viewName}`), /serializeAdminPostFormData/)
  }
  assert.match(form, /export function serializeAdminPostFormData/)
  assert.match(form, /delete output\[widget\.widgetId\]/)
})

test('post.createAdmin API 接受 legacy archive collaboration 三类目标', () => {
  const api = read('src/api/cloud.ts')
  assert.match(api, /type AdminPostCreateParams/)
  assert.match(api, /area:\s*'archive'/)
  assert.match(api, /area:\s*'collaboration'/)
  assert.match(api, /collaborationTemplateId/)
})

test('原生 archive 视频只允许一个自托管视频，创建和二次编辑契约一致', () => {
  const create = read('src/views/CommunityAdmin/PostCreateAdmin.vue')
  const edit = read('src/views/CommunityAdmin/PostEditAdmin.vue')
  const editor = read('src/components/VideoItemEditor.vue')
  assert.match(create, /isArchiveVideoTarget/)
  assert.match(create, /:cos-only="isArchiveVideoTarget"/)
  assert.match(edit, /:cos-only="isArchiveVideoPost"/)
  assert.match(editor, /cosOnly\?: boolean/)
  assert.match(editor, /v-if="!cosOnly"/)
})
