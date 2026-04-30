<template>
  <view v-if="audioStore.isVisible" class="floating-player-root">
    <movable-area
      v-if="!expanded"
      class="float-area"
      :style="{ height: areaHeight + 'px', width: areaWidth + 'px' }"
    >
      <movable-view
        class="float-view"
        :x="audioStore.floatPosition.x"
        :y="audioStore.floatPosition.y"
        direction="all"
        :damping="40"
        :friction="2"
        @change="onMove"
        @tap="expanded = true"
      >
        <view class="card" :class="{ playing: audioStore.isPlaying }">
          <view class="title-line">{{ audioStore.currentTrack?.title || '音频' }}</view>
          <view class="ctrl-row">
            <view class="play-btn" @tap.stop="onTogglePlay">
              <text class="icon">{{ audioStore.isPlaying ? 'Ⅱ' : '▶' }}</text>
            </view>
            <view class="close-btn" @tap.stop="onClose">×</view>
          </view>
        </view>
      </movable-view>
    </movable-area>

    <view v-if="expanded" class="modal-mask" @tap="expanded = false">
      <view class="modal-panel" @tap.stop>
        <view class="grab-handle" />
        <view v-if="audioStore.currentMeta?.postId" class="post-link" @tap="goToPost">
          回到帖子：{{ audioStore.currentMeta.postTitle || '查看' }} →
        </view>
        <view class="track-title">{{ audioStore.currentTrack?.title || '音频' }}</view>
        <view class="track-index">{{ audioStore.currentIndex + 1 }} / {{ audioStore.currentPlaylist.length }}</view>
        <view class="progress-row">
          <text class="time">{{ formatTime(audioStore.currentTime) }}</text>
          <slider
            class="progress-slider"
            :min="0"
            :max="trackDurationSeconds"
            :value="Math.round(audioStore.currentTime)"
            block-size="20"
            activeColor="#3A6A45"
            backgroundColor="#E3DFDA"
            @change="onSeekEnd"
          />
          <text class="time">{{ formatTime(trackDurationSeconds) }}</text>
        </view>
        <view class="ctrl-large">
          <view class="ctrl-btn" :class="{ disabled: !audioStore.canPrev }" @tap="onPrev">
            <text class="ctrl-icon">‹‹</text>
          </view>
          <view class="ctrl-btn primary" @tap="onTogglePlay">
            <text class="ctrl-icon-large">{{ audioStore.isPlaying ? 'Ⅱ' : '▶' }}</text>
          </view>
          <view class="ctrl-btn" :class="{ disabled: !audioStore.canNext }" @tap="onNext">
            <text class="ctrl-icon">››</text>
          </view>
        </view>
        <view class="modal-actions">
          <view class="text-btn close-action" @tap="onClose">关闭播放器</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAudioStore } from '../../store/audio'

const audioStore = useAudioStore()
const expanded = ref(false)
const areaWidth = ref(375)
const areaHeight = ref(667)

onMounted(() => {
  audioStore.loadPositionFromStorage()
  try {
    const sys = uni.getSystemInfoSync()
    areaWidth.value = sys.windowWidth || 375
    areaHeight.value = sys.windowHeight || 667
  } catch {}
})

const trackDurationSeconds = computed(() => {
  const duration = audioStore.currentTrack?.duration ?? 0
  return duration > 0 ? Math.round(duration) : 1
})

function onMove(event: any) {
  const detail = event?.detail
  if (!detail) return
  audioStore.setFloatPosition(Math.round(Number(detail.x || 0)), Math.round(Number(detail.y || 0)))
}

function onTogglePlay() {
  void audioStore.togglePlay()
}

function onPrev() {
  if (audioStore.canPrev) void audioStore.prev()
}

function onNext() {
  if (audioStore.canNext) void audioStore.next()
}

function onSeekEnd(event: any) {
  audioStore.seek(Number(event?.detail?.value || 0))
}

function onClose() {
  expanded.value = false
  audioStore.close()
}

function goToPost() {
  const postId = audioStore.currentMeta?.postId
  if (!postId) return
  expanded.value = false
  uni.navigateTo({ url: `/pages/detail/index?postId=${postId}` })
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  const minutes = Math.floor(total / 60)
  const sec = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}
</script>

<style lang="scss" scoped>
.floating-player-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 998;
}

.float-area {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.float-view {
  width: 240rpx;
  height: 200rpx;
  pointer-events: auto;
}

.card {
  width: 100%;
  height: 100%;
  background: $hh-surface-1;
  border: 1rpx solid $hh-accent-line;
  border-radius: $hh-radius-lg;
  box-shadow: $hh-shadow-fab;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 16rpx 18rpx;
  box-sizing: border-box;
  font-family: $hh-font-sans;
}

.card.playing {
  border-color: $hh-accent;
}

.title-line {
  font-size: $hh-font-caption;
  font-weight: $hh-font-weight-medium;
  color: $hh-accent-ink;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
}

.ctrl-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.play-btn {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  background: $hh-accent;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon {
  color: $hh-surface-1;
  font-size: 24rpx;
  font-weight: $hh-font-weight-bold;
}

.close-btn {
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  background: $hh-surface-2;
  color: $hh-color-text-sub;
  font-size: 30rpx;
  line-height: 36rpx;
  text-align: center;
}

.modal-mask {
  position: fixed;
  inset: 0;
  background: $hh-color-mask;
  z-index: 999;
  pointer-events: auto;
  display: flex;
  align-items: flex-end;
}

.modal-panel {
  width: 100%;
  background: $hh-surface-1;
  border-top-left-radius: $hh-radius-xl;
  border-top-right-radius: $hh-radius-xl;
  padding: 24rpx 32rpx 48rpx;
  box-sizing: border-box;
  font-family: $hh-font-sans;
  box-shadow: $hh-shadow-modal;
}

.grab-handle {
  width: 60rpx;
  height: 6rpx;
  background: $hh-surface-3;
  border-radius: 6rpx;
  margin: 0 auto 16rpx;
}

.post-link {
  font-size: $hh-font-caption;
  color: $hh-accent-ink;
  text-align: center;
  margin-bottom: 16rpx;
}

.track-title {
  font-family: $hh-font-serif;
  font-size: $hh-font-h2;
  font-weight: $hh-font-weight-bold;
  color: $hh-color-text;
  text-align: center;
  margin-bottom: 8rpx;
}

.track-index {
  font-size: $hh-font-caption;
  color: $hh-color-text-mute;
  text-align: center;
  margin-bottom: 32rpx;
}

.progress-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-bottom: 32rpx;
}

.time {
  font-family: $hh-font-num;
  font-size: $hh-font-caption;
  color: $hh-color-text-sub;
  min-width: 80rpx;
  text-align: center;
}

.progress-slider {
  flex: 1;
  margin: 0;
}

.ctrl-large {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 56rpx;
  margin-bottom: 32rpx;
}

.ctrl-btn {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  background: $hh-surface-2;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ctrl-btn.primary {
  width: 120rpx;
  height: 120rpx;
  background: $hh-accent;
}

.ctrl-btn.disabled {
  opacity: 0.4;
}

.ctrl-icon {
  font-size: 32rpx;
  color: $hh-color-text;
}

.ctrl-icon-large {
  font-size: 44rpx;
  color: $hh-surface-1;
  font-weight: $hh-font-weight-bold;
}

.modal-actions {
  display: flex;
  justify-content: center;
}

.text-btn {
  font-size: $hh-font-body;
  color: $hh-color-text-sub;
  padding: 12rpx 24rpx;
}

.close-action {
  color: $hh-accent-ochre;
}
</style>
