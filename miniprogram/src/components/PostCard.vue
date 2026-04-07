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

<style scoped>
.post-card {
  background: #fff; border-radius: 16rpx; padding: 28rpx 32rpx;
  margin-bottom: 16rpx; box-shadow: 0 2rpx 12rpx rgba(0,0,0,0.04);
}
.field { display: flex; align-items: center; margin-bottom: 8rpx; }
.field-label { font-size: 24rpx; color: #999; margin-right: 12rpx; flex-shrink: 0; }
.field-value { font-size: 28rpx; color: #333; }
.time { font-size: 24rpx; color: #bbb; display: block; margin-top: 16rpx; text-align: right; }
.empty-preview { color: #ccc; font-size: 26rpx; }
</style>
