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
        @tap="handleApply(community)"
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

const communities = ref<any[]>([])
const communityStore = useCommunityStore()

onMounted(async () => {
  const res = await communityApi.list(true)
  communities.value = res.communities
})

async function handleApply(community: any) {
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
}

function handleCreate() {
  uni.navigateTo({ url: '/pages/createCommunity/index' })
}
</script>

<style scoped>
.onboarding { padding: 32rpx; }
.header { margin-bottom: 40rpx; }
.title { font-size: 48rpx; font-weight: bold; display: block; }
.subtitle { font-size: 28rpx; color: #666; margin-top: 8rpx; display: block; }
.community-card {
  display: flex; align-items: center; padding: 24rpx;
  background: #fff; border-radius: 16rpx; margin-bottom: 20rpx;
  box-shadow: 0 2rpx 12rpx rgba(0,0,0,0.06);
}
.cover { width: 100rpx; height: 100rpx; border-radius: 12rpx; flex-shrink: 0; }
.info { flex: 1; margin: 0 20rpx; }
.name { font-size: 32rpx; font-weight: 600; display: block; }
.desc { font-size: 26rpx; color: #888; margin-top: 4rpx; display: block; }
.meta { font-size: 24rpx; color: #aaa; margin-top: 4rpx; display: block; }
.badge { font-size: 24rpx; padding: 8rpx 16rpx; border-radius: 20rpx; white-space: nowrap; }
.badge.open { background: #e8f5e9; color: #2e7d32; }
.badge.approval { background: #fff3e0; color: #e65100; }
.footer { margin-top: 40rpx; }
.create-btn { background: #f5f5f5; color: #333; border-radius: 12rpx; }
</style>
