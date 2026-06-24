<template>
  <view class="search-page">
    <view class="search-head">
      <text class="eyebrow">SEARCH</text>
      <text class="page-title">{{ communityName }}</text>
    </view>

    <view class="search-box">
      <text class="search-icon">⌕</text>
      <input
        v-model="query"
        class="search-input"
        confirm-type="search"
        placeholder="搜索帖子、正文、视频"
        placeholder-class="search-placeholder"
        @confirm="submitSearch"
      />
      <view class="search-button" @tap="submitSearch">
        <text>搜索</text>
      </view>
    </view>

    <view v-if="loading && items.length === 0" class="state">
      <text>搜索中...</text>
    </view>

    <view v-else-if="loadError" class="state error">
      <text class="state-title">搜索失败</text>
      <text class="state-desc">{{ loadError }}</text>
      <button class="retry-btn" size="mini" @tap="submitSearch">重试</button>
    </view>

    <view v-else-if="!searched" class="state">
      <text>输入关键词开始搜索</text>
    </view>

    <view v-else-if="items.length === 0" class="state">
      <text>没有找到相关帖子</text>
    </view>

    <view v-else class="result-list">
      <view class="result-summary">
        <text>{{ total }} 条结果</text>
      </view>
      <view
        v-for="item in items"
        :key="item.postId"
        class="result-card"
        @tap="openPost(item.postId)"
      >
        <view class="result-top">
          <text class="result-section">{{ item.sectionName || '帖子' }}</text>
          <text class="result-date">{{ formatDate(item.updatedAt || item.createdAt) }}</text>
        </view>
        <text class="result-title">{{ item.title || '无标题' }}</text>
        <view v-if="item.matchedFields?.length" class="field-list">
          <view
            v-for="field in item.matchedFields"
            :key="`${item.postId}-${field.fieldLabel}-${field.preview}`"
            class="field-row"
          >
            <text class="field-label">{{ field.fieldLabel }}</text>
            <text class="field-preview">{{ field.preview }}</text>
          </view>
        </view>
      </view>

      <view
        v-if="items.length < total"
        class="load-more"
        :class="{ loading }"
        @tap="loadMore"
      >
        <text>{{ loading ? '加载中...' : '加载更多' }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { postApi } from '../../api/cloud'
import { useCommunityStore } from '../../store/community'
import { useUserStore } from '../../store/user'
import { clientLog } from '../../utils/client-log'
import { openOnboardingPreservingStack } from '../../utils/onboarding-nav'

interface SearchField {
  fieldLabel: string
  fieldType: string
  preview: string
}

interface SearchItem {
  postId: string
  communityId: string
  sectionId: string
  sectionName: string
  title: string
  score: number
  matchedFields: SearchField[]
  createdAt: string
  updatedAt: string
}

const communityStore = useCommunityStore()
const userStore = useUserStore()
const communityId = ref('')
const query = ref('')
const searched = ref(false)
const loading = ref(false)
const loadError = ref('')
const items = ref<SearchItem[]>([])
const total = ref(0)
const limit = 20

const communityName = computed(() => {
  if (communityStore.currentCommunityId === communityId.value && communityStore.currentCommunity?.name) {
    return communityStore.currentCommunity.name
  }
  return '帖子搜索'
})

onLoad((options: any) => {
  communityId.value = decodeParam(options?.communityId) || communityStore.currentCommunityId || ''
  query.value = decodeParam(options?.q || options?.query)
  clientLog('info', 'search.onLoad', {
    communityId: communityId.value,
    hasQuery: !!query.value.trim(),
  })
  if (query.value.trim()) {
    void runSearch({ reset: true })
  }
})

watch(
  () => userStore.isLoggedIn,
  () => {
    if (searched.value && query.value.trim()) void runSearch({ reset: true })
  },
)

function decodeParam(value: unknown): string {
  const raw = String(value || '')
  if (!raw) return ''
  try {
    return decodeURIComponent(raw)
  } catch (_error) {
    return raw
  }
}

function compactQuery(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '')
}

function submitSearch() {
  void runSearch({ reset: true, showShortToast: true })
}

async function loadMore() {
  if (loading.value || items.value.length >= total.value) return
  await runSearch({ reset: false })
}

async function runSearch(options: { reset: boolean; showShortToast?: boolean }) {
  const normalizedQuery = query.value.trim()
  if (!communityId.value) {
    uni.showToast({ title: '请先选择社区', icon: 'none' })
    openOnboardingPreservingStack()
    return
  }
  if (compactQuery(normalizedQuery).length < 2) {
    if (options.showShortToast && normalizedQuery) {
      uni.showToast({ title: '请输入至少两个字', icon: 'none' })
    }
    searched.value = Boolean(normalizedQuery)
    items.value = []
    total.value = 0
    loadError.value = ''
    return
  }

  loading.value = true
  loadError.value = ''
  const skip = options.reset ? 0 : items.value.length
  clientLog('info', 'search.load.start', {
    communityId: communityId.value,
    skip,
    reset: options.reset,
  })
  try {
    const result = await postApi.search({
      communityId: communityId.value,
      query: normalizedQuery,
      skip,
      limit,
      asGuest: !userStore.isLoggedIn,
    })
    const nextItems = result.items || []
    items.value = options.reset ? nextItems : [...items.value, ...nextItems]
    total.value = Number(result.total || items.value.length)
    searched.value = true
    clientLog('info', 'search.load.success', {
      communityId: communityId.value,
      total: total.value,
      returned: nextItems.length,
    })
  } catch (error: any) {
    loadError.value = error?.message || '搜索失败'
    clientLog('error', 'search.load.fail', { communityId: communityId.value, error })
    if (String(loadError.value).includes('需要先加入社区后查看内容')) {
      uni.showToast({ title: '需要先加入社区后查看内容', icon: 'none' })
      openOnboardingPreservingStack({ replaceCurrent: true })
    }
  } finally {
    loading.value = false
  }
}

function openPost(postId: string) {
  if (!postId) return
  const url = `/pages/detail/index?postId=${postId}`
  clientLog('info', 'search.post.tap', { postId, url })
  uni.navigateTo({
    url,
    fail: (error) => clientLog('error', 'search.post.navigate.fail', { postId, url, error }),
  })
}

function formatDate(value: unknown): string {
  const d = new Date(String(value || ''))
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  return sameYear
    ? `${d.getMonth() + 1}/${d.getDate()}`
    : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}
</script>

<style lang="scss" scoped>
.search-page {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 30rpx 28rpx 72rpx;
  background: $hh-surface-0;
}

.search-head {
  padding: 8rpx 0 24rpx;
  border-bottom: 1rpx solid $hh-ink-line-2;
  margin-bottom: 22rpx;
}

.eyebrow {
  display: block;
  font-family: $hh-font-mono;
  font-size: 20rpx;
  letter-spacing: $hh-tracking-mono;
  color: $hh-ink-3;
  margin-bottom: 10rpx;
}

.page-title {
  display: block;
  min-width: 0;
  font-family: $hh-font-serif;
  font-size: 44rpx;
  line-height: 1.18;
  color: $hh-ink-1;
  font-weight: $hh-font-weight-bold;
}

.search-box {
  min-height: 86rpx;
  padding: 0 16rpx 0 24rpx;
  border: 1rpx solid $hh-ink-line;
  border-radius: 20rpx;
  background: $hh-surface-1;
  box-shadow: $hh-shadow-card;
  display: flex;
  align-items: center;
  gap: 14rpx;
}

.search-icon {
  width: 32rpx;
  flex-shrink: 0;
  font-size: 30rpx;
  color: $hh-ink-3;
}

.search-input {
  flex: 1;
  min-width: 0;
  height: 86rpx;
  color: $hh-ink-1;
  font-size: 27rpx;
}

.search-placeholder {
  color: $hh-ink-4;
}

.search-button {
  flex-shrink: 0;
  min-width: 92rpx;
  height: 58rpx;
  padding: 0 18rpx;
  border-radius: $hh-radius-full;
  background: $hh-ink-1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.search-button text {
  font-size: 23rpx;
  font-weight: $hh-font-weight-bold;
  color: $hh-surface-1;
}

.state {
  min-height: 420rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 16rpx;
  color: $hh-ink-3;
  font-size: 26rpx;
}

.state-title {
  color: $hh-ink-1;
  font-size: 30rpx;
  font-weight: $hh-font-weight-bold;
}

.state-desc {
  color: $hh-ink-3;
  font-size: 24rpx;
  line-height: 1.45;
  text-align: center;
}

.retry-btn {
  border: 1rpx solid $hh-ink-line;
  color: $hh-ink-1;
  background: $hh-surface-1;
}

.result-list {
  margin-top: 24rpx;
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.result-summary {
  padding: 0 4rpx;
  font-family: $hh-font-mono;
  font-size: 20rpx;
  letter-spacing: $hh-tracking-mono-sm;
  color: $hh-ink-3;
}

.result-card {
  padding: 24rpx;
  border: 1rpx solid $hh-ink-line;
  border-left: 6rpx solid #4F6D8A;
  border-radius: 16rpx;
  background: $hh-surface-1;
  box-shadow: $hh-shadow-card;
}

.result-card:active {
  transform: translateY(1rpx);
  opacity: 0.92;
}

.result-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
  margin-bottom: 10rpx;
}

.result-section,
.result-date {
  font-size: 22rpx;
  color: $hh-ink-3;
  line-height: 1.3;
}

.result-section {
  min-width: 0;
  font-weight: $hh-font-weight-bold;
}

.result-date {
  flex-shrink: 0;
  font-family: $hh-font-num;
}

.result-title {
  display: block;
  color: $hh-ink-1;
  font-size: 32rpx;
  line-height: 1.36;
  font-weight: $hh-font-weight-bold;
}

.field-list {
  margin-top: 16rpx;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.field-row {
  display: flex;
  align-items: flex-start;
  gap: 14rpx;
  min-width: 0;
}

.field-label {
  flex: 0 0 auto;
  max-width: 148rpx;
  padding: 4rpx 10rpx;
  border-radius: 999rpx;
  background: $hh-surface-2;
  color: $hh-ink-3;
  font-size: 21rpx;
  line-height: 1.35;
}

.field-preview {
  flex: 1;
  min-width: 0;
  color: $hh-ink-2;
  font-size: 25rpx;
  line-height: 1.48;
  display: -webkit-box;
  overflow: hidden;
  text-overflow: ellipsis;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.load-more {
  height: 76rpx;
  border: 1rpx solid $hh-ink-line;
  border-radius: 16rpx;
  background: $hh-surface-1;
  color: $hh-ink-2;
  display: flex;
  align-items: center;
  justify-content: center;
}

.load-more.loading {
  opacity: 0.72;
}

.load-more text {
  font-size: 25rpx;
  font-weight: $hh-font-weight-bold;
}
</style>
