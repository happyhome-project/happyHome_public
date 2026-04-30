<template>
  <div class="audio-group-editor">
    <input
      ref="fileInput"
      type="file"
      accept=".mp3,.m4a,.aac,.wav,audio/mpeg,audio/mp4,audio/aac,audio/wav"
      style="display: none;"
      @change="onPick"
    />

    <div class="toolbar">
      <el-button :icon="Upload" :loading="uploading" @click="pick">上传音频</el-button>
      <span class="muted">支持 mp3 / m4a / aac / wav，单个不超过 50MB</span>
    </div>

    <div v-if="uploading" class="progress-row">
      <el-progress :percentage="percent" :stroke-width="14" />
      <span class="muted">{{ formatBytes(uploadedBytes) }} / {{ formatBytes(totalBytes) }}</span>
    </div>

    <el-empty v-if="tracks.length === 0 && !uploading" description="还没有音频" />

    <div v-for="(track, index) in tracks" :key="track.fileID || index" class="track-card">
      <div class="track-head">
        <span class="track-index">{{ index + 1 }}</span>
        <el-input
          v-model="track.title"
          placeholder="音频标题"
          class="title-input"
          @input="emitTracks"
        />
        <div class="track-actions">
          <el-button :icon="Top" link :disabled="index === 0" @click="moveTrack(index, -1)">上移</el-button>
          <el-button :icon="Bottom" link :disabled="index === tracks.length - 1" @click="moveTrack(index, 1)">下移</el-button>
          <el-button :icon="Delete" link type="danger" @click="removeTrack(index)">删除</el-button>
        </div>
      </div>

      <div class="track-meta">
        <el-tag size="small" effect="plain">{{ String(track.ext || '').toUpperCase() }}</el-tag>
        <span>{{ formatBytes(Number(track.size || 0)) }}</span>
        <span>时长</span>
        <el-input-number
          v-model="track.duration"
          :min="1"
          :precision="0"
          size="small"
          controls-position="right"
          @change="emitTracks"
        />
        <span>秒</span>
      </div>

      <div class="file-id" :title="track.fileID">
        {{ track.fileID }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Bottom, Delete, Top, Upload } from '@element-plus/icons-vue'
import { audioApi } from '../api/cloud'

interface AudioTrack {
  fileID: string
  title: string
  duration: number
  size: number
  ext: 'mp3' | 'm4a' | 'aac' | 'wav'
}

const props = defineProps<{ modelValue: AudioTrack[] }>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: AudioTrack[]): void
}>()

const AUDIO_EXTS = new Set(['mp3', 'm4a', 'aac', 'wav'])
const MAX_BYTES = 50 * 1024 * 1024

const fileInput = ref<HTMLInputElement>()
const tracks = ref<AudioTrack[]>([])
const uploading = ref(false)
const percent = ref(0)
const uploadedBytes = ref(0)
const totalBytes = ref(0)

watch(
  () => props.modelValue,
  (value) => {
    tracks.value = Array.isArray(value) ? value.map((item) => ({ ...item })) : []
  },
  { immediate: true, deep: true },
)

function pick() {
  fileInput.value?.click()
}

function emitTracks() {
  emit('update:modelValue', tracks.value.map((item) => ({ ...item })))
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function getExt(fileName: string): AudioTrack['ext'] | '' {
  const ext = String(fileName || '').split('.').pop()?.toLowerCase() || ''
  return AUDIO_EXTS.has(ext) ? ext as AudioTrack['ext'] : ''
}

function titleFromFileName(fileName: string) {
  return String(fileName || '').replace(/\.[^.]+$/, '').trim() || '未命名音频'
}

async function probeDuration(file: File): Promise<number> {
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve) => {
      const audio = document.createElement('audio')
      audio.preload = 'metadata'
      audio.onloadedmetadata = () => {
        const duration = Math.round(Number(audio.duration || 0))
        resolve(Number.isFinite(duration) ? duration : 0)
      }
      audio.onerror = () => resolve(0)
      audio.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function uploadToCos(file: File) {
  const meta = await audioApi.requestUpload({ fileName: file.name })

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

  return meta.fileId
}

async function onPick(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  const ext = getExt(file.name)
  if (!ext) {
    ElMessage.error('仅支持 mp3 / m4a / aac / wav')
    input.value = ''
    return
  }
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
    const [duration, fileID] = await Promise.all([
      probeDuration(file),
      uploadToCos(file),
    ])
    tracks.value.push({
      fileID,
      title: titleFromFileName(file.name),
      duration,
      size: file.size,
      ext,
    })
    emitTracks()
    ElMessage.success('上传成功')
  } catch (err: any) {
    ElMessage.error(err?.message || '上传失败')
  } finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

function removeTrack(index: number) {
  tracks.value.splice(index, 1)
  emitTracks()
}

function moveTrack(index: number, direction: -1 | 1) {
  const nextIndex = index + direction
  if (nextIndex < 0 || nextIndex >= tracks.value.length) return
  const next = [...tracks.value]
  const [item] = next.splice(index, 1)
  next.splice(nextIndex, 0, item)
  tracks.value = next
  emitTracks()
}
</script>

<style scoped>
.audio-group-editor {
  display: grid;
  gap: 12px;
}

.toolbar,
.progress-row,
.track-head,
.track-meta,
.track-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.muted {
  color: #909399;
  font-size: 12px;
}

.track-card {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 12px;
  background: #fff;
}

.track-index {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #f2f6fc;
  color: #606266;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  flex: 0 0 auto;
}

.title-input {
  max-width: 360px;
  flex: 1 1 240px;
}

.track-actions {
  margin-left: auto;
}

.track-meta {
  margin-top: 10px;
  color: #606266;
  font-size: 13px;
}

.file-id {
  margin-top: 8px;
  color: #909399;
  font-size: 12px;
  max-width: 680px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
