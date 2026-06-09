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
        placeholder="也可粘贴 cloud:// 或 https:// 图片地址"
        @keyup.enter="addManualUrl"
      />
      <el-button @click="addManualUrl">添加</el-button>
    </div>

    <div v-if="uploading" class="progress-row">
      <el-progress :percentage="percent" :stroke-width="12" />
    </div>

    <div v-if="images.length" class="image-list">
      <div v-for="(image, index) in images" :key="`${image}-${index}`" class="image-item">
        <el-image
          v-if="canRenderImage(image)"
          :src="image"
          class="thumb"
          fit="cover"
          :preview-src-list="previewImages"
          preview-teleported
        />
        <div v-else class="thumb placeholder">云图片</div>
        <div class="image-meta">
          <span class="image-url">{{ image }}</span>
          <span v-if="index === 0" class="cover-tag">封面</span>
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
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { Upload } from '@element-plus/icons-vue'
import { imageApi } from '../api/cloud'

const props = defineProps<{ modelValue: string[] | unknown }>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void
}>()

const fileInput = ref<HTMLInputElement>()
const manualUrl = ref('')
const uploading = ref(false)
const percent = ref(0)

const images = computed(() => {
  return Array.isArray(props.modelValue)
    ? props.modelValue.map((item) => String(item || '').trim()).filter(Boolean)
    : []
})

const previewImages = computed(() => images.value.filter(canRenderImage))

function update(next: string[]) {
  emit('update:modelValue', Array.from(new Set(next.map((item) => item.trim()).filter(Boolean))))
}

function canRenderImage(src: string) {
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
  gap: 10px;
}

.image-item {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 10px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafafa;
}

.thumb {
  width: 96px;
  height: 72px;
  border-radius: 6px;
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
  gap: 8px;
}

.image-url {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #606266;
  font-size: 12px;
}

.cover-tag {
  flex: 0 0 auto;
  padding: 2px 7px;
  border-radius: 999px;
  background: #ecf5ff;
  color: #409eff;
  font-size: 12px;
}

.item-actions {
  display: flex;
  gap: 6px;
}

@media (max-width: 900px) {
  .image-item {
    grid-template-columns: 96px minmax(0, 1fr);
  }

  .item-actions {
    grid-column: 1 / -1;
  }
}
</style>
