<template>
  <web-view v-if="url" :src="url" />
  <view v-else class="empty">
    <text class="hint">链接无效</text>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { ensureHierarchyStack } from '../../utils/hierarchy-nav'

const url = ref('')

onLoad((options: any) => {
  if (ensureHierarchyStack('/pages/web-view/index', options || {})) return
  const raw = String(options?.url || '')
  if (!raw) return
  try { url.value = decodeURIComponent(raw) } catch { url.value = raw }
})
</script>

<style lang="scss" scoped>
.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
}
.hint {
  color: $hh-color-text-mute;
  font-size: $hh-font-body;
}
</style>
