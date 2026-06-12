<template>
  <view v-if="hasContent" class="rich-note-renderer">
    <template v-for="(block, index) in blocks" :key="`${block.type}-${index}`">
      <image
        v-if="block.type === 'image'"
        :src="block.src"
        class="rich-note-image"
        mode="widthFix"
        @tap="previewImage(block.src)"
      />
      <rich-text v-else :nodes="block.html" />
    </template>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import {
  isRichNoteEmpty,
  normalizeRichNoteContent,
  richNoteMarkdownToRenderBlocks,
  type RichNoteRenderBlock,
} from '../../utils/rich-note'
import { clientLog } from '../../utils/client-log'

const props = withDefaults(defineProps<{ value: unknown; allowImages?: boolean }>(), {
  allowImages: true,
})

const content = computed(() => normalizeRichNoteContent(props.value))

const blocks = computed<RichNoteRenderBlock[]>(() =>
  richNoteMarkdownToRenderBlocks(content.value.markdown || '', props.allowImages)
)

const hasContent = computed(() => !isRichNoteEmpty(props.value) && blocks.value.length > 0)

function previewImage(current: string) {
  const urls = blocks.value
    .filter((block): block is { type: 'image'; src: string } => block.type === 'image')
    .map((block) => block.src)
  if (urls.length === 0) return
  uni.previewImage({ current, urls })
}

function logRichNote(stage: string) {
  clientLog('debug', 'richNote.render.' + stage, {
    hasContent: hasContent.value,
    blockCount: blocks.value.length,
    markdownLength: content.value.markdown ? content.value.markdown.length : 0,
  })
}

onMounted(() => {
  logRichNote('mounted')
})

watch(hasContent, () => {
  logRichNote('hasContentChanged')
})
</script>

<style lang="scss" scoped>
.rich-note-renderer {
  display: grid;
  gap: $hh-space-md;
  color: $hh-color-text;
  font-size: $hh-font-body-lg;
  line-height: 1.8;
  word-break: break-word;
}

.rich-note-image {
  width: 100%;
  border-radius: $hh-radius-md;
  background: $hh-color-bg-sub;
}
</style>
