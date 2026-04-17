<template>
  <view class="onboarding">
    <view class="header">
      <text class="title">选择你的社区</text>
      <text class="subtitle">加入后即可浏览和发帖</text>
    </view>
    <view class="community-list">
      <view
        v-for="community in communities"
        :key="community._id"
        class="community-card"
        :class="{ disabled: applyLock.isBusy(community._id) }"
        @tap="applyLock.run(community)"
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
        <view class="badge" :class="community.joinType">
          {{ community.joinType === 'open' ? '直接加入' : '申请加入' }}
        </view>
      </view>
    </view>
    <view class="footer">
      <button class="create-btn" @tap="handleCreate">创建新社区</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { communityApi, memberApi } from '../../api/cloud'
import { useCommunityStore } from '../../store/community'
import { useKeyedBusyLock } from '../../utils/useBusyLock'

const communities = ref<any[]>([])
const communityStore = useCommunityStore()

onMounted(async () => {
  const res = await communityApi.list(false)
  communities.value = res.communities
})

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
      }
    } catch (e: any) {
      uni.showToast({ title: e?.message || '操作失败', icon: 'none' })
    }
  },
  (community) => community._id,
)

function handleCreate() {
  uni.navigateTo({ url: '/pages/createCommunity/index' })
}
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
.footer { margin-top: $hh-space-xl; }
.create-btn { background: $hh-color-bg-sub; color: $hh-color-text; border-radius: $hh-radius-md; }
</style>
