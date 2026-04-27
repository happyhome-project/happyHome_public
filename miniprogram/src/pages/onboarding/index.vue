<template>
  <view class="onboarding">
    <LoginGuard
      v-if="!userStore.isLoggedIn"
      title="请先登录"
      desc="登录后再来发现和加入社区"
    />
    <template v-else>
    <view class="header">
      <text class="title">选择你的社区</text>
      <text class="subtitle">加入后即可浏览和发帖</text>
    </view>
    <view class="community-list">
      <view
        v-for="community in communities"
        :key="community._id"
        class="community-card"
        :class="{ disabled: isCardDisabled(community) || applyLock.isBusy(community._id) }"
        @tap="handleCommunityTap(community)"
      >
        <image
          :src="community.coverImage || '/static/default-community.png'"
          class="cover"
          mode="aspectFill"
        />
        <view class="info">
          <text class="name">{{ community.name }}</text>
          <text class="desc">{{ community.description }}</text>
          <text class="meta">{{ community.memberCount }} 位成员</text>
        </view>
        <view class="badge" :class="[community.joinType, `status-${community.viewerStatus || 'none'}`]">
          {{ getBadgeText(community) }}
        </view>
      </view>
    </view>
    <view class="footer">
      <button class="create-btn" @tap="handleCreate">创建新社区</button>
    </view>
    </template>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { communityApi, memberApi } from '../../api/cloud'
import { useCommunityStore } from '../../store/community'
import { useUserStore } from '../../store/user'
import { useKeyedBusyLock } from '../../utils/useBusyLock'
import LoginGuard from '../../components/LoginGuard.vue'

const communities = ref<any[]>([])
const communityStore = useCommunityStore()
const userStore = useUserStore()
const entryMode = ref<'auto' | 'discover'>('auto')
let refreshingOnboarding = false

onLoad((query?: Record<string, any>) => {
  entryMode.value = query?.mode === 'discover' ? 'discover' : 'auto'
})

onMounted(async () => {
  await refreshOnboardingData()
})

async function loadCommunities() {
  const res = await communityApi.listDiscoverable()
  communities.value = res.communities
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
    if (entryMode.value !== 'discover' && communityStore.myCommunities.length > 0) {
      uni.reLaunch({ url: '/pages/index/index' })
      return
    }
    await loadCommunities()
  } finally {
    refreshingOnboarding = false
  }
}

// Per-community lock — clicking on card A doesn't block card B.
const applyLock = useKeyedBusyLock(
  async (community: any) => {
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
    }
  },
  (community) => community._id,
)

function isCardDisabled(community: any) {
  // pending 申请中的社区：不能重复申请 → 点击无反应
  // creator-pending 自己创建的等超管审批：可点但走 toast 分支（下方 handleCommunityTap 处理）
  return community.viewerStatus === 'pending'
}

function getBadgeText(community: any) {
  if (community.viewerStatus === 'creator-pending') return '审核中 · 你创建的'
  if (community.viewerStatus === 'pending') return '审核中'
  if (community.viewerStatus === 'rejected') return '重新申请'
  return community.joinType === 'open' ? '直接加入' : '申请加入'
}

function handleCommunityTap(community: any) {
  if (isCardDisabled(community) || applyLock.isBusy(community._id)) return
  // 自己创建的待审批社区：点击只弹 toast 说明状态，不触发 apply 流程
  if (community.viewerStatus === 'creator-pending') {
    uni.showToast({
      title: '等待超管审批中，通过后会自动加入',
      icon: 'none',
      duration: 2500,
    })
    return
  }
  applyLock.run(community)
}

function handleCreate() {
  uni.navigateTo({ url: '/pages/createCommunity/index' })
}

onShow(() => {
  void refreshOnboardingData()
})
</script>

<style lang="scss" scoped>
.onboarding { padding: $hh-space-lg; }
.header { margin-bottom: $hh-space-xl; }
.title { font-size: $hh-font-h1; font-weight: $hh-font-weight-bold; display: block; color: $hh-color-text; }
.subtitle { font-size: $hh-font-body; color: $hh-color-text-sub; margin-top: $hh-space-xs; display: block; }
.community-card {
  display: flex; align-items: center; padding: $hh-space-md;
  background: $hh-color-surface; border-radius: $hh-radius-md; margin-bottom: $hh-space-md;
  box-shadow: $hh-shadow-card;
  transition: opacity $hh-duration-base $hh-ease-standard;
}
.community-card.disabled { opacity: $hh-opacity-disabled; pointer-events: none; }
.cover { width: 100rpx; height: 100rpx; border-radius: $hh-radius-sm; flex-shrink: 0; }
.info { flex: 1; margin: 0 $hh-space-md; }
.name { font-size: $hh-font-h3; font-weight: $hh-font-weight-bold; display: block; color: $hh-color-text; }
.desc { font-size: $hh-font-caption; color: $hh-color-text-sub; margin-top: 4rpx; display: block; }
.meta { font-size: $hh-font-caption; color: $hh-color-text-mute; margin-top: 4rpx; display: block; }
.badge { font-size: $hh-font-caption; padding: $hh-space-xs $hh-space-sm; border-radius: $hh-radius-lg; white-space: nowrap; }
.badge.open { background: #e8f5e9; color: #2e7d32; }
.badge.approval { background: #fff3e0; color: #e65100; }
/* creator-pending 用墨绿色调，与普通"审核中"区分开（你创建的 vs 你申请加入的别人的） */
.badge.status-creator-pending {
  background: $hh-accent-wash;
  color: $hh-accent-ink;
  font-weight: $hh-font-weight-bold;
}
.badge.status-pending { background: #f5f5f5; color: #757575; }
.badge.status-rejected { background: #ffebee; color: #c62828; }
.footer { margin-top: $hh-space-xl; }
.create-btn { background: $hh-color-bg-sub; color: $hh-color-text; border-radius: $hh-radius-md; }
</style>
