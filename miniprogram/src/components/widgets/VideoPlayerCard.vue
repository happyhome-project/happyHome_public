<template>
  <view class="video-card">
    <view v-if="!playingSrc" class="cover-wrap" @tap="onTapPlay">
      <image
        v-if="coverUrl"
        :src="coverUrl"
        mode="aspectFill"
        class="cover"
      />
      <view v-else class="cover-placeholder">
        <text class="placeholder-text">视频</text>
      </view>
      <view class="play-mask">
        <view class="play-icon">▶</view>
      </view>
      <text v-if="durationLabel" class="duration-tag">{{ durationLabel }}</text>
      <text v-if="sourceTag" class="source-tag">{{ sourceTag }}</text>
    </view>
    <video
      v-else
      :src="playingSrc"
      :controls="true"
      :autoplay="true"
      class="player"
      object-fit="contain"
      :show-fullscreen-btn="true"
    />

    <view class="meta">
      <text class="title">{{ item.title || '未命名视频' }}</text>
      <text v-if="item.description" class="desc">{{ item.description }}</text>
    </view>

    <view v-if="hasActions" class="actions">
      <button
        v-if="canDownload"
        size="mini"
        class="action-btn"
        @tap.stop="onDownload"
      >下载到相册</button>
      <button
        v-if="canShare"
        size="mini"
        class="action-btn"
        @tap.stop="onShare"
      >分享给好友</button>
      <button
        v-if="canOpenExternal"
        size="mini"
        class="action-btn primary"
        @tap.stop="onOpenExternal"
      >{{ externalLabel }}</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  resolvePlayUrl,
  playInline,
  openExternal,
  downloadToAlbum,
  shareToWeChat,
} from '../../utils/video-actions'
import type { VideoItem } from '../../../../cloud/shared/types'

const props = defineProps<{ item: VideoItem }>()

const playingSrc = ref('')
const coverUrl = ref('')

const sourceTag = computed(() => {
  switch (props.item.source) {
    case 'channels_feed': return '视频号'
    case 'channels_live': return '直播'
    case 'miniprogram':   return '小程序'
    case 'h5':            return 'H5'
    case 'app_link':      return 'App'
    default:              return ''
  }
})

const externalLabel = computed(() => {
  switch (props.item.source) {
    case 'channels_feed': return '去视频号看'
    case 'channels_live': return '去看直播'
    case 'miniprogram':   return '打开小程序'
    case 'h5':            return '打开网页'
    case 'app_link':      return '复制链接'
    default:              return '打开'
  }
})

const canDownload = computed(() =>
  props.item.source === 'cos' && (props.item as any).allowDownload !== false
)
const canShare = computed(() =>
  props.item.source === 'cos' && (props.item as any).allowShare !== false
)
const canOpenExternal = computed(() =>
  props.item.source !== 'cos' && props.item.source !== 'h5'
)
const hasActions = computed(() => canDownload.value || canShare.value || canOpenExternal.value)

const durationLabel = computed(() => {
  const s = props.item.duration
  if (!s || !Number.isFinite(s) || s <= 0) return ''
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
})

onMounted(async () => {
  if (props.item.cover) {
    try { coverUrl.value = await resolvePlayUrl(props.item.cover) } catch { /* noop */ }
  }
})

async function onTapPlay() {
  if (props.item.source === 'cos' || props.item.source === 'h5') {
    try {
      await playInline(props.item, { setSrc: (s: string) => (playingSrc.value = s) })
    } catch (err: any) {
      uni.showToast({ title: String(err?.message || '播放失败'), icon: 'none' })
    }
  } else {
    await openExternal(props.item)
  }
}

async function onDownload() {
  await downloadToAlbum(props.item)
}

async function onShare() {
  await shareToWeChat(props.item)
}

async function onOpenExternal() {
  await openExternal(props.item)
}
</script>

<style lang="scss" scoped>
.video-card {
  background: $hh-surface-1;
  border-radius: $hh-radius-md;
  margin: $hh-space-sm 0;
  overflow: hidden;
  box-shadow: 0 1rpx 4rpx rgba(0, 0, 0, 0.06);
}
.cover-wrap {
  position: relative;
  width: 100%;
  height: 0;
  padding-bottom: 56.25%;
  background: #000;
}
.cover, .cover-placeholder {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.cover-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a1a1a;
}
.placeholder-text {
  color: rgba(255, 255, 255, 0.5);
  font-size: 56rpx;
  letter-spacing: 8rpx;
}
.play-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.18);
}
.play-icon {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  color: $hh-accent;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40rpx;
  padding-left: 8rpx;
}
.duration-tag {
  position: absolute;
  right: 16rpx;
  bottom: 16rpx;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  padding: 4rpx 12rpx;
  border-radius: 6rpx;
  font-size: $hh-font-caption;
}
.source-tag {
  position: absolute;
  left: 16rpx;
  top: 16rpx;
  background: rgba(255, 255, 255, 0.92);
  color: $hh-color-text;
  padding: 4rpx 12rpx;
  border-radius: 6rpx;
  font-size: $hh-font-caption;
}
.player {
  width: 100%;
  height: 0;
  padding-bottom: 56.25%;
  background: #000;
}
.meta {
  padding: $hh-space-md;
}
.title {
  display: block;
  font-size: $hh-font-body-lg;
  color: $hh-color-text;
  font-weight: 600;
}
.desc {
  display: block;
  margin-top: $hh-space-xs;
  font-size: $hh-font-caption;
  color: $hh-color-text-mute;
  line-height: 1.5;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: $hh-space-sm;
  padding: 0 $hh-space-md $hh-space-md;
}
.action-btn {
  font-size: $hh-font-caption;
  background: $hh-surface-0;
  color: $hh-color-text;
}
.action-btn.primary {
  background: $hh-accent;
  color: #fff;
}
</style>
