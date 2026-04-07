<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { useCommunityStore } from './store/community'
import { useUserStore } from './store/user'

onLaunch(async () => {
  wx.cloud.init({ env: 'YOUR_CLOUD_ENV_ID', traceUser: true })

  const userStore = useUserStore()
  const communityStore = useCommunityStore()

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
  <router-view />
</template>
