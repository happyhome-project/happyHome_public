<template>
  <view class="my-activities-page" data-testid="my-activities-page">
    <view class="my-activities-heading">
      <text class="my-activities-title">我的活动</text>
      <text v-if="total" class="my-activities-count">{{ total }} 个</text>
    </view>

    <view v-if="loading && !hasCards" class="my-activities-skeletons">
      <view v-for="item in 4" :key="item" class="my-activities-skeleton" />
    </view>

    <view v-else-if="error && !hasCards" class="my-activities-state">
      <text class="my-activities-state-title">暂时没有加载出来</text>
      <text class="my-activities-state-copy">{{ error }}</text>
      <button class="my-activities-primary" @tap="loadActivities(true)">重试</button>
    </view>

    <view v-else-if="!hasCards" class="my-activities-empty" data-testid="my-activities-empty">
      <image
        class="my-activities-empty-art"
        src="/static/profile/my-activities-empty.svg"
        mode="aspectFit"
      />
      <text class="my-activities-state-title">您还没参加任何活动</text>
      <text class="my-activities-state-copy">独乐乐不如众乐乐，快去参加或者发起活动吧~</text>
      <view class="my-activities-actions">
        <button class="my-activities-primary" @tap="goDiscover">去首页看看</button>
        <button class="my-activities-secondary" @tap="goPublish">发起活动</button>
      </view>
    </view>

    <AuthorPostColumns v-else :columns="columns" @open="openPost" />

    <view v-if="loading && hasCards" class="my-activities-footer">加载中...</view>
    <view v-else-if="hasCards && !hasMore" class="my-activities-footer">已经到底了</view>
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
  void loadActivities(true)
})

onPullDownRefresh(async () => {
  try {
    await loadActivities(true)
  } finally {
    uni.stopPullDownRefresh()
  }
})

onReachBottom(() => {
  if (hasMore.value && !loading.value) void loadActivities(false)
})

async function loadActivities(reset: boolean) {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const skip = reset ? 0 : columns.value[0].length + columns.value[1].length
    const result = await postApi.listMyActivities(skip, pageSize)
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

function goDiscover() {
  uni.switchTab({ url: '/pages/index/index' })
}

function goPublish() {
  uni.navigateTo({ url: '/pages/create/index?mode=collaboration' })
}
</script>

<style lang="scss" scoped>
.my-activities-page {
  min-height: 100vh;
  padding: 0 16rpx calc(42rpx + env(safe-area-inset-bottom));
  background: #fff;
  box-sizing: border-box;
}
.my-activities-heading {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
  padding: 28rpx 4rpx 24rpx;
}
.my-activities-title { color: #171717; font-size: 36rpx; font-weight: 650; }
.my-activities-count { color: #999; font-size: 22rpx; }
.my-activities-skeletons {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: 12rpx;
}
.my-activities-skeleton { height: 420rpx; border-radius: 12rpx; background: #f3f3f3; }
.my-activities-state,
.my-activities-empty {
  min-height: 72vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 32rpx 36rpx 80rpx;
  text-align: center;
}
.my-activities-empty-art {
  width: 420rpx;
  height: 318rpx;
  margin-bottom: 28rpx;
}
.my-activities-state-title { color: #26211e; font-size: 32rpx; font-weight: 650; line-height: 46rpx; }
.my-activities-state-copy {
  max-width: 560rpx;
  margin-top: 14rpx;
  color: #8a7770;
  font-size: 24rpx;
  line-height: 38rpx;
}
.my-activities-actions { display: flex; gap: 18rpx; margin-top: 36rpx; }
.my-activities-primary,
.my-activities-secondary {
  min-width: 188rpx;
  height: 76rpx;
  margin: 0;
  padding: 0 30rpx;
  border: 0;
  border-radius: 999rpx;
  font-size: 25rpx;
  font-weight: 600;
  line-height: 76rpx;
}
.my-activities-primary { color: #fff; background: #ff6b4a; box-shadow: 0 10rpx 24rpx rgba(255, 107, 74, 0.25); }
.my-activities-secondary { color: #d84b2b; background: #fff0e9; }
.my-activities-primary::after,
.my-activities-secondary::after { border: 0; }
.my-activities-footer { padding: 36rpx 0 8rpx; color: #aaa; font-size: 22rpx; text-align: center; }
</style>
