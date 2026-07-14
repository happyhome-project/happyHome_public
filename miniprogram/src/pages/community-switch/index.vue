<template>
  <view class="switch-page">
    <view class="page-head">
      <text class="page-title">请选择你的社区</text>
      <text class="page-subtitle">加入后即可浏览和发帖</text>
    </view>

    <view v-if="loading && !communities.length" class="state-card">
      <text>{{ slowLoading ? '加载较慢，请稍候...' : '正在加载社区...' }}</text>
    </view>

    <view v-else-if="loadError && !communities.length" class="state-card">
      <text>{{ loadError }}</text>
      <view class="state-action" @tap="loadCommunities">
        <text>重试</text>
      </view>
    </view>

    <view v-else class="community-list">
      <view v-if="loading || loadError" class="directory-refresh-state">
        <text v-if="loading">{{ slowLoading ? '加载较慢，已保留现有社区' : '正在更新社区列表...' }}</text>
        <text v-else>{{ loadError }}</text>
        <view v-if="loadError" class="directory-refresh-action" @tap="loadCommunities">
          <text>重试</text>
        </view>
      </view>
      <view v-if="!communities.length" class="state-card">
        <text>暂时没有可加入的社区</text>
      </view>
      <view
        v-for="community in communities"
        :key="community._id"
        class="community-card"
        :class="{ disabled: communityActionBusy || isCardDisabled(community) || switchingId === community._id || applyLock.isBusy(community._id) }"
        @tap="handleCommunityTap(community)"
      >
        <image
          v-if="communityAvatar(community)"
          :src="communityAvatar(community)"
          class="community-avatar"
          mode="aspectFill"
          @error="handleAvatarError(community)"
        />
        <view v-else class="community-avatar avatar-fallback">
          <text>{{ communityInitial(community) }}</text>
        </view>
        <view class="community-main">
          <text class="community-name">{{ communityName(community) }}</text>
          <text class="community-desc">{{ communityDescription(community) }}</text>
        </view>
        <view
          class="community-status"
          :class="{
            joined: community.viewerStatus === 'active',
            pending: community.viewerStatus === 'pending',
            joinable: community.viewerStatus !== 'active' && community.viewerStatus !== 'pending',
          }"
        >
          <text v-if="switchingId === community._id">切换中</text>
          <text v-else>{{ getStatusText(community) }}</text>
        </view>
      </view>

      <view class="create-entry" @tap="goCreate">
        <text class="create-plus">＋</text>
        <text>创建新社区</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { communityApi, memberApi } from '../../api/cloud'
import { useCommunityStore } from '../../store/community'
import { useUserStore } from '../../store/user'
import { resolveCloudFileUrls } from '../../utils/cloud-file-url'
import {
  mergeCommunityDirectory,
  resolvedCommunityCoverUrl,
  singleLineCommunityText,
  type DirectoryCommunity,
} from '../../utils/community-directory'
import { useKeyedBusyLock } from '../../utils/useBusyLock'
import { openOnboardingPreservingStack } from '../../utils/onboarding-nav'
import { clientLog } from '../../utils/client-log'
import { createPerformanceRequestId } from '../../utils/performance-trace'

const communityStore = useCommunityStore()
const userStore = useUserStore()
const communities = ref<DirectoryCommunity[]>([])
const resolvedCoverUrls = ref<Record<string, string>>({})
const failedCoverIds = ref<Record<string, boolean>>({})
const loading = ref(false)
const slowLoading = ref(false)
const loadError = ref('')
const switchingId = ref('')
const communityActionBusy = ref(false)
let coverResolveVersion = 0
let directoryLoadEpoch = 0

async function loadCommunities() {
  const epoch = ++directoryLoadEpoch
  if (!userStore.isLoggedIn) {
    communities.value = []
    loadError.value = ''
    loading.value = false
    slowLoading.value = false
    coverResolveVersion += 1
    openOnboardingPreservingStack({ mode: 'discover' })
    return
  }
  communities.value = mergeCommunityDirectory(
    communityStore.myCommunities,
    communities.value,
  )
  loading.value = true
  slowLoading.value = false
  loadError.value = ''
  const slowTimer = setTimeout(() => {
    if (epoch === directoryLoadEpoch && loading.value) slowLoading.value = true
  }, 5000)
  try {
    const directory = await communityApi.listDiscoverable({
      requestId: createPerformanceRequestId('community-directory'),
      stage: 'community.directory',
      sample: communities.value.length > 0 ? 'warm' : 'cold',
      counts: { cachedCommunityCount: communities.value.length },
    })
    if (epoch !== directoryLoadEpoch) return
    communities.value = mergeCommunityDirectory(
      communityStore.myCommunities,
      (directory.communities || []) as DirectoryCommunity[],
    )
    loading.value = false
    slowLoading.value = false
    void resolveCommunityCovers(communities.value)
  } catch (error) {
    if (epoch !== directoryLoadEpoch) return
    loadError.value = '社区列表加载失败'
    console.error('Failed to load communities:', error)
  } finally {
    clearTimeout(slowTimer)
    if (epoch === directoryLoadEpoch) {
      loading.value = false
      slowLoading.value = false
    }
  }
}

async function resolveCommunityCovers(items: DirectoryCommunity[]) {
  const version = ++coverResolveVersion
  failedCoverIds.value = {}
  const covers = items
    .map((community) => String(community?.coverImage || '').trim())
    .filter(Boolean)
  if (!covers.length) {
    if (version === coverResolveVersion) resolvedCoverUrls.value = {}
    return
  }
  try {
    const resolved = await resolveCloudFileUrls(covers)
    if (version === coverResolveVersion) resolvedCoverUrls.value = resolved
  } catch (error) {
    console.warn('Failed to resolve community covers:', error)
    if (version === coverResolveVersion) resolvedCoverUrls.value = {}
  }
}

function communityAvatar(community: DirectoryCommunity) {
  const id = String(community?._id || '')
  return resolvedCommunityCoverUrl(
    community?.coverImage,
    resolvedCoverUrls.value,
    !!failedCoverIds.value[id],
  )
}

function handleAvatarError(community: DirectoryCommunity) {
  const id = String(community?._id || '')
  if (id) failedCoverIds.value = Object.assign({}, failedCoverIds.value, { [id]: true })
}

function communityInitial(community: DirectoryCommunity) {
  return communityName(community).charAt(0) || '社'
}

function communityName(community: DirectoryCommunity) {
  return singleLineCommunityText(community?.name, '未命名社区')
}

function communityDescription(community: DirectoryCommunity) {
  return singleLineCommunityText(community?.description, '社区内容与活动')
}

function isCardDisabled(community: DirectoryCommunity) {
  return community.viewerStatus === 'pending'
}

function getStatusText(community: DirectoryCommunity) {
  if (community.viewerStatus === 'active') return '已加入'
  if (community.viewerStatus === 'pending') return '审核中'
  return '我要加入'
}

function selectCommunity(community: DirectoryCommunity | string) {
  const shell = typeof community === 'string' ? undefined : community
  const id = String(typeof community === 'string' ? community : community?._id || '').trim()
  if (!id || switchingId.value) return
  const requestId = createPerformanceRequestId('community-switch')
  switchingId.value = id
  communityStore.selectCommunityShell(id, shell, requestId)
  clientLog('info', 'community.switch.shell.commit', {
    trace: {
      requestId,
      stage: 'community.switch',
      counts: { cachedSectionCount: communityStore.currentSections.length },
    },
  })
  uni.switchTab({
    url: '/pages/index/index',
    success: () => {
      switchingId.value = ''
    },
    fail: (error) => {
      communityStore.rollbackCommunitySelection(id)
      switchingId.value = ''
      console.error('Failed to switch community:', error)
      uni.showToast({ title: '切换失败，请重试', icon: 'none' })
    },
  })
}

const applyLock = useKeyedBusyLock(
  async (community: DirectoryCommunity) => {
    if (communityActionBusy.value) return
    communityActionBusy.value = true
    try {
      await memberApi.apply(community._id)
      if (community.joinType === 'open') {
        uni.showToast({ title: '加入成功！', icon: 'success' })
        await communityStore.loadMyCommunities({ loadSections: false })
        selectCommunity(community)
      } else {
        uni.showToast({ title: '申请已提交', icon: 'none' })
        await loadCommunities()
      }
    } catch (error: any) {
      uni.showToast({ title: error?.message || '操作失败', icon: 'none' })
    } finally {
      communityActionBusy.value = false
    }
  },
  (community) => community._id,
)

function handleCommunityTap(community: DirectoryCommunity) {
  if (communityActionBusy.value || isCardDisabled(community) || switchingId.value || applyLock.isBusy(community._id)) return
  if (community.viewerStatus === 'active') {
    void openJoinedCommunity(community)
    return
  }
  applyLock.run(community)
}

async function openJoinedCommunity(community: DirectoryCommunity) {
  if (communityActionBusy.value) return
  communityActionBusy.value = true
  try {
    selectCommunity(community)
  } finally {
    communityActionBusy.value = false
  }
}

function goCreate() {
  if (communityActionBusy.value) return
  uni.navigateTo({ url: '/pages/createCommunity/index' })
}

onShow(() => {
  void loadCommunities()
})
</script>

<style lang="scss" scoped>
.switch-page {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 32rpx 32rpx calc(32rpx + env(safe-area-inset-bottom));
  background: #f2f3f7;
  color: #181818;
}

.page-head {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  margin-bottom: 32rpx;
}

.page-title {
  font-size: 40rpx;
  font-weight: $hh-font-weight-bold;
  line-height: 56rpx;
}

.page-subtitle {
  color: #777;
  font-size: 28rpx;
  line-height: 44rpx;
}

.community-list {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.directory-refresh-state {
  min-height: 64rpx;
  padding: 12rpx 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20rpx;
  border-radius: 16rpx;
  background: rgba(255, 255, 255, 0.72);
  color: #777;
  font-size: 24rpx;
  line-height: 36rpx;
}

.directory-refresh-action {
  flex: 0 0 auto;
  color: #3dad7d;
  font-weight: $hh-font-weight-bold;
}

.community-card {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 24rpx;
  min-height: 160rpx;
  padding: 32rpx;
  background: #fff;
  border-radius: 24rpx;
}

.community-card.disabled {
  opacity: 0.7;
}

.community-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 88rpx;
  height: 88rpx;
  overflow: hidden;
  border-radius: 50%;
}

.avatar-fallback {
  background: $hh-accent-wash;
  color: $hh-accent-ink;
  font-size: 32rpx;
  font-weight: $hh-font-weight-bold;
}

.community-main {
  min-width: 0;
  flex: 1;
}

.community-name,
.community-desc {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.community-name {
  font-size: 36rpx;
  font-weight: $hh-font-weight-bold;
  line-height: 52rpx;
}

.community-desc {
  margin-top: 4rpx;
  color: #a6a6a6;
  font-size: 28rpx;
  line-height: 44rpx;
}

.community-status {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  min-width: 112rpx;
  height: 64rpx;
  padding: 0 24rpx;
  border-radius: 999rpx;
  font-size: 32rpx;
  line-height: 48rpx;
  white-space: nowrap;
}

.community-status.joined,
.community-status.pending {
  min-width: 0;
  height: auto;
  padding: 0;
  border-radius: 0;
  color: #a6a6a6;
}

.community-status.joinable {
  background: #3dad7d;
  color: #fff;
}

.create-entry {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
  height: 96rpx;
  background: #fff;
  border-radius: 24rpx;
  color: #3dad7d;
  font-size: 36rpx;
  font-weight: $hh-font-weight-bold;
  line-height: 52rpx;
}

.create-plus {
  font-size: 42rpx;
  font-weight: $hh-font-weight-medium;
}

.state-card {
  min-height: 220rpx;
  padding: 40rpx 24rpx;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
  align-items: center;
  justify-content: center;
  background: #fff;
  border-radius: 24rpx;
  color: #777;
  font-size: 28rpx;
  line-height: 40rpx;
}

.state-action {
  min-width: 160rpx;
  height: 56rpx;
  padding: 0 28rpx;
  border-radius: 999rpx;
  background: #3dad7d;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26rpx;
  font-weight: $hh-font-weight-bold;
}
</style>
