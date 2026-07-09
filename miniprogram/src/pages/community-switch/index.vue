<template>
  <view class="switch-page">
    <view class="switch-hero">
      <text class="switch-eyebrow">当前社区</text>
      <text class="switch-title">选择社区</text>
      <text class="switch-subtitle">选择要浏览和发布内容的社区</text>
    </view>

    <view v-if="currentCommunity" class="current-card">
      <view class="current-avatar">
        <text>{{ communityInitial(currentCommunity) }}</text>
      </view>
      <view class="current-main">
        <text class="current-label">正在浏览</text>
        <text class="current-name">{{ currentCommunity.name }}</text>
      </view>
    </view>

    <view class="switch-section">
      <view class="section-head">
        <text class="section-title">我的社区</text>
        <text v-if="communities.length" class="section-count">{{ communities.length }} 个</text>
      </view>

      <view v-if="loading" class="state-card">
        <text>正在加载社区...</text>
      </view>

      <view v-else-if="loadError" class="state-card">
        <text>{{ loadError }}</text>
        <view class="state-action" @tap="loadCommunities">
          <text>重试</text>
        </view>
      </view>

      <view v-else-if="!communities.length" class="state-card">
        <text>还没有加入社区</text>
        <view class="state-action" @tap="goDiscover">
          <text>发现社区</text>
        </view>
      </view>

      <view v-else class="community-list">
        <view
          v-for="community in communities"
          :key="community._id"
          class="community-card"
          :class="{ active: isCurrent(community._id), busy: switchingId === community._id }"
          @tap="selectCommunity(community._id)"
        >
          <view class="community-avatar">
            <text>{{ communityInitial(community) }}</text>
          </view>
          <view class="community-main">
            <text class="community-name">{{ community.name || '未命名社区' }}</text>
            <text class="community-desc">{{ communityDescription(community) }}</text>
          </view>
          <view class="community-status">
            <text v-if="isCurrent(community._id)">当前</text>
            <text v-else-if="switchingId === community._id">切换中</text>
            <text v-else>切换</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useCommunityStore } from '../../store/community'
import { useUserStore } from '../../store/user'
import { openOnboardingPreservingStack } from '../../utils/onboarding-nav'
import type { Community } from '../../../../cloud/shared/types'

const communityStore = useCommunityStore()
const userStore = useUserStore()
const loading = ref(false)
const loadError = ref('')
const switchingId = ref('')

const communities = computed(() => communityStore.myCommunities ?? [])
const currentCommunity = computed<Community | undefined>(() =>
  communityStore.currentCommunity ||
  communities.value.find((community) => community._id === communityStore.currentCommunityId),
)

function communityInitial(community: Community) {
  const name = String(community?.name || '').trim()
  return name.charAt(0) || '社'
}

function communityDescription(community: Community) {
  const description = String(community?.description || '').trim()
  if (description) return description
  const memberCount = Number(community?.memberCount || 0)
  return memberCount > 0 ? `${memberCount} 位成员` : '社区内容与活动'
}

function isCurrent(communityId: string) {
  return String(communityId || '') === String(communityStore.currentCommunityId || '')
}

async function loadCommunities() {
  if (!userStore.isLoggedIn) {
    loadError.value = ''
    return
  }
  loading.value = true
  loadError.value = ''
  try {
    await communityStore.loadMyCommunities({ loadSections: false })
  } catch (error) {
    loadError.value = '社区列表加载失败'
    console.error('Failed to load communities:', error)
  } finally {
    loading.value = false
  }
}

async function selectCommunity(communityId: string) {
  const id = String(communityId || '').trim()
  if (!id || switchingId.value) return
  if (isCurrent(id)) {
    uni.switchTab({ url: '/pages/index/index' })
    return
  }
  switchingId.value = id
  try {
    await communityStore.switchCommunity(id)
    uni.switchTab({ url: '/pages/index/index' })
  } catch (error) {
    console.error('Failed to switch community:', error)
    uni.showToast({ title: '切换失败，请重试', icon: 'none' })
  } finally {
    switchingId.value = ''
  }
}

function goDiscover() {
  openOnboardingPreservingStack({ mode: 'discover' })
}

onShow(() => {
  void loadCommunities()
})
</script>

<style lang="scss" scoped>
.switch-page {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 40rpx 24rpx 64rpx;
  background: $hh-surface-0;
  color: $hh-ink-1;
}

.switch-hero {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  padding: 12rpx 4rpx 32rpx;
}

.switch-eyebrow {
  font-size: 22rpx;
  line-height: 32rpx;
  color: $hh-accent;
  font-weight: $hh-font-weight-bold;
}

.switch-title {
  font-size: 44rpx;
  line-height: 60rpx;
  font-weight: $hh-font-weight-heavy;
  color: $hh-ink-1;
}

.switch-subtitle {
  font-size: 26rpx;
  line-height: 38rpx;
  color: $hh-ink-3;
}

.current-card,
.community-card,
.state-card {
  background: $hh-surface-1;
  border: 1rpx solid $hh-ink-line;
  border-radius: $hh-radius-card-figma;
}

.current-card {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 24rpx;
  margin-bottom: 32rpx;
  box-shadow: var(--hh-shadow-soft);
}

.current-avatar,
.community-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 50%;
  background: $hh-accent-wash;
  color: $hh-accent-ink;
  font-weight: $hh-font-weight-bold;
}

.current-avatar {
  width: 80rpx;
  height: 80rpx;
  font-size: 32rpx;
}

.current-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.current-label {
  font-size: 22rpx;
  line-height: 32rpx;
  color: $hh-ink-3;
}

.current-name {
  font-size: 32rpx;
  line-height: 44rpx;
  font-weight: $hh-font-weight-bold;
  color: $hh-ink-1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.switch-section {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4rpx;
}

.section-title {
  font-size: 30rpx;
  line-height: 42rpx;
  font-weight: $hh-font-weight-bold;
}

.section-count {
  font-size: 24rpx;
  line-height: 34rpx;
  color: $hh-ink-3;
}

.community-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.community-card {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 24rpx;
}

.community-card.active {
  border-color: $hh-accent-line;
  background: $hh-accent-wash;
}

.community-card.busy {
  opacity: 0.72;
}

.community-avatar {
  width: 68rpx;
  height: 68rpx;
  font-size: 28rpx;
}

.community-main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.community-name {
  font-size: 30rpx;
  line-height: 42rpx;
  font-weight: $hh-font-weight-bold;
  color: $hh-ink-1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.community-desc {
  font-size: 24rpx;
  line-height: 34rpx;
  color: $hh-ink-3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.community-status {
  flex-shrink: 0;
  min-width: 88rpx;
  height: 48rpx;
  padding: 0 18rpx;
  border-radius: $hh-radius-full;
  display: flex;
  align-items: center;
  justify-content: center;
  background: $hh-surface-2;
  color: $hh-ink-2;
  font-size: 24rpx;
  font-weight: $hh-font-weight-medium;
}

.community-card.active .community-status {
  background: $hh-surface-1;
  color: $hh-accent-ink;
}

.state-card {
  min-height: 220rpx;
  padding: 40rpx 24rpx;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
  align-items: center;
  justify-content: center;
  color: $hh-ink-3;
  font-size: 28rpx;
  line-height: 40rpx;
}

.state-action {
  min-width: 160rpx;
  height: 56rpx;
  padding: 0 28rpx;
  border-radius: $hh-radius-full;
  background: $hh-accent;
  color: $hh-surface-1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26rpx;
  font-weight: $hh-font-weight-bold;
}
</style>
