<template>
  <view class="phone-inner">
    <view class="home-shell">
      <view class="home-brandbar" aria-label="社群助手">
        <view class="home-brand-title-wrap">
          <text class="home-brand-title">社群助手</text>
          <view class="home-brand-line"></view>
        </view>
      </view>

      <view class="home-topbar">
        <view class="community-identity" @tap="onMastheadTap">
          <view class="community-avatar">
            <image
              v-if="homeHeroImage"
              :src="homeHeroImage"
              class="community-avatar-image"
              mode="aspectFill"
            />
            <text v-else>{{ avatarLetter }}</text>
          </view>
          <text class="community-title">{{ communityName }}</text>
        </view>
        <view
          v-if="hasMultipleCommunities"
          class="community-switch"
          @tap.stop="onMastheadTap"
        >
          <text class="switch-icon">↔</text>
          <text>切换</text>
        </view>
      </view>

      <view v-if="quoteText" class="home-quote">
        <text class="home-quote-mark">“</text>
        <view class="home-quote-main">
          <text class="home-quote-text">{{ quoteText }}</text>
          <view v-if="quoteCite" class="home-quote-cite-wrap">
            <view class="home-quote-line"></view>
            <text class="home-quote-cite">{{ quoteCite }}</text>
          </view>
        </view>
      </view>

      <view class="home-search">
        <view class="home-search-box">
          <view class="home-search-icon" aria-hidden="true">
            <view class="home-search-icon-ring"></view>
            <view class="home-search-icon-handle"></view>
          </view>
          <input
            v-model="homeSearchQuery"
            class="home-search-input"
            confirm-type="search"
            placeholder="搜索帖子、正文、视频"
            placeholder-class="home-search-placeholder"
            @confirm="submitHomeSearch"
          />
          <view class="home-search-action" @tap="submitHomeSearch">
            <text>搜索</text>
          </view>
        </view>
      </view>

      <view class="home-banner">
        <swiper
          v-if="homeBannerItems.length > 0"
          class="home-banner-swiper"
          :current="homeBannerActiveIndex"
          :circular="homeBannerItems.length > 1"
          :duration="260"
          @change="onHomeBannerChange"
          @touchstart="onHomeBannerGestureStart"
          @touchmove="onHomeBannerGestureMove"
          @touchend="onHomeBannerGestureEnd"
          @mousedown="onHomeBannerGestureStart"
          @mousemove="onHomeBannerGestureMove"
          @mouseup="onHomeBannerGestureEnd"
        >
          <swiper-item
            v-for="(banner, i) in homeBannerItems"
            :key="banner.bannerId"
            class="home-banner-slide"
            @tap="openHomeBanner(banner)"
          >
            <image
              v-if="!isHomeBannerImageFailed(banner.imageKey)"
              :src="banner.coverImage"
              class="home-banner-image"
              mode="aspectFill"
              @load="onHomeBannerImageLoad(banner)"
              @error="onHomeBannerImageError(banner, $event)"
            />
            <view v-else class="home-banner-art"></view>
            <view class="home-banner-shade"></view>
            <text class="home-banner-title">{{ banner.title }}</text>
          </swiper-item>
        </swiper>
        <template v-else>
          <view class="home-banner-art"></view>
          <view class="home-banner-shade"></view>
          <text class="home-banner-title">新人必看</text>
        </template>
        <view v-if="homeBannerItems.length > 1" class="home-banner-dots">
          <text
            v-for="(banner, i) in homeBannerItems"
            :key="`${banner.bannerId}-dot`"
            class="home-banner-dot"
            :class="{ active: i === homeBannerActiveIndex }"
          ></text>
        </view>
      </view>
    </view>

    <!-- Admin notice · 管理员维护的固定公告 -->
    <view v-if="noticeRows.length > 0" class="notice-board">
      <view
        v-for="(notice, i) in noticeRows"
        :key="notice.id"
        class="notice-row"
        :class="{ 'is-long': notice.isLong }"
        :style="getNoticeCardStyle(notice, i)"
        @tap="openNotice(notice)"
      >
        <text class="notice-kind">{{ notice.kind }}</text>
        <view class="notice-main">
          <view class="notice-line">
            <text class="notice-badge">{{ i === 0 ? '置顶' : '最新' }}</text>
            <text class="notice-content">{{ notice.preview }}</text>
          </view>
        </view>
        <text v-if="notice.when" class="notice-time">{{ notice.when }}</text>
      </view>
    </view>

    <!-- Live strip · 实时脉冲区：有激活的实时协作板块时显示 -->
    <view v-if="liveItems.length > 0" class="group-section">
      <text class="group-section-title">活动召集</text>
      <view
        v-for="(item, i) in liveItems"
        :key="i"
        class="group-card"
        @tap="onLiveTap(item)"
      >
        <view class="group-icon">
          <text>{{ item.ic }}</text>
        </view>
        <view class="group-body">
          <text class="group-title">{{ item.t }}</text>
          <view class="group-meta">
            <text v-for="(m, j) in item.m" :key="j" class="group-meta-item">{{ m }}</text>
          </view>
        </view>
        <view v-if="item.isPinned || item.isFeatured" class="group-ribbon">
          <text>推荐</text>
        </view>
      </view>
    </view>

    <!-- Schedule strip · 近期日程 -->
    <template v-if="scheduleItems.length > 0">
      <view class="sch-head">
        <text class="sch-head-t"><text class="sch-head-b">近期日程</text><text>· 活动 · 课程 · 通知</text></text>
        <text class="sch-head-more">日历 ›</text>
      </view>
      <scroll-view scroll-x class="sch-strip">
        <view class="sch-inner">
          <view
            v-for="(s, i) in scheduleItems"
            :key="i"
            class="sch-card"
            :class="{ hot: s.highlight }"
          >
            <view class="sch-date">
              <text class="sch-d">{{ s.date }}</text>
              <text class="sch-w">{{ s.day }}</text>
            </view>
            <text class="sch-kind">{{ s.kind }}</text>
            <text class="sch-tt">{{ s.t }}</text>
            <text class="sch-mm">{{ s.m }}</text>
          </view>
        </view>
      </scroll-view>
    </template>

    <scroll-view
      v-if="archiveGroups.length"
      scroll-x
      class="section-tabs"
      :show-scrollbar="false"
    >
      <view class="section-tabs-inner">
        <text
          v-for="(g, index) in archiveGroups"
          :key="g.id"
          class="section-tab"
          :class="{ active: index === activeArchiveIndex }"
          @tap="selectArchiveGroup(g)"
        >{{ g.name }}</text>
      </view>
    </scroll-view>

    <!-- Archive feed · Figma 0626 选中板块内容区 -->
    <view
      v-if="activeArchiveGroup"
      class="active-archive"
      :class="{
        'active-archive--guide': activeArchiveGroup.displayTemplate === 'guide_note',
        'active-archive--default': activeArchiveGroup.displayTemplate !== 'guide_note',
      }"
      :style="activeArchiveStyle"
    >
      <view class="active-archive-body">
        <view
          v-if="activeArchiveGroup.displayTemplate === 'guide_note'"
          class="guide-feed"
        >
          <view
            v-for="(column, columnIndex) in guideColumns"
            :key="columnIndex"
            class="guide-feed-column"
          >
            <view
              v-for="(item, i) in column"
              :key="item.postId || columnIndex + '-' + i"
              class="guide-card"
              @tap="onPostTap(item)"
            >
              <image
                v-if="item.coverImage && !isHomeGuideImageFailed(item.imageKey)"
                :src="item.coverImage"
                mode="aspectFill"
                class="guide-cover"
                @load="onHomeGuideImageLoad(item)"
                @error="onHomeGuideImageError(item, $event)"
              />
              <view v-else class="guide-cover guide-cover-empty">
                <text>{{ activeArchiveGroup.name.slice(0, 2) }}</text>
              </view>
              <view class="guide-main">
                <text class="guide-title">{{ item.t }}</text>
                <text v-if="item.excerpt" class="guide-excerpt">{{ item.excerpt }}</text>
                <view v-if="item.driveDuration" class="guide-stats">
                  <text class="guide-stat">{{ item.driveDuration }}</text>
                </view>
                <view v-if="item.isPinned || item.isFeatured" class="post-badges guide-badges">
                  <text v-if="item.isPinned" class="post-badge pin">置顶</text>
                  <text v-if="item.isFeatured" class="post-badge feature">精华</text>
                </view>
                <view class="guide-meta">
                  <view v-if="item.contentAuthor" class="guide-author">
                    <view
                      class="guide-author-avatar"
                      :style="getGuideAuthorAvatarStyle(item.contentAuthor)"
                    >
                      <text>{{ getAuthorInitial(item.contentAuthor) }}</text>
                    </view>
                    <text class="guide-author-name">{{ item.contentAuthor }}</text>
                  </view>
                  <text v-if="item.when" class="guide-when">{{ item.when }}</text>
                </view>
              </view>
            </view>
          </view>
        </view>

        <view
          v-else
          class="arc-card"
          :data-index="activeArchiveIndex"
          :style="getArchiveCardStyle(activeArchiveGroup, activeArchiveIndex)"
          @tap="onGroupHeaderTap(activeArchiveGroup)"
        >
          <view
            v-for="(item, i) in activeArchiveGroup.items"
            :key="item.postId || i"
            class="arc-item"
            @tap.stop="onPostTap(item)"
          >
            <!-- kicker 小标：当前装饰版固定 01/02/03；未来接真实档案号时仍走 item.k -->
            <text v-if="item.k" class="arc-k">{{ item.k }}</text>
            <view class="arc-tl">
              <text class="arc-title">{{ item.t }}</text>
              <view v-if="item.isPinned || item.isFeatured" class="post-badges">
                <text v-if="item.isPinned" class="post-badge pin">置顶</text>
                <text v-if="item.isFeatured" class="post-badge feature">精华</text>
              </view>
              <view class="arc-mm">
                <text v-if="item.contentAuthor" class="arc-content-author">{{ item.contentAuthor }}</text>
                <text v-if="item.meta" class="arc-meta" :class="{ hot: item.hot }">{{ item.meta }}</text>
              </view>
            </view>
            <text class="arc-when">{{ item.when }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- Dormant section · 休眠板块 -->
    <view v-if="dormantNames.length > 0" class="dormant" @tap="expandDormant">
      <text class="dormant-h">休眠板块 · 本月无新内容</text>
      <view class="dormant-list">
        <text
          v-for="(d, i) in dormantNames"
          :key="i"
          class="dormant-name"
        >{{ d }}<text v-if="i < dormantNames.length - 1" class="dormant-sep">·</text></text>
      </view>
      <text class="dormant-open">展开 ⌄</text>
    </view>

    <!-- Foot -->
    <view class="s1-foot-wrap">
      <text class="s1-foot">— {{ kind }} · 记忆在这里 —</text>
    </view>
    <view v-if="showGuestIntro && guestIntroConfig" class="guest-intro-mask" @touchmove.stop.prevent>
      <view class="guest-intro-panel" @tap.stop>
        <text class="guest-intro-title">{{ guestIntroConfig.title }}</text>
        <text class="guest-intro-body">{{ guestIntroConfig.body }}</text>
        <view class="guest-intro-list">
          <view
            v-for="item in guestIntroConfig.features"
            :key="item.key"
            class="guest-intro-row"
          >
            <text class="guest-intro-row-label">{{ item.label }}</text>
            <text class="guest-intro-row-text">{{ item.text }}</text>
          </view>
        </view>
        <view class="guest-intro-primary" @tap="handleGuestIntroPrimary">
          <text>{{ guestIntroConfig.primaryActionText }}</text>
        </view>
        <view class="guest-intro-secondary" @tap="handleGuestIntroSecondary">
          <text>{{ guestIntroConfig.secondaryActionText }}</text>
        </view>
      </view>
    </view>
    <AppTabBar current="home" />
  </view>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { onLoad, onPageScroll, onPullDownRefresh, onShareAppMessage, onShow } from '@dcloudio/uni-app'
import { useCommunityStore } from '../../store/community'
import { useUserStore } from '../../store/user'
import { memberApi, postApi } from '../../api/cloud'
import AppTabBar from '../../components/AppTabBar.vue'
import { hideNativeTabBar } from '../../utils/app-tabbar'
import { getArchiveHomeMeta, getFamilyLetterListSummary, getGuideNoteCard, getHomeLiveMeta, getPostHomeTitle, getPostHomeTitleIssue } from '../../utils/widget'
import { clientLog } from '../../utils/client-log'
import { openOnboardingPreservingStack } from '../../utils/onboarding-nav'
import { clearHomeSnapshotCache, getBestBackgroundFetchSnapshot, readHomeSnapshotCache, subscribeBackgroundFetchSnapshot, writeHomeSnapshotCache } from '../../utils/home-snapshot-cache'
import { normalizeHomeNoticeKind } from '../../utils/home-notice'
import { formatHomeQuoteCite } from '../../utils/home-quote'
import { resolveCloudFileUrl, resolveCloudFileUrls } from '../../utils/cloud-file-url'
import {
  buildHomeImageKey,
  clearFailedHomeImageProbeEntries,
  summarizeHomeImageProbe,
  upsertHomeImageProbeEntry,
  type HomeImageKind,
  type HomeImageProbeEntry,
  type HomeImageStatus,
} from '../../utils/home-image-probe'
import {
  buildCommunitySharePath,
  buildCommunityShareTitle,
  DEFAULT_COMMUNITY_SHARE_IMAGE,
  isCommunityShareQuery,
  normalizeCommunityShareId,
  savePendingShareCommunity,
} from '../../utils/community-share'
import { markGuestIntroSeen, shouldShowGuestIntro } from '../../utils/guest-intro'
import type { HomeBanner, HomeSnapshot } from '../../../../cloud/shared/types'
import type { GuestIntroConfig } from '../../../../cloud/shared/guest-intro-config'

const communityStore = useCommunityStore()
const userStore = useUserStore()
const showGuestIntro = ref(false)
const guestIntroConfig = ref<GuestIntroConfig | null>(null)
const postsBySection = ref<Record<string, any[]>>({})
const resolvedHomeBannerCoverUrls = ref<Record<string, string>>({})
const resolvedHomeGuideCoverUrls = ref<Record<string, string>>({})
const homeImageProbeEntries = ref<Record<string, HomeImageProbeEntry>>({})
const incomingShareCommunityId = ref('')
const shareImageUrl = ref(DEFAULT_COMMUNITY_SHARE_IMAGE)
const homeSearchQuery = ref('')
const selectedArchiveId = ref('')
const homePageScrollTop = ref(0)
const archivePreviewMinHeightPx = ref(0)
const homeBannerActiveIndex = ref(0)
const homeBannerSwipeIntent = ref(false)
let refreshingHome = false
let queuedForcedHomeRefresh = false
let mountedAt = 0
let unsubscribeBackgroundFetchSnapshot: (() => void) | null = null
let archiveSwitchScrollTimers: ReturnType<typeof setTimeout>[] = []
let archivePreviewMeasureTimers: ReturnType<typeof setTimeout>[] = []
let suppressNextHomeBannerTap = false
let suppressHomeBannerTapTimer: ReturnType<typeof setTimeout> | null = null
let homeBannerPointerStartX = 0
let homeBannerPointerStartY = 0
let homeBannerHasPointerStart = false
let homeBannerResolveToken = 0
const reportedMissingHomeTitle = new Set<string>()
const NOTICE_PREVIEW_LIMIT = 68
const HOME_BANNER_SWIPE_THRESHOLD_PX = 8
const HOME_BANNER_TAP_SUPPRESS_MS = 320
const HOME_REFRESH_AFTER_POST_KEY = 'home_refresh_after_post'
const HOME_REFRESH_MARKER_TTL = 5 * 60 * 1000
const GUIDE_AUTHOR_AVATAR_PALETTE = [
  ['#CFE8DE', '#7EC6A0'],
  ['#F6D7C3', '#D28A63'],
  ['#DCE6F8', '#7C9ED9'],
  ['#F3D9E5', '#D18AAA'],
  ['#E8E0C8', '#BBA66D'],
  ['#D7E8EA', '#72B2B8'],
]
const GUIDE_NOTE_NAME_HINTS = ['亲子出游', '周末遛娃', '村游攻略', '路线攻略', '出游攻略']

onPageScroll((event) => {
  const nextScrollTop = Number(event?.scrollTop || 0)
  homePageScrollTop.value = Number.isFinite(nextScrollTop) ? Math.max(0, Math.round(nextScrollTop)) : 0
})

onLoad((options?: Record<string, any>) => {
  if (!isCommunityShareQuery(options)) return
  incomingShareCommunityId.value = normalizeCommunityShareId(options?.communityId)
  clientLog('info', 'home.share.load', {
    communityId: incomingShareCommunityId.value,
  })
})

// ── Computed: masthead ──
const communityName = computed(() => communityStore.currentCommunity?.name ?? '选择社区')
const avatarLetter = computed(() => {
  const name = communityStore.currentCommunity?.name ?? ''
  return name.charAt(0) || '?'
})
const hasMultipleCommunities = computed(() => (communityStore.myCommunities?.length ?? 0) > 1)
const homeHeroImage = computed(() =>
  String(communityStore.currentCommunity?.coverImage || '').trim() ? shareImageUrl.value : ''
)
const quoteText = computed(() => String(communityStore.currentCommunity?.motto || '').trim())
const quoteCite = computed(() => formatHomeQuoteCite(communityStore.currentCommunity?.mottoCite))
const activeArchiveIndex = computed(() => {
  const groups = archiveGroups.value
  if (!groups.length) return -1
  const selectedIndex = selectedArchiveId.value
    ? groups.findIndex((group) => group.id === selectedArchiveId.value)
    : -1
  if (selectedIndex >= 0) return selectedIndex
  const guideIndex = groups.findIndex((group) => group.displayTemplate === 'guide_note')
  return guideIndex >= 0 ? guideIndex : 0
})
const activeArchiveStyle = computed(() =>
  archivePreviewMinHeightPx.value > 0
    ? `min-height: ${archivePreviewMinHeightPx.value}px;`
    : ''
)

function onMastheadTap() {
  // 仅当用户有多个社区时才进入切换页；否则 tap 不做任何事（避免空页面困扰）
  if (hasMultipleCommunities.value) {
    uni.navigateTo({ url: '/pages/community-switch/index' })
  }
}

// 场景类型（暂时固定为社群，将来由 community.type 决定）
const kind = computed(() => '社群')
const currentShareCommunityId = computed(() => communityStore.currentCommunityId || communityStore.currentCommunity?._id || '')

interface HomeBannerItem {
  bannerId: string
  postId: string
  title: string
  imageKey: string
  coverImage: string
}

const homeBannerItems = computed<HomeBannerItem[]>(() => {
  const banners = ((communityStore.currentCommunity as any)?.homeBanners || []) as HomeBanner[]
  return banners
    .filter((banner) => banner && banner.enabled !== false)
    .slice()
    .sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0))
    .map((banner, index) => {
      const rawCover = String(banner.coverImage || '').trim()
      const coverImage = resolvedHomeBannerCoverUrls.value[rawCover] || rawCover
      return {
        bannerId: String(banner.bannerId || `${banner.postId}-${index}`),
        postId: String(banner.postId || '').trim(),
        title: String(banner.title || '').trim() || '新人必看',
        imageKey: buildHomeImageKey('banner', rawCover || String(banner.bannerId || banner.postId || index)),
        coverImage,
      }
    })
    .filter((banner) => banner.postId && banner.coverImage)
})

// 辅助：归一化 section 的 type/status（应对老数据）
function secType(s: any): 'realtime' | 'evergreen' {
  return s?.type === 'realtime' ? 'realtime' : 'evergreen'
}
function secStatus(s: any): 'active' | 'dormant' | 'archived' {
  return s?.status === 'dormant' || s?.status === 'archived' ? s.status : 'active'
}

interface SectionNotice {
  id: string
  sectionId: string
  widgetId: string
  sectionName: string
  label: string
  kind: string
  content: string
  preview: string
  isLong: boolean
  icon: string
  accentColor?: string
  when: string
}

const sectionNotices = computed<SectionNotice[]>(() => {
  const notices: SectionNotice[] = []
  for (const section of communityStore.currentSections ?? []) {
    if (secStatus(section) !== 'active') continue
    for (const widget of section.widgets || []) {
      if (widget.type !== 'admin_notice') continue
      const content = String(widget.noticeContent || '').trim()
      if (!content) continue
      const preview = makeNoticePreview(content)
      notices.push({
        id: `${section._id}_${widget.widgetId}`,
        sectionId: section._id,
        widgetId: widget.widgetId,
        sectionName: section.name,
        label: widget.label || '公告',
        kind: normalizeHomeNoticeKind(widget.label),
        content,
        preview,
        isLong: Array.from(content).length > NOTICE_PREVIEW_LIMIT,
        icon: section.icon || '告',
        accentColor: section.accentColor || '',
        when: formatHomeRelativeTime((section as any).updatedAt || section.createdAt),
      })
    }
  }
  return notices
})
const noticeRows = computed(() => sectionNotices.value.slice(0, 2))

// ── 实时协作区：type='realtime' && status='active' 的板块，按帖子逐条展示 ──
interface LiveItem {
  ic: string
  t: string
  m: string[]
  cta: string
  sectionId: string
  postId?: string
  isPinned?: boolean
  isFeatured?: boolean
}
const liveItems = computed<LiveItem[]>(() => {
  const sections = communityStore.currentSections ?? []
  const items: LiveItem[] = []
  for (const section of sections) {
    if (secType(section) !== 'realtime' || secStatus(section) !== 'active') continue
    const posts = postsBySection.value[section._id] ?? []
    for (const post of posts) {
      reportMissingHomeTitle(post, section, 'home.live')
      items.push({
        ic: section.icon || '·',
        t: getPostHomeTitle(post, section) || section.name,
        m: getHomeLiveMeta(post, section),
        cta: '进入',
        sectionId: section._id,
        postId: post._id,
        isPinned: Boolean(post.isPinned),
        isFeatured: Boolean(post.isFeatured),
      })
    }
  }
  return items
})

// ── 近期日程（datetime widget 聚合，后续实现；先返回空） ──
interface ScheduleItem { date: string; day: string; t: string; m: string; kind: string; highlight?: boolean }
const scheduleItems = computed<ScheduleItem[]>(() => [])

// ── 沉淀板块分组：只展示 type='evergreen' 的板块 ──
interface ArchiveItem {
  k: string
  t: string
  contentAuthor?: string
  meta?: string
  excerpt?: string
  imageKey?: string
  coverImage?: string
  driveDuration?: string
  routeStats?: Array<{ label: string; value: string }>
  hot?: boolean
  when: string
  postId?: string
  isPinned?: boolean
  isFeatured?: boolean
}
interface ArchiveGroup { id: string; name: string; count: number; items: ArchiveItem[]; accentColor?: string; displayTemplate: 'default' | 'guide_note' }

function resolveArchiveDisplayTemplate(section: any): ArchiveGroup['displayTemplate'] {
  if (section?.displayTemplate === 'guide_note') return 'guide_note'
  const sectionName = String(section?.name || '').trim()
  return GUIDE_NOTE_NAME_HINTS.some((hint) => sectionName.includes(hint)) ? 'guide_note' : 'default'
}

const archiveGroups = computed<ArchiveGroup[]>(() => {
  return (communityStore.currentSections ?? [])
    .filter((section) => secType(section) === 'evergreen' && secStatus(section) !== 'archived')
    .map((section) => {
      const posts = postsBySection.value[section._id] ?? []
      const displayTemplate = resolveArchiveDisplayTemplate(section)
      return {
        id: section._id,
        name: section.name,
        count: posts.length,
        accentColor: section.accentColor || '',
        displayTemplate,
        items: posts.slice(0, displayTemplate === 'guide_note' ? 6 : 3).map((p, idx) => {
          if (displayTemplate === 'guide_note') {
            const guide = getGuideNoteCard(p, section)
            const resolvedCover = resolvedHomeGuideCoverUrls.value[guide.coverImage] || guide.coverImage
            return {
              k: '',
              t: guide.title,
              contentAuthor: guide.author,
              meta: '',
              excerpt: guide.excerpt,
              imageKey: buildHomeImageKey('guide', guide.coverImage || p._id || idx),
              coverImage: resolvedCover,
              driveDuration: guide.driveDuration,
              routeStats: guide.routeStats,
              hot: false,
              when: guide.when,
              postId: p._id,
              isPinned: Boolean(p.isPinned),
              isFeatured: Boolean(p.isFeatured),
            }
          }
          const familyLetterSummary = getFamilyLetterListSummary(p, section)
          return {
            k: formatArchiveKicker(idx),
            t: familyLetterSummary ? familyLetterSummary.title : getPostHomeTitle(p, section),
            contentAuthor: familyLetterSummary?.author || '',
            meta: getArchiveHomeMeta(p, section),
            hot: isPostHot(p),
            when: formatArchiveWhen(p.createdAt),
            postId: p._id,
            isPinned: Boolean(p.isPinned),
            isFeatured: Boolean(p.isFeatured),
          }
        }),
      }
    })
    .filter((g) => g.items.length > 0)
})

const rawHomeGuideCoverImages = computed(() => {
  const urls: string[] = []
  for (const section of communityStore.currentSections ?? []) {
    if (secType(section) !== 'evergreen' || secStatus(section) === 'archived') continue
    if (resolveArchiveDisplayTemplate(section) !== 'guide_note') continue
    const posts = postsBySection.value[section._id] ?? []
    for (const post of posts.slice(0, 6)) {
      const coverImage = getGuideNoteCard(post, section).coverImage
      if (coverImage && !urls.includes(coverImage)) urls.push(coverImage)
    }
  }
  return urls
})

const rawHomeBannerCoverImages = computed(() => {
  const banners = ((communityStore.currentCommunity as any)?.homeBanners || []) as HomeBanner[]
  const urls: string[] = []
  for (const banner of banners) {
    const coverImage = String(banner?.coverImage || '').trim()
    if (coverImage && !urls.includes(coverImage)) urls.push(coverImage)
  }
  return urls
})

const activeArchiveGroup = computed(() => {
  const index = activeArchiveIndex.value
  return index >= 0 ? archiveGroups.value[index] ?? null : null
})

const guideColumns = computed<ArchiveItem[][]>(() => {
  const group = activeArchiveGroup.value
  if (!group || group.displayTemplate !== 'guide_note') return [[], []]
  return group.items.reduce<ArchiveItem[][]>((columns, item, index) => {
    columns[index % 2].push(item)
    return columns
  }, [[], []])
})

const currentHomeImageKeys = computed(() => {
  const keys: string[] = []
  for (const item of homeBannerItems.value) {
    if (item.imageKey) keys.push(item.imageKey)
  }
  const group = activeArchiveGroup.value
  if (group?.displayTemplate === 'guide_note') {
    for (const item of group.items) {
      if (item.imageKey && item.coverImage) keys.push(item.imageKey)
    }
  }
  return keys
})

watch(
  () => activeArchiveGroup.value?.id || '',
  () => scheduleArchivePreviewMeasure(),
  { immediate: true },
)

watch(
  () => currentShareCommunityId.value,
  () => {
    archivePreviewMinHeightPx.value = 0
    scheduleArchivePreviewMeasure()
  },
)

watch(archiveGroups, (groups) => {
  if (!groups.length) {
    selectedArchiveId.value = ''
    return
  }
  if (selectedArchiveId.value && groups.some((group) => group.id === selectedArchiveId.value)) return
  selectedArchiveId.value = groups.find((group) => group.displayTemplate === 'guide_note')?.id || groups[0].id
}, { immediate: true })

watch(homeBannerItems, (items) => {
  if (homeBannerActiveIndex.value >= items.length) homeBannerActiveIndex.value = 0
}, { immediate: true })

watch(
  rawHomeGuideCoverImages,
  async (urls) => {
    if (urls.length === 0) {
      resolvedHomeGuideCoverUrls.value = {}
      return
    }
    homeImageProbeEntries.value = clearFailedHomeImageProbeEntries(
      homeImageProbeEntries.value,
      urls.map((url) => buildHomeImageKey('guide', url)),
    )
    try {
      resolvedHomeGuideCoverUrls.value = {
        ...resolvedHomeGuideCoverUrls.value,
        ...(await resolveCloudFileUrls(urls)),
      }
    } catch (error) {
      clientLog('warn', 'home.guideCover.resolve.fail', {
        communityId: communityStore.currentCommunityId || '',
        count: urls.length,
        error,
      })
    }
  },
  { immediate: true },
)

// ── 休眠板块：type='realtime' && status='dormant' 的板块名字 ──
const dormantNames = computed(() => {
  return (communityStore.currentSections ?? [])
    .filter((s) => secType(s) === 'realtime' && secStatus(s) === 'dormant')
    .map((s) => s.name)
})

// ── Helpers ──
// kicker（档案左栏小标）— 当前用「装饰版」：前 3 条固定 01 / 02 / 03。
// 未来如果接入真实档案号（#27/#26/… 按板块累计），换成 post 自带的 seqInSection 字段即可。
// 详见 memory/feedback_kicker_design_decision.md
function formatArchiveKicker(index: number): string {
  return String(index + 1).padStart(2, '0')
}

function updateHomeImageProbe(
  kind: HomeImageKind,
  key: string,
  src: string,
  label: string,
  status: HomeImageStatus,
  error?: unknown,
) {
  const safeKey = String(key || '').trim()
  if (!safeKey) return
  const previous = homeImageProbeEntries.value[safeKey]
  homeImageProbeEntries.value = upsertHomeImageProbeEntry(homeImageProbeEntries.value, {
    key: safeKey,
    kind,
    src: String(src || '').trim(),
    label: String(label || '').trim(),
    status,
    updatedAt: new Date().toISOString(),
  })
  if (status === 'failed' && previous?.status !== 'failed') {
    clientLog('warn', kind === 'banner' ? 'home.banner.image.fail' : 'home.guide.image.fail', {
      imageKey: safeKey,
      src: String(src || '').trim(),
      label: String(label || '').trim(),
      error,
    })
  }
}

function isHomeBannerImageFailed(imageKey: string): boolean {
  return homeImageProbeEntries.value[String(imageKey || '').trim()]?.status === 'failed'
}

function isHomeGuideImageFailed(imageKey?: string): boolean {
  return homeImageProbeEntries.value[String(imageKey || '').trim()]?.status === 'failed'
}

function onHomeBannerImageLoad(item: HomeBannerItem) {
  updateHomeImageProbe('banner', item.imageKey, item.coverImage, item.title, 'loaded')
}

function onHomeBannerImageError(item: HomeBannerItem, event?: any) {
  updateHomeImageProbe(
    'banner',
    item.imageKey,
    item.coverImage,
    item.title,
    'failed',
    event?.detail?.errMsg || event,
  )
}

function onHomeGuideImageLoad(item: ArchiveItem) {
  updateHomeImageProbe('guide', String(item.imageKey || ''), String(item.coverImage || ''), item.t, 'loaded')
  scheduleArchivePreviewMeasure()
}

function onHomeGuideImageError(item: ArchiveItem, event?: any) {
  updateHomeImageProbe(
    'guide',
    String(item.imageKey || ''),
    String(item.coverImage || ''),
    item.t,
    'failed',
    event?.detail?.errMsg || event,
  )
  scheduleArchivePreviewMeasure()
}

function getReleaseHomeImageProbe() {
  return summarizeHomeImageProbe(currentHomeImageKeys.value, homeImageProbeEntries.value)
}

defineExpose({
  getReleaseHomeImageProbe,
})

function reportMissingHomeTitle(post: any, section: any, source: string) {
  const issue = getPostHomeTitleIssue(post, section)
  if (!issue) return
  const key = `${source}:${section?._id || ''}:${post?._id || ''}:${issue.code}`
  if (reportedMissingHomeTitle.has(key)) return
  reportedMissingHomeTitle.add(key)
  clientLog('warn', 'post.missingHomeTitle', {
    source,
    issueCode: issue.code,
    message: issue.message,
    communityId: communityStore.currentCommunityId || section?.communityId || '',
    sectionId: section?._id || '',
    sectionName: section?.name || '',
    postId: post?._id || '',
    contentKeys: Object.keys(post?.content || {}),
  })
}

function formatArchiveWhen(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  return sameYear ? `${d.getMonth() + 1}/${d.getDate()}` : `${d.getFullYear()}/${d.getMonth() + 1}`
}

function isPostHot(post: any): boolean {
  return Number(post?.likeCount || 0) > 10
}

function getArchiveCardStyle(group: ArchiveGroup, index: number) {
  const fallbackPalette = ['#C8703E', '#4F6D8A', '#6C8A4E', '#A5668B', '#8C7A45', '#5E7F76']
  return {
    '--arc-accent': group.accentColor || fallbackPalette[index % fallbackPalette.length],
  }
}

function getNoticeCardStyle(notice: SectionNotice, index: number) {
  const fallbackPalette = ['#B35C3B', '#4F6D8A', '#6C8A4E', '#8C6A4E', '#5E7F76']
  return {
    '--notice-accent': notice.accentColor || fallbackPalette[index % fallbackPalette.length],
  }
}

function makeNoticePreview(content: string) {
  const normalized = content.trim().replace(/\n{2,}/g, '\n')
  const chars = Array.from(normalized)
  if (chars.length <= NOTICE_PREVIEW_LIMIT) return normalized
  return `${chars.slice(0, NOTICE_PREVIEW_LIMIT).join('').trimEnd()}…`
}

function formatHomeRelativeTime(value: unknown): string {
  if (!value) return ''
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return ''
  const diffMinutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000))
  if (diffMinutes < 1) return '刚刚'
  if (diffMinutes < 60) return `${diffMinutes}分钟前`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}小时前`
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return sameYear ? `${date.getMonth() + 1}/${date.getDate()}` : `${date.getFullYear()}/${date.getMonth() + 1}`
}

function getAuthorInitial(author?: string): string {
  const chars = Array.from(String(author || '').trim())
  return chars[0] || '邻'
}

function getGuideAuthorAvatarStyle(author?: string) {
  const text = String(author || '邻里居民')
  const hash = Array.from(text).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const palette = GUIDE_AUTHOR_AVATAR_PALETTE[hash % GUIDE_AUTHOR_AVATAR_PALETTE.length]
  return {
    '--guide-avatar-start': palette[0],
    '--guide-avatar-end': palette[1],
  }
}

// ── Actions ──
function onHomeBannerChange(event: any) {
  const next = Number(event?.detail?.current ?? 0)
  if (Number.isFinite(next)) homeBannerActiveIndex.value = next
  if (event?.detail?.source === 'touch') {
    suppressHomeBannerTapTemporarily()
  }
}

function onHomeBannerGestureStart(event: any) {
  const point = getHomeBannerGesturePoint(event)
  homeBannerPointerStartX = point.x
  homeBannerPointerStartY = point.y
  homeBannerHasPointerStart = true
  homeBannerSwipeIntent.value = false
  if (suppressHomeBannerTapTimer) {
    clearTimeout(suppressHomeBannerTapTimer)
    suppressHomeBannerTapTimer = null
  }
  suppressNextHomeBannerTap = false
}

function onHomeBannerGestureMove(event: any) {
  if (!homeBannerHasPointerStart) return
  const point = getHomeBannerGesturePoint(event)
  const dx = Math.abs(point.x - homeBannerPointerStartX)
  const dy = Math.abs(point.y - homeBannerPointerStartY)
  if (Math.max(dx, dy) >= HOME_BANNER_SWIPE_THRESHOLD_PX) {
    homeBannerSwipeIntent.value = true
    suppressHomeBannerTapTemporarily()
  }
}

function onHomeBannerGestureEnd() {
  if (homeBannerSwipeIntent.value) suppressHomeBannerTapTemporarily()
  homeBannerHasPointerStart = false
  homeBannerSwipeIntent.value = false
}

function getHomeBannerGesturePoint(event: any) {
  const touch = event?.touches?.[0] || event?.changedTouches?.[0]
  const x = Number(touch?.clientX ?? touch?.pageX ?? event?.clientX ?? event?.pageX ?? 0)
  const y = Number(touch?.clientY ?? touch?.pageY ?? event?.clientY ?? event?.pageY ?? 0)
  return { x, y }
}

function suppressHomeBannerTapTemporarily() {
  suppressNextHomeBannerTap = true
  if (suppressHomeBannerTapTimer) clearTimeout(suppressHomeBannerTapTimer)
  suppressHomeBannerTapTimer = setTimeout(() => {
    suppressNextHomeBannerTap = false
    suppressHomeBannerTapTimer = null
  }, HOME_BANNER_TAP_SUPPRESS_MS)
}

function openHomeBanner(item: HomeBannerItem) {
  if (suppressNextHomeBannerTap) {
    suppressNextHomeBannerTap = false
    if (suppressHomeBannerTapTimer) {
      clearTimeout(suppressHomeBannerTapTimer)
      suppressHomeBannerTapTimer = null
    }
    return
  }
  if (!item.postId) return
  const url = `/pages/detail/index?postId=${encodeURIComponent(item.postId)}`
  clientLog('info', 'home.banner.tap', {
    bannerId: item.bannerId,
    postId: item.postId,
    title: item.title,
    url,
  })
  uni.navigateTo({
    url,
    success: () => clientLog('info', 'home.banner.navigate.success', { postId: item.postId, url }),
    fail: (error) => clientLog('error', 'home.banner.navigate.fail', { postId: item.postId, url, error }),
  })
}

function onLiveTap(item: LiveItem) {
  if (item.postId) {
    const url = `/pages/detail/index?postId=${item.postId}`
    clientLog('info', 'home.live.tap', {
      postId: item.postId,
      sectionId: item.sectionId,
      url,
    })
    uni.navigateTo({
      url,
      success: () => clientLog('info', 'home.live.navigate.success', { postId: item.postId, url }),
      fail: (error) => clientLog('error', 'home.live.navigate.fail', { postId: item.postId, url, error }),
    })
  }
}

function clearArchiveSwitchScrollTimers() {
  archiveSwitchScrollTimers.forEach((timer) => clearTimeout(timer))
  archiveSwitchScrollTimers = []
}

function clearArchivePreviewMeasureTimers() {
  archivePreviewMeasureTimers.forEach((timer) => clearTimeout(timer))
  archivePreviewMeasureTimers = []
}

function getArchiveMeasuredHeight(rect: any) {
  const target = Array.isArray(rect) ? rect[0] : rect
  const height = Number(target?.height || 0)
  return Number.isFinite(height) ? Math.ceil(height) : 0
}

function measureActiveArchiveHeight() {
  try {
    uni
      .createSelectorQuery()
      .select('.active-archive-body')
      .boundingClientRect((rect) => {
        const height = getArchiveMeasuredHeight(rect)
        const group = activeArchiveGroup.value
        const hasGuideGroup = archiveGroups.value.some((item) => item.displayTemplate === 'guide_note')
        // Only natural guide/feed height may raise the baseline; short default tabs inherit it.
        const shouldCaptureHeight =
          !hasGuideGroup ||
          group?.displayTemplate === 'guide_note' ||
          archivePreviewMinHeightPx.value === 0
        if (shouldCaptureHeight && height > archivePreviewMinHeightPx.value) {
          archivePreviewMinHeightPx.value = height
        }
      })
      .exec()
  } catch (error) {
    clientLog('warn', 'home.archive.measure.fail', { error })
  }
}

function scheduleArchivePreviewMeasure() {
  clearArchivePreviewMeasureTimers()
  nextTick(() => {
    measureActiveArchiveHeight()
    archivePreviewMeasureTimers.push(setTimeout(measureActiveArchiveHeight, 80))
    archivePreviewMeasureTimers.push(setTimeout(measureActiveArchiveHeight, 260))
  })
}

function getCurrentPageScrollTop() {
  let scrollTop = homePageScrollTop.value
  // #ifdef H5
  if (typeof window !== 'undefined' || typeof document !== 'undefined') {
    const candidates = [
      typeof window !== 'undefined' ? window.scrollY : 0,
      typeof document !== 'undefined' ? document.documentElement?.scrollTop || 0 : 0,
      typeof document !== 'undefined' ? document.body?.scrollTop || 0 : 0,
    ].filter((value) => Number.isFinite(value) && value >= 0)
    if (candidates.length) scrollTop = Math.max(...candidates)
  }
  // #endif
  return Math.max(0, Math.round(Number(scrollTop) || 0))
}

function restoreArchiveSwitchScroll(scrollTop: number) {
  clearArchiveSwitchScrollTimers()
  const target = Math.max(0, Math.round(Number(scrollTop) || 0))
  const restore = () => {
    try {
      uni.pageScrollTo({ scrollTop: target, duration: 0 })
      homePageScrollTop.value = target
    } catch (error) {
      clientLog('warn', 'home.archive.scroll.restore.fail', { target, error })
    }

    // #ifdef H5
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo({ top: target, left: 0, behavior: 'auto' })
    }
    // #endif
  }

  nextTick(() => {
    restore()
    archiveSwitchScrollTimers.push(setTimeout(restore, 60))
    archiveSwitchScrollTimers.push(setTimeout(restore, 180))
  })
}

function selectArchiveGroup(g: ArchiveGroup) {
  if (!g.id) return
  const previousScrollTop = getCurrentPageScrollTop()
  selectedArchiveId.value = g.id
  scheduleArchivePreviewMeasure()
  restoreArchiveSwitchScroll(previousScrollTop)
  clientLog('info', 'home.archive.group.select', {
    sectionId: g.id,
    name: g.name,
    count: g.count,
    displayTemplate: g.displayTemplate,
  })
}

function onGroupHeaderTap(g: ArchiveGroup) {
  if (!g.id) return
  const url = `/pages/section/index?sectionId=${encodeURIComponent(g.id)}`
  clientLog('info', 'home.archive.group.tap', {
    sectionId: g.id,
    name: g.name,
    count: g.count,
    url,
  })
  uni.navigateTo({
    url,
    fail: (error) => clientLog('error', 'home.archive.group.navigate.fail', { sectionId: g.id, url, error }),
  })
}

function onPostTap(item: ArchiveItem) {
  if (item.postId) {
    const url = `/pages/detail/index?postId=${item.postId}`
    clientLog('info', 'home.archive.tap', {
      postId: item.postId,
      title: item.t,
      url,
    })
    uni.navigateTo({
      url,
      success: () => clientLog('info', 'home.archive.navigate.success', { postId: item.postId, url }),
      fail: (error) => clientLog('error', 'home.archive.navigate.fail', { postId: item.postId, url, error }),
    })
  }
}

function openNotice(notice: SectionNotice) {
  const url = `/pages/notice/index?sectionId=${encodeURIComponent(notice.sectionId)}&widgetId=${encodeURIComponent(notice.widgetId)}`
  clientLog('info', 'home.notice.tap', {
    sectionId: notice.sectionId,
    widgetId: notice.widgetId,
    url,
  })
  uni.navigateTo({
    url,
    fail: (error) => clientLog('error', 'home.notice.navigate.fail', { sectionId: notice.sectionId, widgetId: notice.widgetId, error }),
  })
}

function submitHomeSearch() {
  const communityId = communityStore.currentCommunityId || ''
  if (!communityId) {
    uni.showToast({ title: '请先加入社区', icon: 'none' })
    openOnboardingPreservingStack()
    return
  }
  const query = homeSearchQuery.value.trim()
  const url = `/pages/search/index?communityId=${encodeURIComponent(communityId)}${query ? `&q=${encodeURIComponent(query)}` : ''}`
  clientLog('info', 'home.search.submit', { communityId, hasQuery: !!query, url })
  uni.navigateTo({
    url,
    fail: (error) => clientLog('error', 'home.search.navigate.fail', { communityId, url, error }),
  })
}

function expandDormant() {
  // TODO: 展开所有休眠板块
}

function openSharedCommunityOnboarding(communityId: string) {
  openOnboardingPreservingStack({ mode: 'discover', communityId })
}

async function handleInitialShareLanding(): Promise<boolean> {
  const targetCommunityId = normalizeCommunityShareId(incomingShareCommunityId.value)
  if (!targetCommunityId) return false

  if (!userStore.isLoggedIn) {
    savePendingShareCommunity(targetCommunityId)
    clientLog('info', 'home.share.redirect.guest', { communityId: targetCommunityId })
    openSharedCommunityOnboarding(targetCommunityId)
    return true
  }

  try {
    const status = await memberApi.myStatus(targetCommunityId)
    if (status.isMember && status.status === 'active') {
      communityStore.currentCommunityId = targetCommunityId
      communityStore.currentSectionIndex = 0
      communityStore.saveToStorage()
      clientLog('info', 'home.share.member.accept', { communityId: targetCommunityId })
      return false
    }
    clientLog('info', 'home.share.redirect.nonMember', {
      communityId: targetCommunityId,
      status: status.status || '',
    })
    openSharedCommunityOnboarding(targetCommunityId)
    return true
  } catch (error) {
    clientLog('warn', 'home.share.status.fail', { communityId: targetCommunityId, error })
    uni.showToast({ title: '社群信息暂不可用，请稍后重试', icon: 'none' })
    return false
  }
}

async function prepareCommunityShareImage() {
  const coverImage = String(communityStore.currentCommunity?.coverImage || '').trim()
  if (!coverImage) {
    shareImageUrl.value = DEFAULT_COMMUNITY_SHARE_IMAGE
    return
  }

  const expectedCoverImage = coverImage
  try {
    const resolved = await resolveCloudFileUrl(coverImage)
    if (String(communityStore.currentCommunity?.coverImage || '').trim() === expectedCoverImage) {
      shareImageUrl.value = resolved || DEFAULT_COMMUNITY_SHARE_IMAGE
    }
  } catch (error) {
    clientLog('warn', 'home.share.image.resolve.fail', { coverImage, error })
    if (String(communityStore.currentCommunity?.coverImage || '').trim() === expectedCoverImage) {
      shareImageUrl.value = DEFAULT_COMMUNITY_SHARE_IMAGE
    }
  }
}

function refreshGuestIntroVisibility() {
  showGuestIntro.value = shouldShowGuestIntro(guestIntroConfig.value, {
    isLoggedIn: userStore.isLoggedIn,
    hasPublicCommunity: Boolean(communityStore.currentCommunityId),
  })
}

function markCurrentGuestIntroSeen() {
  if (guestIntroConfig.value?.version) {
    markGuestIntroSeen(guestIntroConfig.value.version)
  }
  showGuestIntro.value = false
}

function handleGuestIntroPrimary() {
  markCurrentGuestIntroSeen()
}

function handleGuestIntroSecondary() {
  markCurrentGuestIntroSeen()
  openOnboardingPreservingStack({ mode: 'discover' })
}

function applyHomeSnapshot(snapshot: HomeSnapshot | null, source: 'prefetch' | 'cache' | 'cloud') {
  if (!snapshot) return false
  const expectedViewer = userStore.isLoggedIn ? userStore.openId : ''
  if (snapshot.viewerOpenId !== expectedViewer) return false
  communityStore.myCommunities = userStore.isLoggedIn ? (snapshot.communities || []) : []
  communityStore.currentCommunityId = snapshot.currentCommunityId || ''
  communityStore.browsingCommunity = snapshot.currentCommunity || snapshot.communities?.find((item) => item._id === snapshot.currentCommunityId) || null
  communityStore.currentSectionIndex = 0
  communityStore.currentSections = snapshot.sections || []
  postsBySection.value = snapshot.postsBySection || {}
  guestIntroConfig.value = userStore.isLoggedIn ? null : (snapshot.guestIntroConfig || null)
  refreshGuestIntroVisibility()
  if (userStore.isLoggedIn) communityStore.saveToStorage()
  clientLog('info', 'home.snapshot.apply', {
    source,
    viewerMode: userStore.isLoggedIn ? 'user' : 'guest',
    communityCount: communityStore.myCommunities.length,
    currentCommunityId: communityStore.currentCommunityId || '',
    sectionCount: communityStore.currentSections.length,
    totalPosts: Object.keys(postsBySection.value).reduce((sum, key) => sum + (postsBySection.value[key]?.length || 0), 0),
  })
  return true
}

async function hydrateHomeFromFastPath() {
  if (!userStore.isLoggedIn || !userStore.openId) return false
  const prefetched = await getBestBackgroundFetchSnapshot({
    openId: userStore.openId,
    communityId: communityStore.currentCommunityId || undefined,
  })
  if (applyHomeSnapshot(prefetched, 'prefetch')) {
    writeHomeSnapshotCache(prefetched as HomeSnapshot)
    return true
  }
  const cached = readHomeSnapshotCache({
    openId: userStore.openId,
    communityId: communityStore.currentCommunityId || '',
  })
  return applyHomeSnapshot(cached, 'cache')
}

function applyLateBackgroundFetchSnapshot(snapshot: HomeSnapshot) {
  if (applyHomeSnapshot(snapshot, 'prefetch')) {
    writeHomeSnapshotCache(snapshot)
  }
}

function getPendingHomeRefreshMarker() {
  try {
    const marker = uni.getStorageSync(HOME_REFRESH_AFTER_POST_KEY)
    if (!marker || typeof marker !== 'object') return null
    const createdAt = Number(marker.createdAt || 0)
    if (!createdAt || Date.now() - createdAt > HOME_REFRESH_MARKER_TTL) {
      uni.removeStorageSync(HOME_REFRESH_AFTER_POST_KEY)
      return null
    }
    return marker as { communityId?: string; sectionId?: string; postId?: string; createdAt: number }
  } catch {
    return null
  }
}

function clearHomeRefreshMarker() {
  try {
    uni.removeStorageSync(HOME_REFRESH_AFTER_POST_KEY)
  } catch {}
}

async function refreshHomeData(options: { force?: boolean } = {}) {
  const force = options.force === true
  clientLog('info', 'home.refresh.start', {
    force,
    loggedIn: userStore.isLoggedIn,
    currentCommunityId: communityStore.currentCommunityId || '',
  })
  if (refreshingHome) {
    if (force) queuedForcedHomeRefresh = true
    clientLog('warn', 'home.refresh.skip.busy', {
      force,
      queuedForcedHomeRefresh,
    })
    return
  }
  refreshingHome = true
  try {
    const requestedCommunityId = userStore.isLoggedIn
      ? communityStore.currentCommunityId || undefined
      : undefined
    const result = await postApi.bootstrap(requestedCommunityId, 20, !userStore.isLoggedIn)
    if (userStore.isLoggedIn && result.backgroundFetchToken) {
      userStore.setBackgroundFetchToken(result.backgroundFetchToken, result.backgroundFetchTokenExpiresAt)
    }
    applyHomeSnapshot(result as HomeSnapshot, 'cloud')
    if (userStore.isLoggedIn && communityStore.currentCommunityId) {
      writeHomeSnapshotCache(result as HomeSnapshot)
    }
    if (!communityStore.currentCommunityId) {
      postsBySection.value = {}
      clientLog('warn', 'home.community.empty.openOnboarding', {
        loggedIn: userStore.isLoggedIn,
      })
      if (userStore.isLoggedIn) openOnboardingPreservingStack()
      return
    }
    if (force) clearHomeRefreshMarker()
    clientLog('info', 'home.refresh.success', {
      force,
      currentCommunityId: communityStore.currentCommunityId || '',
    })
  } catch (error) {
    clientLog('error', 'home.refresh.fail', { force, error })
    const message = String((error as any)?.message || error || '')
    if (message.includes('需要先加入社区后查看内容')) {
      clearHomeSnapshotCache(userStore.openId, communityStore.currentCommunityId || '')
      communityStore.clearCommunityState()
      postsBySection.value = {}
      uni.showToast({ title: '需要先加入社区后查看内容', icon: 'none' })
      openOnboardingPreservingStack()
      return
    }
    throw error
  } finally {
    refreshingHome = false
  }
  if (queuedForcedHomeRefresh) {
    queuedForcedHomeRefresh = false
    await refreshHomeData({ force: true })
  }
}

onMounted(async () => {
  mountedAt = Date.now()
  hideNativeTabBar()
  clientLog('info', 'home.mounted', {})
  unsubscribeBackgroundFetchSnapshot = subscribeBackgroundFetchSnapshot(
    () => ({
      openId: userStore.openId,
      communityId: communityStore.currentCommunityId || undefined,
    }),
    applyLateBackgroundFetchSnapshot,
  )
  const redirectedByShare = await handleInitialShareLanding()
  if (redirectedByShare) return
  await hydrateHomeFromFastPath()
  await refreshHomeData()
})

onUnmounted(() => {
  clearArchiveSwitchScrollTimers()
  clearArchivePreviewMeasureTimers()
  unsubscribeBackgroundFetchSnapshot?.()
  unsubscribeBackgroundFetchSnapshot = null
})

// tabBar 页面切回首页时（如发帖后 switchTab 返回）不会重新 mount，只触发 onShow。
// 这里 onShow 统一刷新帖子数据，确保新发/新删的内容能实时反映。
// 首次 onShow 发生在 onMounted 之后，会二次拉取（可接受：代价低、换取数据新鲜度）。
onShow(() => {
  hideNativeTabBar()
  const marker = getPendingHomeRefreshMarker()
  clientLog('info', 'home.show', {
    hasPendingRefreshMarker: !!marker,
    marker,
  })
  if (!marker && mountedAt && Date.now() - mountedAt < 1500) {
    clientLog('debug', 'home.show.skip.afterMounted', {})
    return
  }
  void refreshHomeData({ force: !!marker })
})

onPullDownRefresh(async () => {
  clientLog('info', 'home.pullDownRefresh', {})
  try {
    await refreshHomeData({ force: true })
  } catch (error) {
    clientLog('error', 'home.pullDownRefresh.fail', { error })
    uni.showToast({ title: '刷新失败，请重试', icon: 'none' })
  } finally {
    uni.stopPullDownRefresh()
  }
})

watch(
  rawHomeBannerCoverImages,
  async (images) => {
    const token = ++homeBannerResolveToken
    if (!images.length) {
      resolvedHomeBannerCoverUrls.value = {}
      homeBannerActiveIndex.value = 0
      return
    }
    homeImageProbeEntries.value = clearFailedHomeImageProbeEntries(
      homeImageProbeEntries.value,
      images.map((image) => buildHomeImageKey('banner', image)),
    )
    const next: Record<string, string> = {}
    await Promise.all(images.map(async (image) => {
      try {
        next[image] = await resolveCloudFileUrl(image)
      } catch (error) {
        next[image] = image
        clientLog('warn', 'home.bannerCover.resolve.fail', { image, error })
      }
    }))
    if (token !== homeBannerResolveToken) return
    resolvedHomeBannerCoverUrls.value = next
    if (homeBannerActiveIndex.value >= homeBannerItems.value.length) {
      homeBannerActiveIndex.value = 0
    }
  },
  { immediate: true },
)

watch(
  () => communityStore.currentCommunity?.coverImage,
  () => {
    void prepareCommunityShareImage()
  },
  { immediate: true },
)

onShareAppMessage(() => {
  const communityId = currentShareCommunityId.value
  return {
    title: buildCommunityShareTitle(communityName.value),
    path: communityId ? buildCommunitySharePath(communityId) : '/pages/index/index',
    imageUrl: shareImageUrl.value || DEFAULT_COMMUNITY_SHARE_IMAGE,
  }
})
</script>

<style lang="scss" scoped>
.phone-inner {
  padding: 16rpx 0 112rpx;
  background: $hh-surface-0;
  min-height: 100vh;
  position: relative;
}

/* ═══ Masthead ═══ */
.s1-top {
  padding: 16rpx 48rpx 28rpx;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.s1-top.is-tappable {
  /* 多社区时整块可点切换，用极弱的 hover/active 指示可交互 */
  cursor: pointer;
}
.s1-top.is-tappable:active {
  background: $hh-surface-1;
}
.top-body {
  flex: 1;
  min-width: 0;
}
.eyebrow {
  font-family: $hh-font-mono;
  font-size: 20rpx;
  letter-spacing: $hh-tracking-mono;
  color: $hh-ink-3;
  text-transform: uppercase;
  display: block;
  margin-bottom: 12rpx;
}
.title-wrap {
  display: flex;
  align-items: baseline;
  gap: 14rpx;
}
.title {
  font-family: $hh-font-serif;
  font-size: 56rpx;
  font-weight: $hh-font-weight-bold;
  letter-spacing: $hh-tracking-serif;
  color: $hh-ink-1;
  line-height: 1.05;
}
.title-chev {
  font-size: 36rpx;
  color: $hh-ink-3;
  line-height: 1;
  font-weight: $hh-font-weight-regular;
  margin-left: 4rpx;
  /* 把 chevron 稍稍下沉，与 baseline 对齐更协调 */
  transform: translateY(-6rpx);
}
.sub-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0;
  margin-top: 16rpx;
}
.sub {
  font-family: $hh-font-sans;
  font-size: 24rpx;
  font-weight: $hh-font-weight-regular;
  color: $hh-ink-3;
}
.sub-switch {
  font-family: $hh-font-mono;
  font-size: 22rpx;
  font-weight: $hh-font-weight-heavy;
  letter-spacing: $hh-tracking-mono-sm;
  color: $hh-accent;
  text-transform: none;
}
.sub-dot {
  margin: 0 12rpx;
  color: $hh-ink-3;
  font-family: $hh-font-sans;
  font-weight: $hh-font-weight-regular;
}
.avatar {
  width: 72rpx;
  height: 72rpx;
  border-radius: $hh-radius-full;
  background: $hh-surface-2;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-left: 24rpx;
}
.avatar text {
  font-size: 26rpx;
  font-weight: $hh-font-weight-heavy;
  color: $hh-ink-2;
}

/* ═══ Quote ═══ */
.s1-quote {
  margin: 8rpx 48rpx 28rpx;
  padding: 20rpx 0 24rpx;
  border-top: 1rpx solid $hh-ink-line-2;
  border-bottom: 1rpx solid $hh-ink-line-2;
  position: relative;
}
.q-text {
  font-family: $hh-font-serif;
  font-size: 26rpx;
  font-style: italic;
  color: $hh-ink-2;
  line-height: 1.55;
  letter-spacing: 0.01em;
  display: block;
}
.cite {
  display: block;
  margin-top: 8rpx;
  font-family: $hh-font-mono;
  font-size: 20rpx;
  letter-spacing: $hh-tracking-mono-sm;
  color: $hh-ink-3;
  text-align: right;
  text-transform: uppercase;
}

/* ═══ Home Banner ═══ */
.home-banner {
  position: relative;
  margin: 0 32rpx 28rpx;
  height: 260rpx;
  border-radius: 24rpx;
  overflow: hidden;
  background: $hh-surface-2;
  box-shadow: $hh-shadow-card;
}
.home-banner-swiper,
.home-banner-slide,
.home-banner-image {
  width: 100%;
  height: 100%;
}
.home-banner-image {
  display: block;
}
.home-banner-shade {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 58%;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.56));
  pointer-events: none;
}
.home-banner-title {
  position: absolute;
  left: 28rpx;
  right: 28rpx;
  bottom: 34rpx;
  font-size: 31rpx;
  font-weight: $hh-font-weight-bold;
  line-height: 1.28;
  color: #fff;
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  text-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.24);
}
.home-banner-dots {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 14rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
  pointer-events: none;
}
.home-banner-dot {
  width: 10rpx;
  height: 10rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.55);
}
.home-banner-dot.active {
  width: 24rpx;
  background: #e84f5f;
}

/* ═══ Search ═══ */
.home-search {
  margin: 0 32rpx 28rpx;
}
.home-search-box {
  min-height: 90rpx;
  padding: 0 8rpx 0 30rpx;
  border: 0;
  border-radius: $hh-radius-full;
  background: #fff;
  box-shadow: none;
  display: flex;
  align-items: center;
  gap: 15rpx;
}
.home-search-icon {
  position: relative;
  flex-shrink: 0;
  width: 38rpx;
  height: 38rpx;
  color: rgba(0, 0, 0, 0.45);
}
.home-search-icon-ring {
  position: absolute;
  left: 4rpx;
  top: 4rpx;
  width: 26rpx;
  height: 26rpx;
  border: 3rpx solid currentColor;
  border-radius: 50%;
  box-sizing: border-box;
}
.home-search-icon-handle {
  position: absolute;
  left: 27rpx;
  top: 28rpx;
  width: 13rpx;
  height: 3rpx;
  border-radius: $hh-radius-full;
  background: currentColor;
  transform: rotate(45deg);
  transform-origin: left center;
}
.home-search-input {
  flex: 1;
  min-width: 0;
  height: 90rpx;
  font-size: 30rpx;
  line-height: 45rpx;
  color: $hh-ink-1;
}
.home-search-placeholder {
  color: rgba(0, 0, 0, 0.45);
}
.home-search-action {
  flex: 0 0 150rpx;
  width: 150rpx;
  min-width: 0;
  height: 75rpx;
  padding: 0;
  border-radius: $hh-radius-full;
  background: var(--hh-color-brand-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}
.home-search-action text {
  font-size: 30rpx;
  line-height: 45rpx;
  font-weight: $hh-font-weight-medium;
  color: $hh-surface-1;
}

/* ═══ Admin notices ═══ */
.notice-list {
  margin: 0 32rpx 30rpx;
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}
.notice-card {
  padding: 22rpx 26rpx 20rpx;
  border: 1rpx solid $hh-ink-line;
  border-left: 8rpx solid var(--notice-accent);
  border-radius: 24rpx;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.94), rgba(251, 247, 238, 0.9));
  box-shadow: $hh-shadow-card;
  position: relative;
}
.notice-card.is-long:active {
  transform: translateY(1rpx);
  opacity: 0.9;
}
.notice-head {
  display: flex;
  align-items: center;
  gap: 14rpx;
  margin-bottom: 12rpx;
}
.notice-mark {
  width: 46rpx;
  height: 46rpx;
  border-radius: 14rpx;
  background: var(--notice-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.notice-mark text {
  color: $hh-surface-1;
  font-size: 22rpx;
  font-weight: $hh-font-weight-heavy;
}
.notice-title-wrap {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.notice-section {
  font-size: 26rpx;
  font-weight: $hh-font-weight-bold;
  color: $hh-ink-1;
  line-height: 1.25;
}
.notice-label {
  margin-top: 2rpx;
  font-family: $hh-font-mono;
  font-size: 20rpx;
  letter-spacing: $hh-tracking-mono-sm;
  color: $hh-ink-3;
}
.notice-content {
  display: block;
  font-size: 27rpx;
  line-height: 1.52;
  color: $hh-ink-2;
  white-space: pre-wrap;
}
.notice-foot {
  margin-top: 10rpx;
  padding-top: 10rpx;
  border-top: 1rpx dashed $hh-ink-line-2;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8rpx;
  font-family: $hh-font-mono;
  font-size: 21rpx;
  font-weight: $hh-font-weight-heavy;
  letter-spacing: $hh-tracking-mono-sm;
  color: var(--notice-accent);
}
.notice-arrow {
  font-size: 28rpx;
  line-height: 1;
}

/* ═══ Live strip ═══ */
.s1-live {
  margin: 0 32rpx 40rpx;
  border: 1rpx solid $hh-ink-line;
  border-left: 6rpx solid $hh-live;
  border-radius: 24rpx;
  background: $hh-surface-1;
  overflow: hidden;
}
.live-h {
  padding: 20rpx 28rpx 14rpx;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1rpx solid $hh-ink-line-2;
}
.live-h-l {
  font-family: $hh-font-mono;
  font-size: 20rpx;
  letter-spacing: $hh-tracking-mono-sm;
  color: $hh-live;
  font-weight: $hh-font-weight-heavy;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.ping {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background: $hh-live;
  animation: ring 1.6s infinite;
}
@keyframes ring {
  0%, 100% { box-shadow: 0 0 0 0 rgba(207, 64, 64, 0.5); }
  50% { box-shadow: 0 0 0 10rpx rgba(207, 64, 64, 0); }
}
.live-h-n {
  font-family: $hh-font-mono;
  font-size: 20rpx;
  color: $hh-ink-3;
  letter-spacing: 0.1em;
}
.live-row {
  padding: 22rpx 28rpx;
  display: flex;
  gap: 24rpx;
  align-items: center;
  border-bottom: 1rpx solid $hh-ink-line-2;
}
.live-row:last-child { border-bottom: none; }
.live-ic {
  width: 56rpx;
  height: 56rpx;
  border-radius: 16rpx;
  background: $hh-surface-2;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.live-ic text { font-size: 30rpx; }
.live-body { flex: 1; min-width: 0; }
.live-t {
  font-size: 28rpx;
  font-weight: $hh-font-weight-bold;
  color: $hh-ink-1;
  letter-spacing: $hh-tracking-serif-sm;
  display: block;
}
.live-m {
  font-family: $hh-font-num;
  font-size: 23rpx;
  color: $hh-ink-3;
  margin-top: 4rpx;
  display: flex;
  gap: 20rpx;
}
.live-m-item {
  font-family: inherit;
}
.post-badges {
  display: flex;
  align-items: center;
  gap: 8rpx;
  flex-wrap: wrap;
  margin-top: 6rpx;
}
.post-badge {
  font-family: $hh-font-mono;
  font-size: 18rpx;
  line-height: 1;
  padding: 5rpx 8rpx;
  border-radius: $hh-radius-full;
  border: 1rpx solid $hh-ink-line;
  color: $hh-ink-3;
  background: $hh-surface-1;
}
.post-badge.pin {
  color: #8a5a00;
  border-color: #ead3a2;
  background: #fff6dc;
}
.post-badge.feature {
  color: #9a3a2f;
  border-color: #e8b7af;
  background: #fff1ee;
}
.live-cta {
  flex-shrink: 0;
  font-family: $hh-font-mono;
  font-size: 20rpx;
  font-weight: $hh-font-weight-heavy;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 12rpx 22rpx;
  border-radius: $hh-radius-full;
  background: $hh-ink-1;
}
.live-cta text { color: $hh-surface-1; }

/* ═══ Figma home notice + group cards ═══ */
.notice-board {
  margin: 24rpx 32rpx 30rpx;
  padding: 16rpx 20rpx;
  border: 1rpx solid $hh-ink-line;
  border-radius: 16rpx;
  background: $hh-surface-1;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  box-shadow: $hh-shadow-card;
}

.notice-row {
  min-height: 44rpx;
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.notice-row.is-long:active {
  opacity: 0.9;
}

.notice-kind {
  width: 76rpx;
  flex-shrink: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-body-lg-size);
  line-height: var(--hh-text-body-lg-line);
  font-weight: $hh-font-weight-bold;
  text-align: left;
}

.notice-main {
  flex: 1;
  min-width: 0;
}

.notice-line {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.notice-badge {
  flex: 0 0 auto;
  padding: 1rpx 8rpx;
  border-radius: 6rpx;
  border: 1rpx solid rgba(61, 173, 125, 0.42);
  color: var(--hh-color-brand-primary);
  background: rgba(61, 173, 125, 0.08);
  font-size: var(--hh-text-caption-base-size);
  line-height: 30rpx;
  font-weight: $hh-font-weight-bold;
}

.notice-row:nth-child(2) .notice-badge {
  color: #f0942b;
  border-color: rgba(240, 148, 43, 0.36);
  background: rgba(240, 148, 43, 0.08);
}

.notice-board .notice-content {
  min-width: 0;
  display: block;
  color: var(--hh-color-text-secondary);
  font-size: var(--hh-text-body-base-size);
  line-height: var(--hh-text-body-base-line);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.notice-time {
  flex: 0 0 auto;
  color: var(--hh-color-text-tertiary);
  font-size: var(--hh-text-caption-lg-size);
  line-height: var(--hh-text-caption-lg-line);
}

.group-section {
  margin: 0 32rpx 34rpx;
}

.group-section-title {
  display: block;
  margin-bottom: 16rpx;
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-heading-sm-size);
  line-height: var(--hh-text-heading-sm-line);
  font-weight: $hh-font-weight-bold;
}

.group-card {
  position: relative;
  min-height: 104rpx;
  padding: 18rpx 26rpx 18rpx 18rpx;
  border: 1rpx solid $hh-ink-line;
  border-radius: 16rpx;
  background: $hh-surface-1;
  display: flex;
  align-items: center;
  gap: 18rpx;
  overflow: hidden;
  box-shadow: $hh-shadow-card;
}

.group-card + .group-card {
  margin-top: 14rpx;
}

.group-icon {
  width: 64rpx;
  height: 64rpx;
  border-radius: 16rpx;
  background: var(--hh-color-brand-soft);
  color: var(--hh-color-brand-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}

.group-icon text {
  font-size: 34rpx;
  line-height: 1;
}

.group-body {
  flex: 1;
  min-width: 0;
}

.group-title {
  display: block;
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-body-lg-size);
  line-height: var(--hh-text-body-lg-line);
  font-weight: $hh-font-weight-bold;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.group-meta {
  margin-top: 4rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx 16rpx;
  color: var(--hh-color-text-tertiary);
  font-size: var(--hh-text-caption-lg-size);
  line-height: var(--hh-text-caption-lg-line);
}

.group-ribbon {
  position: absolute;
  right: -42rpx;
  top: 8rpx;
  width: 118rpx;
  height: 34rpx;
  transform: rotate(45deg);
  background: #ffd66e;
  display: flex;
  align-items: center;
  justify-content: center;
}

.group-ribbon text {
  color: #a96a00;
  font-size: 20rpx;
  line-height: 1;
  font-weight: $hh-font-weight-bold;
}

/* ═══ Schedule strip ═══ */
.sch-head {
  padding: 28rpx 48rpx 16rpx;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.sch-head-t {
  font-family: $hh-font-mono;
  font-size: 21rpx;
  letter-spacing: $hh-tracking-mono;
  text-transform: uppercase;
  color: $hh-ink-3;
}
.sch-head-b {
  color: $hh-ink-1;
  font-weight: $hh-font-weight-heavy;
  margin-right: 12rpx;
}
.sch-head-more {
  font-family: $hh-font-mono;
  font-size: 20rpx;
  color: $hh-ink-3;
  letter-spacing: $hh-tracking-mono-sm;
  text-transform: uppercase;
}
.sch-strip {
  margin-bottom: 24rpx;
  padding: 0 48rpx 12rpx;
  white-space: nowrap;
}
.sch-inner { display: inline-flex; gap: 16rpx; }
.sch-card {
  flex-shrink: 0;
  width: 316rpx;
  background: $hh-surface-1;
  border: 1rpx solid $hh-ink-line;
  border-radius: $hh-radius-md;
  padding: 20rpx 24rpx 22rpx;
  display: inline-flex;
  flex-direction: column;
  position: relative;
  white-space: normal;
}
.sch-card.hot {
  background: $hh-accent-wash;
  border-color: $hh-accent-line;
}
.sch-date {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
  font-family: $hh-font-num;
  color: $hh-ink-1;
  margin-bottom: 12rpx;
}
.sch-d {
  font-size: 34rpx;
  font-weight: $hh-font-weight-heavy;
  letter-spacing: -0.02em;
}
.sch-w {
  font-family: $hh-font-mono;
  font-size: 19rpx;
  color: $hh-ink-3;
  letter-spacing: $hh-tracking-mono-sm;
  text-transform: uppercase;
  margin-left: auto;
}
.sch-kind {
  font-family: $hh-font-mono;
  font-size: 17rpx;
  font-weight: $hh-font-weight-heavy;
  letter-spacing: $hh-tracking-mono-sm;
  text-transform: uppercase;
  color: $hh-ink-3;
  margin-bottom: 8rpx;
  display: block;
}
.sch-card.hot .sch-kind { color: $hh-accent-ink; }
.sch-tt {
  font-size: 26rpx;
  font-weight: $hh-font-weight-bold;
  color: $hh-ink-1;
  line-height: 1.3;
  letter-spacing: $hh-tracking-serif-sm;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.sch-mm {
  margin-top: 8rpx;
  font-family: $hh-font-num;
  font-size: 21rpx;
  color: $hh-ink-3;
  display: block;
}

/* ═══ Section head ═══ */
.sec-head {
  padding: 20rpx 48rpx 16rpx;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.sec-head-t {
  font-family: $hh-font-mono;
  font-size: 21rpx;
  letter-spacing: $hh-tracking-mono;
  text-transform: uppercase;
  color: $hh-ink-3;
}
.sec-head-b {
  color: $hh-ink-1;
  font-weight: $hh-font-weight-heavy;
  margin-right: 12rpx;
}
.sec-head-more {
  font-family: $hh-font-mono;
  font-size: 20rpx;
  color: $hh-ink-3;
  letter-spacing: $hh-tracking-mono-sm;
  text-transform: uppercase;
}

/* ═══ Archive cards ═══ */
.arc-group { margin: 0 32rpx 28rpx; }
.arc-card {
  background: $hh-surface-1;
  border: 1rpx solid $hh-ink-line;
  border-radius: $hh-radius-lg;
  overflow: hidden;
  margin-bottom: 20rpx;
  position: relative;
}
.arc-card::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 6rpx;
  background: var(--arc-accent, #{$hh-accent});
  opacity: 0.7;
}

.arc-bh {
  padding: 24rpx 28rpx 16rpx 32rpx;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  border-bottom: 1rpx dashed $hh-ink-line-2;
}
.arc-bh-l { display: flex; align-items: baseline; }
.arc-nm {
  font-family: $hh-font-serif;
  font-size: 32rpx;
  font-weight: $hh-font-weight-bold;
  color: $hh-ink-1;
  letter-spacing: $hh-tracking-serif-sm;
}
.arc-cnt {
  font-family: $hh-font-mono;
  font-size: 20rpx;
  color: $hh-ink-3;
  letter-spacing: 0.1em;
  margin-left: 16rpx;
  font-weight: $hh-font-weight-medium;
}
.arc-arrow {
  font-size: 28rpx;
  color: $hh-ink-3;
}
.arc-item {
  padding: 20rpx 28rpx 20rpx 32rpx;
  display: flex;
  gap: 20rpx;
  border-bottom: 1rpx solid $hh-ink-line-2;
  align-items: flex-start;
}
.arc-item:last-child { border-bottom: none; }
.arc-k {
  font-family: $hh-font-mono;
  font-size: 18rpx;
  color: $hh-ink-3;
  letter-spacing: $hh-tracking-mono-sm;
  text-transform: uppercase;
  width: 72rpx;
  flex-shrink: 0;
  padding-top: 4rpx;
  font-weight: $hh-font-weight-heavy;
}
.arc-tl { flex: 1; min-width: 0; }
.arc-title {
  font-size: 27rpx;
  color: $hh-ink-1;
  line-height: 1.35;
  font-weight: $hh-font-weight-medium;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.arc-mm {
  font-family: $hh-font-num;
  font-size: 22rpx;
  color: $hh-ink-3;
  margin-top: 4rpx;
  display: flex;
  gap: 16rpx;
}
.arc-content-author { font-family: inherit; }
.arc-meta { font-family: inherit; }
.arc-meta.hot {
  color: $hh-accent-ink;
  font-weight: $hh-font-weight-bold;
}
.arc-when {
  font-family: $hh-font-num;
  font-size: 21rpx;
  color: $hh-ink-3;
  flex-shrink: 0;
  padding-top: 2rpx;
}

.guide-card {
  padding: 22rpx 24rpx;
  display: grid;
  grid-template-columns: 190rpx 1fr;
  gap: 22rpx;
  border-bottom: 1rpx solid $hh-ink-line-2;
}
.guide-card:last-child { border-bottom: none; }
.guide-cover {
  width: 190rpx;
  height: 206rpx;
  border-radius: $hh-radius-md;
  background: $hh-surface-2;
  border: 1rpx solid $hh-ink-line-2;
  overflow: hidden;
}
.guide-cover-empty {
  display: flex;
  align-items: flex-end;
  padding: 18rpx;
  color: $hh-accent-ink;
  background:
    radial-gradient(circle at 26% 24%, rgba(255, 255, 255, 0.48), transparent 30%),
    linear-gradient(135deg, $hh-accent-wash 0%, $hh-surface-1 58%, $hh-surface-2 100%);
}
.guide-cover-empty text {
  font-family: $hh-font-serif;
  font-size: 32rpx;
  color: $hh-accent-ink;
}
.guide-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.guide-title {
  font-family: $hh-font-serif;
  font-size: 31rpx;
  line-height: 1.34;
  color: $hh-ink-1;
  font-weight: $hh-font-weight-bold;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.guide-excerpt {
  margin-top: 10rpx;
  font-size: 24rpx;
  line-height: 1.58;
  color: $hh-ink-2;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.guide-badges {
  margin-top: 10rpx;
}
.guide-stats {
  margin-top: 10rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
}
.guide-stat {
  padding: 5rpx 10rpx;
  border-radius: 999rpx;
  background: #eef5ea;
  color: #365d42;
  font-size: 20rpx;
  line-height: 1.25;
  font-weight: $hh-font-weight-medium;
}
.guide-meta {
  margin-top: auto;
  padding-top: 12rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx 16rpx;
  font-family: $hh-font-num;
  font-size: 21rpx;
  color: $hh-ink-3;
}

/* ═══ Dormant ═══ */
.dormant {
  margin: 36rpx 32rpx 0;
  padding: 28rpx;
  border: 1rpx dashed $hh-ink-line;
  border-radius: $hh-radius-lg;
  text-align: center;
}
.dormant-h {
  font-family: $hh-font-mono;
  font-size: 20rpx;
  color: $hh-ink-3;
  letter-spacing: $hh-tracking-mono-sm;
  text-transform: uppercase;
  display: block;
  margin-bottom: 16rpx;
}
.dormant-list {
  font-size: 26rpx;
  color: $hh-ink-2;
  display: block;
}
.dormant-name { opacity: 0.75; }
.dormant-sep {
  margin: 0 12rpx;
  opacity: 0.5;
}
.dormant-open {
  font-family: $hh-font-mono;
  font-size: 20rpx;
  color: $hh-ink-3;
  margin-top: 16rpx;
  letter-spacing: $hh-tracking-mono-sm;
  text-transform: uppercase;
  display: block;
}

/* ═══ Foot ═══ */
.s1-foot {
  display: block;
  text-align: center;
  font-family: $hh-font-mono;
  font-size: 19rpx;
  line-height: 1.4;
  letter-spacing: $hh-tracking-mono;
  text-transform: uppercase;
  color: $hh-ink-4;
}

.s1-foot-wrap {
  margin: 0 32rpx;
  padding: 4rpx 0 8rpx;
  text-align: center;
}

/* ═══ Figma 0626 visual pass ═══ */
.phone-inner {
  background: var(--hh-color-page);
}

.home-shell {
  padding: calc(86rpx + env(safe-area-inset-top)) var(--hh-page-x) 24rpx;
  background:
    radial-gradient(circle at 84% 0%, rgba(48, 91, 70, 0.22), transparent 34%),
    linear-gradient(170deg, #caeee7 0%, #f1f3ee 58%, var(--hh-color-page) 100%);
}

.home-brandbar {
  height: 78rpx;
  margin-bottom: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.home-brand-title-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.home-brand-title {
  color: #183327;
  font-family: $hh-font-serif;
  font-size: 52rpx;
  line-height: 1;
  font-weight: 760;
  letter-spacing: 0;
  white-space: nowrap;
  text-shadow: 0 10rpx 22rpx rgba(24, 51, 39, 0.1);
}

.home-brand-line {
  position: absolute;
  left: -56rpx;
  right: -56rpx;
  bottom: -12rpx;
  height: 2rpx;
  background: linear-gradient(90deg, transparent, rgba(36, 77, 57, 0.38), transparent);
  pointer-events: none;
}

.home-topbar {
  min-height: 64rpx;
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.community-identity {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.community-avatar {
  width: 64rpx;
  height: 64rpx;
  border-radius: $hh-radius-full;
  overflow: hidden;
  background: var(--hh-color-brand-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}

.community-avatar-image {
  width: 100%;
  height: 100%;
}

.community-avatar text {
  color: var(--hh-color-brand-strong);
  font-size: var(--hh-text-body-base-size);
  font-weight: $hh-font-weight-bold;
}

.community-title {
  min-width: 0;
  color: #111;
  font-size: var(--hh-text-heading-md-size);
  line-height: var(--hh-text-heading-md-line);
  font-weight: $hh-font-weight-bold;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.community-switch {
  min-height: 48rpx;
  padding: 0 18rpx;
  border-radius: $hh-radius-full;
  background: rgba(255, 255, 255, 0.9);
  color: var(--hh-color-brand-primary);
  display: flex;
  align-items: center;
  gap: 8rpx;
  flex: 0 0 auto;
}

.community-switch text {
  font-size: var(--hh-text-body-base-size);
  line-height: var(--hh-text-body-base-line);
  font-weight: $hh-font-weight-bold;
}

.switch-icon {
  font-size: 24rpx;
  line-height: 1;
}

.home-quote {
  margin: 24rpx 0 28rpx;
  display: flex;
  align-items: flex-start;
  gap: 12rpx;
}

.home-quote-mark {
  width: 30rpx;
  color: rgba(61, 173, 125, 0.32);
  font-size: 54rpx;
  line-height: 0.9;
  font-weight: $hh-font-weight-bold;
}

.home-quote-main {
  flex: 1;
  min-width: 0;
}

.home-quote-text {
  display: block;
  color: #3f8f75;
  font-size: var(--hh-text-body-lg-size);
  line-height: var(--hh-text-body-lg-line);
  font-weight: $hh-font-weight-regular;
}

.home-quote-cite-wrap {
  margin-top: 12rpx;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14rpx;
}

.home-quote-line {
  width: 96rpx;
  height: 2rpx;
  background: rgba(61, 173, 125, 0.22);
}

.home-quote-cite {
  color: #5c907e;
  font-size: var(--hh-text-caption-base-size);
  line-height: var(--hh-text-caption-base-line);
}

.home-shell .home-search {
  margin: 28rpx 0 24rpx;
}

.home-shell .home-search-box {
  min-height: 90rpx;
  padding: 0 8rpx 0 30rpx;
  border: 0;
  border-radius: $hh-radius-full;
  box-shadow: none;
  gap: 15rpx;
}

.home-shell .home-search-input {
  height: 90rpx;
  font-size: 30rpx;
  line-height: 45rpx;
}

.home-shell .home-search-icon,
.home-shell .home-search-placeholder {
  color: rgba(0, 0, 0, 0.45);
}

.home-shell .home-search-action {
  flex: 0 0 150rpx;
  width: 150rpx;
  min-width: 0;
  height: 75rpx;
  padding: 0;
  background: var(--hh-color-brand-primary);
}

.home-shell .home-search-action text {
  font-size: 30rpx;
  line-height: 45rpx;
  font-weight: $hh-font-weight-medium;
}

.home-banner {
  position: relative;
  height: 310rpx;
  overflow: hidden;
  border-radius: var(--hh-radius-card);
  background: #cecece;
}

.home-banner-swiper,
.home-banner-slide {
  width: 100%;
  height: 100%;
}

.home-banner-slide {
  position: relative;
  overflow: hidden;
}

.home-banner-image,
.home-banner-art,
.home-banner-shade {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.home-banner-art {
  background:
    linear-gradient(130deg, rgba(36, 77, 54, 0.2), rgba(61, 173, 125, 0.06)),
    radial-gradient(circle at 24% 24%, #eaf6de 0, #b9ddc8 28%, transparent 29%),
    linear-gradient(155deg, #385b44 0%, #7ea67f 48%, #d0b78a 100%);
}

.home-banner-shade {
  background: linear-gradient(180deg, transparent 45%, rgba(0, 0, 0, 0.56) 100%);
}

.home-banner-title {
  position: absolute;
  left: 30rpx;
  bottom: 44rpx;
  color: #fff;
  font-size: var(--hh-text-heading-sm-size);
  line-height: var(--hh-text-heading-sm-line);
  font-weight: $hh-font-weight-bold;
}

.home-banner-dots {
  position: absolute;
  left: 30rpx;
  right: 30rpx;
  bottom: 16rpx;
  display: flex;
  gap: 10rpx;
  z-index: 3;
}

.home-banner-dot {
  width: 18rpx;
  height: 6rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.45);
}

.home-banner-dot.active {
  width: 42rpx;
  background: #ef4444;
}

.section-tabs {
  margin: 34rpx 0 20rpx;
  white-space: nowrap;
  overflow-anchor: none;
}

.section-tabs-inner {
  display: inline-flex;
  align-items: center;
  gap: 32rpx;
  padding: 0 var(--hh-page-x);
}

.section-tab {
  position: relative;
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-heading-sm-size);
  line-height: var(--hh-text-heading-sm-line);
  font-weight: $hh-font-weight-regular;
  white-space: nowrap;
}

.section-tab.active {
  font-weight: $hh-font-weight-bold;
}

.section-tab.active::after {
  content: "";
  position: absolute;
  left: 18rpx;
  right: -8rpx;
  bottom: 8rpx;
  height: 18rpx;
  border-radius: $hh-radius-full;
  background: linear-gradient(90deg, rgba(61, 173, 125, 0.34), rgba(61, 173, 125, 0));
  z-index: -1;
}

.active-archive {
  margin: 0 var(--hh-page-x) 28rpx;
  box-sizing: border-box;
  overflow-anchor: none;
}

.active-archive-body {
  min-height: inherit;
}

.active-archive--default .arc-card {
  box-sizing: border-box;
  min-height: inherit;
  margin-bottom: 0;
}

.guide-feed {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
}

.guide-feed-column {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.guide-feed .guide-card {
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
  border: 1rpx solid var(--hh-color-line);
  border-radius: var(--hh-radius-card);
  background: var(--hh-color-card);
  box-shadow: var(--hh-shadow-soft);
}

.guide-feed .guide-card:active {
  transform: scale(0.992);
}

.guide-feed .guide-cover {
  width: 100%;
  height: 286rpx;
  border: 0;
  border-radius: 0;
}

.guide-feed-column:first-child .guide-card:nth-child(2n) .guide-cover {
  height: 238rpx;
}

.guide-feed-column:nth-child(2) .guide-card:nth-child(2n + 1) .guide-cover {
  height: 248rpx;
}

.guide-feed-column:nth-child(2) .guide-card:nth-child(2n) .guide-cover {
  height: 306rpx;
}

.guide-feed .guide-cover-empty {
  min-height: 248rpx;
}

.guide-feed .guide-main {
  padding: 16rpx 16rpx 18rpx;
  gap: 8rpx;
}

.guide-feed .guide-title {
  font-family: $hh-font-sans;
  font-size: var(--hh-text-body-lg-size);
  line-height: var(--hh-text-body-lg-line);
  font-weight: $hh-font-weight-bold;
  color: var(--hh-color-text-primary);
  -webkit-line-clamp: 2;
}

.guide-feed .guide-excerpt {
  margin-top: 0;
  font-size: var(--hh-text-caption-lg-size);
  line-height: var(--hh-text-caption-lg-line);
  color: var(--hh-color-text-secondary);
  -webkit-line-clamp: 2;
}

.guide-feed .guide-stats {
  margin-top: 2rpx;
}

.guide-feed .guide-stat {
  padding: 4rpx 10rpx;
  font-size: var(--hh-text-caption-base-size);
  line-height: var(--hh-text-caption-base-line);
}

.guide-feed .guide-meta {
  margin-top: 2rpx;
  padding-top: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10rpx;
  font-family: $hh-font-sans;
  font-size: var(--hh-text-caption-base-size);
  line-height: var(--hh-text-caption-base-line);
}

.guide-author {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.guide-author-avatar {
  width: 32rpx;
  height: 32rpx;
  border-radius: $hh-radius-full;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: linear-gradient(135deg, var(--guide-avatar-start), var(--guide-avatar-end));
}

.guide-author-avatar text {
  color: #fff;
  font-size: 18rpx;
  line-height: 1;
  font-weight: $hh-font-weight-bold;
}

.guide-author-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.guide-when {
  flex: 0 0 auto;
}

.s1-top {
  margin: 0 var(--hh-page-x) 18rpx;
  padding: 24rpx;
  border: 1rpx solid var(--hh-color-line);
  border-radius: var(--hh-radius-panel);
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(232, 248, 240, 0.76));
  box-shadow: var(--hh-shadow-soft);
}

.s1-top.is-tappable:active {
  background: var(--hh-color-card);
}

.eyebrow,
.sec-head-t,
.sch-head-t {
  color: var(--hh-color-text-tertiary);
}

.title {
  font-size: 48rpx;
  color: var(--hh-color-text-primary);
  line-height: 1.14;
}

.sub,
.title-chev,
.sub-dot,
.arc-cnt,
.arc-arrow,
.arc-k,
.arc-mm,
.arc-when,
.guide-meta {
  color: var(--hh-color-text-tertiary);
}

.sub-switch,
.arc-meta.hot {
  color: var(--hh-color-brand-primary);
}

.avatar {
  background: var(--hh-color-brand-soft);
}

.avatar text {
  color: var(--hh-color-brand-strong);
}

.s1-quote {
  margin: 8rpx var(--hh-page-x) 28rpx;
  border-color: var(--hh-color-line-soft);
}

.home-search,
.notice-list,
.s1-live,
.arc-group,
.dormant {
  margin-left: var(--hh-page-x);
  margin-right: var(--hh-page-x);
}

.home-search-box {
  border-color: var(--hh-color-line);
  border-radius: var(--hh-radius-card);
  background: var(--hh-color-card);
  box-shadow: var(--hh-shadow-soft);
}

.home-search-action,
.live-cta {
  background: var(--hh-color-brand-primary);
}

.home-search-input {
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-body-base-size);
}

.home-search-icon,
.home-search-placeholder {
  color: var(--hh-color-text-tertiary);
}

.notice-board,
.group-card,
.sch-card,
.arc-card,
.dormant {
  border-color: var(--hh-color-line);
  border-radius: var(--hh-radius-card);
  background: var(--hh-color-card);
  box-shadow: var(--hh-shadow-soft);
}

.arc-card::before {
  background: var(--arc-accent, var(--hh-color-brand-primary));
  opacity: 0.82;
}

.arc-bh,
.live-h,
.arc-item,
.guide-card {
  border-color: var(--hh-color-line-soft);
}

.arc-nm,
.arc-title,
.guide-title,
.notice-section,
.live-t,
.sch-head-b,
.sec-head-b {
  color: var(--hh-color-text-primary);
}

.arc-nm,
.guide-title {
  font-family: $hh-font-sans;
}

.arc-group {
  margin-top: 0;
}

.guide-cover,
.guide-cover-empty {
  border-color: var(--hh-color-line-soft);
  border-radius: var(--hh-radius-card);
}

.guide-title {
  font-size: var(--hh-text-heading-sm-size);
}

.guide-excerpt,
.notice-content,
.q-text {
  color: var(--hh-color-text-secondary);
}

.guide-stat {
  background: var(--hh-color-brand-soft);
  color: var(--hh-color-brand-strong);
}

.guest-intro-panel {
  background: var(--hh-color-card);
  border-color: var(--hh-color-line);
}

.guest-intro-mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40rpx 32rpx;
  background: rgba(30, 26, 22, 0.42);
}
.guest-intro-panel {
  width: 100%;
  max-width: 640rpx;
  padding: 36rpx 32rpx 34rpx;
  border-radius: 32rpx;
  background: $hh-surface-1;
  border: 1rpx solid rgba(30, 26, 22, 0.08);
  box-shadow: $hh-shadow-modal;
}
.guest-intro-title {
  display: block;
  font-family: $hh-font-serif;
  font-size: 36rpx;
  font-weight: $hh-font-weight-bold;
  line-height: 1.28;
  color: $hh-ink-1;
  letter-spacing: $hh-tracking-serif-sm;
}
.guest-intro-body {
  display: block;
  margin-top: 18rpx;
  font-size: 27rpx;
  line-height: 1.62;
  color: $hh-ink-2;
}
.guest-intro-list {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  margin-top: 26rpx;
}
.guest-intro-row {
  display: flex;
  align-items: center;
  gap: 18rpx;
  min-height: 64rpx;
  padding: 12rpx 18rpx;
  border-radius: 18rpx;
  background: $hh-surface-2;
}
.guest-intro-row-label {
  flex: 0 0 auto;
  min-width: 96rpx;
  font-size: 24rpx;
  font-weight: $hh-font-weight-heavy;
  color: $hh-accent-ink;
}
.guest-intro-row-text {
  flex: 1;
  min-width: 0;
  font-size: 24rpx;
  line-height: 1.35;
  color: $hh-ink-2;
}
.guest-intro-primary,
.guest-intro-secondary {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 82rpx;
}
.guest-intro-primary {
  margin-top: 28rpx;
  border-radius: 42rpx;
  background: $hh-ink-1;
}
.guest-intro-primary text {
  font-size: 27rpx;
  font-weight: $hh-font-weight-bold;
  color: $hh-surface-1;
}
.guest-intro-secondary {
  margin-top: 12rpx;
}
.guest-intro-secondary text {
  font-size: 25rpx;
  font-weight: $hh-font-weight-bold;
  color: $hh-accent-ink;
}
</style>
