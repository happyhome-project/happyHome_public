<template>
  <view class="section-page" data-testid="section-page">
      <view v-if="!loading && section" class="section-head" data-testid="section-ready" :data-section-id="section._id">
        <view class="title-row">
          <text class="section-title">{{ sectionName }}</text>
          <text v-if="posts.length" class="section-count">{{ posts.length }} 条</text>
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

      <view v-else-if="posts.length === 0" class="empty-state">
        <view class="empty-illustration" aria-hidden="true">
          <view class="empty-paper">
            <view class="empty-line wide"></view>
            <view class="empty-line mid"></view>
            <view class="empty-line short"></view>
            <view class="empty-block"></view>
          </view>
          <view class="empty-pencil">✎</view>
        </view>
        <text class="empty-title">暂无内容</text>
        <text class="empty-desc">这里还没有帖子，成为第一个分享的人吧</text>
        <button class="empty-action" @tap="goCreatePost">去发布帖子</button>
      </view>

      <view v-else-if="isImageNote" class="image-note-feed">
        <view
          v-for="(column, columnIndex) in imageNoteColumns"
          :key="columnIndex"
          class="image-note-feed-column"
        >
          <view
            v-for="item in column"
            :key="item.postId"
            class="post-card image-note-card"
            data-testid="section-post-card"
            :data-post-id="item.postId"
            @tap="openPost(item.postId)"
          >
            <view
              v-if="item.coverImage && !isSectionImageFailed(item.coverImage)"
              class="post-cover image-note-cover"
            >
              <image
                :src="item.coverImage"
                mode="aspectFill"
                class="post-cover-image"
                @error="onSectionImageError(item.coverImage)"
              />
            </view>
            <view v-else class="post-cover post-cover-empty image-note-cover image-note-cover-empty">
              <text>{{ coverFallbackText(item) }}</text>
            </view>
            <view class="post-body image-note-main">
              <text class="post-title image-note-title">{{ item.title }}</text>
              <view class="post-meta image-note-meta">
                <view class="post-author image-note-author">
                  <image
                    v-if="item.authorAvatar"
                    :src="item.authorAvatar"
                    mode="aspectFill"
                    class="post-avatar image-note-author-avatar"
                  />
                  <view
                    v-else
                    class="post-avatar post-avatar--generated image-note-author-avatar"
                    :style="generatedAvatarStyle(item.postId)"
                  >
                    <text>{{ authorInitial(item.authorName) }}</text>
                  </view>
                  <text class="post-author-name image-note-author-name">{{ item.authorName }}</text>
                </view>
                <view class="image-note-like" :aria-label="`${item.likeCount || 0} 个赞`">
                  <text class="image-note-like-icon" aria-hidden="true">♡</text>
                  <text>{{ item.likeCount || 0 }}</text>
                </view>
              </view>
            </view>
          </view>
        </view>
      </view>

      <view v-else class="post-list">
        <view
          v-for="item in sectionItems"
          :key="item.postId"
          class="post-card"
          data-testid="section-post-card"
          :data-post-id="item.postId"
          :class="{ 'post-card--visual': !!item.coverImage }"
          @tap="openPost(item.postId)"
        >
          <view v-if="item.coverImage" class="post-cover">
            <image
              :src="item.coverImage"
              mode="aspectFill"
              class="post-cover-image"
            />
          </view>
          <view v-else-if="item.hasVisualPlaceholder" class="post-cover post-cover-empty">
            <text>{{ coverFallbackText(item) }}</text>
          </view>

          <view class="post-body">
            <text class="post-title">{{ item.title }}</text>
            <text v-if="item.preview" class="post-preview">{{ item.preview }}</text>
            <view v-if="item.previewLines.length" class="preview-list">
              <text
                v-for="preview in item.previewLines"
                :key="preview.label"
                class="preview-line"
              >{{ preview.label }}: {{ preview.value }}</text>
            </view>
            <text v-if="item.highlight" class="post-highlight">{{ item.highlight }}</text>
            <view class="post-meta">
              <view class="post-author">
                <image
                  v-if="item.authorAvatar"
                  :src="item.authorAvatar"
                  mode="aspectFill"
                  class="post-avatar"
                />
                <view
                  v-else
                  class="post-avatar post-avatar--generated"
                  :style="generatedAvatarStyle(item.postId)"
                >
                  <text>{{ authorInitial(item.authorName) }}</text>
                </view>
                <text class="post-author-name">{{ item.authorName }}</text>
              </view>
              <text v-if="item.meta" class="post-meta-text">{{ item.meta }}</text>
              <text class="post-date">{{ item.when }}</text>
            </view>
          </view>
        </view>
      </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { postApi, sectionApi } from '../../api/cloud'
import { useUserStore } from '../../store/user'
import { CREATE_SECTION_INTENT_KEY } from '../../utils/app-tabbar'
import { getArchiveHomeMeta, getGuideNoteCard, getListPreview, getPostHomeTitle, getPostHomeTitleIssue } from '../../utils/widget'
import { getImageNoteCard, isImageNoteSectionContract } from '../../utils/image-note'
import { clientLog } from '../../utils/client-log'
import { openOnboardingPreservingStack } from '../../utils/onboarding-nav'
import { resolveCloudFileUrls } from '../../utils/cloud-file-url'
import { ensureHierarchyStack } from '../../utils/hierarchy-nav'

const userStore = useUserStore()
const sectionId = ref('')
const section = ref<any>(null)
const posts = ref<any[]>([])
const loading = ref(false)
const loadError = ref('')
const reportedMissingHomeTitle = new Set<string>()
const resolvedGuideCoverUrls = ref<Record<string, string>>({})
const resolvedAuthorAvatarUrls = ref<Record<string, string>>({})
const failedSectionImageUrls = ref<Record<string, true>>({})
const GUIDE_NOTE_NAME_HINTS = ['亲子出游', '周末遛娃', '村游攻略', '路线攻略', '出游攻略']

interface SectionListItem {
  postId: string
  title: string
  coverImage: string
  preview: string
  previewLines: Array<{ label: string; value: string }>
  highlight: string
  meta: string
  authorName: string
  authorAvatar: string
  when: string
  hasVisualPlaceholder: boolean
  likeCount?: number
}

const sectionName = computed(() => String(section.value?.name || '板块'))
const isImageNote = computed(() => isImageNoteSectionContract(section.value))
const isGuideNote = computed(() => {
  if (section.value?.displayTemplate === 'guide_note') return true
  const name = String(section.value?.name || '').trim()
  return GUIDE_NOTE_NAME_HINTS.some((hint) => name.includes(hint))
})

const sectionItems = computed<SectionListItem[]>(() => {
  if (!section.value) return []
  return posts.value.map((post) => {
    if (isImageNote.value) {
      const card = getImageNoteCard(post, section.value)
      const rawCover = String(card.coverImage || '').trim()
      const rawAvatar = String(card.authorAvatarUrl || '').trim()
      return {
        postId: post._id,
        title: card.title,
        coverImage: resolvedGuideCoverUrls.value[rawCover] || rawCover,
        preview: '',
        previewLines: [],
        highlight: '',
        meta: '',
        authorName: card.authorName,
        authorAvatar: resolvedAuthorAvatarUrls.value[rawAvatar] || rawAvatar,
        when: '',
        hasVisualPlaceholder: true,
        likeCount: card.likeCount,
      }
    }
    if (isGuideNote.value) {
      const card = getGuideNoteCard(post, section.value)
      const rawCover = String(card.coverImage || '').trim()
      const rawAvatar = String(post.authorAvatarUrl || '').trim()
      return {
        postId: post._id,
        title: card.title,
        coverImage: resolvedGuideCoverUrls.value[rawCover] || rawCover,
        preview: '',
        previewLines: [],
        highlight: card.driveDuration,
        meta: '',
        authorName: resolveAuthorName(post, card.author),
        authorAvatar: resolvedAuthorAvatarUrls.value[rawAvatar] || rawAvatar,
        when: card.when || formatShortDate(post.createdAt),
        hasVisualPlaceholder: true,
      }
    }

    reportMissingHomeTitle(post, section.value, 'section.list')
    const rawCover = resolvePostCover(post, section.value)
    const rawAvatar = String(post.authorAvatarUrl || '').trim()
    const previewLines = getListPreview(post, section.value).slice(0, 2)
    return {
      postId: post._id,
      title: getPostHomeTitle(post, section.value),
      coverImage: resolvedGuideCoverUrls.value[rawCover] || rawCover,
      preview: previewLines.length ? '' : resolveFallbackPreview(post, section.value),
      previewLines,
      highlight: '',
      meta: getArchiveHomeMeta(post, section.value),
      authorName: resolveAuthorName(post),
      authorAvatar: resolvedAuthorAvatarUrls.value[rawAvatar] || rawAvatar,
      when: formatShortDate(post.createdAt),
      hasVisualPlaceholder: false,
    }
  })
})

const imageNoteColumns = computed<SectionListItem[][]>(() => {
  if (!isImageNote.value) return [[], []]
  return sectionItems.value.reduce<SectionListItem[][]>((columns, item, index) => {
    columns[index % 2].push(item)
    return columns
  }, [[], []])
})

const rawGuideCoverImages = computed(() => {
  if (!section.value) return []
  return posts.value
    .map((post) => {
      if (isImageNote.value) return getImageNoteCard(post, section.value).coverImage
      return isGuideNote.value ? getGuideNoteCard(post, section.value).coverImage : resolvePostCover(post, section.value)
    })
    .filter((url) => String(url || '').trim())
})

const rawAuthorAvatarImages = computed(() => {
  if (!section.value) return []
  return posts.value
    .map((post) => String(post.authorAvatarUrl || '').trim())
    .filter(Boolean)
})

onLoad((options: any) => {
  if (ensureHierarchyStack('/pages/section/index', options || {})) return
  sectionId.value = String(options?.sectionId || '')
  clientLog('info', 'section.onLoad', { sectionId: sectionId.value })
  void loadSectionData()
})

onShow(() => {
  if (sectionId.value && !section.value && !loading.value) {
    void loadSectionData()
  }
})

watch(
  () => userStore.isLoggedIn,
  (loggedIn) => {
    if (loggedIn && sectionId.value) void loadSectionData()
  },
)

watch(
  rawGuideCoverImages,
  async (urls) => {
    if (urls.length === 0) {
      resolvedGuideCoverUrls.value = {}
      return
    }
    try {
      resolvedGuideCoverUrls.value = Object.assign(
        {},
        resolvedGuideCoverUrls.value,
        await resolveCloudFileUrls(urls),
      )
    } catch (error) {
      clientLog('warn', 'section.guideCover.resolve.fail', {
        sectionId: sectionId.value,
        count: urls.length,
        error,
      })
    }
  },
  { immediate: true },
)

watch(
  rawAuthorAvatarImages,
  async (urls) => {
    if (urls.length === 0) {
      resolvedAuthorAvatarUrls.value = {}
      return
    }
    try {
      resolvedAuthorAvatarUrls.value = Object.assign(
        {},
        resolvedAuthorAvatarUrls.value,
        await resolveCloudFileUrls(urls),
      )
    } catch (error) {
      clientLog('warn', 'section.authorAvatar.resolve.fail', {
        sectionId: sectionId.value,
        count: urls.length,
        error,
      })
    }
  },
  { immediate: true },
)

async function loadSectionData() {
  if (!sectionId.value) return
  loading.value = true
  loadError.value = ''
  resolvedGuideCoverUrls.value = {}
  resolvedAuthorAvatarUrls.value = {}
  failedSectionImageUrls.value = {}
  clientLog('info', 'section.load.start', { sectionId: sectionId.value })
  try {
    const results = await Promise.all([
      sectionApi.get(sectionId.value, !userStore.isLoggedIn),
      postApi.list(sectionId.value, 0, !userStore.isLoggedIn),
    ])
    const sectionRes = results[0]
    const postRes = results[1]
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
  clientLog('info', 'section.post.tap', { sectionId: sectionId.value, postId, url })
  uni.navigateTo({
    url,
    fail: (error) => clientLog('error', 'section.post.navigate.fail', { sectionId: sectionId.value, postId, url, error }),
  })
}

function isSectionImageFailed(url: string): boolean {
  return Boolean(failedSectionImageUrls.value[String(url || '').trim()])
}

function onSectionImageError(url: string) {
  const normalized = String(url || '').trim()
  if (!normalized) return
  failedSectionImageUrls.value = Object.assign({}, failedSectionImageUrls.value, { [normalized]: true as const })
}

function goCreatePost() {
  if (!sectionId.value) return
  const returnTo = `/pages/section/index?sectionId=${encodeURIComponent(sectionId.value)}`
  try {
    uni.setStorageSync(CREATE_SECTION_INTENT_KEY, {
      sectionId: sectionId.value,
      createdAt: Date.now(),
      returnTo,
      source: 'section.empty',
    })
  } catch (error) {
    clientLog('warn', 'section.create.intent.storage.fail', { sectionId: sectionId.value, error })
  }
  uni.navigateTo({
    url: `/pages/create/index?returnTo=${encodeURIComponent(returnTo)}`,
    fail: (error) => clientLog('error', 'section.create.navigate.fail', { sectionId: sectionId.value, error }),
  })
}

function reportMissingHomeTitle(post: any, currentSection: any, source: string) {
  const issue = getPostHomeTitleIssue(post, currentSection)
  if (!issue) return
  const key = `${source}:${currentSection?._id || ''}:${post?._id || ''}:${issue.code}`
  if (reportedMissingHomeTitle.has(key)) return
  reportedMissingHomeTitle.add(key)
  clientLog('warn', 'post.missingHomeTitle', {
    source,
    issueCode: issue.code,
    message: issue.message,
    communityId: currentSection?.communityId || '',
    sectionId: currentSection?._id || '',
    sectionName: currentSection?.name || '',
    postId: post?._id || '',
    contentKeys: Object.keys(post?.content || {}),
  })
}

function formatShortDate(value: unknown): string {
  const d = new Date(String(value || ''))
  if (Number.isNaN(d.getTime())) return ''
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${month}-${day}`
}

function resolveAuthorName(post: any, fallback = ''): string {
  return String(fallback || post?.authorNickname || '社区邻居').trim()
}

function authorInitial(name: string): string {
  return splitUnicodeCharacters(String(name || '').trim()).find((char) => char.trim()) || '邻'
}

function coverFallbackText(item: SectionListItem): string {
  return splitUnicodeCharacters(item.title || sectionName.value || '社区').slice(0, 2).join('') || '社区'
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

function generatedAvatarStyle(postId: string) {
  const palettes = [
    ['#F4C7B8', '#7FB099'],
    ['#BFD7EA', '#E5B183'],
    ['#D9C3E6', '#85AFA5'],
    ['#F1D08A', '#7294B8'],
    ['#C9D6A3', '#C4867D'],
  ]
  const palette = palettes[stableHash(postId) % palettes.length]
  return {
    '--section-avatar-start': palette[0],
    '--section-avatar-end': palette[1],
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

function resolvePostCover(post: any, currentSection: any): string {
  const imageWidget = (currentSection?.widgets || []).find((widget: any) => widget?.type === 'image_group')
  if (!imageWidget) return ''
  return firstImageValue(post?.content?.[imageWidget.widgetId])
}

function firstImageValue(value: any): string {
  if (Array.isArray(value)) {
    const first = value.find((item) => String(item || '').trim())
    return String(first || '').trim()
  }
  if (value && typeof value === 'object') {
    const list = Array.isArray(value.urls)
      ? value.urls
      : Array.isArray(value.images)
        ? value.images
        : []
    const first = list.find((item: any) => String(typeof item === 'string' ? item : item?.url || '').trim())
    return String(typeof first === 'string' ? first : first?.url || '').trim()
  }
  return ''
}

function resolveFallbackPreview(post: any, currentSection: any): string {
  const widgets = (currentSection?.widgets || [])
    .filter((widget: any) => ['summary', 'short_text', 'rich_text', 'rich_note'].includes(widget?.type))
    .sort((a: any, b: any) => Number(a.order || 0) - Number(b.order || 0))
  for (const widget of widgets) {
    const value = post?.content?.[widget.widgetId]
    const text = extractText(value)
    if (text && text !== getPostHomeTitle(post, currentSection)) return text.slice(0, 80)
  }
  return ''
}

function extractText(value: any): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).replace(/\s+/g, ' ').trim()
  }
  if (Array.isArray(value)) {
    return value.map(extractText).filter(Boolean).join(' ').trim()
  }
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text.replace(/\s+/g, ' ').trim()
    if (typeof value.markdown === 'string') return value.markdown.replace(/\s+/g, ' ').trim()
    if (Array.isArray(value.blocks)) return value.blocks.map(extractText).filter(Boolean).join(' ').trim()
  }
  return ''
}
</script>

<style lang="scss" scoped>
.section-page {
  min-height: 100vh;
  background: var(--hh-color-page);
  padding: 24rpx 24rpx 72rpx;
  box-sizing: border-box;
}

.section-head {
  padding: 6rpx 4rpx 20rpx;
}

.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
}

.section-title {
  min-width: 0;
  font-size: var(--hh-text-heading-md-size);
  line-height: var(--hh-text-heading-md-line);
  color: var(--hh-color-text-primary);
  font-weight: $hh-font-weight-bold;
}

.section-count {
  flex-shrink: 0;
  font-size: 24rpx;
  color: var(--hh-color-text-tertiary);
}

.state {
  min-height: 360rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 16rpx;
  color: var(--hh-color-text-tertiary);
  font-size: var(--hh-text-body-base-size);
}

.empty-state {
  min-height: 620rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 128rpx 64rpx 0;
  box-sizing: border-box;
}

.empty-illustration {
  position: relative;
  width: 360rpx;
  height: 290rpx;
  margin-bottom: 32rpx;
}

.empty-paper {
  position: absolute;
  left: 90rpx;
  top: 20rpx;
  width: 220rpx;
  height: 240rpx;
  padding: 28rpx;
  box-sizing: border-box;
  border-radius: 36rpx;
  background: #fff;
  box-shadow: 0 16rpx 24rpx rgba(61, 173, 125, 0.1);
}

.empty-line {
  height: 16rpx;
  margin-bottom: 16rpx;
  border-radius: 999rpx;
  background: #e3f5ea;
}

.empty-line.wide { width: 132rpx; }
.empty-line.mid { width: 98rpx; }
.empty-line.short { width: 114rpx; }

.empty-block {
  width: 164rpx;
  height: 84rpx;
  margin-top: 8rpx;
  border-radius: 20rpx;
  background: #e3f5ea;
}

.empty-pencil {
  position: absolute;
  right: 36rpx;
  top: 0;
  width: 80rpx;
  height: 80rpx;
  border-radius: 999rpx;
  background: var(--hh-color-brand-primary);
  color: #fff;
  font-size: 40rpx;
  line-height: 80rpx;
  text-align: center;
  box-shadow: 0 12rpx 16rpx rgba(61, 173, 125, 0.35);
}

.empty-title {
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-heading-md-size);
  line-height: var(--hh-text-heading-md-line);
  font-weight: $hh-font-weight-bold;
}

.empty-desc {
  margin-top: 8rpx;
  color: var(--hh-color-text-tertiary);
  font-size: var(--hh-text-body-lg-size);
  line-height: var(--hh-text-body-lg-line);
  text-align: center;
}

.empty-action {
  width: 576rpx;
  max-width: 100%;
  height: 96rpx;
  margin: 32rpx 0 0;
  padding: 0;
  border: 0;
  border-radius: $hh-radius-full;
  background: var(--hh-color-brand-primary);
  color: #fff;
  font-size: var(--hh-text-heading-sm-size);
  line-height: 96rpx;
  font-weight: $hh-font-weight-bold;
}

.empty-action::after {
  border: 0;
}

.state-title {
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-body-lg-size);
  font-weight: $hh-font-weight-bold;
}

.state-desc {
  color: var(--hh-color-text-tertiary);
  font-size: var(--hh-text-caption-lg-size);
}

.retry-btn {
  border: 1rpx solid var(--hh-color-line);
  color: var(--hh-color-text-primary);
  background: var(--hh-color-card);
}

.post-list {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.image-note-feed {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
}

.image-note-feed-column {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.image-note-card {
  width: 100%;
  box-shadow: var(--hh-shadow-soft);
}

.image-note-cover {
  height: 286rpx;
}

.image-note-feed-column:first-child .image-note-card:nth-child(2n) .image-note-cover {
  height: 238rpx;
}

.image-note-feed-column:nth-child(2) .image-note-card:nth-child(2n + 1) .image-note-cover {
  height: 248rpx;
}

.image-note-feed-column:nth-child(2) .image-note-card:nth-child(2n) .image-note-cover {
  height: 306rpx;
}

.image-note-title {
  display: -webkit-box;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: normal;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.image-note-meta {
  gap: 10rpx;
}

.image-note-like {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4rpx;
  color: var(--hh-color-text-tertiary);
  font-size: var(--hh-text-caption-base-size);
  line-height: var(--hh-text-caption-base-line);
}

.image-note-like-icon {
  font-size: 28rpx;
  line-height: 1;
}

.post-card {
  overflow: hidden;
  border-radius: 16rpx;
  background: var(--hh-color-card);
}

.post-card:active {
  transform: translateY(1rpx);
  opacity: 0.92;
}

.post-cover {
  width: 100%;
  height: 316rpx;
  overflow: hidden;
  background: #cecece;
}

.post-cover-image,
.post-cover-empty {
  width: 100%;
  height: 100%;
}

.post-cover-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 24% 18%, rgba(255, 255, 255, 0.62), transparent 24%),
    linear-gradient(135deg, #d4eadf 0%, #7daf8e 52%, #5a765f 100%);
}

.post-cover-empty text {
  color: rgba(255, 255, 255, 0.9);
  font-size: 64rpx;
  line-height: 1;
  font-weight: $hh-font-weight-bold;
}

.post-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 18rpx 26rpx 18rpx;
}

.post-title {
  display: block;
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-body-lg-size);
  line-height: var(--hh-text-body-lg-line);
  font-weight: $hh-font-weight-bold;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.post-preview {
  display: -webkit-box;
  padding-top: 8rpx;
  overflow: hidden;
  color: var(--hh-color-text-secondary);
  font-size: var(--hh-text-body-base-size);
  line-height: var(--hh-text-body-base-line);
  text-overflow: ellipsis;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.preview-list {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  padding-top: 10rpx;
}

.preview-line {
  display: -webkit-box;
  overflow: hidden;
  text-overflow: ellipsis;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  color: var(--hh-color-text-secondary);
  font-size: var(--hh-text-body-base-size);
  line-height: var(--hh-text-body-base-line);
}

.post-highlight {
  align-self: flex-start;
  margin-top: 12rpx;
  padding: 5rpx 12rpx;
  border-radius: 999rpx;
  background: var(--hh-color-brand-soft);
  color: var(--hh-color-brand-strong);
  font-size: var(--hh-text-caption-base-size);
  line-height: var(--hh-text-caption-base-line);
  font-weight: $hh-font-weight-medium;
}

.post-meta {
  padding-top: 16rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
}

.post-author {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.post-avatar {
  width: 40rpx;
  height: 40rpx;
  border-radius: $hh-radius-full;
  flex: 0 0 auto;
  background: var(--hh-color-brand-soft);
}

.post-avatar--generated {
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 30% 24%, rgba(255, 255, 255, 0.72), transparent 23%),
    linear-gradient(135deg, var(--section-avatar-start), var(--section-avatar-end));
  color: rgba(30, 26, 22, 0.82);
  box-shadow: inset 0 0 0 1rpx rgba(255, 255, 255, 0.7);
}

.post-avatar--generated text {
  font-size: 21rpx;
  line-height: 1;
  font-weight: $hh-font-weight-bold;
}

.post-author-name {
  min-width: 0;
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-caption-base-size);
  line-height: var(--hh-text-caption-base-line);
  font-weight: $hh-font-weight-bold;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.post-meta-text,
.post-date {
  flex-shrink: 0;
  color: var(--hh-color-text-tertiary);
  font-size: var(--hh-text-caption-base-size);
  line-height: var(--hh-text-caption-base-line);
}

.post-meta-text {
  color: var(--hh-color-brand-strong);
  font-weight: $hh-font-weight-medium;
}
</style>
