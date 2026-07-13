<template>
  <view class="notice-page">
    <view v-if="notice" class="notice-detail">
      <text class="notice-heading">{{ notice.label }}</text>
      <view class="notice-author-row">
        <view class="notice-author-avatar">
          <text>{{ notice.icon }}</text>
        </view>
        <view class="notice-author-copy">
          <text class="notice-author-name">{{ notice.sectionName }}</text>
          <text class="notice-publish-date">{{ notice.publishedAt }}</text>
        </view>
      </view>
      <text class="notice-body">{{ notice.content }}</text>
    </view>

    <view v-else class="notice-empty">
      <text class="empty-title">公告不存在或已更新</text>
      <text class="empty-desc">请返回首页重新打开公告。</text>
      <button class="empty-button" @tap="goHome">返回首页</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useCommunityStore } from '../../store/community'
import { useUserStore } from '../../store/user'
import { ensureHierarchyStack, navigateBackOrHome } from '../../utils/hierarchy-nav'
import { resolveSectionIconGlyph } from '../../utils/section-icon'

interface NoticeDetail {
  sectionName: string
  label: string
  content: string
  icon: string
  publishedAt: string
}

const communityStore = useCommunityStore()
const userStore = useUserStore()
const notice = ref<NoticeDetail | null>(null)
const sectionId = ref('')
const widgetId = ref('')

async function ensureSectionsLoaded() {
  if (communityStore.currentSections.length > 0) return
  userStore.loadFromStorage()
  communityStore.loadFromStorage()
  if (!userStore.isLoggedIn) return
  await communityStore.loadMyCommunities()
}

function resolveNotice() {
  const section = communityStore.currentSections.find((item) => item._id === sectionId.value)
  const widget = section?.widgets?.find((item) => item.widgetId === widgetId.value && item.type === 'admin_notice')
  const content = String(widget?.noticeContent || '').trim()
  if (!section || !widget || !content) {
    notice.value = null
    return
  }
  notice.value = {
    sectionName: section.name,
    label: widget.label || '公告',
    content,
    icon: resolveSectionIconGlyph(section.icon, '告'),
    publishedAt: formatNoticeDate(section.createdAt),
  }
}

function formatNoticeDate(value: unknown) {
  if (!value) return ''
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function goHome() {
  navigateBackOrHome()
}

onLoad(async (query) => {
  uni.setNavigationBarTitle({ title: '公告详情' })
  if (ensureHierarchyStack('/pages/notice/index', query || {})) return
  sectionId.value = decodeURIComponent(String(query?.sectionId || ''))
  widgetId.value = decodeURIComponent(String(query?.widgetId || ''))
  await ensureSectionsLoaded()
  resolveNotice()
})
</script>

<style lang="scss" scoped>
.notice-page {
  min-height: 100vh;
  padding: 36rpx 40rpx 80rpx;
  background: $hh-surface-1;
  box-sizing: border-box;
}

.notice-detail {
  max-width: 100%;
}

.notice-heading {
  display: block;
  color: $hh-ink-1;
  font-family: $hh-font-serif;
  font-size: 42rpx;
  font-weight: $hh-font-weight-bold;
  line-height: 1.35;
}

.notice-author-row {
  display: flex;
  align-items: center;
  gap: 18rpx;
  margin-top: 26rpx;
}

.notice-author-avatar {
  width: 56rpx;
  height: 56rpx;
  border-radius: 999rpx;
  background: $hh-surface-2;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.notice-author-avatar text {
  color: $hh-ink-2;
  font-size: 25rpx;
  font-weight: $hh-font-weight-heavy;
}

.notice-author-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.notice-author-name {
  font-size: 26rpx;
  font-weight: $hh-font-weight-medium;
  color: $hh-ink-1;
  line-height: 1.25;
}

.notice-publish-date {
  margin-top: 4rpx;
  font-size: 22rpx;
  color: $hh-ink-3;
}

.notice-body {
  display: block;
  margin-top: 40rpx;
  font-size: 30rpx;
  line-height: 1.82;
  color: $hh-ink-2;
  white-space: pre-wrap;
  word-break: break-word;
}

.notice-empty {
  min-height: 70vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 0 48rpx;
}

.empty-title {
  font-size: 32rpx;
  font-weight: $hh-font-weight-bold;
  color: $hh-ink-1;
}

.empty-desc {
  margin-top: 12rpx;
  font-size: 26rpx;
  color: $hh-ink-3;
}

.empty-button {
  margin-top: 36rpx;
  width: 260rpx;
  height: 78rpx;
  line-height: 78rpx;
  border-radius: $hh-radius-full;
  background: $hh-ink-1;
  color: $hh-surface-1;
  font-size: 26rpx;
}
</style>
