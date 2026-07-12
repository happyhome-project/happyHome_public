<script setup lang="ts">
import { onLaunch, onShow } from '@dcloudio/uni-app'
import { useCommunityStore } from './store/community'
import { useUserStore } from './store/user'
import { clientLog, installRuntimeLogHooks } from './utils/client-log'
import { refreshCommunitiesForCurrentSession } from './utils/app-session-lifecycle'

let lastCommunityRefreshAt = 0
let sessionReady: Promise<unknown> = Promise.resolve()
const FOREGROUND_COMMUNITY_REFRESH_INTERVAL = 30 * 1000

function getRuntimeDiagnostics() {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore wx is injected by the mini-program runtime.
    const appBase = typeof wx !== 'undefined' && wx.getAppBaseInfo ? wx.getAppBaseInfo() : null
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore wx is injected by the mini-program runtime.
    const system = typeof wx !== 'undefined' && wx.getSystemInfoSync ? wx.getSystemInfoSync() : null
    return {
      SDKVersion: String(appBase?.SDKVersion || system?.SDKVersion || ''),
      platform: String(appBase?.platform || system?.platform || ''),
      system: String(appBase?.system || system?.system || ''),
      version: String(appBase?.version || system?.version || ''),
    }
  } catch (error) {
    return { diagnosticsError: String((error as any)?.message || error || '') }
  }
}

async function refreshMyCommunitiesSilently() {
  await sessionReady
  const userStore = useUserStore()
  if (!userStore.isLoggedIn) return
  const now = Date.now()
  if (now - lastCommunityRefreshAt < FOREGROUND_COMMUNITY_REFRESH_INTERVAL) return
  lastCommunityRefreshAt = now

  try {
    clientLog('debug', 'app.communities.refresh.start', {})
    const communityStore = useCommunityStore()
    await refreshCommunitiesForCurrentSession({
      sessionReady,
      isLoggedIn: () => userStore.isLoggedIn,
      identity: () => String(userStore.openId || ''),
      load: () => communityStore.loadMyCommunities({ loadSections: false }),
      clear: () => {
        communityStore.clearCommunityState()
        communityStore.myCommunities = []
        communityStore.membershipByCommunity = {}
      },
    })
    clientLog('debug', 'app.communities.refresh.success', {})
  } catch (e) {
    clientLog('error', 'app.communities.refresh.fail', { error: e })
    console.error('Failed to refresh communities:', e)
  }
}

onLaunch(async () => {
  // H5 环境没有 wx.cloud，跳过初始化（H5 通过 CloudBase Web SDK 访问云函数）
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (typeof wx !== 'undefined' && wx.cloud?.init) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    wx.cloud.init({ env: 'cloudbase-3gh862acb1505ff3', traceUser: true })
  }
  installRuntimeLogHooks()
  clientLog('info', 'app.launch.start', getRuntimeDiagnostics())

  const userStore = useUserStore()
  const communityStore = useCommunityStore()

  userStore.loadFromStorage()
  userStore.syncBackgroundFetchToken()
  communityStore.loadFromStorage()
  // #ifdef H5
  sessionReady = userStore.restoreWebSession().catch((error) => {
    clientLog('error', 'app.webSession.restore.fail', { error })
    console.error('Failed to restore Web session:', error)
    userStore.clearLocalSession()
  })
  await sessionReady
  // #endif
  lastCommunityRefreshAt = Date.now()
  clientLog('info', 'app.storage.loaded', {
    loggedIn: userStore.isLoggedIn,
    openIdTail: userStore.openId ? String(userStore.openId).slice(-6) : '',
    currentCommunityId: communityStore.currentCommunityId || '',
    communityCount: communityStore.myCommunities.length,
  })

  // 2022-10 微信策略变更后，真机上 wx.getUserProfile 强制返回 "微信用户"；
  // 老版本采集的用户昵称是这个假名 → 清掉让他们走新登录流程（选头像 + 输昵称）。
  if (userStore.isLoggedIn && userStore.nickName === '微信用户') {
    await userStore.logout()
    clientLog('warn', 'app.legacyWechatUser.logout', {})
    // 延迟弹提示，等首页 mount 完再显示 toast，避免被生命周期覆盖
    setTimeout(() => {
      uni.showToast({
        title: '请重新登录以完善资料',
        icon: 'none',
        duration: 3000,
      })
    }, 500)
    return
  }

  // 首页首屏数据由 post.bootstrap / 数据预拉取负责；这里不再阻塞启动等待社区列表。
  // 前台返回时仍会按阈值静默刷新，解决后台审批通过后用户无需杀进程的问题。
})

onShow(async () => {
  clientLog('info', 'app.show', {})
  // The app may stay alive while an admin approves a membership in the backend.
  // Refresh active communities when returning to the foreground so users do not
  // need to kill and reopen the mini-program to see newly approved communities.
  await sessionReady
  await refreshMyCommunitiesSilently()
})
</script>

<template>
  <view />
</template>

<style lang="scss">
/* ═══════════════════════════════════════════════════════════════
 * Figma 0626 · 全局样式
 * 浅灰页面底 · 白卡片 · 亮绿强调 · CSS variables for mini-program pages
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

  /* Figma 0626 tokens */
  --hh-color-page: #{$hh-figma-bg};
  --hh-color-card: #{$hh-figma-card};
  --hh-color-card-soft: #{$hh-figma-card-soft};
  --hh-color-line: #{$hh-figma-line};
  --hh-color-line-soft: #{$hh-figma-line-soft};
  --hh-color-brand-primary: #{$hh-figma-green};
  --hh-color-brand-strong: #{$hh-figma-green-dark};
  --hh-color-brand-soft: #{$hh-figma-green-soft};
  --hh-color-brand-line: #{$hh-figma-green-line};
  --hh-color-text-primary: #{$hh-figma-ink};
  --hh-color-text-secondary: #{$hh-figma-ink-2};
  --hh-color-text-tertiary: #{$hh-figma-ink-3};
  --hh-color-text-disabled: #{$hh-figma-ink-4};

  --hh-text-display-size: 64rpx;
  --hh-text-display-line: 96rpx;
  --hh-text-heading-lg-size: 48rpx;
  --hh-text-heading-lg-line: 72rpx;
  --hh-text-heading-md-size: 40rpx;
  --hh-text-heading-md-line: 56rpx;
  --hh-text-heading-sm-size: 36rpx;
  --hh-text-heading-sm-line: 52rpx;
  --hh-text-body-lg-size: 32rpx;
  --hh-text-body-lg-line: 48rpx;
  --hh-text-body-base-size: 28rpx;
  --hh-text-body-base-line: 44rpx;
  --hh-text-caption-lg-size: 26rpx;
  --hh-text-caption-lg-line: 40rpx;
  --hh-text-caption-base-size: 24rpx;
  --hh-text-caption-base-line: 32rpx;
  --hh-text-mark-size: 20rpx;
  --hh-text-mark-line: 28rpx;

  --hh-page-x: 24rpx;
  --hh-section-gap: 24rpx;
  --hh-radius-card: #{$hh-radius-card-figma};
  --hh-radius-panel: #{$hh-radius-panel-figma};
  --hh-shadow-soft: 0 12rpx 32rpx rgba(31, 35, 32, 0.06);
}
</style>
