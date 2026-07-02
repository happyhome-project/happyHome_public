<template>
  <view class="phone-inner">
    <!-- Masthead：社群封面卡（整块可点切换社区） -->
    <view
      class="s1-top"
      :class="{ 'is-tappable': hasMultipleCommunities }"
      @tap="onMastheadTap"
    >
      <view class="top-body">
        <text class="eyebrow">{{ kindEn }}</text>
        <view class="title-wrap">
          <text class="title">{{ communityName }}</text>
          <text v-if="hasMultipleCommunities" class="title-chev">⌄</text>
        </view>
        <view v-if="communityMeta || hasMultipleCommunities" class="sub-row">
          <text v-if="communityMeta" class="sub">{{ communityMeta }}</text>
          <text v-if="hasMultipleCommunities" class="sub-switch">
            <text v-if="communityMeta" class="sub-dot">·</text>切换社区 ›
          </text>
        </view>
      </view>
      <view class="avatar">
        <text>{{ avatarLetter }}</text>
      </view>
    </view>

    <!-- Quote · 群训引文（可选） -->
    <view v-if="quote" class="s1-quote">
      <text class="q-text">{{ quote }}</text>
      <text v-if="quoteCite" class="cite">— {{ quoteCite }}</text>
    </view>

    <view v-if="homeBannerItems.length > 0" class="home-banner">
      <swiper
        class="home-banner-swiper"
        :current="homeBannerActiveIndex"
        :indicator-dots="false"
        :autoplay="false"
        @change="onHomeBannerChange"
      >
        <swiper-item
          v-for="banner in homeBannerItems"
          :key="banner.bannerId"
          class="home-banner-slide"
          @touchstart="onHomeBannerPointerStart"
          @touchmove="onHomeBannerPointerMove"
          @touchend="onHomeBannerPointerEnd"
          @mousedown="onHomeBannerPointerStart"
          @mousemove="onHomeBannerPointerMove"
          @mouseup="onHomeBannerPointerEnd"
          @tap="openHomeBanner(banner)"
        >
          <image
            :src="banner.coverImage"
            class="home-banner-image"
            mode="aspectFill"
          />
          <view class="home-banner-shade"></view>
          <text class="home-banner-title">{{ banner.title }}</text>
        </swiper-item>
      </swiper>
      <view v-if="homeBannerItems.length > 1" class="home-banner-dots">
        <text
          v-for="(banner, i) in homeBannerItems"
          :key="`${banner.bannerId}-dot`"
          class="home-banner-dot"
          :class="{ active: i === homeBannerActiveIndex }"
        ></text>
      </view>
    </view>

    <view class="home-search">
      <view class="home-search-box">
        <text class="home-search-icon">⌕</text>
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

    <!-- Admin notice · 管理员维护的固定公告 -->
    <view v-if="sectionNotices.length > 0" class="notice-list">
      <view
        v-for="(notice, i) in sectionNotices"
        :key="notice.id"
        class="notice-card"
        :class="{ 'is-long': notice.isLong }"
        :style="getNoticeCardStyle(notice, i)"
        @tap="notice.isLong && openNotice(notice)"
      >
        <view class="notice-head">
          <view class="notice-mark">
            <text>{{ notice.icon }}</text>
          </view>
          <view class="notice-title-wrap">
            <text class="notice-section">{{ notice.sectionName }}</text>
            <text class="notice-label">{{ notice.label }}</text>
          </view>
        </view>
        <text class="notice-content">{{ notice.preview }}</text>
        <view v-if="notice.isLong" class="notice-foot">
          <text>查看全文</text>
          <text class="notice-arrow">›</text>
        </view>
      </view>
    </view>

    <!-- Live strip · 实时脉冲区：有激活的实时协作板块时显示 -->
    <view v-if="liveItems.length > 0" class="s1-live">
      <view class="live-h">
        <view class="live-h-l">
          <view class="ping"></view>
          <text>正在进行</text>
        </view>
        <text class="live-h-n">{{ liveItems.length }} 件</text>
      </view>
      <view
        v-for="(item, i) in liveItems"
        :key="i"
        class="live-row"
        @tap="onLiveTap(item)"
      >
        <view class="live-ic">
          <text>{{ item.ic }}</text>
        </view>
        <view class="live-body">
          <text class="live-t">{{ item.t }}</text>
          <view v-if="item.isPinned || item.isFeatured" class="post-badges">
            <text v-if="item.isPinned" class="post-badge pin">置顶</text>
            <text v-if="item.isFeatured" class="post-badge feature">精华</text>
          </view>
          <view class="live-m">
            <text v-for="(m, j) in item.m" :key="j" class="live-m-item">{{ m }}</text>
          </view>
        </view>
        <view class="live-cta">
          <text>{{ item.cta }}</text>
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

    <!-- Section Head · 沉淀板块标题 -->
    <view class="sec-head">
      <text class="sec-head-t"><text class="sec-head-b">时光胶囊</text><text>· 沉淀精华</text></text>
    </view>

    <!-- Archive cards · 沉淀板块分组卡 -->
    <view class="arc-group">
      <view
        v-for="(g, gi) in archiveGroups"
        :key="g.id"
        class="arc-card"
        :data-index="gi"
        :style="getArchiveCardStyle(g, gi)"
        @tap="onGroupHeaderTap(g)"
      >
        <view class="arc-bh">
          <view class="arc-bh-l">
            <text class="arc-nm">{{ g.name }}</text>
            <text class="arc-cnt">· {{ g.count }} 条</text>
          </view>
          <text class="arc-arrow">›</text>
        </view>
        <template v-if="g.displayTemplate === 'guide_note'">
          <view
            v-for="(item, i) in g.items"
            :key="i"
            class="guide-card"
            @tap.stop="onPostTap(item)"
          >
            <image
              v-if="item.coverImage"
              :src="item.coverImage"
              mode="aspectFill"
              class="guide-cover"
            />
            <view v-else class="guide-cover guide-cover-empty">
              <text>{{ g.name.slice(0, 2) }}</text>
            </view>
            <view class="guide-main">
              <text class="guide-title">{{ item.t }}</text>
              <text v-if="item.excerpt" class="guide-excerpt">{{ item.excerpt }}</text>
              <view v-if="item.driveDuration" class="guide-stats">
                <text
                  class="guide-stat"
                >{{ item.driveDuration }}</text>
              </view>
              <view v-if="item.isPinned || item.isFeatured" class="post-badges guide-badges">
                <text v-if="item.isPinned" class="post-badge pin">置顶</text>
                <text v-if="item.isFeatured" class="post-badge feature">精华</text>
              </view>
              <view class="guide-meta">
                <text v-if="item.when">{{ item.when }}</text>
                <text v-if="item.contentAuthor">{{ item.contentAuthor }}</text>
              </view>
            </view>
          </view>
        </template>
        <template v-else>
          <view
            v-for="(item, i) in g.items"
            :key="i"
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
        </template>
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
    <!-- Community switcher modal -->
    <view v-if="showSwitcher" class="switcher-mask" @tap="showSwitcher = false">
      <view class="switcher-panel" @tap.stop>
        <text class="switcher-title">切换社区</text>
        <view
          v-for="c in communityStore.myCommunities"
          :key="c._id"
          class="switcher-item"
          :class="{ active: c._id === communityStore.currentCommunityId }"
          @tap="switchCommunity(c._id)"
        >
          <text>{{ c.name }}</text>
        </view>
      </view>
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
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { onLoad, onPullDownRefresh, onShareAppMessage, onShow } from '@dcloudio/uni-app'
import { useCommunityStore } from '../../store/community'
import { useUserStore } from '../../store/user'
import { memberApi, postApi } from '../../api/cloud'
import AppTabBar from '../../components/AppTabBar.vue'
import { hideNativeTabBar } from '../../utils/app-tabbar'
import { getArchiveHomeMeta, getFamilyLetterListSummary, getGuideNoteCard, getHomeLiveMeta, getPostHomeTitle, getPostHomeTitleIssue } from '../../utils/widget'
import { clientLog } from '../../utils/client-log'
import { openOnboardingPreservingStack } from '../../utils/onboarding-nav'
import { clearHomeSnapshotCache, getBestBackgroundFetchSnapshot, readHomeSnapshotCache, subscribeBackgroundFetchSnapshot, writeHomeSnapshotCache } from '../../utils/home-snapshot-cache'
import { resolveCloudFileUrl } from '../../utils/cloud-file-url'
import {
  buildCommunityOnboardingPath,
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
const showSwitcher = ref(false)
const showGuestIntro = ref(false)
const guestIntroConfig = ref<GuestIntroConfig | null>(null)
const postsBySection = ref<Record<string, any[]>>({})
const resolvedHomeBannerCoverUrls = ref<Record<string, string>>({})
const incomingShareCommunityId = ref('')
const shareImageUrl = ref(DEFAULT_COMMUNITY_SHARE_IMAGE)
const homeSearchQuery = ref('')
const homeBannerActiveIndex = ref(0)
let refreshingHome = false
let queuedForcedHomeRefresh = false
let mountedAt = 0
let unsubscribeBackgroundFetchSnapshot: (() => void) | null = null
let homeBannerPointerStartX = 0
let homeBannerPointerMoved = false
let suppressNextHomeBannerTap = false
let homeBannerResolveToken = 0
const reportedMissingHomeTitle = new Set<string>()
const NOTICE_PREVIEW_LIMIT = 68
const HOME_REFRESH_AFTER_POST_KEY = 'home_refresh_after_post'
const HOME_REFRESH_MARKER_TTL = 5 * 60 * 1000

onLoad((options?: Record<string, any>) => {
  if (!isCommunityShareQuery(options)) return
  incomingShareCommunityId.value = normalizeCommunityShareId(options?.communityId)
  clientLog('info', 'home.share.load', {
    communityId: incomingShareCommunityId.value,
  })
})

// ── Computed: masthead ──
const communityName = computed(() => communityStore.currentCommunity?.name ?? '选择社区')
const communityMeta = computed(() => '')
const avatarLetter = computed(() => {
  const name = communityStore.currentCommunity?.name ?? ''
  return name.charAt(0) || '?'
})
const hasMultipleCommunities = computed(() => (communityStore.myCommunities?.length ?? 0) > 1)

function onMastheadTap() {
  // 仅当用户有多个社区时才打开切换器；否则 tap 不做任何事（避免空切换器困扰）
  if (hasMultipleCommunities.value) {
    showSwitcher.value = true
  }
}

// 场景类型（暂时固定为社群，将来由 community.type 决定）
const kind = computed(() => '社群')
const kindEn = computed(() => 'Welcome : )')

// ── 群训引文：读 community.motto / mottoCite ──
const quote = computed(() => communityStore.currentCommunity?.motto || '')
const quoteCite = computed(() => communityStore.currentCommunity?.mottoCite || '')
const currentShareCommunityId = computed(() => communityStore.currentCommunityId || communityStore.currentCommunity?._id || '')

interface HomeBannerItem {
  bannerId: string
  postId: string
  title: string
  coverImage: string
}

const rawHomeBannerCoverImages = computed(() => {
  const banners = ((communityStore.currentCommunity as any)?.homeBanners || []) as HomeBanner[]
  return banners
    .map((banner) => String(banner?.coverImage || '').trim())
    .filter(Boolean)
})

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
  content: string
  preview: string
  isLong: boolean
  icon: string
  accentColor?: string
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
        content,
        preview,
        isLong: Array.from(content).length > NOTICE_PREVIEW_LIMIT,
        icon: section.icon || '告',
        accentColor: section.accentColor || '',
      })
    }
  }
  return notices
})

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

const archiveGroups = computed<ArchiveGroup[]>(() => {
  return (communityStore.currentSections ?? [])
    .filter((section) => secType(section) === 'evergreen' && secStatus(section) !== 'archived')
    .map((section) => {
      const posts = postsBySection.value[section._id] ?? []
      const displayTemplate: ArchiveGroup['displayTemplate'] = section.displayTemplate === 'guide_note' ? 'guide_note' : 'default'
      return {
        id: section._id,
        name: section.name,
        count: posts.length,
        accentColor: section.accentColor || '',
        displayTemplate,
        items: posts.slice(0, 3).map((p, idx) => {
          if (displayTemplate === 'guide_note') {
            const guide = getGuideNoteCard(p, section)
            return {
              k: '',
              t: guide.title,
              contentAuthor: guide.author,
              meta: '',
              excerpt: guide.excerpt,
              coverImage: guide.coverImage,
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

// ── Actions ──
function getHomeBannerPointerX(event: any): number {
  const touch = event?.touches?.[0] || event?.changedTouches?.[0]
  const clientX = Number(touch?.clientX ?? event?.clientX ?? 0)
  return Number.isFinite(clientX) ? clientX : 0
}

function onHomeBannerPointerStart(event: any) {
  homeBannerPointerStartX = getHomeBannerPointerX(event)
  homeBannerPointerMoved = false
}

function onHomeBannerPointerMove(event: any) {
  const currentX = getHomeBannerPointerX(event)
  if (Math.abs(currentX - homeBannerPointerStartX) > 16) {
    homeBannerPointerMoved = true
  }
}

function onHomeBannerPointerEnd(event: any) {
  const currentX = getHomeBannerPointerX(event)
  if (Math.abs(currentX - homeBannerPointerStartX) > 16 || homeBannerPointerMoved) {
    suppressNextHomeBannerTap = true
    setTimeout(() => {
      suppressNextHomeBannerTap = false
      homeBannerPointerMoved = false
    }, 350)
  }
}

function onHomeBannerChange(event: any) {
  const current = Number(event?.detail?.current || 0)
  homeBannerActiveIndex.value = Number.isFinite(current) ? current : 0
  suppressNextHomeBannerTap = true
  setTimeout(() => {
    suppressNextHomeBannerTap = false
  }, 350)
}

function openHomeBanner(item: HomeBannerItem) {
  if (suppressNextHomeBannerTap || homeBannerPointerMoved) {
    suppressNextHomeBannerTap = false
    homeBannerPointerMoved = false
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
  const url = buildCommunityOnboardingPath(communityId)
  uni.navigateTo({
    url,
    fail: () => {
      uni.redirectTo({
        url,
        fail: () => uni.reLaunch({ url }),
      })
    },
  })
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

async function switchCommunity(communityId: string) {
  showSwitcher.value = false
  communityStore.currentCommunityId = communityId
  communityStore.currentSectionIndex = 0
  communityStore.currentSections = []
  postsBySection.value = {}
  communityStore.saveToStorage()
  communityStore.refreshMembershipStatus(communityId).catch(() => {})
  await refreshHomeData({ force: true })
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
  min-height: 84rpx;
  padding: 0 16rpx 0 24rpx;
  border: 1rpx solid $hh-ink-line;
  border-radius: 22rpx;
  background: $hh-surface-1;
  box-shadow: $hh-shadow-card;
  display: flex;
  align-items: center;
  gap: 14rpx;
}
.home-search-icon {
  flex-shrink: 0;
  width: 32rpx;
  font-size: 30rpx;
  line-height: 1;
  color: $hh-ink-3;
}
.home-search-input {
  flex: 1;
  min-width: 0;
  height: 84rpx;
  font-size: 27rpx;
  color: $hh-ink-1;
}
.home-search-placeholder {
  color: $hh-ink-4;
}
.home-search-action {
  flex-shrink: 0;
  min-width: 92rpx;
  height: 56rpx;
  padding: 0 18rpx;
  border-radius: $hh-radius-full;
  background: $hh-ink-1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.home-search-action text {
  font-size: 23rpx;
  font-weight: $hh-font-weight-bold;
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
/* ═══ Switcher ═══ */
.switcher-mask {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 100;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.switcher-panel {
  width: 100%;
  background: $hh-surface-1;
  border-radius: 28rpx 28rpx 0 0;
  padding: 36rpx 32rpx 60rpx;
  max-height: 70vh;
  overflow-y: auto;
  border-top: 1rpx solid $hh-ink-line;
}
.switcher-title {
  display: block;
  font-family: $hh-font-mono;
  font-size: 20rpx;
  letter-spacing: $hh-tracking-mono;
  text-transform: uppercase;
  color: $hh-ink-3;
  margin-bottom: 20rpx;
  text-align: center;
}
.switcher-item {
  padding: 28rpx 24rpx;
  font-family: $hh-font-serif;
  font-size: 30rpx;
  color: $hh-ink-1;
  border-bottom: 1rpx solid $hh-ink-line-2;
}
.switcher-item.active {
  color: $hh-accent;
  font-weight: $hh-font-weight-bold;
}
.switcher-item:last-child { border-bottom: none; }

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
