<template>
  <view class="onboarding">
    <LoginGuard
      v-if="!userStore.isLoggedIn"
      title="请先登录"
      desc="登录后再来发现和加入社区"
    />
    <template v-else>
      <view class="header">
        <text class="title">请选择你的社区</text>
        <text class="subtitle">加入后即可浏览和发帖</text>
      </view>
      <view class="community-list">
        <view
          v-for="community in communities"
          :key="community._id"
          class="community-card"
          :class="{
            disabled: communityActionBusy || isCardDisabled(community) || applyLock.isBusy(community._id),
            'share-target': isShareTarget(community),
          }"
          @tap="handleCommunityTap(community)"
        >
          <image
            v-if="communityAvatar(community)"
            :src="communityAvatar(community)"
            class="cover"
            mode="aspectFill"
            @error="handleAvatarError(community)"
          />
          <view v-else class="cover cover-fallback">
            <text>{{ communityInitial(community) }}</text>
          </view>
          <view class="info">
            <text class="name">{{ communityName(community) }}</text>
            <text class="desc">{{ communityDescription(community) }}</text>
          </view>
          <view
            class="status"
            :class="{
              joined: community.viewerStatus === 'active',
              pending: community.viewerStatus === 'pending',
              joinable: community.viewerStatus !== 'active' && community.viewerStatus !== 'pending',
            }"
          >
            {{ getBadgeText(community) }}
          </view>
        </view>
        <view class="create-entry" @tap="handleCreate">
          <text class="create-plus">＋</text>
          <text>创建新社区</text>
        </view>
      </view>
    </template>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { onLoad, onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import { communityApi, memberApi } from '../../api/cloud'
import { useCommunityStore } from '../../store/community'
import { useUserStore } from '../../store/user'
import { useKeyedBusyLock } from '../../utils/useBusyLock'
import {
  DISCOVER_ENTRY_STORAGE_KEY,
  resolveOnboardingEntryMode,
  shouldRedirectJoinedUserFromOnboarding,
  type OnboardingEntryMode,
} from '../../utils/onboarding-flow'
import {
  buildCommunitySharePath,
  isCommunityShareQuery,
  normalizeCommunityShareId,
  prioritizeShareTargetCommunities,
  savePendingShareCommunity,
} from '../../utils/community-share'
import LoginGuard from '../../components/LoginGuard.vue'
import { ensureHierarchyStack } from '../../utils/hierarchy-nav'
import { resolveCloudFileUrls } from '../../utils/cloud-file-url'
import {
  mergeCommunityDirectory,
  resolvedCommunityCoverUrl,
  singleLineCommunityText,
} from '../../utils/community-directory'

const communities = ref<any[]>([])
const resolvedCoverUrls = ref<Record<string, string>>({})
const failedCoverIds = ref<Record<string, boolean>>({})
const communityActionBusy = ref(false)
const communityStore = useCommunityStore()
const userStore = useUserStore()
const entryMode = ref<OnboardingEntryMode>('auto')
const targetCommunityId = ref('')
const fromCommunityShare = ref(false)
let refreshingOnboarding = false
let targetUnavailableNotified = false
let coverResolveVersion = 0

onLoad((query?: Record<string, any>) => {
  if (ensureHierarchyStack('/pages/onboarding/index', query || {})) return
  fromCommunityShare.value = isCommunityShareQuery(query)
  targetCommunityId.value = fromCommunityShare.value ? normalizeCommunityShareId(query?.communityId) : ''
  entryMode.value = fromCommunityShare.value ? 'discover' : resolveEntryMode(query)
  if (targetCommunityId.value && !userStore.isLoggedIn) {
    savePendingShareCommunity(targetCommunityId.value)
  }
  if (entryMode.value === 'discover') {
    try {
      uni.removeStorageSync(DISCOVER_ENTRY_STORAGE_KEY)
    } catch {}
  }
})

onMounted(async () => {
  await refreshOnboardingData()
})

async function loadCommunities() {
  const res = await communityApi.listDiscoverable()
  const directory = mergeCommunityDirectory(
    communityStore.myCommunities,
    (res.communities || []) as any[],
  )
  communities.value = prioritizeShareTargetCommunities(directory, targetCommunityId.value)
  await resolveCommunityCovers(communities.value)
  if (targetCommunityId.value && fromCommunityShare.value) {
    const found = communities.value.some((community) => String(community?._id || '') === targetCommunityId.value)
    if (!found && !targetUnavailableNotified) {
      targetUnavailableNotified = true
      uni.showToast({ title: '分享的社群暂不可加入', icon: 'none' })
    }
  }
}

async function resolveCommunityCovers(items: any[]) {
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

function communityAvatar(community: any) {
  const id = String(community?._id || '')
  return resolvedCommunityCoverUrl(
    community?.coverImage,
    resolvedCoverUrls.value,
    !!failedCoverIds.value[id],
  )
}

function handleAvatarError(community: any) {
  const id = String(community?._id || '')
  if (id) failedCoverIds.value = { ...failedCoverIds.value, [id]: true }
}

function communityInitial(community: any) {
  return communityName(community).charAt(0) || '社'
}

function communityName(community: any) {
  return singleLineCommunityText(community?.name, '未命名社区')
}

function communityDescription(community: any) {
  return singleLineCommunityText(community?.description, '社区内容与活动')
}

async function refreshOnboardingData() {
  if (refreshingOnboarding) return
  refreshingOnboarding = true
  try {
    if (!userStore.isLoggedIn) {
      communities.value = []
      return
    }
    await communityStore.loadMyCommunities()
    if (targetCommunityId.value && communityStore.myCommunities.some((community) => community._id === targetCommunityId.value)) {
      communityStore.currentCommunityId = targetCommunityId.value
      communityStore.currentSectionIndex = 0
      communityStore.saveToStorage()
      uni.reLaunch({ url: buildCommunitySharePath(targetCommunityId.value) })
      return
    }
    if (shouldRedirectJoinedUserFromOnboarding(resolveEntryMode(), communityStore.myCommunities.length)) {
      uni.reLaunch({ url: '/pages/index/index' })
      return
    }
    await loadCommunities()
  } finally {
    refreshingOnboarding = false
  }
}

function resolveEntryMode(query?: Record<string, any>): 'auto' | 'discover' {
  let currentPageMode: unknown
  try {
    const pages = getCurrentPages()
    const current = pages[pages.length - 1] as any
    currentPageMode = current?.options?.mode
  } catch {}

  let storedMode: unknown
  try {
    storedMode = uni.getStorageSync(DISCOVER_ENTRY_STORAGE_KEY)
  } catch {}

  return resolveOnboardingEntryMode({
    queryMode: query?.mode,
    currentPageMode,
    storedMode,
    currentMode: entryMode.value,
  })
}

const applyLock = useKeyedBusyLock(
  async (community: any) => {
    if (communityActionBusy.value) return
    communityActionBusy.value = true
    try {
      await memberApi.apply(community._id)
      if (community.joinType === 'open') {
        uni.showToast({ title: '加入成功！', icon: 'success' })
        await communityStore.loadMyCommunities()
        uni.reLaunch({ url: '/pages/index/index' })
      } else {
        uni.showToast({ title: '申请已提交', icon: 'none' })
        await loadCommunities()
      }
    } catch (e: any) {
      uni.showToast({ title: e?.message || '操作失败', icon: 'none' })
    } finally {
      communityActionBusy.value = false
    }
  },
  (community) => community._id,
)

function isCardDisabled(community: any) {
  return community.viewerStatus === 'pending'
}

function isShareTarget(community: any) {
  return !!targetCommunityId.value && String(community?._id || '') === targetCommunityId.value
}

function getBadgeText(community: any) {
  if (community.viewerStatus === 'active') return '已加入'
  if (community.viewerStatus === 'pending') return '审核中'
  return '我要加入'
}

function handleCommunityTap(community: any) {
  if (communityActionBusy.value || isCardDisabled(community) || applyLock.isBusy(community._id)) return
  if (community.viewerStatus === 'active') {
    void openJoinedCommunity(community._id)
    return
  }
  applyLock.run(community)
}

async function openJoinedCommunity(communityId: string) {
  if (communityActionBusy.value) return
  communityActionBusy.value = true
  try {
    await communityStore.switchCommunity(communityId)
    uni.reLaunch({ url: '/pages/index/index' })
  } catch (error) {
    console.error('Failed to switch community:', error)
    uni.showToast({ title: '切换失败，请重试', icon: 'none' })
  } finally {
    communityActionBusy.value = false
  }
}

function handleCreate() {
  if (communityActionBusy.value) return
  uni.navigateTo({ url: '/pages/createCommunity/index' })
}

onShow(() => {
  void refreshOnboardingData()
})

onPullDownRefresh(async () => {
  try {
    await refreshOnboardingData()
  } catch {
    uni.showToast({ title: '刷新失败，请重试', icon: 'none' })
  } finally {
    uni.stopPullDownRefresh()
  }
})
</script>

<style lang="scss" scoped>
.onboarding {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 32rpx 32rpx calc(32rpx + env(safe-area-inset-bottom));
  background: #f2f3f7;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  margin-bottom: 32rpx;
}

.title {
  display: block;
  color: #181818;
  font-size: 40rpx;
  font-weight: $hh-font-weight-bold;
  line-height: 56rpx;
}

.subtitle {
  display: block;
  color: #777;
  font-size: 28rpx;
  line-height: 44rpx;
}

.community-list {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.community-card {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 24rpx;
  min-height: 160rpx;
  padding: 32rpx;
  background: #fff;
  border: 2rpx solid transparent;
  border-radius: 24rpx;
  transition: opacity $hh-duration-base $hh-ease-standard;
}

.community-card.disabled { opacity: 0.7; }

.community-card.share-target {
  border: 2rpx solid $hh-accent;
}

.cover {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 88rpx;
  height: 88rpx;
  overflow: hidden;
  border-radius: 50%;
}

.cover-fallback {
  background: $hh-accent-wash;
  color: $hh-accent-ink;
  font-size: 32rpx;
  font-weight: $hh-font-weight-bold;
}

.info {
  min-width: 0;
  flex: 1;
}

.name,
.desc {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.name {
  color: #181818;
  font-size: 36rpx;
  font-weight: $hh-font-weight-bold;
  line-height: 52rpx;
}

.desc {
  margin-top: 4rpx;
  color: #a6a6a6;
  font-size: 28rpx;
  line-height: 44rpx;
}

.status {
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

.status.joined,
.status.pending {
  min-width: 0;
  height: auto;
  padding: 0;
  border-radius: 0;
  color: #a6a6a6;
}

.status.joinable {
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
</style>
