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

    <view v-if="loading && items.length === 0" class="state">
      <text>搜索中...</text>
    </view>

    <view v-else-if="loadError" class="state error">
      <text class="state-title">搜索失败</text>
      <text class="state-desc">{{ loadError }}</text>
      <button class="retry-btn" size="mini" @tap="submitSearch">重试</button>
    </view>

    <view v-else-if="!searched" class="search-intro">
      <text class="search-intro-title">搜索社区帖子</text>
      <text class="search-intro-desc">语义搜索会按相关度返回社区中的真实帖子，不生成内容，也不会替帖子下结论。</text>
    </view>

    <view v-if="!loading && !loadError && searched && items.length === 0" class="empty-result">
      <view class="empty-illustration" aria-hidden="true">
        <view class="empty-paper"></view>
        <view class="empty-folder"></view>
        <text class="empty-plane">↗</text>
      </view>
      <text class="empty-title">暂无相关帖子</text>
      <text class="empty-desc">换个关键词，或试试搜索帖子正文</text>
    </view>

    <view v-if="items.length" class="result-list">
      <view
        v-for="item in items"
        :key="item.postId"
        class="result-card"
        @tap="openPost(item.postId)"
      >
        <view class="result-cover">
          <image
            v-if="resultCover(item)"
            :src="resultCover(item)"
            class="result-cover-image"
            mode="aspectFill"
          />
          <view v-else class="result-cover-empty">
            <text>{{ coverFallbackText(item) }}</text>
          </view>
        </view>
        <text class="result-title">{{ item.title || '无标题' }}</text>
        <view class="result-match">
          <text class="result-match-field">{{ item.matchedField }}</text>
          <text class="result-preview">{{ item.matchedSnippet }}</text>
        </view>
        <view class="result-meta">
          <view class="result-author">
            <image
              v-if="hasRealAuthorAvatar(item)"
              :src="resultAuthorAvatar(item)"
              class="result-avatar"
              mode="aspectFill"
            />
            <view
              v-else
              class="result-avatar result-avatar--generated"
              :style="resultGeneratedAvatarStyle(item)"
            >
              <text>{{ resultAuthorInitial(item) }}</text>
            </view>
            <text class="result-author-name">{{ resultAuthorName(item) }}</text>
          </view>
          <text class="result-date">{{ formatDate(item.updatedAt || item.createdAt) }}</text>
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
import { resolveCloudFileUrls } from '../../utils/cloud-file-url'
import { clientLog } from '../../utils/client-log'
import { openOnboardingPreservingStack } from '../../utils/onboarding-nav'
import { ensureHierarchyStack, navigateBackOrHome } from '../../utils/hierarchy-nav'

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
  coverImage?: string
  authorName?: string
  authorAvatarUrl?: string
  avatarUrl?: string
  score: number
  matchedSnippet: string
  matchedField: string
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
const resolvedResultCoverUrls = ref<Record<string, string>>({})
const resolvedResultAvatarUrls = ref<Record<string, string>>({})
const PAGE_SIZE = 10
const MAX_PAGE_SIZE = 20
const generatedAvatarPalettes = [
  ['#F4C7B8', '#7FB099'],
  ['#BFD7EA', '#E5B183'],
  ['#D9C3E6', '#85AFA5'],
  ['#F1D08A', '#7294B8'],
  ['#C9D6A3', '#C4867D'],
]
let searchRequestSeq = 0

const communityName = computed(() => {
  if (communityStore.currentCommunityId === communityId.value && communityStore.currentCommunity?.name) {
    return communityStore.currentCommunity.name
  }
  return '帖子搜索'
})
const isInitialSearchLayout = computed(() => !searched.value && !loading.value)
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
  searchRequestSeq += 1
  loading.value = false
  query.value = ''
  searched.value = false
  items.value = []
  total.value = 0
  loadError.value = ''
  resolvedResultCoverUrls.value = {}
  resolvedResultAvatarUrls.value = {}
}

function goBack() {
  navigateBackOrHome()
}

async function loadMore() {
  if (loading.value || items.value.length >= total.value) return
  await runSearch({ reset: false })
}

async function runSearch(options: { reset: boolean; showShortToast?: boolean }) {
  const requestSeq = ++searchRequestSeq
  const normalizedQuery = query.value.trim()
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
    items.value = []
    total.value = 0
    loadError.value = ''
    return
  }

  loading.value = true
  loadError.value = ''
  const skip = options.reset ? 0 : items.value.length
  const asGuest = shouldSearchAsGuest(communityId.value)
  clientLog('info', 'search.load.start', {
    communityId: communityId.value,
    skip,
    reset: options.reset,
    asGuest,
  })
  try {
    const result = await postApi.search({
      communityId: communityId.value,
      query: normalizedQuery,
      skip,
      limit: Math.min(PAGE_SIZE, MAX_PAGE_SIZE),
      asGuest,
    })
    if (requestSeq !== searchRequestSeq) return
    const nextItems = result.items || []
    items.value = options.reset ? nextItems : items.value.concat(nextItems)
    total.value = Number(result.total || items.value.length)
    searched.value = true
    void resolveResultCovers(items.value)
    clientLog('info', 'search.load.success', {
      communityId: communityId.value,
      total: total.value,
      returned: nextItems.length,
    })
  } catch (error: any) {
    if (requestSeq !== searchRequestSeq) return
    loadError.value = friendlySearchError(error)
    searched.value = true
    clientLog('error', 'search.load.fail', { communityId: communityId.value, error })
    if (String(loadError.value).includes('需要先加入社区后查看内容')) {
      uni.showToast({ title: '需要先加入社区后查看内容', icon: 'none' })
    }
  } finally {
    if (requestSeq === searchRequestSeq) {
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

function resultCover(item: SearchItem): string {
  const raw = String(item.coverImage || '').trim()
  return resolvedResultCoverUrls.value[raw] || raw
}

function coverFallbackText(item: SearchItem): string {
  const name = String(item.sectionName || item.title || '社区').trim()
  return splitUnicodeCharacters(name).slice(0, 2).join('') || '社区'
}

function resultAuthorName(item: SearchItem): string {
  return String(item.authorName || '社区邻居').trim()
}

function resultAuthorAvatar(item: SearchItem): string {
  const raw = String(item.authorAvatarUrl || item.avatarUrl || '').trim()
  return resolvedResultAvatarUrls.value[raw] || raw
}

function hasRealAuthorAvatar(item: SearchItem): boolean {
  const avatar = resultAuthorAvatar(item)
  return avatar.startsWith('http://') || avatar.startsWith('https://') || avatar.startsWith('data:')
}

function resultAuthorInitial(item: SearchItem): string {
  const name = resultAuthorName(item)
  return splitUnicodeCharacters(name).find((char) => char.trim()) || '邻'
}

function resultGeneratedAvatarStyle(item: SearchItem) {
  const palette = generatedAvatarPalettes[stableHash(item.postId) % generatedAvatarPalettes.length]
  return {
    '--result-avatar-start': palette[0],
    '--result-avatar-end': palette[1],
  }
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

async function resolveResultCovers(nextItems: SearchItem[]) {
  const covers = nextItems.map((item) => String(item.coverImage || '').trim()).filter(Boolean)
  const avatars = nextItems.map((item) => String(item.authorAvatarUrl || item.avatarUrl || '').trim()).filter(Boolean)
  if (covers.length === 0 && avatars.length === 0) {
    resolvedResultCoverUrls.value = {}
    resolvedResultAvatarUrls.value = {}
    return
  }
  try {
    const resolved = await resolveCloudFileUrls(covers.concat(avatars))
    const resolvedCovers: Record<string, string> = {}
    for (const cover of covers) resolvedCovers[cover] = resolved[cover] || cover
    const resolvedAvatars: Record<string, string> = {}
    for (const avatar of avatars) resolvedAvatars[avatar] = resolved[avatar] || avatar
    resolvedResultCoverUrls.value = resolvedCovers
    resolvedResultAvatarUrls.value = resolvedAvatars
  } catch (error) {
    clientLog('warn', 'search.cover.resolve.fail', { error })
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

function formatDate(value: unknown): string {
  const d = new Date(String(value || ''))
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return sameYear
    ? `${month}-${day}`
    : `${d.getFullYear()}-${month}-${day}`
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

.result-list {
  margin-top: 24rpx;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.result-summary {
  padding: 0 4rpx 2rpx;
  font-size: var(--hh-text-caption-base-size);
  line-height: var(--hh-text-caption-base-line);
  color: var(--hh-color-text-tertiary);
}

.result-card {
  overflow: hidden;
  border-radius: 16rpx;
  background: var(--hh-color-card);
}

.result-card:active {
  transform: translateY(1rpx);
  opacity: 0.92;
}

.result-title {
  display: block;
  padding: 18rpx 26rpx 0;
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-body-lg-size);
  line-height: var(--hh-text-body-lg-line);
  font-weight: $hh-font-weight-bold;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-match {
  padding: 10rpx 26rpx 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.result-match-field {
  color: var(--hh-color-brand-strong);
  font-size: var(--hh-text-caption-base-size);
  line-height: var(--hh-text-caption-base-line);
}

.result-cover {
  width: 100%;
  height: 304rpx;
  overflow: hidden;
  background: #cecece;
}

.result-cover-image,
.result-cover-empty {
  width: 100%;
  height: 100%;
}

.result-cover-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 24% 18%, rgba(255, 255, 255, 0.62), transparent 24%),
    linear-gradient(135deg, #d4eadf 0%, #7daf8e 52%, #5a765f 100%);
}

.result-cover-empty text {
  color: rgba(255, 255, 255, 0.9);
  font-size: 64rpx;
  line-height: 1;
  font-weight: $hh-font-weight-bold;
}

.result-preview {
  display: -webkit-box;
  padding: 0;
  overflow: hidden;
  color: var(--hh-color-text-secondary);
  font-size: var(--hh-text-body-base-size);
  line-height: var(--hh-text-body-base-line);
  text-overflow: ellipsis;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.result-meta {
  padding: 16rpx 26rpx 18rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
}

.result-author {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.result-avatar {
  width: 40rpx;
  height: 40rpx;
  border-radius: $hh-radius-full;
  background: var(--hh-color-brand-soft);
  flex: 0 0 auto;
}

.result-avatar--generated {
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 30% 24%, rgba(255, 255, 255, 0.72), transparent 23%),
    linear-gradient(135deg, var(--result-avatar-start), var(--result-avatar-end));
  color: rgba(30, 26, 22, 0.82);
  box-shadow: inset 0 0 0 1rpx rgba(255, 255, 255, 0.7);
}

.result-avatar--generated text {
  font-size: 21rpx;
  line-height: 1;
  font-weight: $hh-font-weight-bold;
}

.result-author-name {
  min-width: 0;
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-caption-base-size);
  line-height: var(--hh-text-caption-base-line);
  font-weight: $hh-font-weight-bold;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.result-date {
  flex-shrink: 0;
  color: var(--hh-color-text-tertiary);
  font-size: var(--hh-text-caption-base-size);
  line-height: var(--hh-text-caption-base-line);
}

.field-list {
  display: none;
}

.field-row,
.field-label,
.field-preview {
  display: none;
}

.field-label {
  color: var(--hh-color-brand-strong);
}

.field-preview {
  color: var(--hh-color-text-secondary);
}

.load-more {
  height: 76rpx;
  border: 1rpx solid var(--hh-color-line);
  border-radius: var(--hh-radius-card);
  background: var(--hh-color-card);
  color: var(--hh-color-text-secondary);
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
