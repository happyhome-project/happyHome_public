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
/* ═══════════════════════════════════════════════════════════════
 * Classical Dossier · 全局样式
 * 暖灰白纸底 · 墨色文字 · 三字体分工（Serif/Sans/Mono）
 * 详见: design_handoff_happyhome/README.md
 * ═══════════════════════════════════════════════════════════════ */
page {
  background: $hh-surface-0;
  color: $hh-ink-1;
  font-family: $hh-font-sans;
  font-size: 28rpx;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;

  /* CSS 变量，方便页面直接用 var() */
  --surface-0: #{$hh-surface-0};
  --surface-1: #{$hh-surface-1};
  --surface-2: #{$hh-surface-2};
  --surface-3: #{$hh-surface-3};
  --ink-1: #{$hh-ink-1};
  --ink-2: #{$hh-ink-2};
  --ink-3: #{$hh-ink-3};
  --ink-4: #{$hh-ink-4};
  --ink-line: #{$hh-ink-line};
  --ink-line-2: #{$hh-ink-line-2};
  --accent: #{$hh-accent};
  --accent-ink: #{$hh-accent-ink};
  --accent-wash: #{$hh-accent-wash};
  --accent-line: #{$hh-accent-line};
  --live: #{$hh-live};
  --live-wash: #{$hh-live-wash};
  --amber-wash: #{$hh-amber-wash};
  --blue-wash: #{$hh-blue-wash};
  --accent-ochre: #{$hh-accent-ochre};
  --accent-blue: #{$hh-accent-blue};
}
</style>
