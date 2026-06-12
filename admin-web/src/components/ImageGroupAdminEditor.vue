<template>
  <div class="image-group-admin-editor">
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      multiple
      style="display: none;"
      @change="onPickImages"
    />

    <div class="image-actions">
      <el-button :icon="Upload" :loading="uploading" @click="pickImages">上传图片</el-button>
      <el-input
        v-model="manualUrl"
        class="manual-input"
        placeholder="备用：粘贴图片地址"
        @keyup.enter="addManualUrl"
      />
      <el-button @click="addManualUrl">添加</el-button>
    </div>

    <div v-if="uploading" class="progress-row">
      <el-progress :percentage="percent" :stroke-width="12" />
    </div>

    <div v-if="images.length" class="image-list">
      <div v-for="(image, index) in images" :key="`${image}-${index}`" class="image-item">
        <div class="image-preview">
          <el-image
            v-if="canRenderImage(image)"
            :src="imageUrl(image)"
            class="thumb"
            fit="cover"
            :preview-src-list="previewImages"
            preview-teleported
          />
          <div v-else class="thumb placeholder">图片加载中</div>
          <span v-if="index === 0" class="cover-tag">封面</span>
        </div>
        <div class="image-meta">
          <span class="image-index">第 {{ index + 1 }} 张</span>
        </div>
        <div class="item-actions">
          <el-button size="small" :disabled="index === 0" @click="move(index, -1)">上移</el-button>
          <el-button size="small" :disabled="index === images.length - 1" @click="move(index, 1)">下移</el-button>
          <el-button size="small" type="danger" @click="remove(index)">删除</el-button>
        </div>
      </div>
    </div>
    <el-empty v-else description="暂无图片" :image-size="64" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { Upload } from '@element-plus/icons-vue'
import { imageApi, mediaApi } from '../api/cloud'

const props = defineProps<{ modelValue: string[] | unknown }>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void
}>()

const fileInput = ref<HTMLInputElement>()
const manualUrl = ref('')
const uploading = ref(false)
const percent = ref(0)
const urlMap = ref<Record<string, string>>({})

const images = computed(() => {
  return Array.isArray(props.modelValue)
    ? props.modelValue.map((item) => String(item || '').trim()).filter(Boolean)
    : []
})

const previewImages = computed(() => images.value.map(imageUrl).filter(isRenderableImageUrl))

watch(
  () => images.value.filter((image) => image.startsWith('cloud://')),
  async (fileIDs) => {
    const missing = Array.from(new Set(fileIDs.filter((fileID) => !urlMap.value[fileID])))
    if (missing.length === 0) return
    const res = await mediaApi.getUrls(missing).catch(() => ({ urls: {} }))
    urlMap.value = { ...urlMap.value, ...(res.urls || {}) }
  },
  { immediate: true },
)

function update(next: string[]) {
  emit('update:modelValue', Array.from(new Set(next.map((item) => item.trim()).filter(Boolean))))
}

function canRenderImage(src: string) {
  return isRenderableImageUrl(imageUrl(src))
}

function imageUrl(src: string) {
  return urlMap.value[src] || src
}

function isRenderableImageUrl(src: string) {
  return /^https?:\/\//.test(src) || src.startsWith('data:')
}

function pickImages() {
  fileInput.value?.click()
}

function addManualUrl() {
  const value = manualUrl.value.trim()
  if (!value) return
  if (!value.startsWith('cloud://') && !/^https?:\/\//.test(value)) {
    ElMessage.error('请输入 cloud:// 或 http(s) 图片地址')
    return
  }
  update([...images.value, value])
  manualUrl.value = ''
}

function move(index: number, delta: number) {
  const next = images.value.slice()
  const target = index + delta
  if (target < 0 || target >= next.length) return
  ;[next[index], next[target]] = [next[target], next[index]]
  update(next)
}

function remove(index: number) {
  const next = images.value.slice()
  next.splice(index, 1)
  update(next)
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

async function onPickImages(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  if (files.length === 0) return

  for (const file of files) {
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
  }

  uploading.value = true
  percent.value = 0
  try {
    const uploaded: string[] = []
    for (const file of files) {
      uploaded.push(await uploadImage(file))
    }
    update([...images.value, ...uploaded])
    ElMessage.success(`已上传 ${uploaded.length} 张图片`)
  } catch (error: any) {
    ElMessage.error(error?.message || '上传图片失败')
  } finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}
</script>

<style scoped>
.image-group-admin-editor {
  display: grid;
  gap: 12px;
}

.image-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.manual-input {
  width: 420px;
  max-width: 100%;
}

.progress-row {
  width: 360px;
}

.image-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.image-item {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 10px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fff;
}

.image-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: 8px;
  background: #f2f3f5;
}

.thumb {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 8px;
  background: #f2f3f5;
}

.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #909399;
  font-size: 12px;
}

.image-meta {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.image-index {
  color: #606266;
  font-size: 12px;
}

.cover-tag {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: #2f7d4d;
  font-size: 12px;
  line-height: 1.4;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}

.item-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.item-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
</style>
