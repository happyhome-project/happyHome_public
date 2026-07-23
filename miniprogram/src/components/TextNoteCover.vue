<template>
  <view
    class="text-note-cover-frame"
    :class="[
      `text-note-cover--${normalizedTheme}`,
      {
        'text-note-cover-frame--compact': props.compact,
        'text-note-cover-frame--document': props.variant === 'document',
      },
    ]"
  >
    <image class="text-note-cover-background" :src="coverBackground" mode="scaleToFill" />
    <view v-if="props.variant === 'document'" class="text-note-document-surface" />
    <view class="text-note-cover-content">
      <text v-if="normalizedTheme !== 'notice'" class="text-note-cover-kicker">{{ presentation.kicker }}</text>
      <text v-if="presentation.ornament === 'quote'" class="text-note-cover-quote">“</text>
      <text class="text-note-cover-title">{{ normalizedTitle }}</text>
      <view class="text-note-cover-rule" />
      <text class="text-note-cover-body" :class="`text-note-cover-body--${bodySize}`">{{ coverBody }}</text>
      <text v-if="props.variant === 'document'" class="text-note-document-footer">HAPPY HOME · 邻里共享</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  normalizeTextNoteTheme,
  getTextNoteThemePresentation,
  resolveTextNoteDisplayBody,
  resolveTextNoteBodySize,
  type TextNoteDisplayVariant,
  type TextNoteTheme,
} from '../utils/text-note'

const props = defineProps<{
  title: string
  body: string
  theme?: TextNoteTheme | string
  compact?: boolean
  variant?: TextNoteDisplayVariant
}>()

const normalizedTheme = computed(() => normalizeTextNoteTheme(props.theme))
const presentation = computed(() => getTextNoteThemePresentation(normalizedTheme.value))
const normalizedTitle = computed(() => String(props.title || '').trim())
const coverBody = computed(() => resolveTextNoteDisplayBody(props.body, props.variant))
const bodySize = computed(() => resolveTextNoteBodySize(coverBody.value))

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
  max-height: 3.5em;
  overflow: hidden;
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

.text-note-cover-frame--document {
  aspect-ratio: auto;
  min-height: 775rpx;
}

.text-note-cover-frame--document.text-note-cover--paper { background: #f4e4c6; }
.text-note-cover-frame--document.text-note-cover--mint { background: #e7f6ec; }
.text-note-cover-frame--document.text-note-cover--slate { background: #303b4d; }
.text-note-cover-frame--document.text-note-cover--headline { background: #f7f3e9; }
.text-note-cover-frame--document.text-note-cover--quote { background: #f2eff8; }
.text-note-cover-frame--document.text-note-cover--notice { background: #f7e4cb; }

.text-note-cover-frame--document .text-note-cover-background {
  bottom: auto;
  height: 775rpx;
}

.text-note-document-surface {
  position: absolute;
  left: 0;
  top: 220rpx;
  right: 0;
  bottom: 0;
  z-index: 0;
  pointer-events: none;
}

.text-note-cover--paper .text-note-document-surface {
  background: linear-gradient(to bottom, rgba(244, 228, 198, 0.76), #f4e4c6 86rpx);
}

.text-note-cover--mint .text-note-document-surface {
  background: linear-gradient(to bottom, rgba(231, 246, 236, 0.78), #e7f6ec 86rpx);
}

.text-note-cover--slate .text-note-document-surface {
  background: linear-gradient(to bottom, rgba(48, 59, 77, 0.82), #303b4d 86rpx);
}

.text-note-cover--headline .text-note-document-surface {
  background: linear-gradient(to bottom, rgba(247, 243, 233, 0.8), #f7f3e9 86rpx);
}

.text-note-cover--quote .text-note-document-surface {
  background: linear-gradient(to bottom, rgba(242, 239, 248, 0.8), #f2eff8 86rpx);
}

.text-note-cover--notice .text-note-document-surface {
  background: linear-gradient(to bottom, rgba(247, 228, 203, 0.8), #f7e4cb 86rpx);
}

.text-note-cover-frame--document .text-note-cover-content {
  position: relative;
  inset: auto;
  display: flex;
  min-height: 775rpx;
  flex-direction: column;
  padding: 54rpx 44rpx 112rpx;
  overflow: visible;
}

.text-note-cover-frame--document .text-note-cover-kicker,
.text-note-cover-frame--document .text-note-cover-title,
.text-note-cover-frame--document .text-note-cover-body,
.text-note-cover-frame--document .text-note-cover-quote {
  position: relative;
  left: auto;
  top: auto;
  width: auto;
  height: auto;
}

.text-note-cover-frame--document .text-note-cover-title {
  display: block;
  max-height: none;
  margin-top: 34rpx;
  overflow: visible;
  transform: none;
  -webkit-line-clamp: unset;
}

.text-note-cover-frame--document .text-note-cover-rule {
  position: relative;
  left: auto;
  top: auto;
  width: 100%;
  margin: 62rpx 0 46rpx;
}

.text-note-cover-frame--document .text-note-cover-body,
.text-note-cover-frame--document .text-note-cover-body--large,
.text-note-cover-frame--document .text-note-cover-body--medium,
.text-note-cover-frame--document .text-note-cover-body--small {
  position: relative;
  left: auto;
  top: auto;
  width: auto;
  max-height: none;
  overflow: visible;
  font-size: 27rpx;
  line-height: 1.82;
  text-align: left;
  white-space: pre-wrap;
}

.text-note-cover-frame--document.text-note-cover--mint .text-note-cover-title,
.text-note-cover-frame--document.text-note-cover--slate .text-note-cover-title {
  margin-bottom: 82rpx;
}

.text-note-cover-frame--document.text-note-cover--paper .text-note-cover-rule {
  display: block;
  height: 2rpx;
  opacity: 0.22;
}

.text-note-cover-frame--document.text-note-cover--mint .text-note-cover-body {
  padding: 30rpx;
  border-radius: 24rpx;
  background: rgba(255, 255, 255, 0.58);
}

.text-note-cover-frame--document.text-note-cover--quote .text-note-cover-quote {
  margin-top: 26rpx;
  font-size: 88rpx;
  line-height: 96rpx;
}

.text-note-document-footer {
  position: relative;
  z-index: 1;
  display: block;
  margin-top: auto;
  padding-top: 56rpx;
  color: currentColor;
  font-size: 20rpx;
  line-height: 30rpx;
  letter-spacing: 2rpx;
  opacity: 0.58;
}
</style>
