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

    <view v-if="!isBodyPage" class="text-note-cover-content">
      <text class="text-note-cover-kicker">{{ presentation.kicker }}</text>
      <text v-if="normalizedTheme === 'paper'" class="text-note-cover-quote">“</text>
      <view class="text-note-cover-rule" />
      <text class="text-note-cover-title">{{ normalizedTitle }}</text>
      <text class="text-note-cover-signature">HAPPY HOME</text>
    </view>

    <text v-else class="text-note-cover-body">{{ coverBody }}</text>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  getTextNoteThemePresentation,
  normalizeTextNoteTheme,
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
const coverBody = computed(() => String(props.body || ''))

const TEXT_NOTE_COVER_BACKGROUNDS: Record<TextNoteTheme, string> = {
  paper: '/static/text-note-covers/0723/paper.jpg',
  mint: '/static/text-note-covers/0723/mint.jpg',
  slate: '/static/text-note-covers/0723/slate.jpg',
  headline: '/static/text-note-covers/0723/headline.jpg',
  quote: '/static/text-note-covers/0723/quote.jpg',
  notice: '/static/text-note-covers/0723/notice.jpg',
}

const coverBackground = computed(() => TEXT_NOTE_COVER_BACKGROUNDS[normalizedTheme.value])
</script>

<style lang="scss" scoped>
.text-note-cover-frame {
  position: relative;
  aspect-ratio: 370 / 498;
  width: 100%;
  overflow: hidden;
  border-radius: 24rpx;
  box-sizing: border-box;
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
  overflow: hidden;
  box-sizing: border-box;
}

.text-note-cover-kicker,
.text-note-cover-title,
.text-note-cover-quote,
.text-note-cover-signature,
.text-note-cover-body {
  position: absolute;
  display: block;
  box-sizing: border-box;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.text-note-cover-kicker {
  font-size: 22rpx;
  font-weight: 500;
  line-height: 36rpx;
}

.text-note-cover-title {
  display: -webkit-box;
  overflow: hidden;
  font-size: 48rpx;
  font-weight: 600;
  line-height: 54rpx;
  text-align: center;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.text-note-cover-rule {
  position: absolute;
  height: 4rpx;
  background: currentColor;
}

.text-note-cover-signature {
  font-size: 18rpx;
  font-weight: 400;
  line-height: 28rpx;
  letter-spacing: 1rpx;
  opacity: 0.56;
}

.text-note-cover--paper {
  color: #302c27;
}

.text-note-cover--paper .text-note-cover-kicker {
  left: 8.378%;
  top: 7.028%;
}

.text-note-cover--paper .text-note-cover-quote {
  left: 9.73%;
  top: 33.735%;
  color: rgba(65, 55, 44, 0.32);
  font-family: Georgia, serif;
  font-size: 108rpx;
  line-height: 108rpx;
}

.text-note-cover--paper .text-note-cover-title {
  left: 7.567%;
  top: 46.185%;
  width: 84.324%;
  transform: translateY(-50%);
}

.text-note-cover--paper .text-note-cover-rule {
  display: none;
}

.text-note-cover--paper .text-note-cover-signature {
  left: 8.108%;
  top: 88.353%;
}

.text-note-cover--mint {
  color: #174c39;
}

.text-note-cover--mint .text-note-cover-kicker {
  left: 8.378%;
  top: 26.104%;
}

.text-note-cover--mint .text-note-cover-rule {
  left: 8.378%;
  top: 33.333%;
  width: 8.649%;
  height: 4rpx;
  border-radius: 999rpx;
  opacity: 0.46;
}

.text-note-cover--mint .text-note-cover-title {
  left: 7.567%;
  top: 51.606%;
  width: 84.324%;
  transform: translateY(-50%);
}

.text-note-cover--mint .text-note-cover-signature {
  left: 7.027%;
  top: 88.353%;
}

.text-note-cover--slate {
  color: #808d68;
}

.text-note-cover--slate .text-note-cover-kicker {
  left: 6.216%;
  top: 11.647%;
  letter-spacing: 4rpx;
}

.text-note-cover--slate .text-note-cover-title {
  left: 6.216%;
  top: 47.189%;
  width: 87.568%;
  transform: translateY(-50%);
  letter-spacing: 3rpx;
  text-align: left;
}

.text-note-cover--slate .text-note-cover-rule {
  left: 6.216%;
  top: 55.02%;
  width: 16.216%;
  height: 4rpx;
  opacity: 0.5;
}

.text-note-cover--slate .text-note-cover-signature {
  left: 6.216%;
  top: 88.353%;
}

.text-note-cover--headline {
  color: #2f241d;
}

.text-note-cover--headline .text-note-cover-kicker {
  left: 5.676%;
  top: 19.478%;
  width: 88.649%;
  font-size: 26rpx;
  line-height: 40rpx;
  letter-spacing: 6rpx;
  text-align: center;
}

.text-note-cover--headline .text-note-cover-title {
  left: 5.676%;
  top: 47.189%;
  width: 88.649%;
  transform: translateY(-50%);
}

.text-note-cover--headline .text-note-cover-rule {
  left: 43.243%;
  top: 55.823%;
  width: 13.514%;
  height: 2rpx;
  opacity: 0.5;
}

.text-note-cover--headline .text-note-cover-signature {
  left: 5.135%;
  top: 89.96%;
}

.text-note-cover--quote {
  color: #839889;
}

.text-note-cover--quote .text-note-cover-kicker {
  left: 5.676%;
  top: 19.88%;
  width: 88.649%;
  font-size: 26rpx;
  line-height: 40rpx;
  letter-spacing: 6rpx;
  text-align: center;
}

.text-note-cover--quote .text-note-cover-title {
  left: 7.567%;
  top: 47.39%;
  width: 84.324%;
  transform: translateY(-50%);
  font-weight: 500;
}

.text-note-cover--quote .text-note-cover-rule {
  display: none;
}

.text-note-cover--quote .text-note-cover-signature {
  left: 43.243%;
  top: 89.96%;
  transform: translateX(-50%);
}

.text-note-cover--notice {
  color: #5b3213;
}

.text-note-cover--notice .text-note-cover-kicker {
  left: 5.676%;
  top: 19.478%;
  width: 88.649%;
  font-size: 26rpx;
  line-height: 40rpx;
  letter-spacing: 6rpx;
  text-align: center;
}

.text-note-cover--notice .text-note-cover-rule {
  left: 5.676%;
  top: 33.333%;
  width: 88.108%;
  height: 2rpx;
  background: repeating-linear-gradient(to right, rgba(91, 50, 19, 0.42) 0 8rpx, transparent 8rpx 16rpx);
}

.text-note-cover--notice .text-note-cover-title {
  left: 5.676%;
  top: 47.189%;
  width: 88.649%;
  transform: translateY(-50%);
}

.text-note-cover--notice .text-note-cover-signature {
  left: 5.676%;
  top: 89.96%;
}

.text-note-cover-frame--body .text-note-cover-body {
  left: 7.567%;
  top: 9.839%;
  z-index: 1;
  width: 84.324%;
  max-height: 72.289%;
  overflow: hidden;
  color: currentColor;
  font-size: 30rpx;
  font-weight: 400;
  line-height: 44rpx;
  text-align: left;
  white-space: pre-wrap;
}

.text-note-cover-frame--body.text-note-cover--paper,
.text-note-cover-frame--body.text-note-cover--headline {
  color: #34291f;
}

.text-note-cover-frame--body.text-note-cover--mint {
  color: #174c39;
}

.text-note-cover-frame--body.text-note-cover--slate {
  color: #edf2e6;
}

.text-note-cover-frame--body.text-note-cover--quote {
  color: #637a6b;
}

.text-note-cover-frame--body.text-note-cover--notice {
  color: #5b3213;
}

.text-note-cover-frame--compact {
  border-radius: 12rpx;
}

.text-note-cover-frame--compact .text-note-cover-kicker {
  font-size: 8rpx;
  line-height: 12rpx;
  letter-spacing: 1rpx;
}

.text-note-cover-frame--compact .text-note-cover-title {
  font-size: 13rpx;
  line-height: 16rpx;
  letter-spacing: 0;
}

.text-note-cover-frame--compact .text-note-cover-rule {
  height: 1rpx;
}

.text-note-cover-frame--compact .text-note-cover-quote {
  font-size: 31rpx;
  line-height: 31rpx;
}

.text-note-cover-frame--compact .text-note-cover-signature {
  font-size: 5rpx;
  line-height: 8rpx;
  letter-spacing: 0;
}
</style>
