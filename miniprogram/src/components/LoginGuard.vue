<template>
  <view class="hh-login-guard">
    <text class="hh-login-guard-title">{{ title }}</text>
    <text class="hh-login-guard-desc">{{ desc }}</text>
    <button class="hh-login-guard-btn" size="mini" @tap="handleGoLogin">{{ actionText }}</button>
    <text class="hh-login-guard-version">ver: {{ appVersion }}</text>
  </view>
</template>

<script setup lang="ts">
import { BUILD_INFO } from '../generated/build-info'
import { clientLog } from '../utils/client-log'

withDefaults(defineProps<{
  title?: string
  desc?: string
  actionText?: string
}>(), {
  title: '欢迎来到 社群助手',
  desc: '登录后查看你的社群和近况',
  actionText: '去登录',
})

const appVersion = String(BUILD_INFO.version || BUILD_INFO.buildId || 'unknown').replace(/^1\.0\./, '0.7.')

function handleGoLogin() {
  const url = '/pages/profile/index'
  clientLog('info', 'loginGuard.profile.tap', { url })
  uni.switchTab({
    url,
    success: () => clientLog('info', 'loginGuard.profile.switchTab.success', { url }),
    fail: (error) => {
      clientLog('error', 'loginGuard.profile.switchTab.fail', { url, error })
      uni.reLaunch({
        url,
        success: () => clientLog('info', 'loginGuard.profile.reLaunch.success', { url }),
        fail: (fallbackError) => clientLog('error', 'loginGuard.profile.reLaunch.fail', { url, error: fallbackError }),
      })
    },
  })
}
</script>

<style lang="scss" scoped>
.hh-login-guard {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  gap: $hh-space-md;
  padding: $hh-space-xl $hh-space-lg;
}

.hh-login-guard-title {
  font-family: $hh-font-serif;
  font-size: 36rpx;
  font-weight: $hh-font-weight-bold;
  color: $hh-ink-1;
  text-align: center;
  letter-spacing: $hh-tracking-serif-sm;
}

.hh-login-guard-desc {
  font-size: 26rpx;
  color: $hh-ink-3;
  text-align: center;
  line-height: 1.6;
}

.hh-login-guard-btn {
  margin-top: $hh-space-sm;
  background: $hh-surface-1;
  color: $hh-accent-ink;
  border: 1rpx solid $hh-accent-line;
  border-radius: $hh-radius-sm;
  font-size: 26rpx;
  padding: 0 $hh-space-lg;
}

.hh-login-guard-version {
  margin-top: $hh-space-xs;
  font-family: $hh-font-mono;
  font-size: $hh-font-mono-xs;
  color: $hh-color-text-mute;
  opacity: 0.75;
}
</style>
