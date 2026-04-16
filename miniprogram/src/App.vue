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
