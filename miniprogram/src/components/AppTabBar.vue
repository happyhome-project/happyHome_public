<template>
  <view class="app-tabbar" aria-label="主导航">
    <button
      class="tab-btn"
      :class="{ active: props.current === 'home' }"
      @tap="go('home')"
    >
      <text>首页</text>
      <view class="active-dot"></view>
    </button>

    <button class="fab-btn" aria-label="发布" @tap="go('create')">
      <text class="fab-plus">+</text>
    </button>

    <button
      class="tab-btn"
      :class="{ active: props.current === 'profile' }"
      @tap="go('profile')"
    >
      <text>我的</text>
      <view class="active-dot"></view>
    </button>
  </view>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { APP_TABS, type AppTabKey, getTabByKey, hideNativeTabBar } from '../utils/app-tabbar'

const props = defineProps<{ current: AppTabKey }>()

onMounted(() => {
  hideNativeTabBar()
})

function go(key: AppTabKey) {
  const target = getTabByKey(key)
  if (!target) return
  hideNativeTabBar()
  if (props.current === key) return
  uni.switchTab({ url: target.path })
}

void APP_TABS
</script>

<style lang="scss" scoped>
.app-tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: $hh-z-sticky;
  height: calc(96rpx + env(safe-area-inset-bottom));
  padding: 12rpx 64rpx calc(16rpx + env(safe-area-inset-bottom));
  display: grid;
  grid-template-columns: 1fr 104rpx 1fr;
  align-items: end;
  background: rgba(253, 251, 248, 0.95);
  border-top: 1rpx solid $hh-ink-line-2;
  backdrop-filter: blur(28rpx);
  box-shadow: 0 -12rpx 36rpx rgba(30, 26, 22, 0.04);
}

button {
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  line-height: 1;
}

button::after {
  border: 0;
}

.tab-btn {
  min-width: 96rpx;
  height: 58rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 8rpx;
  color: $hh-ink-3;
  font-size: 28rpx;
  font-weight: $hh-font-weight-medium;
}

.tab-btn.active {
  color: $hh-ink-1;
  font-weight: $hh-font-weight-bold;
}

.active-dot {
  width: 7rpx;
  height: 7rpx;
  border-radius: $hh-radius-full;
  background: transparent;
}

.tab-btn.active .active-dot {
  background: $hh-accent;
}

.fab-btn {
  width: 64rpx;
  height: 52rpx;
  margin: 0 auto 12rpx;
  border-radius: 18rpx;
  background: $hh-accent;
  color: $hh-surface-1;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 14rpx 30rpx rgba(58, 106, 69, 0.24);
}

.fab-plus {
  font-size: 48rpx;
  line-height: 44rpx;
  font-weight: $hh-font-weight-regular;
}
</style>
