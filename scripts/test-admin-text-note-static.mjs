import fs from 'node:fs'
import path from 'node:path'

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), ...parts), 'utf8')
const sectionList = read('admin-web', 'src', 'views', 'CommunityAdmin', 'SectionList.vue')
const widgetEditor = read('admin-web', 'src', 'views', 'CommunityAdmin', 'WidgetEditor.vue')
const adminApi = read('admin-web', 'src', 'api', 'cloud.ts')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(adminApi.includes("displayTemplate?: 'default' | 'guide_note' | 'text_note'"), 'admin API enum must include text_note')
assert(sectionList.includes('value="text_note"') && sectionList.includes('纯文字笔记'), 'SectionList must expose the third text-note radio')
assert(sectionList.includes("section?.displayTemplate === 'text_note' ? 'text_note'"), 'SectionList load must preserve text_note')
assert(sectionList.includes(':disabled="!!editingId"'), 'SectionList must disable template changes while editing')
assert(widgetEditor.includes("sectionDisplayTemplate.value === 'text_note'") && widgetEditor.includes("'text_title'") && widgetEditor.includes("'text_body'"), 'WidgetEditor must recognize text-note locked widgets')
assert(widgetEditor.includes('v-if="!isTextNoteTemplate"') && widgetEditor.includes('不能新增、删除、改类型或调整顺序'), 'text-note must expose exactly its two fixed widgets')
assert(widgetEditor.includes('order: resolveWidgetOrder(widget, index)'), 'WidgetEditor payload must preserve canonical locked-widget order')
assert(widgetEditor.includes("title=\"纯文字笔记固定控件\"") && widgetEditor.includes('标题和正文是纯文字笔记的完整固定结构'), 'WidgetEditor must explain the text-note fixed structure')
assert(sectionList.includes('<el-radio-group v-model="form.type" :disabled="!!editingId">'), 'SectionList must disable section type changes while editing')

console.log('[admin-text-note-static] PASS')
