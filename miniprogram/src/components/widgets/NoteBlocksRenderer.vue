<template>
  <view class="note-renderer">
    <template v-for="block in displayBlocks" :key="block.blockId">
      <text v-if="block.type === 'text'" class="note-text">{{ block.text }}</text>
      <image
        v-else
        :src="block.fileID"
        class="note-image"
        mode="widthFix"
        @tap="previewImage(block.fileID)"
      />
    </template>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'

type NoteTextBlock = { blockId: string; type: 'text'; text: string }
type NoteImageBlock = { blockId: string; type: 'image'; fileID: string }
type NoteBlock = NoteTextBlock | NoteImageBlock

const props = defineProps<{ blocks: unknown }>()

const displayBlocks = computed<NoteBlock[]>(() =>
  Array.isArray(props.blocks)
    ? (props.blocks as NoteBlock[]).filter((block) =>
        block &&
        typeof block === 'object' &&
        typeof block.blockId === 'string' &&
        (
          (block.type === 'text' && typeof block.text === 'string' && block.text !== '') ||
          (block.type === 'image' && typeof block.fileID === 'string' && block.fileID !== '')
        )
      )
    : []
)

function previewImage(current: string) {
  const urls = displayBlocks.value
    .filter((block): block is NoteImageBlock => block.type === 'image')
    .map((block) => block.fileID)
  if (urls.length === 0) return
  uni.previewImage({ current, urls })
}
</script>

<style lang="scss" scoped>
.note-renderer {
  display: grid;
  gap: $hh-space-md;
}
.note-text {
  color: $hh-color-text;
  font-size: $hh-font-body-lg;
  line-height: 1.8;
  white-space: pre-wrap;
}
.note-image {
  width: 100%;
  border-radius: $hh-radius-md;
  background: $hh-color-bg-sub;
}
</style>
