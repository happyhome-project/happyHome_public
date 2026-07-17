<template>
  <view class="video-publish-editor">
    <video v-if="previewSource" class="video-preview" :src="previewSource" controls />
    <view v-else class="video-empty"><text>还没有选择视频</text></view>

    <image v-if="coverPreview" class="cover-preview" :src="coverPreview" mode="aspectFill" />
    <progress v-if="uploading" :percent="progress" show-info active />
    <text v-if="errorMessage" class="upload-error">{{ errorMessage }}</text>

    <view class="video-actions">
      <button :disabled="uploading" @tap="chooseVideo">{{ previewSource ? '替换视频' : '选择视频' }}</button>
      <button v-if="previewSource" :disabled="uploading" @tap="chooseCover">选择封面</button>
      <button v-if="previewSource" :disabled="uploading" @tap="removeVideo">删除</button>
      <button v-if="errorMessage" @tap="retryUpload">重试</button>
      <button v-if="failedOperation === 'cover' && coverPending" :disabled="uploading" @tap="removeFailedCover">移除失败封面</button>
    </view>

    <!-- #ifdef H5 -->
    <input ref="h5VideoInput" class="native-file-input" type="file" accept="video/mp4,video/quicktime,video/webm,.m4v" @change="onH5VideoChange" />
    <input ref="h5CoverInput" class="native-file-input" type="file" accept="image/jpeg,image/png,image/webp" @change="onH5CoverChange" />
    <!-- #endif -->
  </view>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import type { VideoItemCos } from '../../../../cloud/shared/types'
import { postApi } from '../../api/cloud'
import { uploadCloudFile, type StorageUploadSource } from '../../api/storage'
import { buildCosVideoItems, hasValidUploadedVideo, isVideoUploadResultCurrent, normalizeChosenVideo, resolveVideoPublishReadiness, shouldConsumeInitialVideo, type ArchiveVideoIntentState, type VideoPublishReadiness } from '../../utils/video-publish'
import type { ArchiveMediaIntentFile } from '../../utils/archive-media-intent'

const props = defineProps<{
  modelValue?: VideoItemCos[]
  initialFile?: ArchiveMediaIntentFile | null
  initialState?: ArchiveVideoIntentState
  initialGeneration?: number
}>()
const emit = defineEmits<{
  (event: 'update:modelValue', value: VideoItemCos[]): void
  (event: 'upload-state', value: boolean): void
  (event: 'navigation-blocked', value: boolean): void
  (event: 'readiness', value: VideoPublishReadiness): void
  (event: 'selected-file', file: ArchiveMediaIntentFile, generation: number): void
  (event: 'initial-state', value: 'pending' | 'failed' | 'resolved', file: ArchiveMediaIntentFile, generation: number): void
}>()

const h5VideoInput = ref<HTMLInputElement | null>(null)
const h5CoverInput = ref<HTMLInputElement | null>(null)
const previewSource = ref('')
const coverPreview = ref('')
const uploading = ref(false)
const progress = ref(0)
const errorMessage = ref('')
const selectedVideo = ref<ArchiveMediaIntentFile | null>(null)
const selectedCover = ref<ArchiveMediaIntentFile | null>(null)
const uploadedVideoFileID = ref('')
const uploadedCoverFileID = ref('')
const coverPending = ref(false)
const failedOperation = ref<'' | 'video' | 'cover'>('')
const initialAcknowledged = ref(false)
const activeInitialFile = ref<ArchiveMediaIntentFile | null>(null)
let retryAction: (() => Promise<void>) | null = null
const objectUrls = new Set<string>()
let uploadGeneration = Number(props.initialGeneration) || 0
let unmounted = false

watch(() => props.modelValue, (items) => {
  const item = items?.[0]
  if (!item || selectedVideo.value) return
  previewSource.value = item.fileID
  coverPreview.value = item.cover || ''
  uploadedVideoFileID.value = item.fileID
  uploadedCoverFileID.value = item.cover || ''
  selectedVideo.value = {
    source: item.fileID,
    name: `${item.title || '视频'}.mp4`,
    type: 'video/mp4',
    size: 1,
    duration: item.duration,
  }
  emitReadiness()
}, { immediate: true, deep: true })

watch(() => props.initialFile, (file) => {
  if (!file) {
    initialAcknowledged.value = false
    return
  }
  if (hasValidUploadedVideo(props.modelValue)) {
    initialAcknowledged.value = true
    activeInitialFile.value = null
    emit('initial-state', 'resolved', file, Number(props.initialGeneration) || uploadGeneration)
    return
  }
  const intentState = props.initialState || 'selected'
  if (!shouldConsumeInitialVideo(props.modelValue, file, initialAcknowledged.value, intentState)) {
    if (intentState === 'failed' || intentState === 'pending') restoreInitialForRetry(file, intentState)
    return
  }
  initialAcknowledged.value = true
  activeInitialFile.value = file
  void acceptVideo(file)
}, { immediate: true })

onBeforeUnmount(() => {
  unmounted = true
  uploadGeneration += 1
  objectUrls.forEach((url) => URL.revokeObjectURL(url))
})

function previewFor(source: string | Blob): string {
  if (typeof source === 'string') return source
  const url = URL.createObjectURL(source)
  objectUrls.add(url)
  return url
}

function setUploading(value: boolean) {
  uploading.value = value
  emit('upload-state', value)
  emitReadiness()
}

function emitReadiness() {
  emit('readiness', resolveVideoPublishReadiness({
    uploading: uploading.value,
    videoReady: Boolean(uploadedVideoFileID.value),
    coverPending: coverPending.value,
    error: errorMessage.value,
  }))
}

async function confirmReplacement(): Promise<boolean> {
  if (!previewSource.value) return true
  return new Promise((resolve) => {
    uni.showModal({
      title: '替换已有视频',
      content: '替换后将清空当前视频和封面，是否继续？',
      success: (result: any) => resolve(Boolean(result.confirm)),
      fail: () => resolve(false),
    })
  })
}

async function acceptVideo(file: ArchiveMediaIntentFile) {
  if (!(await confirmReplacement())) return
  if (unmounted) return
  selectedVideo.value = file
  selectedCover.value = null
  uploadedVideoFileID.value = ''
  uploadedCoverFileID.value = ''
  coverPending.value = false
  failedOperation.value = ''
  previewSource.value = previewFor(file.source)
  coverPreview.value = file.thumbTempFilePath || ''
  emit('update:modelValue', [])
  retryAction = () => startVideoUpload(file)
  await retryAction()
}

function startVideoUpload(file: ArchiveMediaIntentFile): Promise<void> {
  const generation = ++uploadGeneration
  activeInitialFile.value = file
  emit('selected-file', file, generation)
  return uploadVideo(file, generation)
}

async function uploadVideo(file: ArchiveMediaIntentFile, generation: number) {
  emit('initial-state', 'pending', file, generation)
  setUploading(true)
  progress.value = 0
  errorMessage.value = ''
  try {
    normalizeChosenVideo({ tempFiles: [{
      tempFilePath: typeof file.source === 'string' ? file.source : 'blob:video',
      name: file.name,
      size: file.size,
      duration: file.duration,
      type: file.type || 'video',
      fileType: 'video',
    }] })
    const metadata = await postApi.requestMemberVideoUpload({ fileName: file.name })
    if (!isVideoUploadResultCurrent(generation, uploadGeneration, unmounted)) return
    const result = await uploadCloudFile({
      cloudPath: metadata.cloudPath,
      source: file.source as StorageUploadSource,
      onProgress: (event) => {
        if (isVideoUploadResultCurrent(generation, uploadGeneration, unmounted)) progress.value = Math.round(event.progress)
      },
    })
    if (!isVideoUploadResultCurrent(generation, uploadGeneration, unmounted)) return
    if (selectedVideo.value !== file) return
    uploadedVideoFileID.value = result.fileID
    failedOperation.value = ''
    publishModel()
    activeInitialFile.value = null
    emit('initial-state', 'resolved', file, generation)
    emitReadiness()
  } catch (error: any) {
    if (!isVideoUploadResultCurrent(generation, uploadGeneration, unmounted)) return
    errorMessage.value = error?.message || '视频上传失败'
    failedOperation.value = 'video'
    emit('initial-state', 'failed', file, generation)
  } finally {
    if (isVideoUploadResultCurrent(generation, uploadGeneration, unmounted)) setUploading(false)
  }
}

async function uploadCover(file: ArchiveMediaIntentFile) {
  const generation = ++uploadGeneration
  setUploading(true)
  progress.value = 0
  errorMessage.value = ''
  try {
    const metadata = await postApi.requestMemberVideoCoverUpload({ fileName: file.name })
    if (!isVideoUploadResultCurrent(generation, uploadGeneration, unmounted)) return
    const result = await uploadCloudFile({
      cloudPath: metadata.cloudPath,
      source: file.source as StorageUploadSource,
      onProgress: (event) => {
        if (isVideoUploadResultCurrent(generation, uploadGeneration, unmounted)) progress.value = Math.round(event.progress)
      },
    })
    if (!isVideoUploadResultCurrent(generation, uploadGeneration, unmounted)) return
    if (selectedCover.value !== file || !selectedVideo.value) return
    uploadedCoverFileID.value = result.fileID
    coverPending.value = false
    emit('navigation-blocked', false)
    failedOperation.value = ''
    publishModel()
    emitReadiness()
  } catch (error: any) {
    if (!isVideoUploadResultCurrent(generation, uploadGeneration, unmounted)) return
    errorMessage.value = error?.message || '封面上传失败'
    failedOperation.value = 'cover'
    emit('navigation-blocked', true)
  } finally {
    if (isVideoUploadResultCurrent(generation, uploadGeneration, unmounted)) setUploading(false)
  }
}

function publishModel() {
  if (!uploadedVideoFileID.value || !selectedVideo.value) return
  emit('update:modelValue', buildCosVideoItems({
    fileID: uploadedVideoFileID.value,
    title: selectedVideo.value.name.replace(/\.[^.]+$/, '') || '视频',
    cover: uploadedCoverFileID.value || undefined,
    duration: selectedVideo.value.duration,
  }))
}

function chooseVideo() {
  // #ifdef H5
  h5VideoInput.value?.click()
  return
  // #endif
  // #ifndef H5
  wx.chooseMedia({ count: 1, mediaType: ['video'], sourceType: ['album', 'camera'], success: (result: any) => {
    const normalized = normalizeChosenVideo(result)
    void acceptVideo({ source: normalized.tempFilePath, name: normalized.name, type: 'video', size: normalized.size, duration: normalized.duration, thumbTempFilePath: normalized.thumbTempFilePath })
  } })
  // #endif
}

function chooseCover() {
  // #ifdef H5
  h5CoverInput.value?.click()
  return
  // #endif
  // #ifndef H5
  wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], success: (result: any) => {
    const file = result?.tempFiles?.[0]
    if (!file) return
    const selected = { source: file.tempFilePath, name: String(file.name || file.tempFilePath.split('/').pop() || 'cover.jpg'), type: String(file.type || 'image'), size: Number(file.size) || 0 }
    acceptCover(selected)
  } })
  // #endif
}

function onH5VideoChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) void acceptVideo({ source: file, name: file.name, type: file.type, size: file.size })
  input.value = ''
}

function onH5CoverChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    const selected = { source: file, name: file.name, type: file.type, size: file.size }
    acceptCover(selected)
  }
  input.value = ''
}

function retryUpload() { void retryAction?.() }

function restoreInitialForRetry(file: ArchiveMediaIntentFile, state: 'pending' | 'failed') {
  uploading.value = false
  emit('upload-state', false)
  initialAcknowledged.value = true
  activeInitialFile.value = file
  selectedVideo.value = file
  previewSource.value = previewFor(file.source)
  coverPreview.value = file.thumbTempFilePath || ''
  errorMessage.value = state === 'pending' ? '上次上传已中断，请重试' : '视频上传失败，请重试'
  failedOperation.value = 'video'
  retryAction = () => startVideoUpload(file)
  if (state === 'pending') emit('initial-state', 'failed', file, Number(props.initialGeneration) || uploadGeneration)
  emitReadiness()
}

function acceptCover(selected: ArchiveMediaIntentFile) {
  selectedCover.value = selected
  coverPreview.value = previewFor(selected.source)
  coverPending.value = true
  emit('navigation-blocked', true)
  failedOperation.value = ''
  errorMessage.value = ''
  emitReadiness()
  retryAction = () => uploadCover(selected)
  void retryAction()
}

function removeFailedCover() {
  if (failedOperation.value !== 'cover') return
  selectedCover.value = null
  coverPending.value = false
  emit('navigation-blocked', false)
  failedOperation.value = ''
  errorMessage.value = ''
  coverPreview.value = uploadedCoverFileID.value
  retryAction = null
  publishModel()
  emitReadiness()
}

function removeVideo() {
  const retainedFile = activeInitialFile.value || props.initialFile || null
  const resolvesInitial = Boolean(retainedFile)
  selectedVideo.value = null
  selectedCover.value = null
  uploadedVideoFileID.value = ''
  uploadedCoverFileID.value = ''
  coverPending.value = false
  emit('navigation-blocked', false)
  failedOperation.value = ''
  previewSource.value = ''
  coverPreview.value = ''
  errorMessage.value = ''
  progress.value = 0
  retryAction = null
  activeInitialFile.value = null
  emit('update:modelValue', [])
  if (resolvesInitial) emit('initial-state', 'resolved', retainedFile!, Number(props.initialGeneration) || uploadGeneration)
  emitReadiness()
}
</script>

<style lang="scss" scoped>
.video-publish-editor { padding: 24rpx; border-radius: 24rpx; background: #fff; }
.video-preview, .video-empty { width: 100%; height: 360rpx; border-radius: 18rpx; background: #111; }
.video-empty { display: flex; align-items: center; justify-content: center; color: #fff; }
.cover-preview { width: 160rpx; height: 100rpx; margin-top: 16rpx; border-radius: 12rpx; }
.video-actions { display: flex; flex-wrap: wrap; gap: 12rpx; margin-top: 18rpx; }
.video-actions button { margin: 0; padding: 0 20rpx; font-size: 24rpx; }
.upload-error { display: block; margin-top: 12rpx; color: #c62828; }
.native-file-input { display: none; }
</style>
