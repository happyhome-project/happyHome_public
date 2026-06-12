<template>
  <view class="guide-route">
    <view v-if="detail.images.length" class="guide-hero">
      <swiper
        class="guide-hero-swiper"
        :current="currentImageIndex"
        :circular="detail.images.length > 1"
        :duration="260"
        @change="onHeroChange"
        @touchstart="onHeroPointerStart"
        @touchmove="onHeroPointerMove"
        @touchend="onHeroPointerEnd"
        @mousedown="onHeroPointerStart"
        @mousemove="onHeroPointerMove"
        @mouseup="onHeroPointerEnd"
      >
        <swiper-item
          v-for="(image, index) in detail.images"
          :key="`${image}-${index}`"
          class="guide-hero-slide"
        >
          <image
            :src="image"
            class="guide-hero-image"
            mode="aspectFill"
            @tap="previewImage(index)"
          />
        </swiper-item>
      </swiper>
    </view>

    <view v-else class="guide-hero-empty">
      <text v-if="detail.title" class="guide-empty-title">{{ detail.title }}</text>
    </view>

    <view v-if="detail.images.length > 1" class="guide-dots" aria-hidden="true">
      <text
        v-for="(_image, index) in detail.images"
        :key="`dot-${index}`"
        class="guide-dot"
        :class="{ active: index === currentImageIndex }"
      />
    </view>

    <view
      v-if="detail.images.length && (detail.title || detail.subtitle || detail.tags.length)"
      class="guide-intro"
    >
      <view v-if="detail.tags.length" class="guide-tags">
        <text v-for="tag in detail.tags" :key="tag" class="guide-tag">{{ tag }}</text>
      </view>
      <text v-if="detail.title" class="guide-title">{{ detail.title }}</text>
      <text v-if="detail.subtitle" class="guide-subtitle">{{ detail.subtitle }}</text>
    </view>

    <view class="guide-stats" aria-label="路线数据">
      <view v-for="stat in detail.stats" :key="stat.key" class="guide-stat">
        <text class="guide-stat-value">{{ stat.value || ' ' }}</text>
        <text class="guide-stat-label">{{ stat.label }}</text>
      </view>
    </view>

    <view
      v-for="section in detail.bodySections"
      :key="section.title"
      class="guide-section"
    >
      <view class="guide-section-heading">
        <text>{{ section.title }}</text>
      </view>
      <view class="guide-text">
        <template v-for="(block, index) in section.blocks" :key="`${section.title}-${index}`">
          <text
            v-if="block.type === 'paragraph'"
            class="guide-paragraph"
          >{{ block.text }}</text>
          <image
            v-else
            :src="block.src"
            class="guide-body-image"
            mode="widthFix"
            @tap="previewBodyImage(block.src)"
          />
        </template>
      </view>
    </view>

    <view v-if="detail.driveDuration" class="guide-drive">
      <text class="guide-drive-label">自驾到达</text>
      <text class="guide-drive-value">{{ detail.driveDuration }}</text>
    </view>

    <view v-if="detail.location" class="guide-section">
      <view class="guide-section-heading">
        <text>目的地位置</text>
      </view>
      <!-- #ifdef H5 -->
      <view class="guide-map-fallback" @tap="openLocation">
        <text class="guide-map-fallback-title">{{ detail.location.name || detail.location.address || '目的地位置' }}</text>
        <text class="guide-map-fallback-sub">点击打开地图导航</text>
      </view>
      <!-- #endif -->
      <!-- #ifndef H5 -->
      <view class="guide-map-card" @tap="openLocation">
        <map
          class="guide-map"
          :latitude="detail.location.lat"
          :longitude="detail.location.lng"
          :markers="mapMarkers"
          :scale="15"
          :enable-scroll="false"
          :enable-zoom="false"
          :enable-rotate="false"
          :enable-overlooking="false"
        />
        <view v-if="detail.location.address || detail.location.name" class="guide-map-meta">
          <text>{{ detail.location.address || detail.location.name }}</text>
        </view>
      </view>
      <!-- #endif -->
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { GuideRouteDetail } from '../utils/guide-detail'

const props = defineProps<{
  detail: GuideRouteDetail
}>()

const HERO_SWIPE_THRESHOLD_PX = 8
const currentImageIndex = ref(0)
const heroSwipeIntent = ref(false)
let heroPointerStartX = 0
let heroPointerStartY = 0
let heroHasPointerStart = false
let heroSuppressNextPreview = false

watch(
  () => props.detail.images.length,
  (length) => {
    if (length === 0 || currentImageIndex.value >= length) currentImageIndex.value = 0
  },
)

const mapMarkers = computed(() => {
  if (!props.detail.location) return []
  return [{
    id: 1,
    latitude: props.detail.location.lat,
    longitude: props.detail.location.lng,
    width: 28,
    height: 28,
  }]
})

const bodyImageUrls = computed(() =>
  props.detail.bodySections
    .flatMap((section) => section.blocks)
    .filter((block): block is { type: 'image'; src: string } => block.type === 'image')
    .map((block) => block.src)
)

function onHeroChange(event: any) {
  const next = Number(event?.detail?.current || 0)
  if (Number.isFinite(next)) currentImageIndex.value = next
  if (event?.detail?.source === 'touch') heroSuppressNextPreview = true
}

function onHeroPointerStart(event: any) {
  const point = getPointerPoint(event)
  heroPointerStartX = point.x
  heroPointerStartY = point.y
  heroHasPointerStart = true
  heroSwipeIntent.value = false
  heroSuppressNextPreview = false
}

function onHeroPointerMove(event: any) {
  if (!heroHasPointerStart) return
  const point = getPointerPoint(event)
  const dx = Math.abs(point.x - heroPointerStartX)
  const dy = Math.abs(point.y - heroPointerStartY)
  if (Math.max(dx, dy) >= HERO_SWIPE_THRESHOLD_PX) {
    heroSwipeIntent.value = true
    heroSuppressNextPreview = true
  }
}

function onHeroPointerEnd() {
  if (heroSwipeIntent.value) heroSuppressNextPreview = true
  heroHasPointerStart = false
  heroSwipeIntent.value = false
}

function getPointerPoint(event: any) {
  const touch = event?.touches?.[0] || event?.changedTouches?.[0]
  const x = Number(touch?.clientX ?? touch?.pageX ?? event?.clientX ?? event?.pageX ?? 0)
  const y = Number(touch?.clientY ?? touch?.pageY ?? event?.clientY ?? event?.pageY ?? 0)
  return { x, y }
}

function previewImage(index: number) {
  if (!props.detail.images.length) return
  if (heroSuppressNextPreview) {
    heroSuppressNextPreview = false
    return
  }
  uni.previewImage({
    current: props.detail.images[index],
    urls: props.detail.images,
  })
}

function previewBodyImage(current: string) {
  const urls = bodyImageUrls.value
  if (urls.length === 0) return
  uni.previewImage({ current, urls })
}

function openLocation() {
  const loc = props.detail.location
  if (!loc) return
  uni.openLocation({
    latitude: loc.lat,
    longitude: loc.lng,
    address: loc.address,
    name: loc.name || loc.address || '目的地位置',
    scale: 16,
  })
}
</script>

<style lang="scss" scoped>
.guide-route {
  overflow: hidden;
  border-radius: $hh-radius-lg;
  background: $hh-surface-1;
}

.guide-hero {
  position: relative;
  height: 72vh;
  min-height: 760rpx;
  max-height: 1120rpx;
  overflow: hidden;
  background: $hh-surface-2;
}

.guide-hero-swiper,
.guide-hero-slide,
.guide-hero-image {
  width: 100%;
  height: 100%;
}

.guide-hero-image {
  display: block;
}

.guide-intro {
  padding: 20rpx 28rpx 24rpx;
  background: $hh-surface-1;
}

.guide-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
  margin-bottom: 18rpx;
}

.guide-tag {
  min-height: 46rpx;
  padding: 9rpx 18rpx;
  border: 1rpx solid $hh-accent-line;
  border-radius: $hh-radius-full;
  background: $hh-accent-wash;
  color: $hh-accent-ink;
  font-size: 24rpx;
  line-height: 1.2;
}

.guide-title {
  display: block;
  color: $hh-ink-1;
  font-family: $hh-font-serif;
  font-size: 42rpx;
  line-height: 1.22;
  font-weight: $hh-font-weight-bold;
}

.guide-subtitle {
  display: block;
  margin-top: 12rpx;
  color: $hh-ink-2;
  font-size: 28rpx;
  line-height: 1.6;
}

.guide-dots {
  display: flex;
  justify-content: center;
  gap: 12rpx;
  padding: 18rpx 0 8rpx;
  background: $hh-surface-1;
  pointer-events: none;
}

.guide-dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 999rpx;
  background: rgba(47, 52, 44, 0.24);
}

.guide-dot.active {
  background: #e64646;
}

.guide-hero-empty {
  min-height: 220rpx;
  padding: 34rpx 28rpx;
  display: flex;
  align-items: flex-end;
  background: linear-gradient(135deg, #eef4e8, #f8f5ec);
}

.guide-empty-title {
  font-family: $hh-font-serif;
  font-size: 44rpx;
  line-height: 1.2;
  font-weight: $hh-font-weight-bold;
  color: $hh-ink-1;
}

.guide-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-top: 1rpx solid $hh-ink-line-2;
  border-bottom: 1rpx solid $hh-ink-line-2;
  background: $hh-surface-1;
}

.guide-stat {
  min-height: 104rpx;
  padding: 18rpx 6rpx 16rpx;
  border-right: 1rpx solid $hh-ink-line-2;
  text-align: center;
}

.guide-stat:last-child {
  border-right: 0;
}

.guide-stat-value {
  display: block;
  min-height: 34rpx;
  color: $hh-ink-1;
  font-family: $hh-font-num;
  font-size: 32rpx;
  line-height: 1.15;
  font-weight: $hh-font-weight-bold;
}

.guide-stat-label {
  display: block;
  margin-top: 8rpx;
  color: $hh-ink-3;
  font-size: 22rpx;
  line-height: 1.3;
}

.guide-section {
  padding: 30rpx 28rpx;
  border-bottom: 1rpx solid $hh-ink-line-2;
}

.guide-section:last-child {
  border-bottom: 0;
}

.guide-drive {
  margin: 30rpx 28rpx 0;
  padding: 22rpx 24rpx;
  border: 1rpx solid $hh-accent-line;
  border-radius: $hh-radius-md;
  background: $hh-accent-wash;
}

.guide-drive-label {
  display: block;
  color: $hh-ink-3;
  font-size: 23rpx;
  line-height: 1.25;
}

.guide-drive-value {
  display: block;
  margin-top: 8rpx;
  color: $hh-accent-ink;
  font-size: 30rpx;
  line-height: 1.35;
  font-weight: $hh-font-weight-bold;
}

.guide-section-heading {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 18rpx;
  color: $hh-ink-1;
  font-family: $hh-font-serif;
  font-size: 34rpx;
  line-height: 1.32;
  font-weight: $hh-font-weight-bold;
}

.guide-section-heading::before {
  content: '';
  width: 8rpx;
  height: 38rpx;
  border-radius: 999rpx;
  background: $hh-accent;
  flex: 0 0 auto;
}

.guide-text {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}

.guide-paragraph {
  color: $hh-ink-2;
  font-size: 29rpx;
  line-height: 1.9;
  word-break: break-word;
}

.guide-body-image {
  width: 100%;
  border-radius: $hh-radius-md;
  background: $hh-surface-2;
}

.guide-map-card {
  overflow: hidden;
  border: 1rpx solid $hh-ink-line-2;
  border-radius: $hh-radius-md;
  background: $hh-surface-2;
}

.guide-map {
  width: 100%;
  height: 300rpx;
}

.guide-map-meta {
  padding: 18rpx 20rpx;
  color: $hh-ink-2;
  font-size: 26rpx;
  line-height: 1.5;
  border-top: 1rpx solid $hh-ink-line-2;
}

.guide-map-fallback {
  min-height: 220rpx;
  padding: 28rpx;
  border: 1rpx solid $hh-ink-line-2;
  border-radius: $hh-radius-md;
  background: linear-gradient(135deg, #eef4e8, #f8f5ec);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 10rpx;
}

.guide-map-fallback-title {
  color: $hh-ink-1;
  font-size: 30rpx;
  line-height: 1.4;
  font-weight: $hh-font-weight-bold;
}

.guide-map-fallback-sub {
  color: $hh-ink-3;
  font-size: 24rpx;
  line-height: 1.4;
}
</style>
