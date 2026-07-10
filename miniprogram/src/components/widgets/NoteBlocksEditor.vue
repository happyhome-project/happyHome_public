<template>
  <view class="note-editor" :class="{ 'note-editor--minimal': minimal }">
    <template v-if="minimal">
      <textarea
        :value="minimalText"
        class="note-simple-textarea"
        auto-height
        :placeholder="placeholder"
        placeholder-class="input-placeholder"
        @input="updateMinimalText(($event as any).detail.value)"
      />

      <view v-if="imageBlocks.length" class="note-simple-images">
        <view
          v-for="block in imageBlocks"
          :key="block.blockId"
          class="note-simple-image-wrap"
        >
          <image
            :src="block.fileID"
            class="note-simple-image"
            mode="aspectFill"
            @tap="previewImage(block.fileID)"
          />
          <view class="note-simple-image-del" @tap="removeBlockById(block.blockId)">×</view>
        </view>
      </view>

      <view v-if="allowImages" class="note-simple-actions">
        <button class="note-image-btn" size="mini" @tap="addImageBlocks">添加图片</button>
      </view>
    </template>

    <template v-else>
      <view class="note-tip">
        <text>可先从微信收藏笔记复制文字，再点“粘贴文字”；图片需保存到相册后手动添加。</text>
      </view>

      <view v-for="(block, index) in blocks" :key="block.blockId" class="note-block">
        <view class="block-toolbar">
          <text class="block-type">{{ block.type === 'image' ? '图片' : '文字' }}</text>
          <view class="block-actions">
            <text class="block-action" :class="{ disabled: index === 0 }" @tap="moveBlock(index, -1)">上移</text>
            <text class="block-action" :class="{ disabled: index === blocks.length - 1 }" @tap="moveBlock(index, 1)">下移</text>
            <text class="block-action danger" @tap="removeBlock(index)">删除</text>
          </view>
        </view>

        <textarea
          v-if="block.type === 'text'"
          :value="block.text"
          class="note-textarea"
          auto-height
          placeholder="输入文字，支持 emoji 表情"
          placeholder-class="input-placeholder"
          @input="updateText(index, ($event as any).detail.value)"
        />

        <image
          v-else
          :src="block.fileID"
          class="note-image"
          mode="widthFix"
          @tap="previewImage(block.fileID)"
        />
      </view>

      <view class="note-actions">
        <button class="note-btn" size="mini" @tap="addTextBlock">添加文字</button>
        <button class="note-btn" size="mini" @tap="pasteTextBlock">粘贴文字</button>
        <button v-if="allowImages" class="note-btn primary" size="mini" @tap="addImageBlocks">添加图片</button>
      </view>
    </template>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'

type NoteTextBlock = { blockId: string; type: 'text'; text: string }
type NoteImageBlock = { blockId: string; type: 'image'; fileID: string }
type NoteBlock = NoteTextBlock | NoteImageBlock

const props = withDefaults(defineProps<{
  modelValue: unknown
  minimal?: boolean
  placeholder?: string
  allowImages?: boolean
}>(), {
  minimal: false,
  placeholder: '请输入',
  allowImages: true,
})
const emit = defineEmits(['update:modelValue'])

const blocks = computed<NoteBlock[]>(() =>
  Array.isArray(props.modelValue)
    ? (props.modelValue as NoteBlock[])
    : []
)
const imageBlocks = computed<NoteImageBlock[]>(() =>
  blocks.value.filter((block): block is NoteImageBlock => block?.type === 'image' && !!block.fileID)
)
const minimalText = computed(() =>
  blocks.value
    .filter((block): block is NoteTextBlock => block?.type === 'text')
    .map((block) => block.text)
    .filter((text) => text !== '')
    .join('\n\n')
)

function newBlockId() {
  return `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function commit(next: NoteBlock[]) {
  emit('update:modelValue', next)
}

function updateMinimalText(text: string) {
  const nextText = String(text || '')
  const images = imageBlocks.value.slice()
  if (!nextText.trim()) {
    commit(images)
    return
  }
  const existing = blocks.value.find((block): block is NoteTextBlock => block.type === 'text')
  const nextBlocks: NoteBlock[] = [{
    blockId: existing?.blockId || newBlockId(),
    type: 'text',
    text: nextText,
  }]
  for (const image of images) nextBlocks.push(image)
  commit(nextBlocks)
}

function addTextBlock(text = '') {
  commit(blocks.value.concat([{ blockId: newBlockId(), type: 'text', text }]))
}

function pasteTextBlock() {
  uni.getClipboardData({
    success: (res: any) => {
      const text = String(res?.data || '').trim()
      if (!text) {
        uni.showToast({ title: '剪贴板没有文字', icon: 'none' })
        return
      }
      addTextBlock(text)
    },
    fail: () => uni.showToast({ title: '读取剪贴板失败', icon: 'none' }),
  })
}

function addImageBlocks() {
  const choose = (typeof uni.chooseMedia === 'function')
    ? uni.chooseMedia
    : (typeof wx !== 'undefined' ? wx.chooseMedia : null)
  if (!choose) {
    uni.showToast({ title: '当前环境不支持选择图片', icon: 'none' })
    return
  }

  choose({
    count: 9,
    mediaType: ['image'],
    sourceType: ['album', 'camera'],
    success: (res: any) => {
      const imageBlocks = (res.tempFiles || [])
        .map((file: any) => String(file?.tempFilePath || ''))
        .filter(Boolean)
        .map((fileID: string) => ({ blockId: newBlockId(), type: 'image' as const, fileID }))
      if (imageBlocks.length > 0) commit(blocks.value.concat(imageBlocks))
    },
  })
}

function removeBlock(index: number) {
  const next = blocks.value.slice()
  next.splice(index, 1)
  commit(next)
}

function removeBlockById(blockId: string) {
  commit(blocks.value.filter((block) => block.blockId !== blockId))
}

function moveBlock(index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= blocks.value.length) return
  const next = blocks.value.slice()
  const removed = next.splice(index, 1)
  const item = removed[0]
  if (!item) return
  next.splice(target, 0, item)
  commit(next)
}

function updateText(index: number, text: string) {
  const next = blocks.value.slice()
  const current = next[index]
  if (!current || current.type !== 'text') return
  next[index] = Object.assign({}, current, { text })
  commit(next)
}

function previewImage(current: string) {
  const urls = blocks.value
    .filter((block): block is NoteImageBlock => block.type === 'image')
    .map((block) => block.fileID)
  if (urls.length === 0) return
  uni.previewImage({ current, urls })
}
</script>

<style lang="scss" scoped>
.note-editor {
  display: grid;
  gap: $hh-space-md;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}
.note-editor--minimal {
  gap: 20rpx;
}
.note-tip {
  padding: $hh-space-sm $hh-space-md;
  border-radius: $hh-radius-sm;
  background: $hh-accent-wash;
  color: $hh-color-text-mute;
  font-size: $hh-font-caption;
  line-height: 1.6;
}
.note-block {
  padding: $hh-space-md;
  border: 1rpx solid $hh-color-divider;
  border-radius: $hh-radius-md;
  background: $hh-surface-1;
}
.block-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: $hh-space-sm;
}
.block-type {
  color: $hh-color-text-mute;
  font-size: $hh-font-caption;
}
.block-actions {
  display: flex;
  gap: $hh-space-sm;
}
.block-action {
  color: $hh-color-info;
  font-size: $hh-font-caption;
}
.block-action.disabled {
  color: $hh-color-text-mute;
}
.block-action.danger {
  color: $hh-color-danger;
}
.note-textarea {
  width: 100%;
  min-height: 120rpx;
  color: $hh-color-text;
  font-size: $hh-font-body;
  line-height: 1.7;
}
.note-image {
  width: 100%;
  border-radius: $hh-radius-md;
  background: $hh-color-bg-sub;
}
.note-actions {
  display: flex;
  flex-wrap: wrap;
  gap: $hh-space-sm;
}
.note-btn {
  margin: 0;
  color: $hh-color-text;
  background: $hh-color-bg-sub;
  border: none;
}
.note-btn.primary {
  color: $hh-color-text-inverse;
  background: $hh-color-primary;
}
.input-placeholder {
  color: $hh-color-text-mute;
}
.note-simple-textarea {
  width: 100%;
  min-height: 220rpx;
  max-width: 100%;
  padding: 0;
  box-sizing: border-box;
  background: transparent;
  color: #181818;
  font-size: 32rpx;
  line-height: 48rpx;
}
.note-simple-images {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  min-width: 0;
}
.note-simple-image-wrap {
  position: relative;
  width: 144rpx;
  height: 144rpx;
  overflow: hidden;
  border-radius: 16rpx;
  background: #f7f7f7;
}
.note-simple-image {
  width: 144rpx;
  height: 144rpx;
}
.note-simple-image-del {
  position: absolute;
  top: 8rpx;
  right: 8rpx;
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.48);
  color: #fff;
  font-size: 28rpx;
  line-height: 36rpx;
  text-align: center;
}
.note-simple-actions {
  display: flex;
  justify-content: flex-start;
}
.note-image-btn {
  height: 56rpx;
  margin: 0;
  padding: 0 24rpx;
  border: 0;
  border-radius: 999rpx;
  background: var(--hh-color-brand-soft);
  color: var(--hh-color-brand-primary);
  font-size: 28rpx;
  line-height: 56rpx;
}
.note-image-btn::after {
  border: 0;
}
</style>
