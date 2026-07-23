<template>
  <view class="image-note-detail">
    <view v-if="media.length" class="image-note-hero">
      <swiper
        class="image-note-swiper"
        :current="currentImageIndex"
        :circular="media.length > 1"
        :duration="260"
        @change="onImageChange"
      >
        <swiper-item
          v-for="(item, index) in media"
          :key="`${item.source}-${index}`"
          class="image-note-slide"
        >
          <view
            v-if="item.state !== 'ready' || failedImageIndexes.includes(index)"
            class="image-note-image-fallback"
          >
            <text>{{ item.state === 'pending' ? '图片加载中...' : '图片暂不可用' }}</text>
          </view>
          <image
            v-else
            :src="item.src"
            class="image-note-image"
            mode="aspectFit"
            @load="onImageLoad(item.source, index)"
            @error="onImageError(item.source, index)"
            @tap="previewImage(index)"
          />
        </swiper-item>
      </swiper>
      <view v-if="media.length > 1" class="image-note-image-count">
        <text>{{ currentImageIndex + 1 }}/{{ media.length }}</text>
      </view>
    </view>

    <view v-else class="image-note-hero-empty">
      <text>图片暂不可用</text>
    </view>

    <view v-if="media.length > 1" class="image-note-dots" aria-hidden="true">
      <text
        v-for="(_item, index) in media"
        :key="`image-note-dot-${index}`"
        class="image-note-dot"
        :class="{ active: index === currentImageIndex }"
      />
    </view>

    <view class="image-note-content">
      <view class="image-note-author">
        <image
          v-if="detail.authorAvatarUrl"
          :src="detail.authorAvatarUrl"
          class="image-note-author-avatar"
          mode="aspectFill"
        />
        <view v-else class="image-note-author-avatar image-note-author-avatar--fallback">
          <text>{{ authorInitial }}</text>
        </view>
        <view class="image-note-author-copy">
          <text class="image-note-author-name">{{ detail.authorName }}</text>
          <text v-if="publishDate" class="image-note-publish-date">{{ publishDate }}</text>
        </view>
      </view>

      <text class="image-note-title">{{ detail.title }}</text>

      <view v-if="detail.body" class="image-note-body">
        <RichNoteRenderer :value="detail.body" :allow-images="false" />
      </view>

      <view v-if="detail.topics.length" class="image-note-topics" aria-label="话题">
        <text
          v-for="topic in detail.topics"
          :key="topic"
          class="image-note-topic"
        >#{{ topic }}</text>
      </view>

      <view
        v-if="detail.location"
        class="image-note-location"
        role="button"
        aria-label="打开设置地点"
        @tap="openLocation"
      >
        <text class="image-note-location-pin" aria-hidden="true">⌖</text>
        <text class="image-note-location-label">地点</text>
        <text class="image-note-location-divider">|</text>
        <text class="image-note-location-text">{{ detail.location.name || detail.location.address || '查看地点' }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  ImageNoteDetail,
  ImageNoteLocation,
  ImageNoteMediaItem,
} from '../utils/image-note'
import RichNoteRenderer from './widgets/RichNoteRenderer.vue'

const props = defineProps<{
  detail: ImageNoteDetail
  media: ImageNoteMediaItem[]
}>()

const emit = defineEmits<{
  (event: 'open-location', location: ImageNoteLocation): void
  (event: 'media-load', source: string): void
  (event: 'media-error', source: string): void
}>()

const currentImageIndex = ref(0)
const failedImageIndexes = ref<number[]>([])

const authorInitial = computed(() => props.detail.authorName.slice(0, 1) || '邻')
const publishDate = computed(() => formatPostDate(props.detail.createdAt))

watch(
  () => props.media.length,
  (length) => {
    if (length === 0 || currentImageIndex.value >= length) currentImageIndex.value = 0
  },
)

function onImageChange(event: any) {
  const nextIndex = Number(event?.detail?.current || 0)
  if (Number.isFinite(nextIndex)) currentImageIndex.value = nextIndex
}

function onImageLoad(source: string, index: number) {
  failedImageIndexes.value = failedImageIndexes.value.filter((item) => item !== index)
  emit('media-load', source)
}

function onImageError(source: string, index: number) {
  if (!failedImageIndexes.value.includes(index)) {
    failedImageIndexes.value = [...failedImageIndexes.value, index]
  }
  emit('media-error', source)
}

function previewImage(index: number) {
  const current = props.media[index]
  if (!current || current.state !== 'ready' || !current.src) return
  const urls = props.media
    .filter((item) => item.state === 'ready' && item.src)
    .map((item) => item.src)
  uni.previewImage({
    current: current.src,
    urls,
  })
}

function openLocation() {
  if (props.detail.location) emit('open-location', props.detail.location)
}

function formatPostDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}月${date.getDate()}日`
}
</script>

<style lang="scss" scoped>
.image-note-detail {
  overflow: hidden;
  background: var(--hh-color-card);
}

.image-note-hero,
.image-note-swiper,
.image-note-slide {
  width: 100%;
  height: 960rpx;
  min-height: 620rpx;
  max-height: 72vh;
  background: var(--hh-color-card);
}

.image-note-hero {
  position: relative;
  overflow: hidden;
  background: var(--hh-color-card);
}

.image-note-image {
  width: 100%;
  height: 100%;
  background: var(--hh-color-card);
}

.image-note-image-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(145deg,#f3f3f3,#fafafa);
  color: var(--hh-color-text-tertiary);
  font-size: 25rpx;
}

.image-note-image-count {
  position: absolute;
  right: 24rpx;
  top: 24rpx;
  min-width: 64rpx;
  padding: 8rpx 16rpx;
  box-sizing: border-box;
  border-radius: 999rpx;
  background: rgba(20, 26, 23, 0.56);
  color: #fff;
  font-family: $hh-font-num;
  font-size: 22rpx;
  line-height: 1.2;
  text-align: center;
}

.image-note-hero-empty {
  min-height: 420rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--hh-color-page);
  color: var(--hh-color-text-tertiary);
  font-size: var(--hh-text-caption-lg-size);
}

.image-note-dots {
  height: 46rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
  background: #fff;
}

.image-note-dot {
  width: 10rpx;
  height: 10rpx;
  border-radius: 999rpx;
  background: #d7d7d7;
  transition: width 160ms ease, background-color 160ms ease;
}

.image-note-dot.active {
  width: 14rpx;
  background: #ff2442;
}

.image-note-content {
  padding: 30rpx var(--hh-page-x) 8rpx;
}

.image-note-author {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.image-note-author-avatar {
  width: 72rpx;
  height: 72rpx;
  flex: 0 0 auto;
  border-radius: 999rpx;
  border: 1rpx solid var(--hh-color-brand-line);
  background: var(--hh-color-brand-soft);
}

.image-note-author-avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--hh-color-brand-strong);
  font-size: 26rpx;
  font-weight: $hh-font-weight-bold;
}

.image-note-author-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.image-note-author-name {
  color: var(--hh-color-text-primary);
  font-size: 28rpx;
  font-weight: $hh-font-weight-medium;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-note-publish-date {
  color: var(--hh-color-text-tertiary);
  font-size: 22rpx;
  line-height: 1.35;
}

.image-note-title {
  display: block;
  margin-top: 30rpx;
  color: var(--hh-color-text-primary);
  font-size: 38rpx;
  font-weight: $hh-font-weight-bold;
  line-height: 1.42;
  letter-spacing: 0.01em;
  word-break: break-word;
}

.image-note-body {
  margin-top: 10rpx;
  color: var(--hh-color-text-secondary);
}

.image-note-body :deep(.rich-note-renderer) {
  color: var(--hh-color-text-secondary);
  font-size: 29rpx;
  line-height: 1.76;
}

.image-note-topics {
  margin-top: 24rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx 18rpx;
}

.image-note-topic {
  padding: 7rpx 14rpx;
  border: 1rpx solid #ffd3da;
  border-radius: 999rpx;
  background: #fff1f3;
  color: #ff2442;
  font-size: 25rpx;
  line-height: 1.45;
}

.image-note-location {
  width: fit-content;
  max-width: 100%;
  margin-top: 26rpx;
  min-height: 64rpx;
  padding: 12rpx 18rpx;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 10rpx;
  border: 1rpx solid #e7e7e7;
  border-radius: 12rpx;
  background: #fff;
}

.image-note-location-pin { color: #333; font-size: 27rpx; line-height: 1; }

.image-note-location-label {
  flex: 0 0 auto;
  color: #333;
  font-size: 25rpx;
  line-height: 1.4;
}

.image-note-location-divider {
  flex: 0 0 auto;
  color: #d8d8d8;
  font-size: 22rpx;
}

.image-note-location-text {
  min-width: 0;
  overflow: hidden;
  color: #555;
  font-size: 25rpx;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
