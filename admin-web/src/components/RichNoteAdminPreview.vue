<template>
  <div class="rich-note-admin-preview">
    <template v-for="(block, index) in blocks" :key="`${block.type}-${index}`">
      <el-image
        v-if="block.type === 'image'"
        :src="resolvedUrl(block.src)"
        class="rich-note-image"
        fit="contain"
        :preview-src-list="[resolvedUrl(block.src)]"
        preview-teleported
      />
      <div v-else class="rich-note-html" v-html="block.html" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { mediaApi } from '../api/cloud'
import { markdownToHtml, normalizeRichNoteContent } from '../utils/rich-note'

type RenderBlock =
  | { type: 'html'; html: string }
  | { type: 'image'; src: string }

const props = defineProps<{ value: unknown }>()
const urlMap = ref<Record<string, string>>({})

const content = computed(() => normalizeRichNoteContent(props.value))

const blocks = computed<RenderBlock[]>(() => {
  const result: RenderBlock[] = []
  const buffer: string[] = []
  const flushText = () => {
    const text = buffer.join('\n').trim()
    if (text) result.push({ type: 'html', html: markdownToHtml(text) })
    buffer.length = 0
  }
  for (const rawLine of content.value.markdown.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim()
    const image = /^!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)$/.exec(line)
    if (image) {
      flushText()
      result.push({ type: 'image', src: image[1] })
    } else {
      buffer.push(rawLine)
    }
  }
  flushText()
  return result
})

watch(
  () => blocks.value.map((block) => block.type === 'image' ? block.src : '').filter(Boolean),
  async (fileIDs) => {
    const cloudIDs = Array.from(new Set(fileIDs.filter((fileID) => fileID.startsWith('cloud://'))))
    if (cloudIDs.length === 0) return
    const res = await mediaApi.getUrls(cloudIDs).catch(() => ({ urls: {} }))
    urlMap.value = { ...urlMap.value, ...(res.urls || {}) }
  },
  { immediate: true },
)

function resolvedUrl(src: string) {
  return urlMap.value[src] || src
}
</script>

<style scoped>
.rich-note-admin-preview {
  display: grid;
  gap: 12px;
  line-height: 1.8;
}

.rich-note-html :deep(p) {
  margin: 0 0 8px;
}

.rich-note-image {
  max-width: 360px;
  border-radius: 8px;
  background: #f5f7fa;
}
</style>
