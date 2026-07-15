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
      <view v-if="loading && communities.length === 0" class="directory-state">正在加载社区...</view>
      <view v-if="slowLoading" class="directory-state directory-state--slow">加载较慢，请稍候</view>
      <view v-if="loadError" class="directory-state directory-state--error" @tap="retryDirectoryLoad">
        {{ loadError }}，点击重试
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
            <text>{{ communityInitial(communityName(community)) }}</text>
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
import { memberApi } from '../../api/cloud'
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
import { communityInitial } from '../../utils/community-avatar'
import {
  mergeCommunityDirectory,
  resolvedCommunityCoverUrl,
  singleLineCommunityText,
} from '../../utils/community-directory'
import {
  loadCommunityDirectory,
  readCommunityDirectoryCache,
} from '../../utils/community-directory-cache'

const communities = ref<any[]>([])
const resolvedCoverUrls = ref<Record<string, string>>({})
const failedCoverIds = ref<Record<string, boolean>>({})
const communityActionBusy = ref(false)
const communityStore = useCommunityStore()
const userStore = useUserStore()
const entryMode = ref<OnboardingEntryMode>('auto')
const targetCommunityId = ref('')
const fromCommunityShare = ref(false)
const loading = ref(false)
const slowLoading = ref(false)
const loadError = ref('')
let targetUnavailableNotified = false
let coverResolveVersion = 0
let directoryLoadEpoch = 0

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

onMounted(() => {
  void refreshOnboardingData()
})

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
  if (id) failedCoverIds.value = Object.assign({}, failedCoverIds.value, { [id]: true })
}

function communityName(community: any) {
  return singleLineCommunityText(community?.name, '未命名社区')
}

function communityDescription(community: any) {
  return singleLineCommunityText(community?.description, '社区内容与活动')
}

async function refreshOnboardingData(force = false) {
  const epoch = ++directoryLoadEpoch
  loading.value = false
  slowLoading.value = false
  loadError.value = ''
  if (!userStore.isLoggedIn) {
    communities.value = []
    coverResolveVersion += 1
    return
  }

  const requestedOpenId = String(userStore.openId || '')
  const cached = readCommunityDirectoryCache(requestedOpenId)
  communities.value = prioritizeShareTargetCommunities(
    mergeCommunityDirectory(
      communityStore.myCommunities,
      cached?.communities || communities.value,
    ),
    targetCommunityId.value,
  )
  void resolveCommunityCovers(communities.value)
  loading.value = true
  const slowTimer = setTimeout(() => {
    if (epoch === directoryLoadEpoch && loading.value) slowLoading.value = true
  }, 5000)

  try {
    const result = await loadCommunityDirectory({
      openId: requestedOpenId,
      force,
      traceStage: 'community.directory.onboarding',
    })
    if (epoch !== directoryLoadEpoch || String(userStore.openId || '') !== requestedOpenId) return

    const latest = (result.communities || []) as any[]
    communities.value = prioritizeShareTargetCommunities(
      mergeCommunityDirectory(communityStore.myCommunities, latest),
      targetCommunityId.value,
    )
    loading.value = false
    slowLoading.value = false
    void resolveCommunityCovers(communities.value)

    const joinedTarget = !!targetCommunityId.value && latest.some(
      (community) => (
        String(community?._id || '') === targetCommunityId.value &&
        community.viewerStatus === 'active'
      ),
    )
    if (joinedTarget && fromCommunityShare.value) {
      communityStore.currentCommunityId = targetCommunityId.value
      communityStore.currentSectionIndex = 0
      communityStore.saveToStorage()
      uni.reLaunch({ url: buildCommunitySharePath(targetCommunityId.value) })
      return
    }

    const activeViewerCount = latest.filter(
      (community) => community.viewerStatus === 'active',
    ).length
    if (shouldRedirectJoinedUserFromOnboarding(resolveEntryMode(), activeViewerCount)) {
      uni.reLaunch({ url: '/pages/index/index' })
      return
    }

    if (targetCommunityId.value && fromCommunityShare.value) {
      const found = latest.some((community) => String(community?._id || '') === targetCommunityId.value)
      if (!found && !targetUnavailableNotified) {
        targetUnavailableNotified = true
        uni.showToast({ title: '分享的社群暂不可加入', icon: 'none' })
      }
    }
  } catch (error) {
    if (epoch !== directoryLoadEpoch || String(userStore.openId || '') !== requestedOpenId) return
    loadError.value = '社区列表刷新失败'
    console.error('Failed to load communities:', error)
  } finally {
    clearTimeout(slowTimer)
    if (epoch === directoryLoadEpoch) {
      loading.value = false
      slowLoading.value = false
    }
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

function retryDirectoryLoad() {
  void refreshOnboardingData(true)
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
        await refreshOnboardingData(true)
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
    await refreshOnboardingData(true)
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

.directory-state {
  box-sizing: border-box;
  margin-bottom: 24rpx;
  padding: 20rpx 24rpx;
  border-radius: 16rpx;
  background: #fff;
  color: #777;
  font-size: 26rpx;
  line-height: 40rpx;
  text-align: center;
}

.directory-state--slow {
  color: #8a6416;
  background: #fff8e7;
}

.directory-state--error {
  color: #9b2c2c;
  background: #fff1f1;
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
  font-family: $hh-font-sans;
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
