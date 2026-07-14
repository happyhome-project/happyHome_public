<template>
  <view class="text-note-cover-frame" :class="`text-note-cover--${normalizedTheme}`">
    <view class="text-note-cover-decoration" :class="`text-note-cover-decoration--${presentation.ornament}`" />
    <view class="text-note-cover-content">
      <text class="text-note-cover-kicker">{{ presentation.kicker }}</text>
      <text v-if="presentation.ornament === 'quote'" class="text-note-cover-quote">“</text>
      <text class="text-note-cover-title">{{ normalizedTitle }}</text>
      <view class="text-note-cover-rule" />
      <text class="text-note-cover-body" :class="`text-note-cover-body--${bodySize}`">{{ coverBody }}</text>
      <text class="text-note-cover-signature">HAPPY HOME · 邻里共享</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  normalizeTextNoteTheme,
  getTextNoteThemePresentation,
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
const presentation = computed(() => getTextNoteThemePresentation(normalizedTheme.value))
const normalizedTitle = computed(() => String(props.title || '').trim())
const coverBody = computed(() => truncateTextNoteBody(String(props.body || '').trim()))
const bodySize = computed(() => resolveTextNoteBodySize(coverBody.value))
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

.text-note-cover-content {
  position: relative;
  z-index: 1;
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

.text-note-cover-kicker,
.text-note-cover-signature {
  display: block;
  flex: 0 0 auto;
}

.text-note-cover-kicker {
  margin-bottom: 30rpx;
  font-size: 22rpx;
  font-weight: 700;
  letter-spacing: 4rpx;
}

.text-note-cover-signature {
  margin-top: auto;
  padding-top: 24rpx;
  font-size: 17rpx;
  letter-spacing: 2rpx;
  opacity: 0.58;
}

.text-note-cover-decoration {
  position: absolute;
  pointer-events: none;
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
.text-note-cover--paper .text-note-cover-content { justify-content: flex-start; padding-top: 70rpx; }
.text-note-cover--paper .text-note-cover-title { font-family: $hh-font-serif; transform: rotate(-1deg); }
.text-note-cover--paper .text-note-cover-rule { width: 100%; height: 2rpx; opacity: 0.22; }

.text-note-cover--mint { background: linear-gradient(150deg, #e8f8ef 0%, #ccebdc 100%); color: #174c39; }
.text-note-cover--mint .text-note-cover-content { justify-content: center; padding: 62rpx 52rpx; }
.text-note-cover--mint .text-note-cover-title { font-size: 42rpx; letter-spacing: 1rpx; }
.text-note-cover--mint .text-note-cover-body { padding: 22rpx 24rpx; border-radius: 24rpx; background: rgba(255, 255, 255, 0.5); }

.text-note-cover--slate { background: radial-gradient(circle at 80% 12%, #53647a 0, #273241 38%); color: #f5f7fa; }
.text-note-cover--slate .text-note-cover-content { justify-content: flex-end; padding-bottom: 58rpx; }
.text-note-cover--slate .text-note-cover-title { text-transform: uppercase; letter-spacing: 3rpx; }
.text-note-cover--slate .text-note-cover-rule { width: 120rpx; opacity: 0.9; }

.text-note-cover--headline { background: #fff8e8; color: #2f241d; border: 3rpx solid #7a301d; }
.text-note-cover--headline .text-note-cover-content { justify-content: flex-start; padding: 42rpx 38rpx; }
.text-note-cover--headline .text-note-cover-kicker { padding-bottom: 16rpx; border-bottom: 5rpx double currentColor; text-align: center; font-family: $hh-font-serif; }
.text-note-cover--headline .text-note-cover-title { margin-top: 20rpx; font-family: $hh-font-serif; font-size: 48rpx; line-height: 1.12; text-align: center; }
.text-note-cover--headline .text-note-cover-body { columns: 1; text-align: justify; }

.text-note-cover--quote { background: linear-gradient(145deg, #f3eff9, #dfd4ef); color: #4d3768; }
.text-note-cover--quote .text-note-cover-content { justify-content: center; padding-left: 62rpx; padding-right: 62rpx; text-align: center; }
.text-note-cover--quote .text-note-cover-title { font-family: $hh-font-serif; font-size: 36rpx; font-weight: 600; }
.text-note-cover--quote .text-note-cover-body { font-family: $hh-font-serif; line-height: 1.75; }

.text-note-cover--notice { background: #fff5d6; color: #5b3213; border: 4rpx solid #d7902d; }
.text-note-cover--notice .text-note-cover-content { justify-content: flex-start; padding: 44rpx 42rpx; }
.text-note-cover--notice .text-note-cover-kicker { align-self: stretch; margin-bottom: 34rpx; padding: 12rpx 18rpx; background: #c85a2a; color: #fffdf5; text-align: center; }
.text-note-cover--notice .text-note-cover-title { font-size: 46rpx; text-align: center; letter-spacing: 3rpx; }
.text-note-cover--notice .text-note-cover-body { padding-top: 24rpx; border-top: 2rpx dashed rgba(91, 50, 19, 0.45); }

.text-note-cover-quote {
  height: 64rpx;
  font-size: 96rpx;
  line-height: 1;
  font-family: Georgia, serif;
  opacity: 0.55;
}

.text-note-cover-decoration--pin { top: 30rpx; right: 46rpx; width: 18rpx; height: 18rpx; border-radius: 999rpx; background: #cf7656; box-shadow: 0 5rpx 12rpx rgba(79, 47, 34, 0.24); }
.text-note-cover-decoration--leaf { top: -48rpx; right: -34rpx; width: 180rpx; height: 180rpx; border-radius: 80% 0 80% 0; background: rgba(60, 151, 109, 0.16); transform: rotate(18deg); }
.text-note-cover-decoration--stars { top: 48rpx; right: 48rpx; width: 10rpx; height: 10rpx; border-radius: 50%; background: #fff; box-shadow: -52rpx 36rpx 0 rgba(255,255,255,.7), 28rpx 66rpx 0 rgba(255,255,255,.45); }
.text-note-cover-decoration--rule { left: 38rpx; right: 38rpx; bottom: 38rpx; height: 6rpx; border-top: 2rpx solid currentColor; border-bottom: 2rpx solid currentColor; opacity: .35; }
.text-note-cover-decoration--quote { left: 26rpx; top: 72rpx; width: 120rpx; height: 120rpx; border-radius: 50%; background: rgba(109, 79, 139, .1); }
.text-note-cover-decoration--stamp { right: 30rpx; bottom: 34rpx; width: 90rpx; height: 90rpx; border: 5rpx double rgba(171, 70, 34, .3); border-radius: 50%; transform: rotate(-12deg); }
</style>
