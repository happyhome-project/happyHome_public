<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { useCommunityStore } from './store/community'
import { useUserStore } from './store/user'

onLaunch(async () => {
  // H5 环境没有 wx.cloud，跳过初始化（H5 通过 http-gateway 访问云函数）
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (typeof wx !== 'undefined' && wx.cloud?.init) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    wx.cloud.init({ env: 'cloudbase-3gh862acb1505ff3', traceUser: true })
  }

  const userStore = useUserStore()
  const communityStore = useCommunityStore()

  userStore.loadFromStorage()
  communityStore.loadFromStorage()

  if (userStore.isLoggedIn) {
    try {
      await communityStore.loadMyCommunities()
      if (communityStore.myCommunities.length === 0) {
        uni.reLaunch({ url: '/pages/onboarding/index' })
      }
    } catch (e) {
      console.error('Failed to load communities:', e)
    }
  }
})
</script>

<template>
  <view />
</template>

<style lang="scss">
/* ═════════════��═════════════════════════════════════════════
 * wot-design-uni 主题覆盖
 * 把 --wot-* CSS 变量对齐 $hh-* design tokens
 * 详见: docs/DESIGN-TOKENS.md · docs/VISUAL-TONE.md
 * ═════════════��════════════════════════════════��════════════ */
page {
  /* ── 核心色 ── */
  --wot-color-theme: #{$hh-color-primary};
  --wot-color-success: #{$hh-color-success};
  --wot-color-warning: #{$hh-color-warning};
  --wot-color-danger: #{$hh-color-danger};

  /* ── 灰阶 → 暖灰 ── */
  --wot-color-gray-1: #{$hh-color-bg-sub};     /* f7f8fa → F7F6F3 */
  --wot-color-gray-2: #{$hh-color-divider};     /* f2f3f5 → F2EFE9 */
  --wot-color-gray-3: #{$hh-color-border};      /* ebedf0 → EBE3D8 */
  --wot-color-gray-6: #{$hh-color-text-mute};   /* 969799 → 766F65 */
  --wot-color-gray-7: #{$hh-color-text-sub};    /* 646566 → 595550 */
  --wot-color-gray-8: #{$hh-color-text};        /* 323233 → 2C2416 */

  /* ── 文字色 ── */
  --wot-color-content: #{$hh-color-text};
  --wot-color-secondary: #{$hh-color-text-sub};
  --wot-color-aid: #{$hh-color-text-mute};

  /* ── 边框/背景 ── */
  --wot-color-border: #{$hh-color-border};
  --wot-color-border-light: #{$hh-color-divider};
  --wot-color-bg: #{$hh-color-bg-sub};

  /* ── 按钮圆角 → 温度感 ── */
  --wot-button-small-radius: #{$hh-radius-sm};
  --wot-button-medium-radius: #{$hh-radius-md};
  --wot-button-large-radius: #{$hh-radius-md};
}
</style>
