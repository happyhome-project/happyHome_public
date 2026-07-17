<template>
  <view class="my-posts-page" data-testid="my-posts-page">
    <view class="my-posts-heading">
      <text class="my-posts-title">我发布的</text>
      <text v-if="total" class="my-posts-count">{{ total }} 篇</text>
    </view>

    <view v-if="loading && !hasCards" class="my-posts-skeletons">
      <view v-for="item in 4" :key="item" class="my-posts-skeleton" />
    </view>

    <view v-else-if="error && !hasCards" class="my-posts-state">
      <text class="my-posts-state-title">暂时没有加载出来</text>
      <text class="my-posts-state-copy">{{ error }}</text>
      <button class="my-posts-state-button" @tap="loadPosts(true)">重试</button>
    </view>

    <view v-else-if="!hasCards" class="my-posts-state">
      <text class="my-posts-state-title">还没有发布内容</text>
      <text class="my-posts-state-copy">从一张照片或一段文字开始记录吧</text>
      <button class="my-posts-state-button" @tap="goPublish">去发布</button>
    </view>

    <AuthorPostColumns v-else :columns="columns" @open="openPost" />

    <view v-if="loading && hasCards" class="my-posts-footer">加载中...</view>
    <view v-else-if="hasCards && !hasMore" class="my-posts-footer">已经到底了</view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app'
import { postApi } from '../../api/cloud'
import AuthorPostColumns from '../../components/AuthorPostColumns.vue'
import { useUserStore } from '../../store/user'
import { appendAuthorPosts, type AuthorPostColumns as AuthorPostColumnsType } from '../../utils/author-post-feed'
import { resolveCloudFileUrls } from '../../utils/cloud-file-url'

const userStore = useUserStore()
const columns = ref<AuthorPostColumnsType>([[], []])
const loading = ref(false)
const error = ref('')
const total = ref(0)
const hasMore = ref(false)
const pageSize = 20

const hasCards = computed(() => columns.value[0].length + columns.value[1].length > 0)

onShow(() => {
  if (!userStore.isLoggedIn) {
    uni.showToast({ title: '请先登录', icon: 'none' })
    uni.switchTab({ url: '/pages/profile/index' })
    return
  }
  void loadPosts(true)
})

onPullDownRefresh(async () => {
  try {
    await loadPosts(true)
  } finally {
    uni.stopPullDownRefresh()
  }
})

onReachBottom(() => {
  if (hasMore.value && !loading.value) void loadPosts(false)
})

async function loadPosts(reset: boolean) {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const skip = reset ? 0 : columns.value[0].length + columns.value[1].length
    const result = await postApi.listMine(skip, pageSize)
    const nextColumns = appendAuthorPosts(reset ? [[], []] : columns.value, result.posts || [])
    const coverFileIds = nextColumns
      .flat()
      .filter(card => card.cover.kind === 'image')
      .map(card => card.cover.kind === 'image' ? card.cover.src : '')
      .filter(Boolean)
    const resolved = await resolveCloudFileUrls(coverFileIds)
    nextColumns.flat().forEach((card) => {
      if (card.cover.kind === 'image') card.cover.src = resolved[card.cover.src] || card.cover.src
    })
    columns.value = nextColumns
    total.value = Number(result.total || 0)
    hasMore.value = Boolean(result.hasMore)
  } catch (loadError: any) {
    error.value = loadError?.message || '请稍后重试'
  } finally {
    loading.value = false
  }
}

function openPost(postId: string) {
  uni.navigateTo({ url: `/pages/detail/index?postId=${encodeURIComponent(postId)}` })
}

function goPublish() {
  uni.navigateTo({ url: '/pages/create/index?mode=collaboration' })
}

</script>

<style lang="scss" scoped>
.my-posts-page {
  min-height: 100vh;
  padding: 0 16rpx calc(42rpx + env(safe-area-inset-bottom));
  background: #fff;
  box-sizing: border-box;
}

.my-posts-heading {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
  padding: 28rpx 4rpx 24rpx;
}

.my-posts-title { color: #171717; font-size: 36rpx; font-weight: 650; }
.my-posts-count { color: #999; font-size: 22rpx; }

.my-posts-skeletons {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: 12rpx;
}

.my-posts-skeleton { height: 420rpx; border-radius: 12rpx; background: #f3f3f3; }
.my-posts-state {
  min-height: 65vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18rpx;
}
.my-posts-state-title { color: #222; font-size: 32rpx; font-weight: 600; }
.my-posts-state-copy { color: #999; font-size: 24rpx; }
.my-posts-state-button {
  margin: 10rpx 0 0;
  padding: 0 36rpx;
  border: 0;
  border-radius: 999rpx;
  color: #fff;
  background: #222;
  font-size: 25rpx;
}
.my-posts-state-button::after { border: 0; }
.my-posts-footer { padding: 36rpx 0 8rpx; color: #aaa; font-size: 22rpx; text-align: center; }
</style>
