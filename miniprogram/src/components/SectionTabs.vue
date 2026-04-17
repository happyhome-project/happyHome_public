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
const props = defineProps<{ sections: any[]; currentIndex: number }>()
defineEmits(['change'])
const activeTabId = computed(() => `tab-${props.currentIndex}`)
</script>

<style lang="scss" scoped>
.tabs { display: flex; white-space: nowrap; background: $hh-color-surface; padding: 0 $hh-space-sm; border-bottom: 1rpx solid $hh-color-divider; }
.tab { display: inline-block; padding: $hh-space-md $hh-space-md; font-size: $hh-font-body; color: $hh-color-text-sub; flex-shrink: 0; }
.tab.active { color: $hh-color-primary; font-weight: $hh-font-weight-bold; border-bottom: 4rpx solid $hh-color-primary; }
</style>
