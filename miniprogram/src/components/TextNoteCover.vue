<template>
  <view
    class="text-note-cover-frame"
    :class="[
      `text-note-cover--${normalizedTheme}`,
      {
        'text-note-cover-frame--compact': props.compact,
        'text-note-cover-frame--body': isBodyPage,
      },
    ]"
  >
    <image class="text-note-cover-background" :src="coverBackground" mode="scaleToFill" />
    <view v-if="isBodyPage" class="text-note-body-surface" />
    <view class="text-note-cover-content">
      <text v-if="normalizedTheme !== 'notice' || isBodyPage" class="text-note-cover-kicker">{{ presentation.kicker }}</text>
      <text v-if="presentation.ornament === 'quote' && !isBodyPage" class="text-note-cover-quote">“</text>
      <text class="text-note-cover-title">{{ normalizedTitle }}</text>
      <view class="text-note-cover-rule" />
      <text class="text-note-cover-body" :class="`text-note-cover-body--${bodySize}`">{{ coverBody }}</text>
      <text v-if="isBodyPage" class="text-note-page-footer">HAPPY HOME · 邻里共享</text>
    </view>
    <text v-if="showPageCount" class="text-note-page-count">{{ props.pageNumber }}/{{ props.totalPages }}</text>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  normalizeTextNoteTheme,
  getTextNoteThemePresentation,
  resolveTextNoteBodySize,
  type TextNoteTheme,
} from '../utils/text-note'

const props = defineProps<{
  title: string
  body: string
  theme?: TextNoteTheme | string
  compact?: boolean
  pageKind?: 'cover' | 'body'
  pageNumber?: number
  totalPages?: number
}>()

const normalizedTheme = computed(() => normalizeTextNoteTheme(props.theme))
const presentation = computed(() => getTextNoteThemePresentation(normalizedTheme.value))
const normalizedTitle = computed(() => String(props.title || '').trim())
const isBodyPage = computed(() => props.pageKind === 'body')
const coverBody = computed(() => String(props.body || '').trim())
const bodySize = computed(() => resolveTextNoteBodySize(coverBody.value))
const showPageCount = computed(() => !props.compact && Number(props.totalPages || 0) > 1)

const TEXT_NOTE_COVER_BACKGROUNDS: Record<TextNoteTheme, string> = {
  paper: '/static/text-note-covers/paper.svg',
  mint: '/static/text-note-covers/mint.svg',
  slate: '/static/text-note-covers/slate.svg',
  headline: '/static/text-note-covers/headline.svg',
  quote: '/static/text-note-covers/quote.svg',
  notice: '/static/text-note-covers/notice.svg',
}

const coverBackground = computed(() => TEXT_NOTE_COVER_BACKGROUNDS[normalizedTheme.value])
</script>

<style lang="scss" scoped>
.text-note-cover-frame {
  position: relative;
  aspect-ratio: 4 / 5;
  width: 100%;
  border-radius: 28rpx;
  box-sizing: border-box;
  overflow: hidden;
  background: #f6f0e4;
  color: #302c27;
}

.text-note-cover-background {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.text-note-cover-content {
  position: absolute;
  inset: 0;
  z-index: 1;
  box-sizing: border-box;
  overflow: hidden;
}

.text-note-cover-kicker,
.text-note-cover-title,
.text-note-cover-body,
.text-note-cover-quote {
  position: absolute;
  display: block;
  box-sizing: border-box;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.text-note-cover-kicker {
  font-size: 22rpx;
  font-weight: 700;
  line-height: 36rpx;
}

.text-note-cover-title {
  display: -webkit-box;
  max-height: 2.6em;
  font-weight: 700;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.text-note-cover-rule {
  position: absolute;
  height: 4rpx;
  border-radius: 999rpx;
  background: currentColor;
}

.text-note-cover-body {
  max-height: 7.6em;
  overflow: hidden;
  overflow-wrap: anywhere;
  word-break: break-word;
  white-space: pre-wrap;
}

.text-note-cover--paper { color: #302c27; }
.text-note-cover--paper .text-note-cover-kicker { left: 7.19%; top: 7%; width: 68.75%; }
.text-note-cover--paper .text-note-cover-title { left: 7.19%; top: 16%; width: 85.63%; font-size: 42rpx; line-height: 54rpx; transform: rotate(1deg); }
.text-note-cover--paper .text-note-cover-rule { display: none; }
.text-note-cover--paper .text-note-cover-body { left: 7.19%; top: 37.75%; width: 85.63%; line-height: 58rpx; }
.text-note-cover--paper .text-note-cover-body--large { font-size: 38rpx; }
.text-note-cover--paper .text-note-cover-body--medium { font-size: 32rpx; }
.text-note-cover--paper .text-note-cover-body--small { font-size: 27rpx; }

.text-note-cover--mint { color: #174c39; }
.text-note-cover--mint .text-note-cover-kicker { left: 8.13%; top: 18.5%; width: 83.75%; }
.text-note-cover--mint .text-note-cover-title { left: 8.13%; top: 28%; width: 83.75%; font-size: 44rpx; line-height: 58rpx; }
.text-note-cover--mint .text-note-cover-rule { display: none; }
.text-note-cover--mint .text-note-cover-body { left: 11.88%; top: 56.5%; width: 76.25%; line-height: 50rpx; }
.text-note-cover--mint .text-note-cover-body--large { font-size: 32rpx; }
.text-note-cover--mint .text-note-cover-body--medium { font-size: 28rpx; }
.text-note-cover--mint .text-note-cover-body--small { font-size: 24rpx; }

.text-note-cover--slate { color: #808d68; }
.text-note-cover--slate .text-note-cover-kicker { left: 7.19%; top: 12%; width: 85.63%; letter-spacing: 4rpx; }
.text-note-cover--slate .text-note-cover-title { left: 7.19%; top: 21%; width: 85.63%; font-size: 42rpx; line-height: 56rpx; letter-spacing: 3rpx; }
.text-note-cover--slate .text-note-cover-rule { display: none; }
.text-note-cover--slate .text-note-cover-body { left: 7.19%; top: 42%; width: 85.63%; line-height: 50rpx; }
.text-note-cover--slate .text-note-cover-body--large { font-size: 32rpx; }
.text-note-cover--slate .text-note-cover-body--medium { font-size: 28rpx; }
.text-note-cover--slate .text-note-cover-body--small { font-size: 24rpx; }

.text-note-cover--headline { color: #2f241d; }
.text-note-cover--headline .text-note-cover-kicker { left: 5.94%; top: 7.75%; width: 88.13%; color: rgba(47, 36, 29, 0.3); font-size: 26rpx; line-height: 40rpx; letter-spacing: 6rpx; text-align: center; }
.text-note-cover--headline .text-note-cover-title { left: 5.94%; top: 22%; width: 88.13%; font-size: 48rpx; line-height: 58rpx; text-align: center; }
.text-note-cover--headline .text-note-cover-rule { left: 45%; top: 39.5%; width: 10%; opacity: 0.5; }
.text-note-cover--headline .text-note-cover-body { left: 5.94%; top: 46%; width: 88.13%; line-height: 48rpx; }
.text-note-cover--headline .text-note-cover-body--large { font-size: 30rpx; }
.text-note-cover--headline .text-note-cover-body--medium { font-size: 27rpx; }
.text-note-cover--headline .text-note-cover-body--small { font-size: 24rpx; }

.text-note-cover--quote { color: #839889; text-align: center; }
.text-note-cover--quote .text-note-cover-kicker { left: 9.69%; top: 20%; width: 80.63%; font-weight: 500; text-align: center; }
.text-note-cover--quote .text-note-cover-quote { left: 9.69%; top: 27%; width: 80.63%; height: 116rpx; color: #8e9e99; font-family: Georgia, serif; font-size: 108rpx; line-height: 116rpx; opacity: 0.55; text-align: center; }
.text-note-cover--quote .text-note-cover-title { left: 9.69%; top: 42.5%; width: 80.63%; font-size: 38rpx; line-height: 56rpx; font-weight: 500; text-align: center; }
.text-note-cover--quote .text-note-cover-rule { left: 45%; top: 59%; width: 10%; color: #bfc7c1; }
.text-note-cover--quote .text-note-cover-body { left: 9.69%; top: 65%; width: 80.63%; line-height: 56rpx; text-align: center; }
.text-note-cover--quote .text-note-cover-body--large { font-size: 32rpx; }
.text-note-cover--quote .text-note-cover-body--medium { font-size: 28rpx; }
.text-note-cover--quote .text-note-cover-body--small { font-size: 24rpx; }

.text-note-cover--notice { color: #5b3213; }
.text-note-cover--notice .text-note-cover-title { left: 6.56%; top: 21.5%; width: 86.88%; font-size: 46rpx; line-height: 60rpx; letter-spacing: 3rpx; text-align: center; }
.text-note-cover--notice .text-note-cover-rule { left: 6.56%; top: 41.5%; width: 86.88%; height: 2rpx; border-radius: 0; background: repeating-linear-gradient(to right, rgba(91, 50, 19, 0.45) 0 8rpx, transparent 8rpx 16rpx); }
.text-note-cover--notice .text-note-cover-body { left: 6.56%; top: 47%; width: 86.88%; line-height: 50rpx; }
.text-note-cover--notice .text-note-cover-body--large { font-size: 30rpx; }
.text-note-cover--notice .text-note-cover-body--medium { font-size: 27rpx; }
.text-note-cover--notice .text-note-cover-body--small { font-size: 24rpx; }

.text-note-cover-frame--compact {
  border-radius: 12rpx;
}

.text-note-cover-frame--compact .text-note-cover-kicker {
  padding: 0;
  border-width: 0;
  font-size: 8rpx;
  line-height: 12rpx;
  letter-spacing: 1rpx;
}

.text-note-cover-frame--compact .text-note-cover-title {
  font-size: 13rpx;
  line-height: 16rpx;
}

.text-note-cover-frame--compact .text-note-cover-rule {
  height: 1rpx;
}

.text-note-cover-frame--compact .text-note-cover-body,
.text-note-cover-frame--compact .text-note-cover-body--large,
.text-note-cover-frame--compact .text-note-cover-body--medium,
.text-note-cover-frame--compact .text-note-cover-body--small {
  font-size: 10rpx;
  line-height: 14rpx;
}

.text-note-cover-frame--compact .text-note-cover-quote {
  height: 34rpx;
  font-size: 31rpx;
  line-height: 34rpx;
}

.text-note-body-surface {
  position: absolute;
  inset: 7%;
  z-index: 0;
  border-radius: 24rpx;
  background: rgba(255, 255, 255, 0.56);
  pointer-events: none;
}

.text-note-cover-frame--body.text-note-cover--paper .text-note-body-surface {
  background: rgba(255, 250, 238, 0.56);
}

.text-note-cover-frame--body.text-note-cover--mint .text-note-body-surface {
  background: rgba(255, 255, 255, 0.62);
}

.text-note-cover-frame--body.text-note-cover--slate .text-note-body-surface {
  background: rgba(20, 29, 43, 0.48);
}

.text-note-cover-frame--body.text-note-cover--headline .text-note-body-surface {
  background: rgba(255, 253, 246, 0.7);
}

.text-note-cover-frame--body.text-note-cover--quote .text-note-body-surface {
  background: rgba(255, 255, 255, 0.52);
}

.text-note-cover-frame--body.text-note-cover--notice .text-note-body-surface {
  background: rgba(255, 249, 238, 0.68);
}

.text-note-cover-frame--body .text-note-cover-content {
  display: flex;
  flex-direction: column;
  padding: 72rpx 56rpx 74rpx;
}

.text-note-cover-frame--body .text-note-cover-kicker,
.text-note-cover-frame--body .text-note-cover-title,
.text-note-cover-frame--body .text-note-cover-body {
  position: relative;
  left: auto;
  top: auto;
  width: auto;
  height: auto;
}

.text-note-cover-frame--body .text-note-cover-kicker {
  flex: 0 0 auto;
  padding-right: 92rpx;
  font-size: 21rpx;
  line-height: 32rpx;
  letter-spacing: 3rpx;
  text-align: left;
}

.text-note-cover-frame--body .text-note-cover-title {
  display: -webkit-box;
  max-height: 80rpx;
  margin-top: 18rpx;
  overflow: hidden;
  font-size: 28rpx;
  line-height: 40rpx;
  letter-spacing: 1rpx;
  text-align: left;
  transform: none;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.text-note-cover-frame--body .text-note-cover-rule {
  position: relative;
  left: auto;
  top: auto;
  display: block;
  width: 100%;
  height: 2rpx;
  margin: 28rpx 0 30rpx;
  opacity: 0.28;
}

.text-note-cover-frame--body .text-note-cover-body,
.text-note-cover-frame--body .text-note-cover-body--large,
.text-note-cover-frame--body .text-note-cover-body--medium,
.text-note-cover-frame--body .text-note-cover-body--small {
  position: relative;
  left: auto;
  top: auto;
  width: auto;
  flex: 1 1 auto;
  max-height: 420rpx;
  font-size: 26rpx;
  line-height: 44rpx;
  text-align: left;
  white-space: pre-wrap;
}

.text-note-cover-frame--body.text-note-cover--slate {
  color: #edf2e6;
}

.text-note-cover-frame--body.text-note-cover--quote {
  color: #637a6b;
}

.text-note-page-footer {
  position: absolute;
  left: 56rpx;
  bottom: 36rpx;
  z-index: 1;
  color: currentColor;
  font-size: 17rpx;
  line-height: 26rpx;
  letter-spacing: 2rpx;
  opacity: 0.55;
}

.text-note-page-count {
  position: absolute;
  top: 24rpx;
  right: 24rpx;
  z-index: 3;
  min-width: 62rpx;
  padding: 8rpx 13rpx;
  border-radius: 999rpx;
  background: rgba(27, 31, 29, 0.62);
  color: #fff;
  font-size: 22rpx;
  line-height: 30rpx;
  text-align: center;
  box-sizing: border-box;
}
</style>
