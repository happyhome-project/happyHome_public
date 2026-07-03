<template>
  <view class="rich-note-editor" :class="{ 'rich-note-editor--minimal': minimal }">
    <view v-if="!minimal" class="rich-note-toolbar">
      <button class="tool-btn strong" size="mini" @tap="applyAction('bold')">B</button>
      <button class="tool-btn italic" size="mini" @tap="applyAction('italic')">I</button>
      <button class="tool-btn" size="mini" @tap="applyAction('heading')">标题</button>
      <button class="tool-btn" size="mini" @tap="applyAction('ordered-list')">有序</button>
      <button class="tool-btn" size="mini" @tap="applyAction('unordered-list')">列表</button>
      <button class="tool-btn" size="mini" @tap="applyAction('quote')">引用</button>
      <button class="tool-btn" size="mini" @tap="applyAction('line-break')">换行</button>
      <button class="tool-btn" size="mini" @tap="insertLink">链接</button>
      <button v-if="allowImages" class="tool-btn" size="mini" @tap="insertImage">图片</button>
    </view>

    <textarea
      class="rich-note-textarea"
      :value="markdown"
      :cursor="cursor"
      maxlength="-1"
      :placeholder="textareaPlaceholder"
      placeholder-class="rich-note-placeholder"
      :auto-height="!minimal"
      @input="onInput"
      @focus="rememberCursor"
      @blur="rememberCursor"
    />

    <view v-if="!minimal" class="rich-note-tip">
      <text>{{ allowImages
        ? '内容会以兼容 Markdown 的结构保存。不会写格式也没关系：选中或停在光标处点上方按钮即可。'
        : '内容会以兼容 Markdown 的结构保存；正文支持换行和基础排版，但不支持插图。'
      }}</text>
    </view>

    <view v-if="!minimal && markdown.trim()" class="preview-card">
      <text class="preview-title">预览</text>
      <RichNoteRenderer :value="currentContent" :allow-images="allowImages" />
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  applyMarkdownToolbarAction,
  buildRichNoteContentFromMarkdown,
  normalizeRichNoteContent,
  stripMarkdownImages,
  type MarkdownToolbarAction,
} from '../../utils/rich-note'
import RichNoteRenderer from './RichNoteRenderer.vue'

const props = withDefaults(defineProps<{
  modelValue: unknown
  allowImages?: boolean
  minimal?: boolean
  placeholder?: string
}>(), {
  allowImages: true,
  minimal: false,
  placeholder: '',
})
const emit = defineEmits(['update:modelValue'])

const allowImages = computed(() => props.allowImages)
const minimal = computed(() => props.minimal)
const textareaPlaceholder = computed(() => {
  const custom = String(props.placeholder || '').trim()
  if (custom) return custom
  return allowImages.value ? '输入正文，可用上方按钮插入排版和图片' : '输入正文，可用上方按钮插入排版；图片请上传到封面/图片'
})

function normalizeMarkdownForPolicy(value: unknown) {
  const next = normalizeRichNoteContent(value).markdown
  return allowImages.value ? next : stripMarkdownImages(next)
}

const markdown = ref(normalizeMarkdownForPolicy(props.modelValue))
const cursor = ref(markdown.value.length)
const currentContent = computed(() => buildRichNoteContentFromMarkdown(markdown.value))

onMounted(() => {
  if (!allowImages.value && normalizeRichNoteContent(props.modelValue).markdown !== markdown.value) {
    emit('update:modelValue', buildRichNoteContentFromMarkdown(markdown.value))
  }
})

watch(
  () => props.modelValue,
  (value) => {
    const next = normalizeMarkdownForPolicy(value)
    if (next !== markdown.value) {
      markdown.value = next
      cursor.value = next.length
    }
  },
  { deep: true },
)

function emitMarkdown(value: string) {
  const next = allowImages.value ? value : stripMarkdownImages(value)
  markdown.value = next
  emit('update:modelValue', buildRichNoteContentFromMarkdown(next))
}

function rememberCursor(event: any) {
  const detail = event?.detail || {}
  const nextCursor = Number(detail.cursor)
  if (Number.isFinite(nextCursor)) cursor.value = Math.max(0, nextCursor)
}

function onInput(event: any) {
  const value = String(event?.detail?.value || '')
  const nextCursor = Number(event?.detail?.cursor)
  cursor.value = Number.isFinite(nextCursor) ? nextCursor : value.length
  emitMarkdown(value)
}

function applyAction(action: MarkdownToolbarAction, payload: Record<string, string> = {}) {
  const result = applyMarkdownToolbarAction(markdown.value, action, cursor.value, cursor.value, payload)
  cursor.value = result.selectionStart
  emitMarkdown(result.markdown)
}

function chooseImages(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const choose = (typeof uni.chooseMedia === 'function')
      ? uni.chooseMedia
      : (typeof wx !== 'undefined' ? wx.chooseMedia : null)
    if (!choose) {
      reject(new Error('当前环境不支持选择图片'))
      return
    }
    choose({
      count: 9,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res: any) => {
        resolve((res.tempFiles || []).map((file: any) => String(file?.tempFilePath || '')).filter(Boolean))
      },
      fail: reject,
    })
  })
}

async function insertImage() {
  if (!allowImages.value) return
  try {
    const paths = await chooseImages()
    if (paths.length === 0) return
    for (const path of paths) {
      const result = applyMarkdownToolbarAction(markdown.value, 'image', cursor.value, cursor.value, {
        alt: '图片',
        src: path,
      })
      cursor.value = result.selectionStart
      markdown.value = result.markdown
    }
    emitMarkdown(markdown.value)
  } catch (error: any) {
    const msg = String(error?.errMsg || error?.message || '')
    if (!msg.includes('cancel')) {
      uni.showToast({ title: msg || '插入图片失败', icon: 'none' })
    }
  }
}

function insertLink() {
  uni.getClipboardData({
    success: (res: any) => {
      const url = String(res?.data || '').trim()
      if (!/^https?:\/\//.test(url)) {
        uni.showToast({ title: '请先复制 http/https 链接', icon: 'none' })
        return
      }
      applyAction('link', { url })
    },
    fail: () => uni.showToast({ title: '读取剪贴板失败', icon: 'none' }),
  })
}
</script>

<style lang="scss" scoped>
.rich-note-editor {
  display: grid;
  gap: $hh-space-sm;
}

.rich-note-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: $hh-space-xs;
}

.tool-btn {
  margin: 0;
  padding: 0 $hh-space-sm;
  min-width: 64rpx;
  font-size: $hh-font-caption;
  line-height: 2;
  border: none;
  border-radius: $hh-radius-sm;
  background: $hh-color-bg-sub;
  color: $hh-color-text;
}

.tool-btn.strong { font-weight: $hh-font-weight-bold; }
.tool-btn.italic { font-style: italic; }

.rich-note-textarea {
  width: 100%;
  min-height: 360rpx;
  padding: $hh-space-md;
  box-sizing: border-box;
  border: 1rpx solid $hh-color-divider;
  border-radius: $hh-radius-md;
  background: $hh-color-bg-sub;
  color: $hh-color-text;
  font-size: $hh-font-body;
  line-height: 1.8;
}

.rich-note-placeholder {
  color: $hh-color-text-mute;
}

.rich-note-tip {
  padding: $hh-space-sm $hh-space-md;
  border-radius: $hh-radius-sm;
  background: $hh-accent-wash;
  color: $hh-color-text-mute;
  font-size: $hh-font-caption;
  line-height: 1.6;
}

.preview-card {
  padding: $hh-space-md;
  border: 1rpx solid $hh-color-divider;
  border-radius: $hh-radius-md;
  background: $hh-surface-1;
}

.preview-title {
  display: block;
  margin-bottom: $hh-space-sm;
  color: $hh-color-text-mute;
  font-size: $hh-font-caption;
}

.rich-note-editor--minimal {
  display: block;
}

.rich-note-editor--minimal .rich-note-textarea {
  min-height: 400rpx;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-body-lg-size);
  line-height: var(--hh-text-body-lg-line);
}

.rich-note-editor--minimal .rich-note-placeholder {
  color: var(--hh-color-text-tertiary);
  font-size: var(--hh-text-body-lg-size);
  line-height: var(--hh-text-body-lg-line);
}
</style>
