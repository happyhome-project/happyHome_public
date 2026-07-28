<template>
  <view class="search-page" :class="{ 'search-page--initial': isInitialSearchLayout, 'search-page--searched': !isInitialSearchLayout }">
    <view class="search-nav" :class="{ 'search-nav--initial': isInitialSearchLayout }">
      <button class="search-back" aria-label="返回" @tap="goBack">
        <text>‹</text>
      </button>
      <view class="search-box" :class="{ 'search-box--initial': isInitialSearchLayout }">
        <view
          class="search-query-field"
          :class="{ 'search-query-field--compact': !isInitialSearchLayout && query }"
          :style="compactQueryChipStyle"
        >
          <input
            v-model="query"
            class="search-input"
            confirm-type="search"
            placeholder="亲子游路线"
            placeholder-class="search-placeholder"
            @confirm="submitSearch"
          />
          <text v-if="query" class="clear-icon" @tap="clearQuery">×</text>
        </view>
        <button v-if="isInitialSearchLayout" class="search-submit" @tap="submitSearch">搜索</button>
      </view>
      <!-- #ifdef MP-WEIXIN -->
      <view class="search-native-menu-spacer" aria-hidden="true"></view>
      <!-- #endif -->
    </view>

    <view v-if="loading && resultCount === 0" class="state">
      <text>搜索中...</text>
    </view>

    <view v-else-if="loadError && resultCount === 0" class="state error">
      <text class="state-title">搜索失败</text>
      <text class="state-desc">{{ loadError }}</text>
      <button class="retry-btn" size="mini" @tap="submitSearch">重试</button>
    </view>

    <view v-else-if="!searched" class="search-intro">
      <text class="search-intro-title">搜索社区帖子</text>
      <text class="search-intro-desc">语义搜索会按相关度返回社区中的真实帖子，不生成内容，也不会替帖子下结论。</text>
    </view>

    <view v-if="!loading && !loadError && searched && resultCount === 0" class="empty-result">
      <view class="empty-illustration" aria-hidden="true">
        <view class="empty-paper"></view>
        <view class="empty-folder"></view>
        <text class="empty-plane">↗</text>
      </view>
      <text class="empty-title">暂无相关帖子</text>
      <text class="empty-desc">换个关键词，或试试搜索帖子正文</text>
    </view>

    <ArchiveWaterfall
      v-if="hasSearchCards"
      class="search-results-waterfall"
      :columns="searchFeed.columns"
      :loading="loading"
      :error="loadError"
      :has-more="searchFeed.hasMore"
      @post="openSearchCard"
      @load-more="loadMore"
      @cover-load="onSearchCoverLoad"
      @cover-error="onSearchCoverError"
    />
  </view>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { postApi } from '../../api/cloud'
import ArchiveWaterfall from '../../components/ArchiveWaterfall.vue'
import { useCommunityStore } from '../../store/community'
import { useUserStore } from '../../store/user'
import { refreshCloudFileUrl, resolveCloudFileUrls } from '../../utils/cloud-file-url'
import { clientLog } from '../../utils/client-log'
import { resolveFeedCovers } from '../../utils/feed-cover-url'
import { openOnboardingPreservingStack } from '../../utils/onboarding-nav'
import { ensureHierarchyStack, navigateBackOrHome } from '../../utils/hierarchy-nav'
import type { ArchiveFeedCard, ArchiveFeedColumns } from '../../utils/archive-feed'
import {
  appendSemanticSearchPage,
  emptySemanticSearchFeed,
  type SemanticSearchFeed,
} from '../../utils/semantic-search-feed'
import { createSemanticSearchSession, normalizeSemanticQuery, type SemanticSearchRequest } from '../../utils/semantic-search-session'

const communityStore = useCommunityStore()
const userStore = useUserStore()
const communityId = ref('')
const query = ref('')
const searched = ref(false)
const loading = ref(false)
const loadError = ref('')
const searchFeed = ref<SemanticSearchFeed>(emptySemanticSearchFeed())
const PAGE_SIZE = 10
const MAX_PAGE_SIZE = 20
const searchSession = createSemanticSearchSession()
const searchCoverRecoveryPending = new Set<string>()
const searchCoverRecoveryAttempts = new Map<string, number>()

const communityName = computed(() => {
  if (communityStore.currentCommunityId === communityId.value && communityStore.currentCommunity?.name) {
    return communityStore.currentCommunity.name
  }
  return '帖子搜索'
})
const isInitialSearchLayout = computed(() => !searched.value && !loading.value)
const resultCount = computed(() => searchFeed.value.columns[0].length + searchFeed.value.columns[1].length)
const hasSearchCards = computed(() => resultCount.value > 0)
const compactQueryChipStyle = computed(() => {
  if (isInitialSearchLayout.value || !query.value.trim()) return {}
  const queryWidth = splitUnicodeCharacters(query.value.trim()).reduce((total, char) => {
    return total + (/[\u4e00-\u9fff]/.test(char) ? 16 : 8)
  }, 0)
  return { width: `${Math.min(203, Math.max(64, queryWidth + 49))}px` }
})

onLoad((options: any) => {
  if (ensureHierarchyStack('/pages/search/index', options || {})) return
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

watch(query, (nextDraft) => {
  const edit = searchSession.editDraft(nextDraft)
  if (!edit.invalidated) return
  loading.value = false
  searched.value = false
  searchFeed.value = emptySemanticSearchFeed()
  loadError.value = ''
})

function decodeParam(value: unknown): string {
  let next = String(value || '')
  if (!next) return ''
  for (let i = 0; i < 2; i += 1) {
    try {
      const decoded = decodeURIComponent(next)
      if (decoded === next) break
      next = decoded
    } catch (_error) {
      break
    }
  }
  return next
}

function submitSearch() {
  void runSearch({ reset: true, showShortToast: true })
}

function clearQuery() {
  searchSession.clear()
  loading.value = false
  query.value = ''
  searched.value = false
  searchFeed.value = emptySemanticSearchFeed()
  loadError.value = ''
}

function goBack() {
  navigateBackOrHome()
}

async function loadMore() {
  if (loading.value || !searchFeed.value.hasMore) return
  const request = searchSession.nextPage(query.value, searchFeed.value.nextSkip)
  if (request.kind === 'restart') {
    await runSearch({ reset: true })
    return
  }
  await runSearch({ reset: false, request })
}

async function runSearch(options: { reset: boolean; showShortToast?: boolean; request?: SemanticSearchRequest }) {
  const normalizedQuery = normalizeSemanticQuery(query.value)
  if (!communityId.value) {
    uni.showToast({ title: '请先选择社区', icon: 'none' })
    openOnboardingPreservingStack()
    return
  }
  const queryLength = splitUnicodeCharacters(normalizedQuery).length
  if (queryLength < 1 || queryLength > 80) {
    if (options.showShortToast) {
      uni.showToast({ title: queryLength > 80 ? '最多输入80个字符' : '请输入搜索内容', icon: 'none' })
    }
    searched.value = queryLength > 0
    loading.value = false
    searchFeed.value = emptySemanticSearchFeed()
    loadError.value = ''
    return
  }

  const request = options.reset
    ? searchSession.submit(normalizedQuery)
    : options.request || searchSession.nextPage(query.value, searchFeed.value.nextSkip)
  if (request.kind === 'restart') {
    await runSearch({ reset: true, showShortToast: options.showShortToast })
    return
  }

  loading.value = true
  loadError.value = ''
  const asGuest = shouldSearchAsGuest(communityId.value)
  clientLog('info', 'search.load.start', {
    communityId: communityId.value,
    skip: request.skip,
    reset: options.reset,
    asGuest,
  })
  try {
    const result = await postApi.search({
      communityId: communityId.value,
      query: request.query,
      skip: request.skip,
      limit: Math.min(PAGE_SIZE, MAX_PAGE_SIZE),
      asGuest,
    })
    if (!searchSession.isCurrent(request.requestSeq)) return
    const nextFeed = appendSemanticSearchPage(
      options.reset ? emptySemanticSearchFeed() : searchFeed.value,
      result,
    )
    searchFeed.value = nextFeed
    searched.value = true
    void resolveSearchCovers(nextFeed, request.requestSeq)
    clientLog('info', 'search.load.success', {
      communityId: communityId.value,
      total: nextFeed.total,
      returned: Array.isArray(result.items) ? result.items.length : 0,
      displayed: nextFeed.columns[0].length + nextFeed.columns[1].length,
      hasMore: nextFeed.hasMore,
    })
  } catch (error: any) {
    if (!searchSession.isCurrent(request.requestSeq)) return
    loadError.value = friendlySearchError(error)
    searched.value = true
    clientLog('error', 'search.load.fail', { communityId: communityId.value, error })
    if (String(loadError.value).includes('需要先加入社区后查看内容')) {
      uni.showToast({ title: '需要先加入社区后查看内容', icon: 'none' })
    }
  } finally {
    if (searchSession.isCurrent(request.requestSeq)) {
      loading.value = false
    }
  }
}

function friendlySearchError(error: any): string {
  const message = String(error?.message || error?.errMsg || '')
  if (message.includes('需要先加入社区后查看内容')) return '需要先加入社区后查看内容'
  if (message.includes('FUNCTIONS_EXECUTE_FAIL') || message.includes('callFunction') || message.includes('cloud') || message.includes('HTTP')) {
    return '搜索暂时不可用，请稍后再试'
  }
  return message || '搜索失败'
}

function shouldSearchAsGuest(targetCommunityId: string): boolean {
  const id = String(targetCommunityId || '').trim()
  if (!userStore.isLoggedIn) return true
  const membership = communityStore.getMembershipStatus(id)
  if (membership?.isMember) return false
  if (membership && !membership.isMember) return true
  return !communityStore.myCommunities.some((community) => community._id === id)
}

function openPost(postId: string) {
  if (!postId) return
  const url = `/pages/detail/index?postId=${encodeURIComponent(postId)}`
  clientLog('info', 'search.post.tap', { postId, url })
  uni.navigateTo({
    url,
    fail: (error) => clientLog('error', 'search.post.navigate.fail', { postId, url, error }),
  })
}

function openSearchCard(card: ArchiveFeedCard) {
  openPost(card.postId)
}

async function resolveSearchCovers(feed: SemanticSearchFeed, requestSeq: number) {
  await resolveFeedCovers(feed.columns, resolveCloudFileUrls)
  if (!searchSession.isCurrent(requestSeq) || searchFeed.value !== feed) return
  searchFeed.value = {
    columns: feed.columns.map(column => column.slice()) as ArchiveFeedColumns,
    total: feed.total,
    nextSkip: feed.nextSkip,
    hasMore: feed.hasMore,
  }
}

function searchCoverRecoveryKey(card: ArchiveFeedCard, source: string): string {
  return `${card.postId}:${source}`
}

function commitSearchCoverRender() {
  searchFeed.value = {
    columns: searchFeed.value.columns.map(column => column.slice()) as ArchiveFeedColumns,
    total: searchFeed.value.total,
    nextSkip: searchFeed.value.nextSkip,
    hasMore: searchFeed.value.hasMore,
  }
}

function onSearchCoverLoad(card: ArchiveFeedCard) {
  if (card.cover.kind === 'text') return
  const source = String(card.cover.source || card.cover.src || '').trim()
  if (source) searchCoverRecoveryAttempts.delete(searchCoverRecoveryKey(card, source))
}

async function onSearchCoverError(card: ArchiveFeedCard) {
  if (card.cover.kind === 'text') return
  const source = String(card.cover.source || card.cover.src || '').trim()
  card.cover.src = ''
  commitSearchCoverRender()
  if (!source.startsWith('cloud://')) return

  const key = searchCoverRecoveryKey(card, source)
  if (searchCoverRecoveryPending.has(key)) return
  const attempts = searchCoverRecoveryAttempts.get(key) || 0
  if (attempts >= 2) return
  searchCoverRecoveryAttempts.set(key, attempts + 1)
  searchCoverRecoveryPending.add(key)
  clientLog('warn', 'search.cover.load.fail', {
    postId: card.postId,
    attempt: attempts + 1,
  })
  try {
    const refreshed = await refreshCloudFileUrl(source)
    if (refreshed && !refreshed.startsWith('cloud://')) card.cover.src = refreshed
  } finally {
    searchCoverRecoveryPending.delete(key)
    commitSearchCoverRender()
  }
}

function splitUnicodeCharacters(value: unknown): string[] {
  const source = String(value || '')
  const chars: string[] = []
  for (let index = 0; index < source.length; index += 1) {
    let char = source.charAt(index)
    const first = source.charCodeAt(index)
    if (first >= 0xD800 && first <= 0xDBFF && index + 1 < source.length) {
      const second = source.charCodeAt(index + 1)
      if (second >= 0xDC00 && second <= 0xDFFF) {
        char += source.charAt(index + 1)
        index += 1
      }
    }
    chars.push(char)
  }
  return chars
}

</script>

<style lang="scss" scoped>
.search-page {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 0 24rpx 72rpx;
  background:
    linear-gradient(178deg, #fff 0%, #fff 24%, #f2f3f7 56%, var(--hh-color-page) 100%);
}

.search-nav {
  position: relative;
  height: 116px;
  margin: 0 -24rpx;
  padding: 62px 16px 0;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 16px;
  background: #fefefe;
}

.search-nav--initial {
  height: 163px;
  padding: 0;
  display: block;
}

.search-back {
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--hh-color-text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.search-back::after {
  border: 0;
}

.search-back text {
  font-size: 32px;
  font-weight: $hh-font-weight-regular;
  line-height: 24px;
}

.search-box {
  flex: 0 1 227px;
  min-width: 0;
  max-width: 227px;
  height: 36px;
  box-sizing: border-box;
  padding: 0 12px 0 16px;
  border: 3rpx solid var(--hh-color-brand-primary);
  border-radius: 18px;
  background: var(--hh-color-card);
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-box--initial {
  position: absolute;
  left: 12px;
  top: 67px;
  width: calc(100vw - 124px);
  max-width: 278px;
  min-width: 250px;
  height: 88px;
  margin-left: 0;
  padding: 9.5px 13.5px;
  align-items: stretch;
  flex-direction: column;
  border-radius: 16px;
  box-shadow: 0 8rpx 48rpx rgba(0, 0, 0, 0.05);
}

.search-query-field {
  flex: 1;
  min-width: 0;
  height: 36px;
  display: flex;
  align-items: center;
  box-sizing: border-box;
}

.search-box--initial .search-query-field {
  flex: 0 0 48rpx;
  width: 100%;
  height: 48rpx;
}

.search-query-field--compact {
  flex: 0 1 auto;
  max-width: 203px;
  height: 30px;
  padding: 0 6px 0 13px;
  border-radius: $hh-radius-full;
  background: #f7f7f7;
  gap: 4px;
}

.search-input {
  flex: 1;
  min-width: 0;
  height: 36px;
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-body-lg-size);
}

.search-box--initial .search-input {
  flex: 0 0 48rpx;
  height: 48rpx;
  padding-left: 32px;
}

.search-query-field--compact .search-input {
  height: 24px;
  font-size: 15px;
  line-height: 24px;
}

.search-placeholder {
  color: var(--hh-color-text-disabled);
}

.clear-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border-radius: 999rpx;
  background: var(--hh-color-line-soft);
  color: var(--hh-color-text-tertiary);
  font-size: 16px;
  line-height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.search-submit {
  align-self: flex-end;
  width: 120rpx;
  height: 60rpx;
  margin: 20rpx 0 0;
  padding: 0;
  border: 0;
  border-radius: $hh-radius-full;
  background: var(--hh-color-brand-primary);
  color: #fff;
  font-size: var(--hh-text-body-base-size);
  line-height: 60rpx;
}

.search-submit::after {
  border: 0;
}

.search-native-menu-spacer {
  flex: 0 0 87px;
  height: 32px;
  visibility: hidden;
  pointer-events: none;
}

.search-nav--initial .search-native-menu-spacer {
  position: absolute;
  right: 13px;
  top: 73px;
  width: 87px;
  height: 32px;
}

.search-nav--initial .search-back {
  position: absolute;
  left: 16px;
  top: 77px;
  z-index: 2;
}

.search-intro {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  padding: 56rpx 16rpx 0;
}

.search-results-waterfall {
  margin-right: -24rpx;
  margin-left: -24rpx;
}

.search-intro-title {
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-heading-sm-size);
  font-weight: $hh-font-weight-bold;
  line-height: var(--hh-text-heading-sm-line);
}

.search-intro-desc {
  max-width: 620rpx;
  color: var(--hh-color-text-secondary);
  font-size: var(--hh-text-body-base-size);
  line-height: 1.6;
}

.state {
  min-height: 420rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 16rpx;
  color: var(--hh-color-text-tertiary);
  font-size: var(--hh-text-body-base-size);
}

.empty-result {
  min-height: 590rpx;
  padding-top: 136rpx;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.empty-illustration {
  position: relative;
  width: 270rpx;
  height: 270rpx;
  margin-bottom: 64rpx;
  border-radius: $hh-radius-full;
  background: #f0f0f0;
}

.empty-folder {
  position: absolute;
  left: 35rpx;
  bottom: 35rpx;
  width: 200rpx;
  height: 76rpx;
  border-radius: 8rpx 8rpx 14rpx 14rpx;
  background: var(--hh-color-brand-primary);
}

.empty-folder::before {
  content: '';
  position: absolute;
  top: -22rpx;
  left: 0;
  width: 70rpx;
  height: 36rpx;
  border-radius: 10rpx 10rpx 0 0;
  background: var(--hh-color-brand-primary);
}

.empty-paper {
  position: absolute;
  left: 82rpx;
  top: 28rpx;
  width: 112rpx;
  height: 138rpx;
  border-radius: 4rpx;
  background: #fff;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.04);
}

.empty-plane {
  position: absolute;
  right: 20rpx;
  top: 0;
  color: var(--hh-color-brand-primary);
  font-size: 78rpx;
  line-height: 1;
}

.empty-title {
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-heading-sm-size);
  font-weight: $hh-font-weight-bold;
  line-height: var(--hh-text-heading-sm-line);
}

.empty-desc {
  margin-top: 24rpx;
  color: var(--hh-color-text-tertiary);
  font-size: var(--hh-text-body-lg-size);
  line-height: var(--hh-text-body-lg-line);
}

.state-title {
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-body-lg-size);
  font-weight: $hh-font-weight-bold;
}

.state-desc {
  color: var(--hh-color-text-tertiary);
  font-size: var(--hh-text-caption-lg-size);
  line-height: 1.45;
  text-align: center;
}

.retry-btn {
  border: 1rpx solid var(--hh-color-line);
  color: var(--hh-color-text-primary);
  background: var(--hh-color-card);
}

</style>
