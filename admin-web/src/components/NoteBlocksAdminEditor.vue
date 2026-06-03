<template>
  <div class="note-blocks-admin-editor">
    <input
      ref="fileInput"
      type="file"
      accept="image/jpeg,image/png,image/webp,image/gif"
      style="display: none;"
      multiple
      @change="onPickImages"
    />

    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="图文笔记会按块顺序展示；文字支持 emoji，图片会上传到云存储。"
    />

    <el-empty v-if="blocks.length === 0 && !uploading" description="还没有图文内容" />

    <div v-for="(block, index) in blocks" :key="block.blockId" class="note-block-card">
      <div class="block-head">
        <el-tag size="small" effect="plain">{{ block.type === 'image' ? '图片' : '文字' }}</el-tag>
        <div class="block-actions">
          <el-button link :icon="Top" :disabled="index === 0" @click="moveBlock(index, -1)">上移</el-button>
          <el-button link :icon="Bottom" :disabled="index === blocks.length - 1" @click="moveBlock(index, 1)">下移</el-button>
          <el-button link type="danger" :icon="Delete" @click="removeBlock(index)">删除</el-button>
        </div>
      </div>

      <el-input
        v-if="block.type === 'text'"
        v-model="block.text"
        type="textarea"
        :rows="5"
        placeholder="输入文字，支持 emoji 表情"
        @input="emitBlocks"
      />

      <div v-else class="image-block">
        <img
          v-if="previewUrlByBlockId[block.blockId]"
          :src="previewUrlByBlockId[block.blockId]"
          alt="图文笔记图片预览"
          class="image-preview"
        />
        <div class="file-id" :title="block.fileID">{{ block.fileID }}</div>
      </div>
    </div>

    <div v-if="uploading" class="progress-row">
      <el-progress :percentage="percent" :stroke-width="14" />
      <span class="muted">{{ formatBytes(uploadedBytes) }} / {{ formatBytes(totalBytes) }}</span>
    </div>

    <div class="toolbar">
      <el-button :icon="Plus" @click="addTextBlock">添加文字</el-button>
      <el-button :icon="Upload" :loading="uploading" @click="pickImages">上传图片</el-button>
      <span class="muted">支持 jpg / png / webp / gif，单张不超过 10MB</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { Bottom, Delete, Plus, Top, Upload } from '@element-plus/icons-vue'
import { imageApi } from '../api/cloud'

type NoteTextBlock = { blockId: string; type: 'text'; text: string }
type NoteImageBlock = { blockId: string; type: 'image'; fileID: string }
type NoteBlock = NoteTextBlock | NoteImageBlock

const props = defineProps<{ modelValue: NoteBlock[] }>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: NoteBlock[]): void
}>()

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])
const MAX_BYTES = 10 * 1024 * 1024

const fileInput = ref<HTMLInputElement>()
const blocks = ref<NoteBlock[]>([])
const uploading = ref(false)
const percent = ref(0)
const uploadedBytes = ref(0)
const totalBytes = ref(0)
const previewUrlByBlockId = reactive<Record<string, string>>({})

watch(
  () => props.modelValue,
  (value) => {
    blocks.value = Array.isArray(value) ? value.map((item) => ({ ...item })) : []
  },
  { immediate: true, deep: true },
)

function newBlockId() {
  return `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function emitBlocks() {
  emit('update:modelValue', blocks.value.map((item) => ({ ...item })))
}

function addTextBlock() {
  blocks.value.push({ blockId: newBlockId(), type: 'text', text: '' })
  emitBlocks()
}

function pickImages() {
  fileInput.value?.click()
}

function removeBlock(index: number) {
  const [removed] = blocks.value.splice(index, 1)
  if (removed?.type === 'image' && previewUrlByBlockId[removed.blockId]) {
    URL.revokeObjectURL(previewUrlByBlockId[removed.blockId])
    delete previewUrlByBlockId[removed.blockId]
  }
  emitBlocks()
}

function moveBlock(index: number, direction: -1 | 1) {
  const nextIndex = index + direction
  if (nextIndex < 0 || nextIndex >= blocks.value.length) return
  const next = [...blocks.value]
  const [item] = next.splice(index, 1)
  next.splice(nextIndex, 0, item)
  blocks.value = next
  emitBlocks()
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function getExt(fileName: string) {
  return String(fileName || '').split('.').pop()?.toLowerCase() || ''
}

async function uploadToCos(file: File, uploadedBefore: number) {
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
      uploadedBytes.value = uploadedBefore + ev.loaded
      percent.value = Math.min(99, Math.round((uploadedBytes.value / totalBytes.value) * 100))
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

async function onPickImages(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  if (files.length === 0) return

  for (const file of files) {
    const ext = getExt(file.name)
    if (!IMAGE_EXTS.has(ext)) {
      ElMessage.error(`不支持的图片格式：${file.name}`)
      input.value = ''
      return
    }
    if (file.size > MAX_BYTES) {
      ElMessage.error(`${file.name} 过大，限制 ${formatBytes(MAX_BYTES)}`)
      input.value = ''
      return
    }
  }

  uploading.value = true
  percent.value = 0
  uploadedBytes.value = 0
  totalBytes.value = files.reduce((sum, file) => sum + file.size, 0)

  try {
    let uploadedBefore = 0
    for (const file of files) {
      const blockId = newBlockId()
      const fileID = await uploadToCos(file, uploadedBefore)
      uploadedBefore += file.size
      uploadedBytes.value = uploadedBefore
      blocks.value.push({ blockId, type: 'image', fileID })
      previewUrlByBlockId[blockId] = URL.createObjectURL(file)
      emitBlocks()
    }
    percent.value = 100
    ElMessage.success('图片上传成功')
  } catch (err: any) {
    ElMessage.error(err?.message || '图片上传失败')
  } finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}
</script>

<style scoped>
.note-blocks-admin-editor {
  display: grid;
  gap: 12px;
  max-width: 760px;
}

.note-block-card {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 12px;
  background: #fff;
}

.block-head,
.block-actions,
.toolbar,
.progress-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.block-head {
  justify-content: space-between;
  margin-bottom: 10px;
}

.image-block {
  display: grid;
  gap: 8px;
}

.image-preview {
  max-width: 280px;
  max-height: 180px;
  object-fit: contain;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #f8fafc;
}

.file-id {
  color: #909399;
  font-size: 12px;
  max-width: 680px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.muted {
  color: #909399;
  font-size: 12px;
}
</style>
