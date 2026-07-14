<template>
  <view>
    <view v-if="showPublishSheet" class="publish-mask" @tap="closePublishSheet">
      <view class="publish-sheet" @tap.stop>
        <view class="publish-grid">
          <button
            v-for="option in publishOptions"
            :key="option.key"
            class="publish-option"
            @tap="handlePublishOption(option.key)"
          >
            <view class="publish-icon"><text class="publish-icon-glyph">{{ option.glyph }}</text></view>
            <text class="publish-label">{{ option.label }}</text>
          </button>
        </view>
        <button class="publish-close" aria-label="关闭发布面板" @tap="closePublishSheet">
          <text>×</text>
        </button>
      </view>
    </view>

    <view class="app-tabbar" aria-label="主导航">
      <button
        class="tab-btn"
        :class="{ active: props.current === 'home' }"
        @tap="go('home')"
      >
        <image class="tab-icon" :src="tabIconSrc('home')" mode="aspectFit" />
        <text class="tab-label">首页</text>
      </button>

      <button class="fab-btn" aria-label="发布" @tap="go('create')">
        <view class="fab-pill">
          <text class="fab-plus">+</text>
        </view>
      </button>

      <button
        class="tab-btn"
        :class="{ active: props.current === 'profile' }"
        @tap="go('profile')"
      >
        <image class="tab-icon" :src="tabIconSrc('profile')" mode="aspectFit" />
        <text class="tab-label">我的</text>
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  APP_TABS,
  type AppTabKey,
  getTabByKey,
  hideNativeTabBar,
} from '../utils/app-tabbar'

const props = defineProps<{ current: AppTabKey }>()
const showPublishSheet = ref(false)
const HOME_TAB_RETAP_EVENT = 'happyhome:home-tab-retap'
const publishOptions = computed(() => [
  { key: 'image_text', label: '发图文', glyph: '▧' },
  { key: 'text', label: '写文字', glyph: '文' },
  { key: 'collaboration', label: '发起协作', glyph: '⌁' },
])

onMounted(() => {
  hideNativeTabBar()
})

function go(key: AppTabKey) {
  if (key === 'create') {
    openPublishSheet()
    return
  }
  closePublishSheet()
  const target = getTabByKey(key)
  if (!target) return
  hideNativeTabBar()
  if (props.current === key) {
    if (key === 'home') {
      ;(uni as any).$emit?.(HOME_TAB_RETAP_EVENT)
    }
    return
  }
  uni.switchTab({ url: target.path })
}

function tabIconSrc(key: 'home' | 'profile') {
  const active = props.current === key
  if (key === 'home') return active ? '/static/tab-home-active.png' : '/static/tab-home.png'
  return active ? '/static/tab-profile-active.png' : '/static/tab-profile.png'
}

function openPublishSheet() {
  hideNativeTabBar()
  showPublishSheet.value = true
}

function closePublishSheet() {
  showPublishSheet.value = false
}

function handlePublishOption(key: string) {
  const returnTo = props.current === 'create' ? '' : (getTabByKey(props.current)?.path || '')
  closePublishSheet()
  const params = returnTo ? [`returnTo=${encodeURIComponent(returnTo)}`] : []
  params.push(key === 'collaboration' ? 'mode=collaboration' : `archiveFormat=${encodeURIComponent(key)}`)
  uni.navigateTo({ url: `/pages/create/index?${params.join('&')}` })
}

function currentReturnTo() {
  if (props.current === 'profile') return '/pages/profile/index'
  if (props.current === 'home') return '/pages/index/index'
  return ''
}

function openCreatePage(returnTo = currentReturnTo()) {
  const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''
  uni.navigateTo({ url: `/pages/create/index${query}` })
}

void APP_TABS
</script>

<style lang="scss" scoped>
.publish-mask {
  position: fixed;
  inset: 0;
  z-index: $hh-z-sticky + 20;
  background: rgba(0, 0, 0, 0.65);
}

.publish-sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 48rpx 40rpx calc(40rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
  border-radius: 32rpx 32rpx 0 0;
  background: #fff;
  box-shadow: 0 -8rpx 16rpx rgba(0, 0, 0, 0.06), 0 -32rpx 80rpx rgba(0, 0, 0, 0.1);
}

.publish-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  column-gap: 18rpx;
  row-gap: 32rpx;
  width: 100%;
}

.publish-option {
  width: 100%;
  min-height: 154rpx;
  padding: 0;
  margin: 0;
  border: 0;
  background: transparent;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 15rpx;
}

.publish-icon {
  width: 104rpx;
  height: 104rpx;
  border-radius: 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f4f4f4;
}

.publish-icon-glyph { color: #111; font-size: 42rpx; font-weight: 500; line-height: 1; }

.publish-icon-image {
  width: 72rpx;
  height: 72rpx;
  display: block;
}

.publish-icon--family {
  background: #fdf6e6;
}

.publish-icon--trade {
  background: #e3f0fb;
}

.publish-icon--notice {
  background: #e0fbf7;
}

.publish-icon--lost {
  background: #fef6e3;
}

.publish-icon--neighbor {
  background: #ddf6fc;
}

.publish-icon--car {
  background: #def7ec;
}

.publish-icon--general {
  background: #f7f7f7;
}

.publish-label {
  width: 112rpx;
  color: var(--hh-color-text-secondary);
  font-size: var(--hh-text-body-base-size);
  line-height: var(--hh-text-body-base-line);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.publish-close {
  width: 80rpx;
  height: 80rpx;
  margin: 40rpx auto 0;
  padding: 0;
  border: 0;
  border-radius: $hh-radius-full;
  background: #f4f4f4;
  color: var(--hh-color-text-primary);
  font-size: 48rpx;
  line-height: 80rpx;
  text-align: center;
}

.app-tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: $hh-z-sticky;
  height: calc(98rpx + env(safe-area-inset-bottom));
  padding: 0 64rpx env(safe-area-inset-bottom);
  display: grid;
  grid-template-columns: 1fr 176rpx 1fr;
  align-items: center;
  background: rgba(255, 255, 255, 0.94);
  border-top: 1rpx solid var(--hh-color-line-soft);
  backdrop-filter: blur(24rpx);
  box-shadow: 0 -12rpx 36rpx rgba(31, 35, 32, 0.05);
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
  width: 124rpx;
  height: 88rpx;
  justify-self: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
  color: var(--hh-color-text-primary);
  font-size: 22rpx;
  line-height: 24rpx;
  font-weight: $hh-font-weight-medium;
}

.tab-icon {
  width: 48rpx;
  height: 48rpx;
  display: block;
}

.tab-label {
  display: block;
  line-height: 24rpx;
  white-space: nowrap;
}

.tab-btn.active {
  color: var(--hh-color-brand-primary);
  font-weight: $hh-font-weight-bold;
}

.fab-btn {
  width: 128rpx;
  height: 98rpx;
  margin: 0 auto;
  justify-self: center;
  display: flex;
  align-items: center;
  justify-content: center;
}

.fab-pill {
  width: 112rpx;
  height: 112rpx;
  border-radius: $hh-radius-full;
  background: var(--hh-color-brand-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 16rpx 34rpx rgba(61, 173, 125, 0.28);
}

.fab-plus {
  font-size: 56rpx;
  line-height: 56rpx;
  font-weight: $hh-font-weight-regular;
}
</style>
