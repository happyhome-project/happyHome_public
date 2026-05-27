<template>
  <view class="note-editor">
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
      <button class="note-btn primary" size="mini" @tap="addImageBlocks">添加图片</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'

type NoteTextBlock = { blockId: string; type: 'text'; text: string }
type NoteImageBlock = { blockId: string; type: 'image'; fileID: string }
type NoteBlock = NoteTextBlock | NoteImageBlock

const props = defineProps<{ modelValue: unknown }>()
const emit = defineEmits(['update:modelValue'])

const blocks = computed<NoteBlock[]>(() =>
  Array.isArray(props.modelValue)
    ? (props.modelValue as NoteBlock[])
    : []
)

function newBlockId() {
  return `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function commit(next: NoteBlock[]) {
  emit('update:modelValue', next)
}

function addTextBlock(text = '') {
  commit([...blocks.value, { blockId: newBlockId(), type: 'text', text }])
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
      if (imageBlocks.length > 0) commit([...blocks.value, ...imageBlocks])
    },
  })
}

function removeBlock(index: number) {
  const next = [...blocks.value]
  next.splice(index, 1)
  commit(next)
}

function moveBlock(index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= blocks.value.length) return
  const next = [...blocks.value]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  commit(next)
}

function updateText(index: number, text: string) {
  const next = [...blocks.value]
  const current = next[index]
  if (!current || current.type !== 'text') return
  next[index] = { ...current, text }
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
</style>
