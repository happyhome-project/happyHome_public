<template>
  <view class="guide-route">
    <view v-if="detail.images.length" class="guide-hero">
      <scroll-view scroll-x class="guide-hero-scroll" :show-scrollbar="false" enhanced>
        <view class="guide-hero-track">
          <image
            v-for="(image, index) in detail.images"
            :key="`${image}-${index}`"
            :src="image"
            class="guide-hero-image"
            mode="aspectFill"
            @tap="previewImage(index)"
          />
        </view>
      </scroll-view>
      <view class="guide-hero-mask" />
      <view class="guide-hero-copy">
        <view v-if="detail.tags.length" class="guide-tags">
          <text v-for="tag in detail.tags" :key="tag" class="guide-tag">{{ tag }}</text>
        </view>
        <text v-if="detail.title" class="guide-title">{{ detail.title }}</text>
        <text v-if="detail.subtitle" class="guide-subtitle">{{ detail.subtitle }}</text>
        <view v-if="detail.images.length > 1" class="guide-dots" aria-hidden="true">
          <text
            v-for="(_image, index) in detail.images"
            :key="`dot-${index}`"
            class="guide-dot"
            :class="{ active: index === 0 }"
          />
        </view>
      </view>
    </view>

    <view v-else class="guide-hero-empty">
      <text v-if="detail.title" class="guide-empty-title">{{ detail.title }}</text>
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

    <view v-if="detail.location" class="guide-section">
      <view class="guide-section-heading">
        <text>线路轨迹</text>
      </view>
      <!-- #ifdef H5 -->
      <view class="guide-map-fallback" @tap="openLocation">
        <text class="guide-map-fallback-title">{{ detail.location.address || '线路轨迹' }}</text>
        <text class="guide-map-fallback-sub">纬度 {{ detail.location.lat }} · 经度 {{ detail.location.lng }}</text>
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
        <view v-if="detail.location.address" class="guide-map-meta">
          <text>{{ detail.location.address }}</text>
        </view>
      </view>
      <!-- #endif -->
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { GuideRouteDetail } from '../utils/guide-detail'

const props = defineProps<{
  detail: GuideRouteDetail
}>()

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

function previewImage(index: number) {
  if (!props.detail.images.length) return
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
    name: loc.address || '线路轨迹',
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
  height: 430rpx;
  overflow: hidden;
  background: $hh-surface-2;
}

.guide-hero-scroll,
.guide-hero-track,
.guide-hero-image {
  width: 100%;
  height: 430rpx;
}

.guide-hero-track {
  display: flex;
  white-space: nowrap;
}

.guide-hero-image {
  flex: 0 0 100%;
  display: block;
}

.guide-hero-mask {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(13, 22, 17, 0.04) 8%, rgba(13, 22, 17, 0.32) 48%, rgba(13, 22, 17, 0.82) 100%);
  pointer-events: none;
}

.guide-hero-copy {
  position: absolute;
  left: 28rpx;
  right: 28rpx;
  bottom: 26rpx;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.guide-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
  margin-bottom: 16rpx;
}

.guide-tag {
  min-height: 46rpx;
  padding: 9rpx 18rpx;
  border: 1rpx solid rgba(255, 255, 255, 0.38);
  border-radius: $hh-radius-full;
  background: rgba(255, 255, 255, 0.18);
  color: rgba(255, 255, 255, 0.96);
  font-size: 24rpx;
  line-height: 1.2;
}

.guide-title {
  color: #fff;
  font-family: $hh-font-serif;
  font-size: 46rpx;
  line-height: 1.16;
  font-weight: $hh-font-weight-bold;
}

.guide-subtitle {
  margin-top: 12rpx;
  color: rgba(255, 255, 255, 0.88);
  font-size: 28rpx;
  line-height: 1.6;
}

.guide-dots {
  display: flex;
  gap: 8rpx;
  margin-top: 18rpx;
}

.guide-dot {
  width: 30rpx;
  height: 6rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.36);
}

.guide-dot.active {
  width: 54rpx;
  background: #fff;
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
