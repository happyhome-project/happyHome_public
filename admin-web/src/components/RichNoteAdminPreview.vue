<template>
  <div class="rich-note-admin-preview">
    <template v-for="(block, index) in blocks" :key="`${block.type}-${index}`">
      <el-image
        v-if="block.type === 'image' && canRenderImage(block.src)"
        :src="resolvedUrl(block.src)"
        class="rich-note-image"
        fit="contain"
        :preview-src-list="[resolvedUrl(block.src)]"
        preview-teleported
      />
      <div v-else-if="block.type === 'image'" class="rich-note-image-placeholder">
        图片加载中...
      </div>
      <div v-else class="rich-note-html" v-html="block.html" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { mediaApi } from '../api/cloud'
import {
  normalizeRichNoteContent,
  richNoteMarkdownToRenderBlocks,
  type RichNoteRenderBlock,
} from '../utils/rich-note'

const props = withDefaults(defineProps<{ value: unknown; allowImages?: boolean }>(), {
  allowImages: true,
})
const urlMap = ref<Record<string, string>>({})

const content = computed(() => normalizeRichNoteContent(props.value))

const blocks = computed<RichNoteRenderBlock[]>(() =>
  richNoteMarkdownToRenderBlocks(content.value.markdown, props.allowImages)
)

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

function canRenderImage(src: string) {
  return !src.startsWith('cloud://') || Boolean(urlMap.value[src])
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

.rich-note-image-placeholder {
  width: 240px;
  padding: 24px;
  border: 1px dashed #dcdfe6;
  border-radius: 8px;
  background: #f5f7fa;
  color: #909399;
  text-align: center;
}
</style>
