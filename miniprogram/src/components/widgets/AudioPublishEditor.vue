<template>
  <view class="audio-publish-editor">
    <view v-if="tracks.length === 0" class="audio-empty">
      <text class="audio-empty__title">添加音频文件</text>
      <text class="audio-empty__hint">支持 MP3、M4A、AAC、WAV，单个不超过 50 MiB</text>
    </view>

    <view v-for="(track, index) in tracks" :key="track.id" class="audio-track">
      <view class="audio-track__heading">
        <text class="audio-track__order">{{ index + 1 }}</text>
        <input
          class="audio-track__title"
          :value="track.title"
          :disabled="submissionLocked"
          maxlength="100"
          placeholder="曲目标题"
          @input="handleTitleInput(track.id, $event)"
        />
      </view>

      <view class="audio-track__meta">
        <text>{{ track.name || `${track.ext.toUpperCase()} 音频` }}</text>
        <text v-if="track.duration">{{ formatDuration(track.duration) }}</text>
      </view>
      <progress
        v-if="track.audioStatus === 'uploading'"
        :percent="track.progress"
        show-info
        active
      />
      <text v-if="track.audioError" class="audio-error">{{ track.audioError }}</text>

      <view v-if="track.coverPreview || track.cover" class="audio-cover-row">
        <image class="audio-cover" :src="track.coverPreview || track.cover" mode="aspectFill" />
        <progress
          v-if="track.coverStatus === 'uploading'"
          class="audio-cover-progress"
          :percent="track.coverProgress"
          show-info
          active
        />
      </view>
      <text v-if="track.coverError" class="audio-error">{{ track.coverError }}</text>

      <view class="audio-track__actions">
        <button size="mini" :disabled="submissionLocked || index === 0 || trackBusy(track)" @tap="moveTrack(track.id, -1)">上移</button>
        <button size="mini" :disabled="submissionLocked || index === tracks.length - 1 || trackBusy(track)" @tap="moveTrack(track.id, 1)">下移</button>
        <button size="mini" :disabled="submissionLocked || trackBusy(track)" @tap="chooseCover(track.id)">{{ track.cover ? '替换封面' : '添加封面' }}</button>
        <button v-if="track.cover" size="mini" :disabled="submissionLocked || trackBusy(track)" @tap="removeCover(track.id)">删除封面</button>
        <button v-if="track.audioStatus === 'error'" size="mini" :disabled="submissionLocked" @tap="retryTrack(track.id)">重试音频</button>
        <button v-if="track.coverStatus === 'error'" size="mini" :disabled="submissionLocked" @tap="retryCover(track.id)">重试封面</button>
        <button v-if="track.coverStatus === 'error'" size="mini" :disabled="submissionLocked" @tap="cancelFailedCover(track.id)">取消封面</button>
        <button size="mini" :disabled="submissionLocked" @tap="removeTrack(track.id)">删除曲目</button>
      </view>
    </view>

    <button class="audio-add" :disabled="submissionLocked || uploading" @tap="chooseAudioFiles">{{ tracks.length ? '继续添加音频' : '选择音频' }}</button>

    <!-- #ifdef H5 -->
    <input
      ref="h5AudioInput"
      class="native-file-input"
      type="file"
      accept="audio/mpeg,audio/mp4,audio/aac,audio/wav,.mp3,.m4a,.aac,.wav"
      :disabled="submissionLocked"
      multiple
      @change="onH5AudioChange"
    />
    <input
      ref="h5CoverInput"
      class="native-file-input"
      type="file"
      accept="image/jpeg,image/png,image/webp"
      :disabled="submissionLocked"
      @change="onH5CoverChange"
    />
    <!-- #endif -->
  </view>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { AudioTrack } from '../../../../cloud/shared/types'
import { postApi } from '../../api/cloud'
import { uploadCloudFile, type StorageUploadSource } from '../../api/storage'
import type { ArchiveMediaIntentFile } from '../../utils/archive-media-intent'
import {
  buildAudioTrackOutput,
  cleanupOwnedPendingAudioUploads,
  createAudioSubmissionOwnership,
  createCancelableAudioDurationProbe,
  createMiniProgramAudioDurationProbe,
  isAudioAsyncResultCurrent,
  moveAudioTrack,
  normalizeAudioPublishFile,
  removeAudioTrack,
  requirePositiveAudioDuration,
  resolveAudioPublishReadiness,
  shouldBlockAudioNavigation,
  updateAudioTrackTitle,
  type AudioPublishReadiness,
  type AudioPublishTrackState,
  type CancelableAudioDurationProbe,
  type PendingAudioUpload,
} from '../../utils/audio-publish'
import { validateVideoCoverFile } from '../../utils/video-publish'

type LocalAudioTrack = AudioPublishTrackState & {
  source?: string | Blob
  name: string
  progress: number
  coverProgress: number
  audioError: string
  coverError: string
  coverSource?: string | Blob
  coverName?: string
  coverType?: string
  coverSize?: number
  coverPreview?: string
}

const props = defineProps<{
  communityId: string
  postTitle?: string
  modelValue?: AudioTrack[]
  initialFiles?: ArchiveMediaIntentFile[]
  initialGeneration?: number
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: AudioTrack[]): void
  (event: 'readiness', value: AudioPublishReadiness): void
  (event: 'navigation-blocked', value: boolean): void
  (event: 'upload-state', value: boolean): void
  (event: 'initial-consumed', generation: number): void
}>()

const tracks = ref<LocalAudioTrack[]>([])
const h5AudioInput = ref<HTMLInputElement | null>(null)
const h5CoverInput = ref<HTMLInputElement | null>(null)
const coverTargetId = ref('')
const submissionLocked = ref(false)
const objectUrls = new Set<string>()
const pendingUploads = new Map<string, PendingAudioUpload>()
const activeDurationProbes = new Map<string, CancelableAudioDurationProbe>()
const uploading = computed(() => tracks.value.some((track) => (
  track.audioStatus === 'pending'
  || track.audioStatus === 'uploading'
  || track.coverStatus === 'pending'
  || track.coverStatus === 'uploading'
)))
let nextTrackSequence = 0
let lastInitialGeneration = -1
let uploadQueue = Promise.resolve()
let unmounted = false

watch(() => props.modelValue, (items) => {
  if (tracks.value.length > 0 || !Array.isArray(items) || items.length === 0) return
  tracks.value = items.map((item, index) => ({
    id: `existing-${index}-${String(item.fileID || '').slice(-12)}`,
    name: `${item.title || `曲目 ${index + 1}`}.${item.ext}`,
    title: item.title,
    fileID: item.fileID,
    duration: item.duration,
    size: item.size,
    ext: item.ext,
    cover: item.cover,
    coverPreview: item.cover,
    audioStatus: 'ready',
    coverStatus: 'idle',
    audioGeneration: 0,
    coverGeneration: 0,
    progress: 100,
    coverProgress: item.cover ? 100 : 0,
    audioError: '',
    coverError: '',
  }))
  emitState()
}, { immediate: true, deep: true })

watch(() => [props.initialFiles, props.initialGeneration] as const, ([files, generation]) => {
  const normalizedGeneration = Number(generation) || 0
  if (!Array.isArray(files) || files.length === 0 || normalizedGeneration === lastInitialGeneration) return
  lastInitialGeneration = normalizedGeneration
  emit('initial-consumed', normalizedGeneration)
  acceptAudioFiles(files)
}, { immediate: true, deep: true })

watch(() => props.postTitle, () => emitState())

onBeforeUnmount(() => {
  unmounted = true
  tracks.value.forEach((track) => {
    track.audioGeneration = Number(track.audioGeneration || 0) + 1
    track.coverGeneration = Number(track.coverGeneration || 0) + 1
  })
  cancelAllAudioDurationProbes()
  void submissionOwnership.handleUnmount()
  objectUrls.forEach((url) => {
    try { URL.revokeObjectURL(url) } catch {}
  })
  objectUrls.clear()
})

function createTrackId(): string {
  nextTrackSequence += 1
  return `audio-${Date.now().toString(36)}-${nextTrackSequence.toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function trackBusy(track: LocalAudioTrack): boolean {
  return ['pending', 'uploading'].includes(track.audioStatus) || ['pending', 'uploading'].includes(track.coverStatus)
}

function rememberPendingUpload(fileID: string, kind: 'audio' | 'cover') {
  const normalized = String(fileID || '').trim()
  if (!normalized) return
  pendingUploads.set(normalized, { fileID: normalized, kind, owned: true })
}

async function cleanupPendingUpload(fileID: string) {
  const pending = pendingUploads.get(fileID)
  if (!pending || !pending.owned) return
  await performPendingCleanup([pending])
}

async function performPendingCleanup(uploads: PendingAudioUpload[]) {
  const result = await cleanupOwnedPendingAudioUploads(uploads, async (pending) => {
    await postApi.deleteMemberAudioUpload({
      communityId: props.communityId,
      fileID: pending.fileID,
      kind: pending.kind,
    })
  })
  result.cleaned.forEach((pending) => {
    if (pendingUploads.get(pending.fileID) === pending) pendingUploads.delete(pending.fileID)
  })
  if (result.failed.length > 0) {
    console.warn('[audio-publish] pending upload cleanup failed')
  }
}

async function cleanupPendingUploads() {
  await performPendingCleanup(Array.from(pendingUploads.values()))
}

const submissionOwnership = createAudioSubmissionOwnership(cleanupPendingUploads)

function claimPendingUploadsForSubmission(): boolean {
  const claimed = submissionOwnership.claimForSubmission()
  if (claimed) submissionLocked.value = true
  return claimed
}

async function finalizePendingUploadsAfterSubmit() {
  // The server materializes finalized copies. These source objects are no longer
  // referenced after success, so remove them before navigation. Failed cleanup
  // remains registered for the unmount retry and never changes submit success.
  try {
    await submissionOwnership.settleAfterSubmission('accepted')
  } finally {
    submissionLocked.value = false
  }
}

async function returnPendingUploadsAfterSubmit() {
  try {
    await submissionOwnership.settleAfterSubmission('retry')
  } finally {
    submissionLocked.value = false
  }
}

defineExpose({
  claimPendingUploadsForSubmission,
  finalizePendingUploadsAfterSubmit,
  returnPendingUploadsAfterSubmit,
})

function emitState() {
  const readiness = resolveAudioPublishReadiness({ postTitle: props.postTitle, tracks: tracks.value })
  emit('readiness', readiness)
  emit('navigation-blocked', shouldBlockAudioNavigation(tracks.value))
  emit('upload-state', uploading.value)
}

function publishModel() {
  if (tracks.value.length === 0) {
    emit('update:modelValue', [])
    emitState()
    return
  }
  try {
    emit('update:modelValue', buildAudioTrackOutput(tracks.value))
  } catch {}
  emitState()
}

function previewFor(source: string | Blob): string {
  if (typeof source === 'string') return source
  const url = URL.createObjectURL(source)
  objectUrls.add(url)
  return url
}

function releasePreview(url: string | undefined) {
  if (!url || !objectUrls.delete(url)) return
  try { URL.revokeObjectURL(url) } catch {}
}

function createAudioDurationProbe(source: string | Blob): CancelableAudioDurationProbe {
  // #ifdef H5
  const audio = new Audio()
  const sourceUrl = typeof source === 'string' ? source : URL.createObjectURL(source)
  return createCancelableAudioDurationProbe({
    readDuration: () => audio.duration,
    cleanup: () => {
      audio.onloadedmetadata = null
      audio.onerror = null
      try {
        audio.removeAttribute('src')
        audio.load()
      } catch {}
      if (typeof source !== 'string') URL.revokeObjectURL(sourceUrl)
    },
    subscribe: (resolve, reject) => {
      audio.preload = 'metadata'
      audio.onloadedmetadata = resolve
      audio.onerror = () => reject(new Error('无法读取有效音频时长，请重试或移除该曲目'))
      audio.src = sourceUrl
    },
    timeoutMs: 10000,
  })
  // #endif

  // #ifndef H5
  if (typeof source !== 'string') {
    return createCancelableAudioDurationProbe({
      readDuration: () => 0,
      cleanup: () => {},
      subscribe: (_resolve, reject) => reject(new Error('无法读取有效音频时长，请重试或移除该曲目')),
    })
  }
  const sourcePath = source as string
  const context = uni.createInnerAudioContext()
  return createMiniProgramAudioDurationProbe(context, sourcePath, { timeoutMs: 10000, pollIntervalMs: 100 })
  // #endif
}

function cancelAudioDurationProbe(trackId: string) {
  const probe = activeDurationProbes.get(trackId)
  if (!probe) return
  activeDurationProbes.delete(trackId)
  probe.cancel()
}

function cancelAllAudioDurationProbes() {
  for (const trackId of Array.from(activeDurationProbes.keys())) {
    cancelAudioDurationProbe(trackId)
  }
}

function acceptAudioFiles(files: ArchiveMediaIntentFile[]) {
  if (submissionLocked.value) return
  try {
    const additions: LocalAudioTrack[] = files.map((file) => {
      const normalized = normalizeAudioPublishFile(file)
      return {
        id: createTrackId(),
        source: normalized.source,
        name: normalized.name,
        title: normalized.title,
        fileID: '',
        duration: null,
        size: normalized.size,
        ext: normalized.ext,
        audioStatus: 'pending',
        coverStatus: 'idle',
        audioGeneration: 0,
        coverGeneration: 0,
        progress: 0,
        coverProgress: 0,
        audioError: '',
        coverError: '',
      }
    })
    tracks.value = [...tracks.value, ...additions]
    emitState()
    additions.forEach((track) => enqueueTrackUpload(track.id))
  } catch (error: any) {
    uni.showToast({ title: error?.message || '音频文件不可用', icon: 'none' })
    emitState()
  }
}

function enqueueTrackUpload(trackId: string) {
  uploadQueue = uploadQueue.then(() => uploadTrack(trackId)).catch(() => {})
}

async function uploadTrack(trackId: string) {
  const track = tracks.value.find((item) => item.id === trackId)
  if (!track || !track.source || unmounted) return
  const generation = Number(track.audioGeneration || 0) + 1
  track.audioGeneration = generation
  track.audioStatus = 'pending'
  track.audioError = ''
  track.progress = 0
  emitState()
  try {
    if (!Number.isFinite(Number(track.duration)) || Number(track.duration) <= 0) {
      cancelAudioDurationProbe(track.id)
      const probe = createAudioDurationProbe(track.source)
      activeDurationProbes.set(track.id, probe)
      let duration: number
      try {
        duration = await probe.promise
      } finally {
        if (activeDurationProbes.get(track.id) === probe) activeDurationProbes.delete(track.id)
      }
      if (!isAudioAsyncResultCurrent(tracks.value, track.id, 'audio', generation, unmounted)) return
      track.duration = requirePositiveAudioDuration(duration)
    }
    track.audioStatus = 'uploading'
    emitState()
    const metadata = await postApi.requestMemberAudioUpload({
      communityId: props.communityId,
      fileName: track.name,
    })
    if (!isAudioAsyncResultCurrent(tracks.value, track.id, 'audio', generation, unmounted)) return
    const result = await uploadCloudFile({
      cloudPath: metadata.cloudPath,
      source: track.source as StorageUploadSource,
      onProgress: (event) => {
        if (isAudioAsyncResultCurrent(tracks.value, track.id, 'audio', generation, unmounted)) {
          track.progress = Math.round(event.progress)
        }
      },
    })
    rememberPendingUpload(result.fileID, 'audio')
    if (!isAudioAsyncResultCurrent(tracks.value, track.id, 'audio', generation, unmounted)) {
      void cleanupPendingUpload(result.fileID)
      return
    }
    const replacedPendingFileID = track.fileID
    track.fileID = result.fileID
    track.audioStatus = 'ready'
    track.audioError = ''
    track.progress = 100
    publishModel()
    if (replacedPendingFileID && replacedPendingFileID !== result.fileID && pendingUploads.has(replacedPendingFileID)) {
      void cleanupPendingUpload(replacedPendingFileID)
    }
  } catch (error: any) {
    if (!isAudioAsyncResultCurrent(tracks.value, track.id, 'audio', generation, unmounted)) return
    track.audioStatus = 'error'
    track.audioError = error?.message || '音频处理失败，请重试'
    emitState()
  }
}

async function uploadCover(trackId: string) {
  const track = tracks.value.find((item) => item.id === trackId)
  if (!track || !track.coverSource || !track.coverName) return
  const validationError = validateVideoCoverFile({ name: track.coverName, type: track.coverType, size: track.coverSize })
  if (validationError) {
    track.coverStatus = 'error'
    track.coverError = validationError
    emitState()
    return
  }
  const generation = Number(track.coverGeneration || 0) + 1
  track.coverGeneration = generation
  track.coverStatus = 'uploading'
  track.coverError = ''
  track.coverProgress = 0
  emitState()
  try {
    const metadata = await postApi.requestMemberAudioCoverUpload({
      communityId: props.communityId,
      fileName: track.coverName,
    })
    if (!isAudioAsyncResultCurrent(tracks.value, track.id, 'cover', generation, unmounted)) return
    const result = await uploadCloudFile({
      cloudPath: metadata.cloudPath,
      source: track.coverSource as StorageUploadSource,
      onProgress: (event) => {
        if (isAudioAsyncResultCurrent(tracks.value, track.id, 'cover', generation, unmounted)) {
          track.coverProgress = Math.round(event.progress)
        }
      },
    })
    rememberPendingUpload(result.fileID, 'cover')
    if (!isAudioAsyncResultCurrent(tracks.value, track.id, 'cover', generation, unmounted)) {
      void cleanupPendingUpload(result.fileID)
      return
    }
    const replacedPendingCover = track.cover
    track.cover = result.fileID
    track.coverStatus = 'idle'
    track.coverError = ''
    track.coverProgress = 100
    publishModel()
    if (replacedPendingCover && replacedPendingCover !== result.fileID && pendingUploads.has(replacedPendingCover)) {
      void cleanupPendingUpload(replacedPendingCover)
    }
  } catch (error: any) {
    if (!isAudioAsyncResultCurrent(tracks.value, track.id, 'cover', generation, unmounted)) return
    track.coverStatus = 'error'
    track.coverError = error?.message || '封面上传失败，请重试或取消封面'
    emitState()
  }
}

function chooseAudioFiles() {
  if (submissionLocked.value) return
  // #ifdef H5
  h5AudioInput.value?.click()
  return
  // #endif
  // #ifndef H5
  wx.chooseMessageFile({
    count: 100,
    type: 'file',
    extension: ['mp3', 'm4a', 'aac', 'wav'],
    success: (result: any) => {
      if (submissionLocked.value) return
      const files = (Array.isArray(result?.tempFiles) ? result.tempFiles : []).map((file: any) => ({
        source: file.path || file.tempFilePath,
        name: String(file.name || file.path?.split('/').pop() || ''),
        type: String(file.type || 'file'),
        size: Number(file.size) || 0,
      }))
      acceptAudioFiles(files)
    },
  })
  // #endif
}

function onH5AudioChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (submissionLocked.value) {
    input.value = ''
    return
  }
  const files = Array.from(input.files || []).map((file) => ({
    source: file,
    name: file.name,
    type: file.type,
    size: file.size,
  }))
  if (files.length > 0) acceptAudioFiles(files)
  input.value = ''
}

function chooseCover(trackId: string) {
  if (submissionLocked.value) return
  coverTargetId.value = trackId
  // #ifdef H5
  h5CoverInput.value?.click()
  return
  // #endif
  // #ifndef H5
  wx.chooseMedia({
    count: 1,
    mediaType: ['image'],
    sourceType: ['album', 'camera'],
    success: (result: any) => {
      if (submissionLocked.value) return
      const file = result?.tempFiles?.[0]
      if (!file) return
      acceptCover(trackId, {
        source: file.tempFilePath,
        name: String(file.name || file.tempFilePath?.split('/').pop() || 'cover.jpg'),
        type: String(file.type || 'image'),
        size: Number(file.size) || 0,
      })
    },
  })
  // #endif
}

function onH5CoverChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (submissionLocked.value) {
    input.value = ''
    return
  }
  const file = input.files?.[0]
  if (file && coverTargetId.value) {
    acceptCover(coverTargetId.value, { source: file, name: file.name, type: file.type, size: file.size })
  }
  input.value = ''
}

function acceptCover(trackId: string, file: { source: string | Blob; name: string; type: string; size: number }) {
  if (submissionLocked.value) return
  const track = tracks.value.find((item) => item.id === trackId)
  if (!track) return
  const validationError = validateVideoCoverFile(file)
  releasePreview(track.coverPreview && track.coverPreview !== track.cover ? track.coverPreview : undefined)
  track.coverSource = file.source
  track.coverName = file.name
  track.coverType = file.type
  track.coverSize = file.size
  track.coverPreview = previewFor(file.source)
  track.coverError = validationError || ''
  track.coverStatus = validationError ? 'error' : 'pending'
  emitState()
  if (!validationError) void uploadCover(trackId)
}

function retryTrack(trackId: string) {
  if (submissionLocked.value) return
  const track = tracks.value.find((item) => item.id === trackId)
  if (!track || track.audioStatus !== 'error') return
  track.audioStatus = 'pending'
  track.audioError = ''
  emitState()
  enqueueTrackUpload(trackId)
}

function retryCover(trackId: string) {
  if (submissionLocked.value) return
  const track = tracks.value.find((item) => item.id === trackId)
  if (!track || track.coverStatus !== 'error' || !track.coverSource) return
  track.coverStatus = 'pending'
  track.coverError = ''
  emitState()
  void uploadCover(trackId)
}

function cancelFailedCover(trackId: string) {
  if (submissionLocked.value) return
  const track = tracks.value.find((item) => item.id === trackId)
  if (!track || track.coverStatus !== 'error') return
  track.coverGeneration = Number(track.coverGeneration || 0) + 1
  releasePreview(track.coverPreview && track.coverPreview !== track.cover ? track.coverPreview : undefined)
  track.coverSource = undefined
  track.coverName = undefined
  track.coverType = undefined
  track.coverSize = undefined
  track.coverPreview = track.cover
  track.coverStatus = 'idle'
  track.coverError = ''
  publishModel()
}

function removeCover(trackId: string) {
  if (submissionLocked.value) return
  const track = tracks.value.find((item) => item.id === trackId)
  if (!track) return
  track.coverGeneration = Number(track.coverGeneration || 0) + 1
  const pendingCover = track.cover
  releasePreview(track.coverPreview && track.coverPreview !== track.cover ? track.coverPreview : undefined)
  track.cover = undefined
  track.coverSource = undefined
  track.coverName = undefined
  track.coverType = undefined
  track.coverSize = undefined
  track.coverPreview = undefined
  track.coverStatus = 'idle'
  track.coverError = ''
  if (pendingCover && pendingUploads.has(pendingCover)) void cleanupPendingUpload(pendingCover)
  publishModel()
}

function removeTrack(trackId: string) {
  if (submissionLocked.value) return
  const track = tracks.value.find((item) => item.id === trackId)
  if (!track) return
  track.audioGeneration = Number(track.audioGeneration || 0) + 1
  track.coverGeneration = Number(track.coverGeneration || 0) + 1
  cancelAudioDurationProbe(trackId)
  releasePreview(track.coverPreview && track.coverPreview !== track.cover ? track.coverPreview : undefined)
  tracks.value = removeAudioTrack(tracks.value, trackId)
  if (track.fileID && pendingUploads.has(track.fileID)) void cleanupPendingUpload(track.fileID)
  if (track.cover && pendingUploads.has(track.cover)) void cleanupPendingUpload(track.cover)
  publishModel()
}

function moveTrack(trackId: string, direction: -1 | 1) {
  if (submissionLocked.value) return
  tracks.value = moveAudioTrack(tracks.value, trackId, direction)
  publishModel()
}

function handleTitleInput(trackId: string, event: any) {
  if (submissionLocked.value) return
  tracks.value = updateAudioTrackTitle(tracks.value, trackId, String(event?.detail?.value ?? event?.target?.value ?? ''))
  publishModel()
}

function formatDuration(value: number): string {
  const seconds = Math.max(0, Math.round(Number(value) || 0))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}
</script>

<style lang="scss" scoped>
.audio-publish-editor {
  display: grid;
  gap: 20rpx;
}

.audio-empty,
.audio-track {
  padding: 28rpx;
  border-radius: 24rpx;
  background: #fff;
  box-sizing: border-box;
}

.audio-empty {
  text-align: center;
}

.audio-empty__title,
.audio-empty__hint {
  display: block;
}

.audio-empty__title {
  color: var(--hh-color-text-primary);
  font-size: 30rpx;
  font-weight: $hh-font-weight-bold;
}

.audio-empty__hint,
.audio-track__meta {
  margin-top: 8rpx;
  color: var(--hh-color-text-tertiary);
  font-size: 23rpx;
}

.audio-track__heading,
.audio-track__meta,
.audio-cover-row,
.audio-track__actions {
  display: flex;
  align-items: center;
}

.audio-track__heading {
  gap: 16rpx;
}

.audio-track__order {
  width: 48rpx;
  height: 48rpx;
  border-radius: 999rpx;
  background: var(--hh-color-brand-soft);
  color: var(--hh-color-brand-strong);
  line-height: 48rpx;
  text-align: center;
  font-weight: $hh-font-weight-bold;
}

.audio-track__title {
  min-width: 0;
  flex: 1;
  height: 64rpx;
  color: var(--hh-color-text-primary);
  font-size: 29rpx;
  border-bottom: 1rpx solid var(--hh-color-line);
}

.audio-track__meta {
  justify-content: space-between;
  margin-bottom: 14rpx;
}

.audio-error {
  display: block;
  margin-top: 12rpx;
  color: #c62828;
  font-size: 23rpx;
}

.audio-cover-row {
  gap: 16rpx;
  margin-top: 16rpx;
}

.audio-cover {
  width: 144rpx;
  height: 112rpx;
  border-radius: 14rpx;
}

.audio-cover-progress {
  flex: 1;
}

.audio-track__actions {
  flex-wrap: wrap;
  gap: 10rpx;
  margin-top: 18rpx;
}

.audio-track__actions button {
  margin: 0;
  padding: 0 18rpx;
  font-size: 22rpx;
}

.audio-add {
  margin: 0;
  border: 2rpx dashed var(--hh-color-brand-primary);
  border-radius: 20rpx;
  background: #fff;
  color: var(--hh-color-brand-strong);
  font-size: 27rpx;
}

.native-file-input {
  display: none;
}
</style>
