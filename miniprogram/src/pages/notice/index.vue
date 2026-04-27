<template>
  <view class="notice-page">
    <view v-if="notice" class="notice-detail-card" :style="cardStyle">
      <view class="notice-head">
        <view class="notice-mark">
          <text>{{ notice.icon }}</text>
        </view>
        <view class="notice-title-wrap">
          <text class="notice-section">{{ notice.sectionName }}</text>
          <text class="notice-label">{{ notice.label }}</text>
        </view>
      </view>
      <text class="notice-content">{{ notice.content }}</text>
    </view>

    <view v-else class="notice-empty">
      <text class="empty-title">公告不存在或已更新</text>
      <text class="empty-desc">请返回首页重新打开公告。</text>
      <button class="empty-button" @tap="goHome">返回首页</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useCommunityStore } from '../../store/community'
import { useUserStore } from '../../store/user'

interface NoticeDetail {
  sectionName: string
  label: string
  content: string
  icon: string
  accentColor: string
}

const communityStore = useCommunityStore()
const userStore = useUserStore()
const notice = ref<NoticeDetail | null>(null)
const sectionId = ref('')
const widgetId = ref('')

const cardStyle = computed(() => ({
  '--notice-accent': notice.value?.accentColor || '#B35C3B',
}))

async function ensureSectionsLoaded() {
  if (communityStore.currentSections.length > 0) return
  userStore.loadFromStorage()
  communityStore.loadFromStorage()
  if (!userStore.isLoggedIn) return
  await communityStore.loadMyCommunities()
}

function resolveNotice() {
  const section = communityStore.currentSections.find((item) => item._id === sectionId.value)
  const widget = section?.widgets?.find((item) => item.widgetId === widgetId.value && item.type === 'admin_notice')
  const content = String(widget?.noticeContent || '').trim()
  if (!section || !widget || !content) {
    notice.value = null
    return
  }
  notice.value = {
    sectionName: section.name,
    label: widget.label || '公告',
    content,
    icon: section.icon || '告',
    accentColor: section.accentColor || '',
  }
}

function goHome() {
  uni.switchTab({ url: '/pages/index/index' })
}

onLoad(async (query) => {
  sectionId.value = decodeURIComponent(String(query?.sectionId || ''))
  widgetId.value = decodeURIComponent(String(query?.widgetId || ''))
  await ensureSectionsLoaded()
  resolveNotice()
})
</script>

<style lang="scss" scoped>
.notice-page {
  min-height: 100vh;
  padding: 28rpx 28rpx 80rpx;
  background: $hh-surface-0;
  box-sizing: border-box;
}

.notice-detail-card {
  padding: 32rpx 32rpx 38rpx;
  border: 1rpx solid $hh-ink-line;
  border-left: 8rpx solid var(--notice-accent);
  border-radius: 28rpx;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(251, 247, 238, 0.92));
  box-shadow: $hh-shadow-card;
}

.notice-head {
  display: flex;
  align-items: center;
  gap: 18rpx;
  margin-bottom: 28rpx;
}

.notice-mark {
  width: 56rpx;
  height: 56rpx;
  border-radius: 18rpx;
  background: var(--notice-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.notice-mark text {
  color: $hh-surface-1;
  font-size: 25rpx;
  font-weight: $hh-font-weight-heavy;
}

.notice-title-wrap {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.notice-section {
  font-size: 32rpx;
  font-weight: $hh-font-weight-bold;
  color: $hh-ink-1;
  line-height: 1.25;
}

.notice-label {
  margin-top: 6rpx;
  font-family: $hh-font-mono;
  font-size: 22rpx;
  letter-spacing: $hh-tracking-mono-sm;
  color: $hh-ink-3;
}

.notice-content {
  display: block;
  font-size: 30rpx;
  line-height: 1.82;
  color: $hh-ink-2;
  white-space: pre-wrap;
  word-break: break-word;
}

.notice-empty {
  min-height: 70vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 0 48rpx;
}

.empty-title {
  font-size: 32rpx;
  font-weight: $hh-font-weight-bold;
  color: $hh-ink-1;
}

.empty-desc {
  margin-top: 12rpx;
  font-size: 26rpx;
  color: $hh-ink-3;
}

.empty-button {
  margin-top: 36rpx;
  width: 260rpx;
  height: 78rpx;
  line-height: 78rpx;
  border-radius: $hh-radius-full;
  background: $hh-ink-1;
  color: $hh-surface-1;
  font-size: 26rpx;
}
</style>
