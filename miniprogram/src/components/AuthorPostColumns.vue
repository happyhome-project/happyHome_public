<template>
  <view class="author-post-columns">
    <view v-for="(column, columnIndex) in columns" :key="columnIndex" class="author-post-column">
      <view
        v-for="card in column"
        :key="card.postId"
        class="author-post-card"
        data-testid="author-post-card"
        :data-post-id="card.postId"
        @tap="emit('open', card.postId)"
      >
        <view v-if="card.cover.kind === 'audio'" class="author-post-audio-cover">
          <image
            class="author-post-cover"
            :src="card.cover.src"
            mode="aspectFill"
            @error="fallbackFeedCoverAfterError(card.cover)"
          />
          <view class="author-post-audio-play" aria-hidden="true">
            <wd-icon name="play-circle-filled" size="54rpx" color="#ffffff" />
          </view>
          <view class="author-post-audio-summary">
            <wd-icon name="sound" size="22rpx" color="#ffffff" />
            <text>音频 · {{ card.trackCount }}首 · {{ formatAudioDuration(card.totalDuration) }}</text>
          </view>
        </view>
        <view v-else-if="card.cover.kind === 'video'" class="author-post-video-cover">
          <image
            v-if="card.cover.src"
            class="author-post-cover"
            :src="card.cover.src"
            mode="aspectFill"
          />
          <view v-else class="author-post-video-placeholder video-placeholder"><text>视频</text></view>
          <view class="author-post-video-play video-play"><text>▶</text></view>
        </view>
        <image
          v-else-if="card.cover.kind === 'image'"
          class="author-post-cover"
          :src="card.cover.src"
          mode="widthFix"
        />
        <TextNoteCover
          v-else
          :title="card.title"
          :body="card.bodyText"
          :theme="card.cover.theme as any"
        />
        <view class="author-post-card-main">
          <text class="author-post-card-title">{{ card.title }}</text>
          <text v-if="card.communityLabel" class="author-post-community">{{ card.communityLabel }}</text>
          <view class="author-post-card-meta">
            <text v-if="card.auditStatus !== 'pass'" class="author-post-status">{{ auditLabel(card.auditStatus) }}</text>
            <view class="author-post-metrics">
              <text>♡ {{ card.likeCount }}</text>
              <text>◌ {{ card.commentCount }}</text>
            </view>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import TextNoteCover from './TextNoteCover.vue'
import type { AuthorPostColumns } from '../utils/author-post-feed'
import { formatAudioDuration } from '../utils/audio-display'
import { fallbackFeedCoverAfterError } from '../utils/feed-cover-url'

defineProps<{ columns: AuthorPostColumns }>()
const emit = defineEmits<{ open: [postId: string] }>()

function auditLabel(status: string) {
  if (status === 'rejected') return '未通过'
  if (status === 'review') return '复核中'
  return '审核中'
}
</script>

<style lang="scss" scoped>
.author-post-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: 12rpx;
}
.author-post-column {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}
.author-post-card {
  min-width: 0;
  overflow: hidden;
  border-radius: 12rpx;
  background: #fff;
}
.author-post-cover {
  display: block;
  width: 100%;
  min-height: 230rpx;
  border-radius: 12rpx;
  background: #f2f2f2;
}
.author-post-audio-cover {
  position: relative;
  width: 100%;
  height: 300rpx;
  overflow: hidden;
  border-radius: 12rpx;
  background: #eef5f1;
}
.author-post-audio-cover .author-post-cover { width: 100%; height: 100%; min-height: 0; }
.author-post-audio-play {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  filter: drop-shadow(0 4rpx 12rpx rgba(0, 0, 0, 0.28));
}
.author-post-audio-summary {
  position: absolute;
  right: 10rpx;
  bottom: 10rpx;
  left: 10rpx;
  display: flex;
  align-items: center;
  gap: 7rpx;
  padding: 7rpx 10rpx;
  border-radius: 9rpx;
  background: rgba(22, 43, 34, 0.64);
  color: #fff;
  font-size: 20rpx;
  line-height: 28rpx;
}
.author-post-video-cover {
  position: relative;
  width: 100%;
  height: 300rpx;
  overflow: hidden;
  border-radius: 12rpx;
  background: #171923;
}
.author-post-video-cover .author-post-cover { width: 100%; height: 100%; min-height: 0; }
.author-post-video-placeholder {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  background: linear-gradient(145deg, #272b3d, #11131c);
  color: rgba(255, 255, 255, 0.48);
  font-size: 34rpx;
  letter-spacing: 8rpx;
}
.author-post-video-play {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.author-post-video-play text {
  display: flex;
  width: 68rpx;
  height: 68rpx;
  align-items: center;
  justify-content: center;
  padding-left: 4rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  color: #222;
  font-size: 28rpx;
  box-shadow: 0 4rpx 18rpx rgba(0, 0, 0, 0.2);
}
.author-post-card :deep(.text-note-cover-frame) { border-radius: 12rpx; }
.author-post-card-main { padding: 14rpx 4rpx 0; }
.author-post-card-title {
  display: -webkit-box;
  overflow: hidden;
  color: #1c1c1c;
  font-size: 27rpx;
  font-weight: 600;
  line-height: 38rpx;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.author-post-community {
  display: block;
  overflow: hidden;
  margin-top: 8rpx;
  color: #999;
  font-size: 21rpx;
  line-height: 30rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.author-post-card-meta {
  min-height: 36rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8rpx;
  margin-top: 10rpx;
}
.author-post-status {
  padding: 3rpx 9rpx;
  border-radius: 999rpx;
  color: #a66a00;
  background: #fff5de;
  font-size: 19rpx;
  line-height: 28rpx;
}
.author-post-metrics {
  display: flex;
  gap: 12rpx;
  margin-left: auto;
  color: #777;
  font-size: 21rpx;
}
</style>
