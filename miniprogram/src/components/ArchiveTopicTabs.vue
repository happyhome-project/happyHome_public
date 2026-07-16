<template>
  <scroll-view scroll-x class="archive-topic-tabs" :show-scrollbar="false">
    <view class="archive-topic-tabs__inner">
      <view
        v-for="tab in tabs"
        :key="tab.topicKey || '__all__'"
        class="archive-topic-tab"
        :class="{ 'archive-topic-tab--active': tab.topicKey === modelValue }"
        :aria-selected="tab.topicKey === modelValue ? 'true' : 'false'"
        @tap="$emit('update:modelValue', tab.topicKey)"
      ><text>{{ tab.displayName }}</text></view>
    </view>
  </scroll-view>
</template>

<script setup lang="ts">
import type { ArchiveTab } from '../api/cloud'
defineProps<{ tabs: ArchiveTab[]; modelValue: string }>()
defineEmits<{ (event: 'update:modelValue', value: string): void }>()
</script>

<style scoped>
.archive-topic-tabs { width: 100%; white-space: nowrap; }
.archive-topic-tabs__inner { display: flex; gap: 38rpx; padding: 4rpx var(--hh-page-x) 18rpx; }
.archive-topic-tab { position: relative; z-index: 0; flex: 0 0 auto; color: #292116; font-size: 28rpx; line-height: 40rpx; }
.archive-topic-tab text { position: relative; z-index: 1; }
.archive-topic-tab--active { color: #292116; font-weight: 650; }
.archive-topic-tab--active::after { content: ''; position: absolute; z-index: 0; left: 50%; bottom: -2rpx; width: 102rpx; height: 28rpx; border-radius: 999rpx; background: linear-gradient(90deg, rgba(61, 173, 125, 0.3) 0%, rgba(61, 173, 125, 0) 100%); transform: translateX(-50%); }
</style>
