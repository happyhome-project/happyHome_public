<template>
  <div class="video-uploader">
    <input
      ref="fileInput"
      type="file"
      :accept="accept"
      style="display: none;"
      @change="onPick"
    />
    <div class="row">
      <el-button :loading="uploading" :icon="Upload" @click="pick">
        {{ modelValue ? `重新上传${typeLabel}` : `选择${typeLabel}` }}
      </el-button>
      <el-button v-if="modelValue && !uploading" link size="small" @click="clear">清除</el-button>
    </div>
    <div v-if="uploading" class="progress-row">
      <el-progress :percentage="percent" :stroke-width="14" />
      <span class="muted">{{ formatBytes(uploadedBytes) }} / {{ formatBytes(totalBytes) }}</span>
    </div>
    <div v-if="modelValue && !uploading" class="preview-row">
      <span class="muted ellipsis" :title="modelValue">已上传：{{ modelValue }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { Upload } from '@element-plus/icons-vue'
import { videoApi } from '../api/cloud'

const props = defineProps<{
  modelValue: string
  kind: 'video' | 'cover'
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
}>()

const fileInput = ref<HTMLInputElement>()
const uploading = ref(false)
const percent = ref(0)
const uploadedBytes = ref(0)
const totalBytes = ref(0)

const accept = computed(() =>
  props.kind === 'video' ? 'video/mp4,video/quicktime,video/webm' : 'image/*'
)
const typeLabel = computed(() => (props.kind === 'video' ? '视频' : '封面图'))

const MAX_BYTES = props.kind === 'video' ? 200 * 1024 * 1024 : 10 * 1024 * 1024

function pick() { fileInput.value?.click() }
function clear() { emit('update:modelValue', '') }

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  if (file.size > MAX_BYTES) {
    ElMessage.error(`文件过大，限制 ${formatBytes(MAX_BYTES)}`)
    input.value = ''
    return
  }

  uploading.value = true
  percent.value = 0
  uploadedBytes.value = 0
  totalBytes.value = file.size

  try {
    const meta = await videoApi.requestUpload({ fileName: file.name })

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
        uploadedBytes.value = ev.loaded
        percent.value = Math.round((ev.loaded / ev.total) * 100)
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve()
        else reject(new Error(`COS upload failed: ${xhr.status} ${xhr.responseText || ''}`))
      }
      xhr.onerror = () => reject(new Error('网络错误，上传失败'))
      xhr.send(fd)
    })

    emit('update:modelValue', meta.fileId)
    ElMessage.success('上传成功')
  } catch (err: any) {
    ElMessage.error(err?.message || '上传失败')
  } finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}
</script>

<style scoped>
.video-uploader { width: 100%; }
.row { display: flex; align-items: center; gap: 8px; }
.progress-row { margin-top: 8px; display: flex; align-items: center; gap: 12px; }
.preview-row { margin-top: 6px; }
.muted { color: #909399; font-size: 12px; }
.ellipsis {
  display: inline-block;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}
</style>
