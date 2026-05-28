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
import { computed } from 'vue'
import { isRichNoteEmpty, markdownToHtml, normalizeRichNoteContent } from '../../utils/rich-note'

type RenderBlock =
  | { type: 'html'; html: string }
  | { type: 'image'; src: string }

const props = defineProps<{ value: unknown }>()

const content = computed(() => normalizeRichNoteContent(props.value))
const hasContent = computed(() => !isRichNoteEmpty(props.value))

const blocks = computed<RenderBlock[]>(() => {
  const markdown = content.value.markdown || ''
  const result: RenderBlock[] = []
  const textBuffer: string[] = []
  const flushText = () => {
    const text = textBuffer.join('\n')
    if (text) result.push({ type: 'html', html: markdownToHtml(text) })
    textBuffer.length = 0
  }

  for (const rawLine of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim()
    const image = /^!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)$/.exec(line)
    if (image) {
      flushText()
      result.push({ type: 'image', src: image[1] })
    } else {
      textBuffer.push(rawLine)
    }
  }
  flushText()
  return result
})

function previewImage(current: string) {
  const urls = blocks.value
    .filter((block): block is { type: 'image'; src: string } => block.type === 'image')
    .map((block) => block.src)
  if (urls.length === 0) return
  uni.previewImage({ current, urls })
}
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
