<template>
  <div class="rich-note-admin-editor">
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      style="display: none;"
      @change="onPickImage"
    />

    <div class="toolbar">
      <el-button size="small" @click="runAction('bold')"><strong>B</strong></el-button>
      <el-button size="small" @click="runAction('italic')"><em>I</em></el-button>
      <el-button size="small" @click="runAction('heading')">标题</el-button>
      <el-button size="small" @click="runAction('ordered-list')">有序</el-button>
      <el-button size="small" @click="runAction('unordered-list')">列表</el-button>
      <el-button size="small" @click="runAction('quote')">引用</el-button>
      <el-button size="small" @click="insertLink">链接</el-button>
      <el-button size="small" :loading="uploading" @click="pickImage">插入图片</el-button>
    </div>

    <div class="editor-grid">
      <textarea
        ref="textareaRef"
        v-model="markdown"
        class="markdown-textarea"
        placeholder="输入正文，可用上方按钮插入加粗、标题、列表、链接和图片"
        @input="emitMarkdown"
        @click="rememberSelection"
        @keyup="rememberSelection"
        @select="rememberSelection"
        @blur="rememberSelection"
      />

      <div class="preview-pane">
        <div class="preview-title">预览</div>
        <RichNoteAdminPreview v-if="markdown.trim()" :value="currentContent" />
        <el-empty v-else description="暂无内容" :image-size="64" />
      </div>
    </div>

    <div v-if="uploading" class="progress-row">
      <el-progress :percentage="percent" :stroke-width="12" />
    </div>
    <div class="muted-tip">
      内容以 Markdown 兼容结构保存。运营人员可以只用按钮排版；如果能看懂 Markdown，也可以直接微调。
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { imageApi } from '../api/cloud'
import {
  applyMarkdownToolbarAction,
  buildRichNoteContentFromMarkdown,
  normalizeRichNoteContent,
  type MarkdownToolbarAction,
  type RichNoteContent,
} from '../utils/rich-note'
import RichNoteAdminPreview from './RichNoteAdminPreview.vue'

const props = defineProps<{ modelValue: RichNoteContent | unknown }>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: RichNoteContent): void
}>()

const fileInput = ref<HTMLInputElement>()
const textareaRef = ref<HTMLTextAreaElement>()
const uploading = ref(false)
const percent = ref(0)
const markdown = ref(normalizeRichNoteContent(props.modelValue).markdown)
const selectionStart = ref(markdown.value.length)
const selectionEnd = ref(markdown.value.length)
const currentContent = computed(() => buildRichNoteContentFromMarkdown(markdown.value))

watch(
  () => props.modelValue,
  (value) => {
    const next = normalizeRichNoteContent(value).markdown
    if (next !== markdown.value && document.activeElement !== textareaRef.value) {
      markdown.value = next
      selectionStart.value = next.length
      selectionEnd.value = next.length
    }
  },
  { deep: true },
)

function emitMarkdown() {
  rememberSelection()
  emit('update:modelValue', buildRichNoteContentFromMarkdown(markdown.value))
}

function rememberSelection() {
  const el = textareaRef.value
  if (!el) return
  selectionStart.value = el.selectionStart ?? markdown.value.length
  selectionEnd.value = el.selectionEnd ?? selectionStart.value
}

function restoreSelection(start: number, end: number) {
  nextTick(() => {
    const el = textareaRef.value
    if (!el) return
    el.focus()
    el.setSelectionRange(start, end)
  })
}

function runAction(action: MarkdownToolbarAction, payload: Record<string, string> = {}) {
  rememberSelection()
  const result = applyMarkdownToolbarAction(
    markdown.value,
    action,
    selectionStart.value,
    selectionEnd.value,
    payload,
  )
  markdown.value = result.markdown
  selectionStart.value = result.selectionStart
  selectionEnd.value = result.selectionEnd
  emit('update:modelValue', buildRichNoteContentFromMarkdown(result.markdown))
  restoreSelection(result.selectionStart, result.selectionEnd)
}

async function insertLink() {
  const url = await ElMessageBox.prompt('请输入 http/https 链接', '插入链接', {
    confirmButtonText: '插入',
    cancelButtonText: '取消',
    inputPattern: /^https?:\/\/.+/,
    inputErrorMessage: '请输入 http:// 或 https:// 开头的链接',
  }).then((res) => res.value).catch(() => '')
  if (!url) return
  runAction('link', { url })
}

function pickImage() {
  fileInput.value?.click()
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function uploadImage(file: File): Promise<string> {
  const meta = await imageApi.requestUpload({ fileName: file.name })
  const fd = new FormData()
  fd.append('key', meta.cloudPath)
  fd.append('Signature', meta.authorization)
  fd.append('x-cos-security-token', meta.token)
  fd.append('x-cos-meta-fileid', meta.cosFileId)
  fd.append('file', file)

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', meta.url)
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return
      percent.value = Math.round((ev.loaded / ev.total) * 100)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`COS upload failed: ${xhr.status} ${xhr.responseText || ''}`))
    }
    xhr.onerror = () => reject(new Error('网络错误，上传失败'))
    xhr.send(fd)
  })

  return meta.fileId
}

async function onPickImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    ElMessage.error('请选择图片文件')
    input.value = ''
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    ElMessage.error(`图片过大，限制 ${formatBytes(10 * 1024 * 1024)}`)
    input.value = ''
    return
  }

  uploading.value = true
  percent.value = 0
  try {
    const fileID = await uploadImage(file)
    runAction('image', { alt: '图片', src: fileID })
    ElMessage.success('图片已插入')
  } catch (error: any) {
    ElMessage.error(error?.message || '上传图片失败')
  } finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}
</script>

<style scoped>
.rich-note-admin-editor {
  display: grid;
  gap: 10px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.editor-grid {
  display: grid;
  grid-template-columns: minmax(320px, 1fr) minmax(280px, 0.8fr);
  gap: 12px;
  align-items: stretch;
}

.markdown-textarea {
  min-height: 300px;
  padding: 14px;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  background: #fff;
  color: #303133;
  font-size: 14px;
  line-height: 1.8;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}

.markdown-textarea:focus {
  border-color: #409eff;
}

.preview-pane {
  min-height: 300px;
  padding: 14px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafafa;
  box-sizing: border-box;
}

.preview-title {
  margin-bottom: 10px;
  color: #909399;
  font-size: 12px;
}

.progress-row {
  width: 360px;
}

.muted-tip {
  color: #909399;
  font-size: 12px;
}

@media (max-width: 960px) {
  .editor-grid {
    grid-template-columns: 1fr;
  }
}
</style>
