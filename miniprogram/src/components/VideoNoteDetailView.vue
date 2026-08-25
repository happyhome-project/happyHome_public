<template>
  <view class="video-note-detail">
    <view class="video-note-hero">
      <video
        v-if="playingSrc"
        :src="playingSrc"
        class="video-note-player"
        :controls="true"
        :autoplay="true"
        object-fit="contain"
        :show-fullscreen-btn="true"
        @error="onVideoError"
      />
      <view v-else class="video-note-cover-wrap" @tap="playVideo">
        <image
          v-if="coverUrl"
          :src="coverUrl"
          class="video-note-cover"
          mode="aspectFill"
          @load="onCoverLoad"
          @error="onCoverError"
        />
        <view v-else class="video-note-cover-fallback">
          <text>{{ detail.video ? '视频封面加载中...' : '视频暂不可用' }}</text>
        </view>
        <view v-if="detail.video" class="video-note-play-mask">
          <AudioIcon name="play-circle-filled" size="108rpx" color="#ffffff" />
        </view>
      </view>
    </view>

    <view class="video-note-content">
      <view class="video-note-author-row">
        <view class="video-note-author">
          <image
            v-if="detail.authorAvatarUrl"
            :src="detail.authorAvatarUrl"
            class="video-note-author-avatar"
            mode="aspectFill"
          />
          <view v-else class="video-note-author-avatar video-note-author-avatar--fallback">
            <text>{{ authorInitial }}</text>
          </view>
          <view class="video-note-author-copy">
            <text class="video-note-author-name">{{ detail.authorName }}</text>
            <text v-if="publishDate" class="video-note-publish-date">发布于 {{ publishDate }}</text>
          </view>
        </view>
        <text v-if="communityName" class="video-note-community">{{ communityName }}</text>
      </view>

      <text class="video-note-title">{{ detail.title }}</text>

      <view v-if="detail.body" class="video-note-body">
        <RichNoteRenderer :value="detail.body" :allow-images="false" />
      </view>

      <view v-if="detail.topics.length" class="video-note-topics" aria-label="话题">
        <text
          v-for="topic in detail.topics"
          :key="topic"
          class="video-note-topic"
        >#{{ topic }}</text>
      </view>

      <view
        v-if="detail.location"
        class="video-note-location"
        role="button"
        aria-label="打开设置地点"
        @tap="openLocation"
      >
        <text class="video-note-location-label">地点</text>
        <text class="video-note-location-divider">|</text>
        <text class="video-note-location-text">{{ detail.location.name || detail.location.address || '查看地点' }}</text>
      </view>

      <view class="video-note-footer">
        <text class="video-note-type">内容沉淀 · 视频笔记</text>
        <text
          v-if="isAuthor"
          class="video-note-settings"
          data-testid="post-settings-trigger"
          @tap="emit('settings')"
        >编辑和设置 ›</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { VideoItem } from '../../../cloud/shared/types'
import type {
  NativeArchiveVideoDetail,
  NativeArchiveVideoLocation,
} from '../utils/archive-detail'
import { openExternal, playInline } from '../utils/video-actions'
import AudioIcon from './AudioIcon.vue'
import RichNoteRenderer from './widgets/RichNoteRenderer.vue'

const props = withDefaults(defineProps<{
  detail: NativeArchiveVideoDetail
  communityName?: string
  isAuthor?: boolean
}>(), {
  communityName: '',
  isAuthor: false,
})

const emit = defineEmits<{
  (event: 'open-location', location: NativeArchiveVideoLocation): void
  (event: 'media-load', source: string): void
  (event: 'media-error', source: string): void
  (event: 'settings'): void
}>()

const playingSrc = ref('')

const coverUrl = computed(() => String(props.detail.video?.cover || '').trim())
const authorInitial = computed(() => props.detail.authorName.slice(0, 1) || '邻')
const publishDate = computed(() => formatPostDate(props.detail.createdAt))

watch(
  () => props.detail.video,
  () => {
    playingSrc.value = ''
  },
)

async function playVideo() {
  const video = props.detail.video
  if (!video) return
  try {
    if (video.source === 'cos' || video.source === 'h5') {
      await playInline(video, { setSrc: (src) => { playingSrc.value = src } })
      return
    }
    await openExternal(video)
  } catch (error: any) {
    uni.showToast({ title: String(error?.message || '视频暂时无法播放'), icon: 'none' })
  }
}

function onCoverLoad() {
  if (coverUrl.value) emit('media-load', coverUrl.value)
}

function onCoverError() {
  if (coverUrl.value) emit('media-error', coverUrl.value)
}

function onVideoError() {
  const source = videoSource(props.detail.video)
  if (source) emit('media-error', source)
  playingSrc.value = ''
  uni.showToast({ title: '视频暂时无法播放', icon: 'none' })
}

function openLocation() {
  if (props.detail.location) emit('open-location', props.detail.location)
}

function videoSource(video: VideoItem | null): string {
  if (!video) return ''
  if (video.source === 'cos') return video.fileID
  if (video.source === 'h5' || video.source === 'app_link') return video.url
  return ''
}

function formatPostDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}月${date.getDate()}日`
}
</script>

<style lang="scss" scoped>
.video-note-detail {
  overflow: hidden;
  background: var(--hh-color-card);
}

.video-note-hero {
  position: relative;
  width: 100%;
  height: 422rpx;
  overflow: hidden;
  background: #111;
}

.video-note-cover-wrap,
.video-note-cover,
.video-note-player,
.video-note-cover-fallback {
  width: 100%;
  height: 100%;
}

.video-note-cover-wrap {
  position: relative;
}

.video-note-cover {
  display: block;
}

.video-note-cover-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.68);
  font-size: 25rpx;
  background: #181b1a;
}

.video-note-play-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.18);
  filter: drop-shadow(0 6rpx 16rpx rgba(0, 0, 0, 0.26));
}

.video-note-content {
  padding: 32rpx var(--hh-page-x) calc(34rpx + env(safe-area-inset-bottom));
}

.video-note-author-row,
.video-note-author,
.video-note-footer {
  display: flex;
  align-items: center;
}

.video-note-author-row {
  justify-content: space-between;
  gap: 24rpx;
}

.video-note-author {
  min-width: 0;
  flex: 1;
  gap: 18rpx;
}

.video-note-author-avatar {
  width: 76rpx;
  height: 76rpx;
  flex: 0 0 auto;
  border: 1rpx solid var(--hh-color-brand-line);
  border-radius: 999rpx;
  background: var(--hh-color-brand-soft);
}

.video-note-author-avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--hh-color-brand-strong);
  font-size: 27rpx;
  font-weight: $hh-font-weight-bold;
}

.video-note-author-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.video-note-author-name {
  overflow: hidden;
  color: var(--hh-color-text-primary);
  font-size: 28rpx;
  font-weight: $hh-font-weight-medium;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.video-note-publish-date {
  color: var(--hh-color-text-tertiary);
  font-size: 22rpx;
  line-height: 1.35;
}

.video-note-community {
  max-width: 210rpx;
  flex: 0 1 auto;
  overflow: hidden;
  padding: 9rpx 18rpx;
  border: 1rpx solid var(--hh-color-brand-line);
  border-radius: 999rpx;
  background: var(--hh-color-brand-soft);
  color: var(--hh-color-brand-strong);
  font-size: 23rpx;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.video-note-title {
  display: block;
  margin-top: 34rpx;
  color: var(--hh-color-text-primary);
  font-size: 38rpx;
  font-weight: $hh-font-weight-bold;
  line-height: 1.42;
  letter-spacing: 0.01em;
  word-break: break-word;
}

.video-note-body {
  margin-top: 12rpx;
  color: var(--hh-color-text-secondary);
}

.video-note-body :deep(.rich-note-renderer) {
  gap: 16rpx;
  color: var(--hh-color-text-secondary);
  font-size: 29rpx;
  line-height: 1.76;
}

.video-note-topics {
  margin-top: 24rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx 18rpx;
}

.video-note-topic {
  padding: 7rpx 14rpx;
  border: 1rpx solid var(--hh-color-brand-line);
  border-radius: 999rpx;
  background: var(--hh-color-brand-soft);
  color: var(--hh-color-brand-strong);
  font-size: 25rpx;
  line-height: 1.45;
}

.video-note-location {
  width: fit-content;
  max-width: 100%;
  min-height: 64rpx;
  margin-top: 26rpx;
  padding: 12rpx 18rpx;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 10rpx;
  border: 1rpx solid var(--hh-color-line);
  border-radius: 12rpx;
  background: var(--hh-color-card);
}

.video-note-location-label,
.video-note-location-text {
  color: var(--hh-color-text-secondary);
  font-size: 25rpx;
  line-height: 1.4;
}

.video-note-location-divider {
  color: var(--hh-color-line);
  font-size: 22rpx;
}

.video-note-location-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.video-note-footer {
  justify-content: space-between;
  gap: 22rpx;
  margin-top: 42rpx;
  padding-top: 22rpx;
  border-top: 1rpx solid var(--hh-color-line-soft);
}

.video-note-type,
.video-note-settings {
  color: var(--hh-color-text-tertiary);
  font-size: 23rpx;
  line-height: 1.5;
}

.video-note-settings {
  flex: 0 0 auto;
  padding: 10rpx 0 10rpx 20rpx;
}
</style>
