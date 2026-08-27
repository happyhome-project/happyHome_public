<template>
  <view class="startup-shell" data-testid="startup-routing-shell" @tap="openHome">
    <view class="startup-mark">美好</view>
    <text class="startup-copy">正在进入社区</text>
  </view>
</template>

<script setup lang="ts">
import { onReady } from '@dcloudio/uni-app'
import { clientLog } from '../../utils/client-log'
import { flushStartupPerformanceCapture } from '../../utils/startup-performance'

const HOME_TAB_URL = '/pages/index/index'
let routing = false

function openHome() {
  if (routing) return
  routing = true
  uni.switchTab({
    url: HOME_TAB_URL,
    fail: (error) => {
      routing = false
      flushStartupPerformanceCapture((event, details) => clientLog('debug', event, details))
      clientLog('warn', 'startup.home.route.fail', { error })
    },
  })
}

onReady(() => {
  openHome()
})
</script>

<style lang="scss">
page {
  min-height: 100%;
  background: #eef9f6;
}

.startup-shell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24rpx;
  min-height: 100vh;
  box-sizing: border-box;
  padding: calc(env(safe-area-inset-top) + 44rpx) 32rpx calc(env(safe-area-inset-bottom) + 44rpx);
  background:
    radial-gradient(ellipse at 78% -3%, rgba(175, 242, 220, 0.72) 0%, rgba(220, 243, 241, 0.45) 36%, rgba(255, 255, 255, 0) 66%),
    linear-gradient(180deg, #e6f7f3 0%, #f7faf9 48%, #ffffff 100%);
}

.startup-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 116rpx;
  height: 116rpx;
  border-radius: 32rpx;
  color: #ffffff;
  font-size: 34rpx;
  font-weight: 700;
  background: #3dad7d;
  box-shadow: 0 20rpx 44rpx rgba(61, 173, 125, 0.2);
}

.startup-copy {
  color: #66716c;
  font-size: 26rpx;
}
</style>
