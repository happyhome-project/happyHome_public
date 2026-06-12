<template>
  <view class="section-page">
    <LoginGuard
      v-if="!userStore.isLoggedIn"
      title="请先登录"
      desc="登录后才能查看板块内容"
    />

    <template v-else>
      <view class="section-head">
        <view class="section-head-main">
          <text class="eyebrow">SECTION</text>
          <view class="title-row">
            <text class="section-title">{{ sectionName }}</text>
            <text v-if="posts.length" class="section-count">{{ posts.length }} 条</text>
          </view>
        </view>
      </view>

      <view v-if="loading" class="state">
        <text>加载中...</text>
      </view>

      <view v-else-if="loadError" class="state error">
        <text class="state-title">加载失败</text>
        <text class="state-desc">{{ loadError }}</text>
        <button class="retry-btn" size="mini" @tap="loadSectionData">重试</button>
      </view>

      <view v-else-if="posts.length === 0" class="state">
        <text>还没有内容</text>
      </view>

      <view v-else-if="isGuideNote" class="guide-list">
        <view
          v-for="item in guideItems"
          :key="item.postId"
          class="guide-list-card"
          @tap="openPost(item.postId)"
        >
          <image
            v-if="item.coverImage"
            :src="item.coverImage"
            mode="aspectFill"
            class="guide-cover"
          />
          <view v-else class="guide-cover guide-cover-empty">
            <text>{{ sectionName.slice(0, 2) }}</text>
          </view>
          <view class="guide-body">
            <text class="guide-title">{{ item.title }}</text>
            <text v-if="item.excerpt" class="guide-excerpt">{{ item.excerpt }}</text>
            <view v-if="item.driveDuration" class="guide-stats">
              <text
                class="guide-stat"
              >{{ item.driveDuration }}</text>
            </view>
            <view class="guide-meta">
              <text v-if="item.when" class="guide-chip">{{ item.when }}</text>
              <text v-if="item.author" class="guide-chip">{{ item.author }}</text>
            </view>
          </view>
        </view>
      </view>

      <view v-else class="default-list">
        <view
          v-for="item in defaultItems"
          :key="item.postId"
          class="default-card"
          @tap="openPost(item.postId)"
        >
          <view class="default-main">
            <text class="default-title">{{ item.title }}</text>
            <view v-if="item.preview.length" class="preview-list">
              <text
                v-for="preview in item.preview"
                :key="preview.label"
                class="preview-line"
              >{{ preview.label }}：{{ preview.value }}</text>
            </view>
          </view>
          <view class="default-side">
            <text v-if="item.meta" class="default-meta">{{ item.meta }}</text>
            <text class="default-when">{{ item.when }}</text>
          </view>
        </view>
      </view>
    </template>
  </view>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import LoginGuard from '../../components/LoginGuard.vue'
import { postApi, sectionApi } from '../../api/cloud'
import { useUserStore } from '../../store/user'
import { getArchiveHomeMeta, getGuideNoteCard, getListPreview } from '../../utils/widget'
import { clientLog } from '../../utils/client-log'

const userStore = useUserStore()
const sectionId = ref('')
const section = ref<any>(null)
const posts = ref<any[]>([])
const loading = ref(false)
const loadError = ref('')

const sectionName = computed(() => String(section.value?.name || '板块'))
const isGuideNote = computed(() => section.value?.displayTemplate === 'guide_note')

const guideItems = computed(() => {
  if (!section.value) return []
  return posts.value.map((post) => ({
    postId: post._id,
    ...getGuideNoteCard(post, section.value),
  }))
})

const defaultItems = computed(() => {
  if (!section.value) return []
  return posts.value.map((post) => ({
    postId: post._id,
    title: getPostTitle(post, section.value),
    preview: getListPreview(post, section.value),
    meta: getArchiveHomeMeta(post, section.value),
    when: formatShortDate(post.createdAt),
  }))
})

onLoad((options: any) => {
  sectionId.value = String(options?.sectionId || '')
  clientLog('info', 'section.onLoad', { sectionId: sectionId.value })
  void loadSectionData()
})

onShow(() => {
  if (userStore.isLoggedIn && sectionId.value && !section.value && !loading.value) {
    void loadSectionData()
  }
})

watch(
  () => userStore.isLoggedIn,
  (loggedIn) => {
    if (loggedIn && sectionId.value) void loadSectionData()
  },
)

async function loadSectionData() {
  if (!sectionId.value || !userStore.isLoggedIn) return
  loading.value = true
  loadError.value = ''
  clientLog('info', 'section.load.start', { sectionId: sectionId.value })
  try {
    const [sectionRes, postRes] = await Promise.all([
      sectionApi.get(sectionId.value),
      postApi.list(sectionId.value, 0),
    ])
    section.value = sectionRes.section || null
    posts.value = postRes.posts || []
    if (!section.value) throw new Error('板块不存在')
    clientLog('info', 'section.load.success', {
      sectionId: sectionId.value,
      postCount: posts.value.length,
      displayTemplate: section.value?.displayTemplate || '',
    })
  } catch (error: any) {
    loadError.value = error?.message || '板块加载失败'
    clientLog('error', 'section.load.fail', { sectionId: sectionId.value, error })
  } finally {
    loading.value = false
  }
}

function openPost(postId: string) {
  if (!postId) return
  const url = `/pages/detail/index?postId=${postId}`
  clientLog('info', 'section.post.tap', { sectionId: sectionId.value, postId, url })
  uni.navigateTo({
    url,
    fail: (error) => clientLog('error', 'section.post.navigate.fail', { sectionId: sectionId.value, postId, url, error }),
  })
}

function getPostTitle(post: any, currentSection: any): string {
  const widget = (currentSection.widgets || []).find((item: any) => ['short_text', 'summary'].includes(item.type))
  if (widget && post.content?.[widget.widgetId]) return String(post.content[widget.widgetId])
  const firstKey = Object.keys(post.content || {})[0]
  return firstKey ? String(post.content[firstKey]) : '无标题'
}

function formatShortDate(value: unknown): string {
  const d = new Date(String(value || ''))
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}/${d.getDate()}`
}
</script>

<style lang="scss" scoped>
.section-page {
  min-height: 100vh;
  background: $hh-surface-0;
  padding: 28rpx 28rpx 64rpx;
  box-sizing: border-box;
}

.section-head {
  padding: 10rpx 0 26rpx;
  border-bottom: 1rpx solid $hh-ink-line-2;
  margin-bottom: 24rpx;
}

.section-head-main {
  min-width: 0;
}

.eyebrow {
  display: block;
  font-family: $hh-font-mono;
  font-size: 20rpx;
  letter-spacing: $hh-tracking-mono;
  color: $hh-ink-3;
  margin-bottom: 12rpx;
}

.title-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 18rpx;
}

.section-title {
  min-width: 0;
  font-family: $hh-font-serif;
  font-size: 44rpx;
  line-height: 1.16;
  color: $hh-ink-1;
  font-weight: $hh-font-weight-bold;
}

.section-count {
  flex-shrink: 0;
  font-size: 24rpx;
  color: $hh-ink-3;
}

.state {
  min-height: 360rpx;
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
}

.retry-btn {
  border: 1rpx solid $hh-ink-line;
  color: $hh-ink-1;
  background: $hh-surface-1;
}

.guide-list,
.default-list {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.guide-list-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1rpx solid $hh-ink-line;
  border-left: 6rpx solid #6C8A4E;
  border-radius: 18rpx;
  background: $hh-surface-1;
  box-shadow: $hh-shadow-card;
}

.guide-list-card:active,
.default-card:active {
  transform: translateY(1rpx);
  opacity: 0.92;
}

.guide-cover {
  width: 100%;
  height: 380rpx;
  border-radius: 0;
  background: $hh-surface-2;
}

.guide-cover-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: $hh-ink-3;
  font-size: 24rpx;
}

.guide-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14rpx;
  padding: 22rpx 24rpx 24rpx;
}

.guide-title,
.default-title {
  color: $hh-ink-1;
  font-size: 34rpx;
  line-height: 1.36;
  font-weight: $hh-font-weight-bold;
}

.guide-excerpt {
  color: $hh-ink-2;
  font-size: 27rpx;
  line-height: 1.56;
  display: -webkit-box;
  overflow: hidden;
  text-overflow: ellipsis;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.guide-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12rpx;
  color: $hh-ink-3;
  font-size: 23rpx;
  line-height: 1.34;
}

.guide-stats {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10rpx;
}

.guide-stat {
  padding: 7rpx 12rpx;
  border-radius: 999rpx;
  background: #eef5ea;
  color: #365d42;
  font-size: 23rpx;
  line-height: 1.3;
  font-weight: $hh-font-weight-medium;
}

.guide-location {
  width: 100%;
  color: $hh-ink-3;
  display: -webkit-box;
  overflow: hidden;
  text-overflow: ellipsis;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.guide-chip {
  padding: 5rpx 12rpx;
  border-radius: 999rpx;
  background: $hh-surface-2;
  color: $hh-ink-3;
}

.default-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18rpx;
  padding: 24rpx;
  border: 1rpx solid $hh-ink-line;
  border-left: 6rpx solid #4F6D8A;
  border-radius: 16rpx;
  background: $hh-surface-1;
  box-shadow: $hh-shadow-card;
}

.default-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.preview-list {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.preview-line {
  color: $hh-ink-2;
  font-size: 25rpx;
  line-height: 1.4;
}

.default-side {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8rpx;
  color: $hh-ink-3;
  font-size: 22rpx;
}

.default-meta {
  color: $hh-accent;
  font-weight: $hh-font-weight-bold;
}

@media (max-width: 420px) {
  .guide-cover {
    height: 330rpx;
  }
}
</style>
