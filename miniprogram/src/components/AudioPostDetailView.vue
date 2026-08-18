<template>
  <view class="audio-post-detail">
    <text class="audio-post-detail__title">{{ postTitle }}</text>

    <view class="audio-post-detail__author">
      <view class="audio-post-detail__author-main">
        <image class="audio-post-detail__avatar" :src="authorAvatarUrl" mode="aspectFill" />
        <text class="audio-post-detail__author-name">{{ authorName }}</text>
        <text class="audio-post-detail__date">{{ dateLabel }}</text>
      </view>
      <text v-if="isAuthor" class="audio-post-detail__settings" @tap="emit('settings')">编辑和设置 ›</text>
    </view>

    <image
      class="audio-post-detail__cover"
      :src="currentCover"
      mode="aspectFill"
      @error="handleCoverError"
    />

    <text class="audio-post-detail__current-title">{{ currentTrack?.title || '暂无可播放音轨' }}</text>

    <view class="audio-post-detail__controls">
      <view
        class="audio-post-detail__control"
        :class="{ 'audio-post-detail__control--disabled': !canPrevious }"
        aria-label="上一首"
        @tap="playPrevious"
      >
        <AudioIcon name="previous" size="48rpx" color="#32b77a" />
      </view>
      <view class="audio-post-detail__control audio-post-detail__control--primary" aria-label="播放或暂停" @tap="togglePlayback">
        <AudioIcon v-if="isPlaying" name="pause" size="46rpx" color="#ffffff" />
        <AudioIcon v-else name="play-circle" size="50rpx" color="#ffffff" />
      </view>
      <view
        class="audio-post-detail__control"
        :class="{ 'audio-post-detail__control--disabled': !canNext }"
        aria-label="下一首"
        @tap="playNext"
      >
        <AudioIcon name="next" size="48rpx" color="#32b77a" />
      </view>
    </view>

    <view class="audio-post-detail__progress">
      <text>{{ formatAudioDuration(elapsedSeconds) }}</text>
      <slider
        class="audio-post-detail__slider"
        :value="elapsedSeconds"
        :min="0"
        :max="currentDuration || 1"
        :step="1"
        activeColor="#32b77a"
        backgroundColor="#e3e7e5"
        block-color="#32b77a"
        :block-size="14"
        @change="handleSeek"
      />
      <text>{{ formatAudioDuration(currentDuration) }}</text>
    </view>

    <view class="audio-post-detail__tracks">
      <view
        v-for="(track, index) in audioTracks"
        :key="`${track.fileID}-${index}`"
        class="audio-post-detail__track"
        :class="{ 'audio-post-detail__track--active': index === activeIndex }"
        @tap="playTrack(index)"
      >
        <text class="audio-post-detail__track-index">{{ index + 1 }}</text>
        <text class="audio-post-detail__track-title">{{ track.title }}</text>
        <AudioIcon
          v-if="index === activeIndex && isPlaying"
          name="chart-bar"
          size="26rpx"
          color="#32b77a"
        />
        <text class="audio-post-detail__track-duration">{{ formatAudioDuration(track.duration) }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AudioIcon from './AudioIcon.vue'
import { useAudioStore } from '../store/audio'
import {
  DEFAULT_AUDIO_COVER,
  formatAudioDuration,
  resolveAudioDisplayCover,
  toAudioPlayerTracks,
  type AudioPlayerTrack,
} from '../utils/audio-display'

const props = defineProps<{
  post: Record<string, any>
  resolvedCovers: Record<string, string>
  authorName: string
  authorAvatarUrl: string
  dateLabel: string
  isAuthor: boolean
}>()
const emit = defineEmits<{
  (event: 'cover-error', source: string): void
  (event: 'settings'): void
}>()

const audioStore = useAudioStore()
const selectedIndex = ref(0)
const failedCoverUrls = ref<string[]>([])
const postId = computed(() => String(props.post?._id || ''))
const postTitle = computed(() => String(props.post?.content?.title || '邻里声音').trim() || '邻里声音')
const audioTracks = computed(() => toAudioPlayerTracks(props.post?.content?.audios))
const isCurrentPost = computed(() => audioStore.currentMeta?.postId === postId.value)
const activeIndex = computed(() => {
  if (isCurrentPost.value && audioStore.currentIndex >= 0 && audioStore.currentIndex < audioTracks.value.length) {
    return audioStore.currentIndex
  }
  return Math.min(selectedIndex.value, Math.max(0, audioTracks.value.length - 1))
})
const currentTrack = computed(() => audioTracks.value[activeIndex.value] || null)
const displayTracks = computed(() => audioTracks.value.map((track) => {
  const source = String(track.cover || '').trim()
  const resolved = String(props.resolvedCovers[source] || '').trim()
  if (failedCoverUrls.value.includes(source) || failedCoverUrls.value.includes(resolved)) {
    const next: AudioPlayerTrack = { fileID: track.fileID, title: track.title, duration: track.duration }
    return next
  }
  return track
}))
const displayCurrentTrack = computed(() => displayTracks.value[activeIndex.value] || null)
const currentCover = computed(() => resolveAudioDisplayCover(
  displayCurrentTrack.value,
  displayTracks.value,
  props.resolvedCovers,
))
const currentDuration = computed(() => Math.max(0, Number(currentTrack.value?.duration || 0)))
const elapsedSeconds = computed(() => {
  if (!isCurrentPost.value) return 0
  return Math.min(currentDuration.value, Math.max(0, Number(audioStore.currentTime || 0)))
})
const isPlaying = computed(() => isCurrentPost.value && audioStore.isPlaying)
const canPrevious = computed(() => activeIndex.value > 0)
const canNext = computed(() => activeIndex.value < audioTracks.value.length - 1)
const playlistMeta = computed(() => ({
  postId: postId.value,
  postTitle: postTitle.value,
  sectionId: String(props.post?.sectionId || ''),
  communityId: String(props.post?.communityId || ''),
}))

watch(postId, () => {
  selectedIndex.value = 0
  failedCoverUrls.value = []
}, { immediate: true })

async function playTrack(index: number) {
  if (index < 0 || index >= audioTracks.value.length) return
  selectedIndex.value = index
  await audioStore.playPlaylist(audioTracks.value, index, playlistMeta.value)
}

async function togglePlayback() {
  if (!currentTrack.value) return
  if (!isCurrentPost.value) {
    await playTrack(activeIndex.value)
    return
  }
  await audioStore.togglePlay()
}

async function playPrevious() {
  if (!canPrevious.value) return
  if (isCurrentPost.value) {
    await audioStore.prev()
    return
  }
  await playTrack(activeIndex.value - 1)
}

async function playNext() {
  if (!canNext.value) return
  if (isCurrentPost.value) {
    await audioStore.next()
    return
  }
  await playTrack(activeIndex.value + 1)
}

async function handleSeek(event: { detail?: { value?: number } }) {
  const raw = event?.detail?.value
  const seconds = Math.min(currentDuration.value, Math.max(0, Number(raw || 0)))
  if (!isCurrentPost.value) await playTrack(activeIndex.value)
  audioStore.seek(seconds)
}

function handleCoverError() {
  const failed = currentCover.value
  if (!failed || failed === DEFAULT_AUDIO_COVER || failedCoverUrls.value.includes(failed)) return
  failedCoverUrls.value = failedCoverUrls.value.concat(failed)
  emit('cover-error', failed)
}
</script>

<style lang="scss" scoped>
.audio-post-detail { padding-bottom: 20rpx; color: var(--hh-color-text-primary); }
.audio-post-detail__title { display: block; font-size: 42rpx; font-weight: 700; line-height: 1.35; letter-spacing: .01em; }
.audio-post-detail__author { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; margin-top: 18rpx; }
.audio-post-detail__author-main { min-width: 0; display: flex; align-items: center; gap: 10rpx; }
.audio-post-detail__avatar { width: 40rpx; height: 40rpx; flex: 0 0 auto; border-radius: 50%; background: #eef3f0; }
.audio-post-detail__author-name { max-width: 220rpx; overflow: hidden; color: #525b57; font-size: 24rpx; text-overflow: ellipsis; white-space: nowrap; }
.audio-post-detail__date { color: #a0a7a4; font-size: 23rpx; }
.audio-post-detail__settings { flex: 0 0 auto; color: #8a938f; font-size: 22rpx; }
.audio-post-detail__cover { display: block; width: 100%; height: calc(100vw - 64rpx); max-height: 686rpx; margin-top: 26rpx; border-radius: 18rpx; background: #eef5f1; }
.audio-post-detail__current-title { display: block; margin-top: 18rpx; color: #1f2824; font-size: 30rpx; font-weight: 650; line-height: 42rpx; text-align: center; }
.audio-post-detail__controls { display: flex; align-items: center; justify-content: center; gap: 64rpx; margin-top: 18rpx; }
.audio-post-detail__control { width: 64rpx; height: 64rpx; display: flex; align-items: center; justify-content: center; }
.audio-post-detail__control--primary { width: 88rpx; height: 88rpx; border-radius: 50%; background: #32b77a; box-shadow: 0 8rpx 22rpx rgba(50,183,122,.22); }
.audio-post-detail__control--disabled { opacity: .3; }
.audio-post-detail__progress { display: grid; grid-template-columns: 66rpx minmax(0,1fr) 66rpx; align-items: center; gap: 10rpx; margin-top: 16rpx; color: #9ba29f; font-size: 20rpx; }
.audio-post-detail__progress > text:last-child { text-align: right; }
.audio-post-detail__slider { width: 100%; margin: 0; }
.audio-post-detail__tracks { overflow: hidden; margin-top: 22rpx; border: 1rpx solid #edf0ee; border-radius: 16rpx; background: #f8f9f8; }
.audio-post-detail__track { min-height: 76rpx; display: grid; grid-template-columns: 38rpx minmax(0,1fr) auto auto; align-items: center; gap: 10rpx; padding: 0 18rpx; border-bottom: 1rpx solid #e9ecea; box-sizing: border-box; color: #3f4743; font-size: 25rpx; }
.audio-post-detail__track:last-child { border-bottom: 0; }
.audio-post-detail__track--active { color: #32b77a; font-weight: 600; background: #f1faf6; }
.audio-post-detail__track-index { color: inherit; font-variant-numeric: tabular-nums; }
.audio-post-detail__track-title { overflow: hidden; color: inherit; text-overflow: ellipsis; white-space: nowrap; }
.audio-post-detail__track-duration { color: #747d79; font-size: 22rpx; font-variant-numeric: tabular-nums; }
</style>
