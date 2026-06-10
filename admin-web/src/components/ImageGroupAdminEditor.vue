<template>
  <div class="image-group-admin-editor">
    <input
      ref="fileInput"
      class="file-input"
      type="file"
      accept="image/*"
      multiple
      @change="onPickImages"
    />

    <div class="image-grid">
      <div v-for="(fileID, index) in imageList" :key="`${fileID}-${index}`" class="image-card">
        <div class="image-preview">
          <img v-if="previewUrl(fileID)" :src="previewUrl(fileID)" alt="" />
          <div v-else class="image-placeholder">
            <el-icon><Picture /></el-icon>
            <span>{{ shortFileId(fileID) }}</span>
          </div>
          <span class="image-index">{{ index + 1 }}</span>
        </div>
        <div class="image-actions">
          <el-button
            :icon="ArrowLeft"
            circle
            size="small"
            :disabled="index === 0"
            title="左移"
            @click="moveImage(index, -1)"
          />
          <el-button
            :icon="ArrowRight"
            circle
            size="small"
            :disabled="index === imageList.length - 1"
            title="右移"
            @click="moveImage(index, 1)"
          />
          <el-button
            :icon="Delete"
            circle
            size="small"
            type="danger"
            title="删除"
            @click="removeImage(index)"
          />
        </div>
      </div>

      <button
        class="upload-tile"
        type="button"
        :disabled="uploading"
        aria-label="上传图片"
        @click="pickImages"
      >
        <el-icon><Plus /></el-icon>
        <span>{{ uploading ? `上传中 ${uploadedCount}/${totalCount}` : '上传图片' }}</span>
      </button>
    </div>

    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ArrowLeft, ArrowRight, Delete, Picture, Plus } from '@element-plus/icons-vue'
import { imageApi, mediaApi } from '../api/cloud'

const props = defineProps<{ modelValue: string[] }>()
const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])
const MAX_BYTES = 10 * 1024 * 1024

const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadedCount = ref(0)
const totalCount = ref(0)
const errorMessage = ref('')
const tempUrls = reactive<Record<string, string>>({})

const imageList = computed(() => Array.isArray(props.modelValue) ? props.modelValue : [])

watch(
  () => imageList.value.slice(),
  async (list) => {
    const missing = Array.from(new Set(
      list.filter((fileID) => fileID.startsWith('cloud://') && tempUrls[fileID] === undefined),
    ))
    if (missing.length === 0) return

    missing.forEach((fileID) => { tempUrls[fileID] = '' })
    try {
      const res = await mediaApi.getUrls(missing)
      missing.forEach((fileID) => { tempUrls[fileID] = res.urls[fileID] || '' })
    } catch {
      missing.forEach((fileID) => { tempUrls[fileID] = '' })
    }
  },
  { immediate: true },
)

function pickImages() {
  errorMessage.value = ''
  fileInput.value?.click()
}

function getExt(fileName: string) {
  return String(fileName || '').split('.').pop()?.toLowerCase() || ''
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function onPickImages(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  if (files.length === 0) return

  for (const file of files) {
    const ext = getExt(file.name)
    if (!IMAGE_EXTS.has(ext)) {
      errorMessage.value = `不支持的图片格式：${file.name}`
      return
    }
    if (file.size > MAX_BYTES) {
      errorMessage.value = `${file.name} 过大，限制 ${formatBytes(MAX_BYTES)}`
      return
    }
  }

  uploading.value = true
  uploadedCount.value = 0
  totalCount.value = files.length
  errorMessage.value = ''
  const next = imageList.value.slice()

  try {
    for (const file of files) {
      const fileID = await uploadToCos(file)
      next.push(fileID)
      uploadedCount.value += 1
      emit('update:modelValue', next.slice())
      void loadTempUrls([fileID])
    }
  } catch (error: any) {
    errorMessage.value = error?.message || '图片上传失败'
  } finally {
    uploading.value = false
  }
}

async function uploadToCos(file: File) {
  const meta = await imageApi.requestUpload({ fileName: file.name })
  const fd = new FormData()
  fd.append('key', meta.cloudPath)
  fd.append('Signature', meta.authorization)
  fd.append('x-cos-security-token', meta.token)
  fd.append('x-cos-meta-fileid', meta.cosFileId)
  fd.append('file', file)

  const res = await fetch(meta.url, { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`COS upload failed: ${res.status}`)
  return meta.fileId
}

async function loadTempUrls(fileIDs: string[]) {
  const cloudFileIDs = fileIDs.filter((fileID) => fileID.startsWith('cloud://'))
  if (cloudFileIDs.length === 0) return
  try {
    const res = await mediaApi.getUrls(cloudFileIDs)
    cloudFileIDs.forEach((fileID) => { tempUrls[fileID] = res.urls[fileID] || tempUrls[fileID] || '' })
  } catch {
    cloudFileIDs.forEach((fileID) => { tempUrls[fileID] = tempUrls[fileID] || '' })
  }
}

function previewUrl(fileID: string) {
  if (/^(https?:|blob:|data:)/.test(fileID)) return fileID
  return tempUrls[fileID] || ''
}

function shortFileId(fileID: string) {
  const value = String(fileID || '')
  if (value.length <= 18) return value
  return `${value.slice(0, 10)}...${value.slice(-6)}`
}

function removeImage(index: number) {
  const next = imageList.value.slice()
  next.splice(index, 1)
  emit('update:modelValue', next)
}

function moveImage(index: number, offset: number) {
  const target = index + offset
  if (target < 0 || target >= imageList.value.length) return
  const next = imageList.value.slice()
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  emit('update:modelValue', next)
}
</script>

<style scoped>
.image-group-admin-editor {
  width: 100%;
}

.file-input {
  display: none;
}

.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
  max-width: 760px;
}

.image-card,
.upload-tile {
  min-height: 168px;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  background: #fff;
}

.image-card {
  overflow: hidden;
}

.image-preview {
  position: relative;
  aspect-ratio: 1 / 1;
  background: #f5f7fa;
}

.image-preview img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.image-placeholder {
  height: 100%;
  padding: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #909399;
  word-break: break-all;
  font-size: 12px;
  text-align: center;
}

.image-placeholder .el-icon {
  font-size: 28px;
}

.image-index {
  position: absolute;
  left: 8px;
  top: 8px;
  min-width: 24px;
  height: 24px;
  padding: 0 6px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 12px;
  line-height: 24px;
  text-align: center;
}

.image-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px;
  border-top: 1px solid #ebeef5;
}

.upload-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #606266;
  cursor: pointer;
}

.upload-tile:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.upload-tile .el-icon {
  font-size: 28px;
}

.error-message {
  margin: 8px 0 0;
  color: #f56c6c;
  font-size: 13px;
}
</style>
