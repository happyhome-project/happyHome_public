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
        @touchcancel="onHeroPointerEnd"
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
      <view v-if="detail.images.length > 1" class="guide-hero-count">
        <text>{{ currentImageIndex + 1 }}/{{ detail.images.length }}</text>
      </view>
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

    <view class="guide-body">
      <view
        v-if="detail.title || detail.subtitle || detail.tags.length"
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

      <view v-if="detail.location" class="guide-section guide-location">
        <view class="guide-section-heading">
          <text>位置</text>
        </view>
        <!-- #ifdef H5 -->
        <view class="guide-map-fallback" @tap="openLocation">
          <view class="guide-map-fallback-text">
            <text class="guide-map-fallback-title">{{ detail.location.name || detail.location.address || '目的地位置' }}</text>
            <text v-if="detail.location.address && detail.location.name" class="guide-map-fallback-sub">{{ detail.location.address }}</text>
          </view>
          <view class="guide-map-action-round">
            <text>导航</text>
          </view>
        </view>
        <!-- #endif -->
        <!-- #ifndef H5 -->
        <view class="guide-map-card" @tap="openLocation">
          <view class="guide-map-text">
            <text class="guide-map-address">{{ detail.location.address || detail.location.name || '目的地位置' }}</text>
          </view>
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
            @tap.stop="openLocation"
          />
          <view class="guide-map-action-round">
            <text>导航</text>
          </view>
        </view>
        <!-- #endif -->
      </view>

      <view v-if="detail.liangbuluTrackId" class="guide-section guide-track">
        <view class="guide-section-heading">
          <text>两步路轨迹编号</text>
        </view>
        <view class="guide-track-copy" @tap="copyLiangbuluTrackId">
          <text class="guide-track-id">{{ detail.liangbuluTrackId }}</text>
          <text class="guide-track-action">复制</text>
        </view>
        <text class="guide-track-hint">复制后可到两步路搜索轨迹</text>
      </view>

      <view
        v-for="(section, sectionIndex) in detail.bodySections"
        :key="`${section.title || section.type}-${sectionIndex}`"
        class="guide-section"
        :class="{ 'guide-section--plain': !section.title }"
      >
        <view v-if="section.title" class="guide-section-heading">
          <text>{{ section.title }}</text>
        </view>
        <view v-if="section.type === 'rich_note'" class="guide-rich-note">
          <RichNoteRenderer :value="section.value" :allow-images="false" />
        </view>
        <view v-else class="guide-text">
          <template v-for="(block, index) in section.blocks" :key="`${sectionIndex}-${index}`">
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
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { GuideRouteDetail } from '../utils/guide-detail'
import RichNoteRenderer from './widgets/RichNoteRenderer.vue'

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
    .flatMap((section) => section.type === 'blocks' ? section.blocks : [])
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

function copyLiangbuluTrackId() {
  const trackId = String(props.detail.liangbuluTrackId || '').trim()
  if (!trackId) return
  uni.setClipboardData({
    data: trackId,
    success: () => {
      uni.showToast({ title: '已复制编号', icon: 'success' })
    },
    fail: () => {
      uni.showToast({ title: '复制失败', icon: 'none' })
    },
  })
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
  border-radius: var(--hh-radius-card);
  background: var(--hh-color-card);
}

.guide-hero {
  position: relative;
  margin: 0 40rpx;
  width: auto;
  height: 1160rpx;
  min-height: 760rpx;
  max-height: 72vh;
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

.guide-hero-count {
  position: absolute;
  z-index: 2;
  top: 32rpx;
  right: 32rpx;
  min-width: 72rpx;
  height: 60rpx;
  padding: 0 28rpx;
  border-radius: $hh-radius-full;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.guide-hero-count text {
  color: #fff;
  font-size: var(--hh-text-body-base-size);
  line-height: var(--hh-text-body-base-line);
}

.guide-body {
  display: flex;
  flex-direction: column;
  gap: 48rpx;
  padding: 32rpx 32rpx 0;
  border-radius: 32rpx 32rpx 0 0;
  background: var(--hh-color-card);
}

.guide-intro {
  padding: 0;
}

.guide-intro + .guide-stats {
  margin-top: -24rpx;
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
  border: 1rpx solid var(--hh-color-brand-line);
  border-radius: $hh-radius-full;
  background: var(--hh-color-brand-soft);
  color: var(--hh-color-brand-strong);
  font-size: var(--hh-text-caption-lg-size);
  line-height: 1.2;
}

.guide-title {
  display: block;
  color: var(--hh-color-text-primary);
  font-family: $hh-font-serif;
  font-size: var(--hh-text-heading-lg-size);
  line-height: var(--hh-text-heading-lg-line);
  font-weight: $hh-font-weight-bold;
}

.guide-subtitle {
  display: block;
  margin-top: 12rpx;
  color: var(--hh-color-text-secondary);
  font-size: var(--hh-text-body-base-size);
  line-height: var(--hh-text-body-base-line);
}

.guide-dots {
  display: flex;
  justify-content: center;
  gap: 12rpx;
  height: 16rpx;
  padding: 0;
  background: var(--hh-color-card);
  pointer-events: none;
  align-items: center;
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
  height: 158rpx;
  overflow: hidden;
  border: 1rpx solid var(--hh-color-line);
  border-radius: var(--hh-radius-card);
  background: var(--hh-color-card);
  box-sizing: border-box;
}

.guide-stat {
  min-width: 0;
  min-height: 0;
  height: 100%;
  padding: 16rpx 8rpx;
  border-right: 1rpx solid var(--hh-color-line);
  display: flex;
  flex-direction: column;
  justify-content: center;
  text-align: center;
  box-sizing: border-box;
}

.guide-stat:last-child {
  border-right: 0;
}

.guide-stat-value {
  display: block;
  max-width: 100%;
  min-height: 52rpx;
  color: var(--hh-color-brand-primary);
  font-family: $hh-font-num;
  font-size: var(--hh-text-heading-sm-size);
  line-height: var(--hh-text-heading-sm-line);
  font-weight: $hh-font-weight-bold;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.guide-stat-label {
  display: block;
  max-width: 100%;
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-body-base-size);
  line-height: var(--hh-text-body-base-line);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.guide-section {
  padding: 0;
  border-bottom: 0;
}

.guide-section:last-child {
  border-bottom: 0;
}

.guide-section--plain {
  padding-top: 0;
}

.guide-section-heading {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-bottom: 32rpx;
  color: var(--hh-color-text-primary);
  font-family: $hh-font-serif;
  font-size: var(--hh-text-heading-md-size);
  line-height: var(--hh-text-heading-md-line);
  font-weight: $hh-font-weight-bold;
}

.guide-section-heading::before {
  content: '';
  width: 12rpx;
  height: 44rpx;
  border-radius: 999rpx;
  background: var(--hh-color-brand-primary);
  flex: 0 0 auto;
}

.guide-text {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.guide-paragraph {
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-body-lg-size);
  line-height: var(--hh-text-body-lg-line);
  word-break: break-word;
}

.guide-body-image {
  width: 100%;
  border-radius: var(--hh-radius-card);
  background: $hh-surface-2;
}

.guide-rich-note :deep(.rich-note-renderer) {
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-body-lg-size);
  line-height: var(--hh-text-body-lg-line);
}

.guide-track-copy {
  min-height: 96rpx;
  padding: 20rpx 24rpx;
  border: 1rpx solid var(--hh-color-brand-line);
  border-radius: var(--hh-radius-card);
  background: var(--hh-color-brand-soft);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
}

.guide-track-id {
  flex: 1;
  min-width: 0;
  color: var(--hh-color-brand-strong);
  font-family: $hh-font-num;
  font-size: 28rpx;
  line-height: 1.35;
  font-weight: $hh-font-weight-bold;
  word-break: break-all;
}

.guide-track-action {
  flex: 0 0 auto;
  min-height: 44rpx;
  padding: 9rpx 18rpx;
  border-radius: $hh-radius-full;
  background: var(--hh-color-brand-primary);
  color: #fff;
  font-size: 24rpx;
  line-height: 1.2;
  font-weight: $hh-font-weight-bold;
}

.guide-track-hint {
  display: block;
  margin-top: 12rpx;
  color: var(--hh-color-text-tertiary);
  font-size: 24rpx;
  line-height: 1.45;
}

.guide-map-card {
  position: relative;
  min-height: 168rpx;
  padding: 32rpx 104rpx 32rpx 40rpx;
  overflow: hidden;
  border: 1rpx solid var(--hh-color-brand-line);
  border-radius: var(--hh-radius-card);
  background: #f9ffff;
  display: flex;
  align-items: center;
}

.guide-map {
  position: absolute;
  top: 0;
  right: 0;
  width: 376rpx;
  height: 168rpx;
  opacity: 0.32;
}

.guide-map-text {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
}

.guide-map-address {
  display: block;
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-body-lg-size);
  line-height: var(--hh-text-body-lg-line);
  word-break: break-word;
}

.guide-map-action-round {
  position: absolute;
  z-index: 2;
  right: 40rpx;
  top: 50%;
  transform: translateY(-50%);
  width: 64rpx;
  height: 64rpx;
  border-radius: $hh-radius-full;
  background: var(--hh-color-brand-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 10rpx 22rpx rgba(61, 173, 125, 0.24);
}

.guide-map-action-round text {
  color: #fff;
  font-size: 22rpx;
  line-height: 1.2;
  font-weight: $hh-font-weight-bold;
}

.guide-map-fallback {
  position: relative;
  min-height: 168rpx;
  padding: 32rpx 104rpx 32rpx 40rpx;
  border: 1rpx solid var(--hh-color-brand-line);
  border-radius: var(--hh-radius-card);
  background:
    radial-gradient(circle at 78% 36%, rgba(61, 173, 125, 0.2), transparent 10%),
    linear-gradient(135deg, #f9ffff 0%, #e8f8f0 52%, #f7f8fa 100%);
  display: flex;
  align-items: center;
}

.guide-map-fallback-text {
  flex: 1;
  min-width: 0;
}

.guide-map-fallback-title {
  display: block;
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-body-lg-size);
  line-height: var(--hh-text-body-lg-line);
  font-weight: $hh-font-weight-bold;
  word-break: break-word;
}

.guide-map-fallback-sub {
  display: block;
  margin-top: 6rpx;
  color: var(--hh-color-text-secondary);
  font-size: 24rpx;
  line-height: 1.4;
  word-break: break-word;
}
</style>
