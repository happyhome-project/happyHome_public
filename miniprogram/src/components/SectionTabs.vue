<template>
  <scroll-view scroll-x class="tabs" :scroll-into-view="activeTabId">
    <view
      v-for="(section, i) in sections"
      :key="section._id"
      :id="`tab-${i}`"
      class="tab"
      :class="{ active: i === currentIndex }"
      @tap="$emit('change', i)"
    >
      {{ section.name }}
    </view>
  </scroll-view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
defineProps<{ sections: any[]; currentIndex: number }>()
defineEmits(['change'])
const activeTabId = computed(() => `tab-${0}`)
</script>

<style scoped>
.tabs { display: flex; white-space: nowrap; background: #fff; padding: 0 16rpx; border-bottom: 1rpx solid #eee; }
.tab { display: inline-block; padding: 24rpx 28rpx; font-size: 28rpx; color: #666; flex-shrink: 0; }
.tab.active { color: #333; font-weight: 600; border-bottom: 4rpx solid #333; }
</style>
