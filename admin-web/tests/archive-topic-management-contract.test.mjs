import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const view = fs.readFileSync(new URL('../src/views/CommunityAdmin/ArchiveTopics.vue', import.meta.url), 'utf8')
const api = fs.readFileSync(new URL('../src/api/cloud.ts', import.meta.url), 'utf8')

test('archive topics are reordered by drag handle without numeric order controls', () => {
  assert.match(view, /vuedraggable/)
  assert.match(view, /handle="\.drag-handle"/)
  assert.doesNotMatch(view, /el-input-number/)
  assert.match(view, /archiveTopicApi\.reorder/)
})

test('archive topic management exposes create rename enable and logical delete actions', () => {
  for (const action of ['create', 'rename', 'setEnabled', 'reorder', 'delete']) {
    assert.match(api, new RegExp(`${action}:`))
  }
  assert.match(view, /帖子和帖子里的 #话题不会删除/)
  assert.match(view, /上移/)
  assert.match(view, /下移/)
})
