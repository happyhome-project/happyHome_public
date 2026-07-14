<template>
  <view class="text-note-cover-frame" :class="`text-note-cover--${normalizedTheme}`">
    <view class="text-note-cover-content">
      <text v-if="normalizedTheme === 'notice'" class="text-note-cover-label">通知公告</text>
      <text v-if="normalizedTheme === 'quote'" class="text-note-cover-quote">“</text>
      <text class="text-note-cover-title">{{ normalizedTitle }}</text>
      <view class="text-note-cover-rule" />
      <text class="text-note-cover-body" :class="`text-note-cover-body--${bodySize}`">{{ coverBody }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  normalizeTextNoteTheme,
  resolveTextNoteBodySize,
  truncateTextNoteBody,
  type TextNoteTheme,
} from '../utils/text-note'

const props = defineProps<{
  title: string
  body: string
  theme?: TextNoteTheme | string
}>()

const normalizedTheme = computed(() => normalizeTextNoteTheme(props.theme))
const normalizedTitle = computed(() => String(props.title || '').trim())
const coverBody = computed(() => truncateTextNoteBody(String(props.body || '').trim()))
const bodySize = computed(() => resolveTextNoteBodySize(coverBody.value))
</script>

<style lang="scss" scoped>
.text-note-cover-frame {
  aspect-ratio: 4 / 5;
  width: 100%;
  border-radius: 28rpx;
  box-sizing: border-box;
  overflow: hidden;
  background: #f6f0e4;
  color: #302c27;
}

.text-note-cover-content {
  min-width: 0;
  height: 100%;
  padding: 56rpx 46rpx;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  overflow: hidden;
  min-height: 0;
}

.text-note-cover-title,
.text-note-cover-body {
  display: block;
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.text-note-cover-title {
  display: -webkit-box;
  flex: 0 0 auto;
  max-height: 2.48em;
  font-size: 40rpx;
  line-height: 1.24;
  font-weight: 700;
  margin-bottom: 24rpx;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.text-note-cover-rule {
  width: 64rpx;
  height: 4rpx;
  flex: 0 0 auto;
  margin-bottom: 28rpx;
  border-radius: 999rpx;
  background: currentColor;
  opacity: 0.5;
}

.text-note-cover-body {
  flex: 0 1 auto;
  min-height: 0;
  line-height: 1.55;
  overflow: hidden;
}
.text-note-cover-body--large { font-size: 38rpx; }
.text-note-cover-body--medium { font-size: 32rpx; }
.text-note-cover-body--small { font-size: 27rpx; }

.text-note-cover--paper { background: #f6f0e4; color: #302c27; }
.text-note-cover--mint { background: #dff3e8; color: #174c39; }
.text-note-cover--slate { background: #273241; color: #f5f7fa; }
.text-note-cover--headline { background: #fff1d8; color: #7a301d; }
.text-note-cover--headline .text-note-cover-title { font-size: 48rpx; }
.text-note-cover--quote { background: #eee8f8; color: #4d3768; }
.text-note-cover--notice { background: #fff4cf; color: #6e3d0d; }

.text-note-cover-quote {
  height: 64rpx;
  font-size: 96rpx;
  line-height: 1;
  font-family: Georgia, serif;
  opacity: 0.55;
}

.text-note-cover-label {
  align-self: flex-start;
  margin-bottom: 24rpx;
  padding: 8rpx 18rpx;
  border: 2rpx solid currentColor;
  border-radius: 999rpx;
  font-size: 22rpx;
  font-weight: 700;
  letter-spacing: 3rpx;
}
</style>
