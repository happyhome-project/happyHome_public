<template>
  <view class="post-card" @tap="$emit('tap')">
    <view class="preview-fields">
      <view v-for="field in preview" :key="field.label" class="field">
        <text class="field-label">{{ field.label }}</text>
        <text class="field-value">{{ field.value }}</text>
      </view>
      <view v-if="preview.length === 0" class="empty-preview">
        <text>暂无摘要信息</text>
      </view>
    </view>
    <text class="time">{{ formattedTime }}</text>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getListPreview } from '../utils/widget'

const props = defineProps<{ post: any; section: any }>()
defineEmits(['tap'])

const preview = computed(() => {
  if (!props.post || !props.section) return []
  return getListPreview(props.post, props.section)
})

const formattedTime = computed(() => {
  if (!props.post?.createdAt) return ''
  const d = new Date(props.post.createdAt)
  return `${d.getMonth() + 1}/${d.getDate()}`
})
</script>

<style lang="scss" scoped>
.post-card {
  background: $hh-color-surface; border-radius: $hh-radius-md; padding: $hh-space-md $hh-space-lg;
  margin-bottom: $hh-space-sm; box-shadow: $hh-shadow-card;
}
.field { display: flex; align-items: center; margin-bottom: $hh-space-xs; }
.field-label { font-size: $hh-font-caption; color: $hh-color-text-mute; margin-right: $hh-space-sm; flex-shrink: 0; }
.field-value { font-size: $hh-font-body; color: $hh-color-text; }
.time { font-size: $hh-font-caption; color: $hh-color-text-mute; display: block; margin-top: $hh-space-sm; text-align: right; }
.empty-preview { color: $hh-color-text-mute; font-size: $hh-font-caption; }
</style>
