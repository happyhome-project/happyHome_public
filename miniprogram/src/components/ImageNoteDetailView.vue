<template>
  <view class="image-note-detail">
    <view v-if="detail.images.length" class="image-note-hero">
      <swiper
        class="image-note-swiper"
        :current="currentImageIndex"
        :circular="detail.images.length > 1"
        :duration="260"
        @change="onImageChange"
      >
        <swiper-item
          v-for="(image, index) in detail.images"
          :key="`${image}-${index}`"
          class="image-note-slide"
        >
          <image
            :src="image"
            class="image-note-image"
            mode="aspectFit"
            @tap="previewImage(index)"
          />
        </swiper-item>
      </swiper>
      <view v-if="detail.images.length > 1" class="image-note-image-count">
        <text>{{ currentImageIndex + 1 }}/{{ detail.images.length }}</text>
      </view>
    </view>

    <view v-else class="image-note-hero-empty">
      <text>图片暂不可用</text>
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
        <view class="image-note-location-icon" aria-hidden="true">
          <text>⌖</text>
        </view>
        <view class="image-note-location-copy">
          <text class="image-note-location-label">设置地点</text>
          <text class="image-note-location-name">
            {{ detail.location.name || detail.location.address || '查看地点' }}
          </text>
          <text
            v-if="detail.location.name && detail.location.address"
            class="image-note-location-address"
          >{{ detail.location.address }}</text>
        </view>
        <text class="image-note-location-action">›</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ImageNoteDetail, ImageNoteLocation } from '../utils/image-note'
import RichNoteRenderer from './widgets/RichNoteRenderer.vue'

const props = defineProps<{
  detail: ImageNoteDetail
}>()

const emit = defineEmits<{
  (event: 'open-location', location: ImageNoteLocation): void
}>()

const currentImageIndex = ref(0)

const authorInitial = computed(() => props.detail.authorName.slice(0, 1) || '邻')
const publishDate = computed(() => formatPostDate(props.detail.createdAt))

watch(
  () => props.detail.images.length,
  (length) => {
    if (length === 0 || currentImageIndex.value >= length) currentImageIndex.value = 0
  },
)

function onImageChange(event: any) {
  const nextIndex = Number(event?.detail?.current || 0)
  if (Number.isFinite(nextIndex)) currentImageIndex.value = nextIndex
}

function previewImage(index: number) {
  if (!props.detail.images.length) return
  uni.previewImage({
    current: props.detail.images[index],
    urls: props.detail.images,
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
}

.image-note-hero {
  position: relative;
  overflow: hidden;
  background: var(--hh-color-page);
}

.image-note-image {
  width: 100%;
  height: 100%;
  background: var(--hh-color-page);
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
  margin-top: 20rpx;
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
  margin-top: 30rpx;
  min-height: 104rpx;
  padding: 18rpx 20rpx;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 16rpx;
  border: 1rpx solid var(--hh-color-line-soft);
  border-radius: var(--hh-radius-card);
  background: var(--hh-color-page);
}

.image-note-location-icon {
  width: 56rpx;
  height: 56rpx;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999rpx;
  background: var(--hh-color-brand-soft);
  color: var(--hh-color-brand-strong);
  font-size: 30rpx;
}

.image-note-location-copy {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2rpx;
}

.image-note-location-label {
  color: var(--hh-color-text-tertiary);
  font-size: 21rpx;
  line-height: 1.3;
}

.image-note-location-name {
  color: var(--hh-color-text-primary);
  font-size: 27rpx;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-note-location-address {
  color: var(--hh-color-text-tertiary);
  font-size: 21rpx;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-note-location-action {
  flex: 0 0 auto;
  color: var(--hh-color-text-tertiary);
  font-size: 40rpx;
  line-height: 1;
}
</style>
