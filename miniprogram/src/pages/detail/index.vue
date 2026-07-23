<template>
  <view
    class="detail-page"
    :class="{
      'detail-page--guide': isGuideNoteDetail,
      'detail-page--image-note': isImageNoteDetail,
      'detail-page--text-note': isTextNoteDetail,
    }"
  >
    <view
      v-if="post && section"
      class="content"
      data-testid="detail-ready"
      :data-post-id="post._id"
      :class="{
        'guide-note-detail': isGuideNoteDetail,
        'image-note-detail': isImageNoteDetail,
      }"
    >
      <view v-if="post.isPinned || post.isFeatured" class="post-flag-row">
        <text v-if="post.isPinned" class="post-flag pin">置顶</text>
        <text v-if="post.isFeatured" class="post-flag feature">精华</text>
      </view>
      <view v-if="post.originPostId && post.originLinkType === 'activity_invite'" class="origin-card" @tap="goOriginPost">
        <text class="origin-label">来自攻略</text>
        <text class="origin-title">{{ post.originTitle || '原帖' }}</text>
        <text class="origin-action">查看原帖 ›</text>
      </view>
      <ImageNoteDetailView
        :key="`image-note-${detailMediaRecoveryVersion}`"
        v-if="isImageNoteDetail && imageNoteDetail"
        :detail="imageNoteDetail"
        :media="imageNoteMediaItems"
        @media-load="onDetailMediaLoad"
        @media-error="onDetailMediaError"
        @open-location="openImageNoteLocation"
      />
      <GuideRouteDetailView
        v-else-if="isGuideNoteDetail && guideRouteDetail"
        :detail="guideRouteDetail"
      />

      <DefaultDetailView
        v-else
        :post="renderPost"
        :section="section"
        :widgets="regularWidgets"
        :post-meta="postMeta"
      />

      <template v-if="!isGuideNoteDetail">
        <view
          v-for="widget in attendanceWidgets"
          :key="widget.widgetId"
          class="attendance-card"
          :class="attendanceCardClass(widget)"
          @tap="openRoster(widget)"
        >
          <view class="attendance-head">
            <view class="attendance-title">
              <text class="attendance-count">{{ getAttendanceSummary(widget).occupiedSeats || 0 }}<text v-if="getAttendanceSummary(widget).capacity">/{{ getAttendanceSummary(widget).capacity }}</text></text>
              <template v-if="resolveAttendanceWidgetLabel(widget)">
                <text class="attendance-sep"> · </text>
                <text class="attendance-label">{{ resolveAttendanceWidgetLabel(widget) }}</text>
              </template>
            </view>
            <text
              class="attendance-tag"
              :class="attendanceTagClass(widget)"
              @tap.stop="handleAttendanceAction(widget)"
            >{{ attendanceTagText(widget) }} ›</text>
          </view>

          <view class="hh-avatar-stack">
            <view
              v-for="user in getAttendanceSummary(widget).previewUsers"
              :key="user.userId"
              class="hh-avatar-slot"
              :class="{ 'is-self': user.userId === userStore.openId }"
            >
              <image
                :src="attendanceAvatarSrc(user)"
                class="hh-avatar-img"
                mode="aspectFill"
              />
              <text v-if="(user.seatCount || 1) >= 2" class="hh-avatar-badge">{{ user.seatCount }}</text>
            </view>
            <view
              v-for="n in emptySlotCount(widget)"
              :key="'empty-' + widget.widgetId + '-' + n"
              class="hh-avatar-slot hh-avatar-slot--empty"
            >
              <text class="hh-avatar-empty-mark">＋</text>
            </view>
            <view v-if="!getAttendanceSummary(widget).previewUsers.length && !emptySlotCount(widget)" class="hh-avatar-empty-text">暂无</view>
          </view>
        </view>
      </template>

      <view v-if="activityInviteWidgets.length" class="activity-invite-card">
        <view class="activity-invite-main">
          <text class="activity-invite-kicker">活动召集</text>
          <text class="activity-invite-title">{{ activityInviteTitle }}</text>
          <text class="activity-invite-desc">{{ activityInviteDesc }}</text>
        </view>
        <button
          class="activity-invite-btn"
          size="mini"
          :disabled="activityInviteLoading"
          @tap="handleActivityInviteTap"
        >
          {{ activityInviteButtonText }}
        </button>
      </view>

      <view v-if="!isImageNoteDetail || isAuthor" class="meta">
        <view v-if="!isImageNoteDetail" class="meta-main">
          <view class="meta-author">
            <image
              v-if="detailAuthorAvatarUrl"
              :src="resolvedAvatarUrl(detailAuthorAvatarUrl)"
              class="meta-author-avatar"
              mode="aspectFill"
            />
            <view
              v-else-if="shouldUseGeneratedAuthorAvatar"
              class="meta-author-avatar meta-author-avatar--generated"
            >
              <text>{{ detailAuthorInitial }}</text>
            </view>
            <text class="meta-author-name">{{ detailAuthorName }}</text>
          </view>
          <text class="time">发布于 {{ formatDate(post.createdAt) }}</text>
        </view>
        <view v-if="isAuthor" class="actions">
          <text
            class="post-settings-trigger"
            data-testid="post-settings-trigger"
            @tap="openPostSettings"
          >编辑和设置 ›</text>
        </view>
      </view>
    </view>

    <view v-else-if="loadError" class="detail-state detail-error">
      <text class="detail-state-title">详情加载失败</text>
      <text class="detail-state-desc">{{ loadError }}</text>
      <view class="detail-state-actions">
        <button class="detail-state-btn primary" size="mini" @tap="retryLoad">重试</button>
        <button class="detail-state-btn" size="mini" @tap="goBack">返回</button>
      </view>
    </view>

    <view v-else class="loading"><text>加载中...</text></view>

    <view v-if="showRoster" class="roster-mask" @tap="closeRoster">
      <view class="roster-panel" @tap.stop>
        <view class="roster-header">
          <view>
            <text class="roster-title">{{ rosterTitle }}</text>
            <text class="roster-subtitle">
              {{ rosterMeta.occupiedSeats }}<text v-if="rosterMeta.capacity">/{{ rosterMeta.capacity }}</text> 席
              <text v-if="rosterMeta.total !== rosterMeta.occupiedSeats"> · 共 {{ rosterMeta.total }} 组</text>
            </text>
          </view>
          <view class="roster-actions">
            <text
              v-if="rosterSelfJoined"
              class="roster-cancel"
              :class="{ disabled: cancelBusy }"
              @tap="handleCancelInSheet"
            >{{ cancelBusy ? '取消中...' : '取消参与' }}</text>
            <text class="roster-close" @tap="closeRoster">关闭</text>
          </view>
        </view>
        <scroll-view scroll-y class="roster-list">
          <view v-for="member in rosterMembers" :key="`${member.userId}-${member.joinedAt}`" class="roster-item">
            <image :src="resolvedAvatarUrl(member.avatarUrl)" class="roster-avatar" mode="aspectFill" />
            <view class="roster-info">
              <text class="roster-name">
                {{ member.nickName || member.userId }}
                <text v-if="(member.seatCount || 1) >= 2" class="roster-companion">（+{{ (member.seatCount || 1) - 1 }} 位同伴）</text>
              </text>
              <text class="roster-time">{{ formatDateTime(member.joinedAt) }}</text>
            </view>
          </view>
          <view v-if="rosterMembers.length === 0" class="roster-empty">还没有人参与</view>
        </scroll-view>
      </view>
    </view>

    <view v-if="showPostSettings" class="post-settings-mask" @tap="closePostSettings">
      <view class="post-settings-sheet" data-testid="post-settings-sheet" @tap.stop>
        <view class="post-settings-header">
          <text class="post-settings-title">笔记设置</text>
          <text class="post-settings-close" @tap="closePostSettings">×</text>
        </view>
        <view class="post-settings-actions">
          <view class="post-settings-action" data-testid="post-settings-edit" @tap="openPostEditor">
            <view class="post-settings-icon">
              <image class="post-settings-icon-image" src="/static/post-settings/edit.svg" mode="aspectFit" />
            </view>
            <text class="post-settings-label">编辑</text>
          </view>
          <view
            class="post-settings-action"
            data-testid="post-settings-delete"
            data-testid-legacy="post-delete"
            :class="{ disabled: deleteLock.busy.value }"
            @tap="handleSettingsDelete"
          >
            <view class="post-settings-icon">
              <image class="post-settings-icon-image" src="/static/post-settings/delete.svg" mode="aspectFit" />
            </view>
            <text class="post-settings-label">删除</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onErrorCaptured, reactive, ref, watch } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { collaborationTemplateApi, postApi, sectionApi } from '../../api/cloud'
import { useCommunityStore } from '../../store/community'
import { useUserStore } from '../../store/user'
import GuideRouteDetailView from '../../components/GuideRouteDetailView.vue'
import ImageNoteDetailView from '../../components/ImageNoteDetailView.vue'
import DefaultDetailView from '../../components/DefaultDetailView.vue'
import { useBusyLock, useKeyedBusyLock } from '../../utils/useBusyLock'
import { resolveAttendanceWidgetLabel } from '../../utils/widget-form'
import { refreshCloudFileUrl, resolveCloudFileUrls } from '../../utils/cloud-file-url'
import { clientLog } from '../../utils/client-log'
import { openOnboardingPreservingStack } from '../../utils/onboarding-nav'
import { buildGuideRouteDetail } from '../../utils/guide-detail'
import {
  buildImageNoteMediaItems,
  buildImageNoteDetail,
  isImageNoteSectionContract,
  type ImageNoteLocation,
} from '../../utils/image-note'
import { extractRichNoteImageSources } from '../../utils/rich-note'
import { ensureHierarchyStack, navigateBackOrHome } from '../../utils/hierarchy-nav'
import { asCollaborationSection } from '../../utils/collaboration-template'
import { buildNativeArchiveDetailSection, normalizeNativeArchiveDetailPost } from '../../utils/archive-detail'

const fallbackAvatar = '/static/default-avatar.png'
const ATTENDANCE_SLOT_DISPLAY_MAX = 6
const ACTIVITY_INVITE_CREATE_INTENT_KEY = 'activity_invite_create_intent_v1'

const post = ref<any>(null)
const section = ref<any>(null)
const currentPostId = ref('')
const loading = ref(false)
const loadError = ref('')
const showRoster = ref(false)
const rosterMembers = ref<any[]>([])
const rosterTitle = ref('')
const rosterWidgetId = ref('')
const rosterMeta = reactive({
  total: 0,
  occupiedSeats: 0,
  capacity: undefined as number | undefined,
})
const resolvedAvatarUrls = reactive<Record<string, string>>({})
const resolvedDetailMediaUrls = reactive<Record<string, string>>({})
const settledDetailMediaUrls = reactive<Record<string, boolean>>({})
const detailMediaRecoveryVersion = ref(0)
const detailMediaRecoveryPending = new Set<string>()
const detailMediaRecoveryAttempts = new Map<string, number>()
const cancelBusy = ref(false)
const activityInviteState = ref<any>(null)
const activityInviteLoading = ref(false)
const showPostSettings = ref(false)
const communityStore = useCommunityStore()
const userStore = useUserStore()
const GUIDE_NOTE_NAME_HINTS = ['亲子出游', '周末遛娃', '村游攻略', '路线攻略', '出游攻略']
clientLog('info', 'detail.setup', {})

const rosterSelfJoined = computed(() => {
  if (!rosterWidgetId.value) return false
  const summary = post.value?.attendanceSummaryByWidget?.[rosterWidgetId.value]
  return Boolean(summary?.isJoined)
})

const isAuthor = computed(() => post.value?.authorId === userStore.openId)
const detailAuthorName = computed(() =>
  String(post.value?.authorNickname || '社区邻居').trim() || '社区邻居'
)
const detailAuthorInitial = computed(() => detailAuthorName.value.slice(0, 1) || '邻')
const detailAuthorAvatarUrl = computed(() => String(post.value?.authorAvatarUrl || '').trim())
const shouldUseGeneratedAuthorAvatar = computed(() => {
  if (detailAuthorAvatarUrl.value) return false
  return String(post.value?.source || '').toLowerCase() === 'ai'
})
const postMeta = computed(() => ({
  postId: String(post.value?._id || currentPostId.value || ''),
  postTitle: String(post.value?.content?.[regularWidgets.value[0]?.widgetId] || detailSectionTitle.value || '帖子'),
  sectionId: String(post.value?.sectionId || section.value?._id || ''),
  communityId: String(post.value?.communityId || section.value?.communityId || ''),
}))
const detailSectionTitle = computed(() => section.value?.name || '')
const isImageNoteDetail = computed(() => isImageNoteSectionContract(section.value))
const isGuideNoteDetail = computed(() =>
  !isImageNoteDetail.value && resolveGuideNoteDetailTemplate(section.value)
)
const isTextNoteDetail = computed(() => section.value?.displayTemplate === 'text_note')
const renderPost = computed(() => {
  const currentPost = post.value
  if (!currentPost) return currentPost
  const replacements = resolvedDetailMediaUrls
  return Object.assign({}, currentPost, {
    content: Object.keys(replacements).length
      ? replaceResolvedMediaUrls(currentPost.content || {}, replacements)
      : currentPost.content,
    authorAvatarUrl: currentPost.authorAvatarUrl
      ? resolvedAvatarUrl(currentPost.authorAvatarUrl)
      : '',
  })
})
const guideRouteDetail = computed(() => {
  if (!renderPost.value || !section.value || !isGuideNoteDetail.value) return null
  return buildGuideRouteDetail(renderPost.value, section.value)
})
const imageNoteDetail = computed(() => {
  if (!renderPost.value || !section.value || !isImageNoteDetail.value) return null
  return buildImageNoteDetail(renderPost.value, section.value)
})
const imageNoteMediaItems = computed(() => {
  if (!post.value || !section.value || !isImageNoteDetail.value) return []
  const canonicalDetail = buildImageNoteDetail(post.value, section.value)
  return buildImageNoteMediaItems(
    canonicalDetail.images,
    resolvedDetailMediaUrls,
    settledDetailMediaUrls,
  )
})
const regularWidgets = computed(() =>
  (section.value?.widgets || []).filter((widget: any) => !['attendance', 'admin_notice', 'activity_invite'].includes(widget.type))
)
const attendanceWidgets = computed(() => (section.value?.widgets || []).filter((widget: any) => widget.type === 'attendance'))
const activityInviteWidgets = computed(() => (section.value?.widgets || []).filter((widget: any) => widget.type === 'activity_invite'))
const activityInvite = computed(() => activityInviteState.value?.invite || null)
const activityInviteTitle = computed(() => {
  const invite = activityInvite.value
  if (invite?.postId) return invite.title || '已有出游邀约'
  return '想一起去？可以发起一次实时邀约'
})
const activityInviteDesc = computed(() => {
  const invite = activityInvite.value
  if (!invite?.postId) return '填写出发时间、集合地点、联系电话和人数，发布后大家可以直接报名参与。'
  const occupied = Number(invite.occupiedSeats || 0)
  const capacity = Number(invite.capacity || 0)
  const seatText = capacity ? `${occupied}/${capacity} 席` : `${occupied} 席已报名`
  return `${formatDateTime(invite.eventStartsAt)} · ${seatText}`
})
const activityInviteButtonText = computed(() => {
  if (activityInviteLoading.value) return '加载中...'
  return activityInvite.value?.postId ? '去参与' : '发起召集'
})

function resolveGuideNoteDetailTemplate(currentSection: any): boolean {
  if (currentSection?.displayTemplate === 'text_note') return false
  if (currentSection?.displayTemplate === 'guide_note') return true
  const sectionName = String(currentSection?.name || '').trim()
  return GUIDE_NOTE_NAME_HINTS.some((hint) => sectionName.includes(hint))
}

function openImageNoteLocation(location: ImageNoteLocation) {
  uni.openLocation({
    latitude: location.lat,
    longitude: location.lng,
    address: location.address,
    name: location.name || location.address || '设置地点',
    scale: 16,
  })
}

function openPostSettings() {
  if (!isAuthor.value) return
  showPostSettings.value = true
}

function closePostSettings() {
  showPostSettings.value = false
}

function openPostEditor() {
  const postId = String(post.value?._id || '')
  if (!postId) return
  closePostSettings()
  const returnTo = `/pages/detail/index?postId=${encodeURIComponent(postId)}`
  uni.navigateTo({
    url: `/pages/create/index?editPostId=${encodeURIComponent(postId)}&returnTo=${encodeURIComponent(returnTo)}`,
  })
}

function handleSettingsDelete() {
  if (deleteLock.busy.value) return
  closePostSettings()
  void deleteLock.run()
}

onErrorCaptured((error, _instance, info) => {
  clientLog('error', 'detail.errorCaptured', {
    info,
    error,
    postId: currentPostId.value,
    hasPost: !!post.value,
    hasSection: !!section.value,
  })
  loadError.value = '详情渲染失败，请把页面版本和时间发给开发者'
  return false
})

onLoad(async (options: any) => {
  if (ensureHierarchyStack('/pages/detail/index', options || {}, options?.returnTo)) return
  const postId = String(options?.postId || '')
  clientLog('info', 'detail.onLoad', {
    rawOptions: options || {},
    postId,
    loggedIn: userStore.isLoggedIn,
  })
  if (!postId) {
    clientLog('error', 'detail.onLoad.missingPostId', { rawOptions: options || {} })
    loadError.value = '缺少帖子参数，请从首页重新进入'
    return
  }
  currentPostId.value = postId
  await ensurePostLoaded()
})

onShow(() => {
  clientLog('info', 'detail.onShow', {
    postId: currentPostId.value,
    loggedIn: userStore.isLoggedIn,
    hasPost: !!post.value,
    hasSection: !!section.value,
  })
  void ensurePostLoaded()
})

watch(
  () => userStore.isLoggedIn,
  (isLoggedIn) => {
    if (isLoggedIn) void ensurePostLoaded()
  },
)

async function ensurePostLoaded() {
  if (!currentPostId.value) {
    clientLog('warn', 'detail.ensure.skip.noPostId', {})
    return
  }
  if (post.value?._id === currentPostId.value && section.value) {
    clientLog('debug', 'detail.ensure.skip.alreadyLoaded', {
      postId: currentPostId.value,
      sectionId: section.value?._id || '',
    })
    await loadActivityInviteState()
    return
  }
  await loadPost(currentPostId.value)
}

async function loadPost(postId: string) {
  if (loading.value) {
    clientLog('warn', 'detail.load.skip.busy', { postId })
    return
  }
  loading.value = true
  loadError.value = ''
  detailMediaRecoveryVersion.value = 0
  detailMediaRecoveryPending.clear()
  detailMediaRecoveryAttempts.clear()
  clearRecord(resolvedDetailMediaUrls)
  clearRecord(settledDetailMediaUrls)
  clientLog('info', 'detail.load.start', {
    postId,
    cachedSectionCount: communityStore.currentSections.length,
    loggedIn: userStore.isLoggedIn,
  })
  try {
    const res = await postApi.get(postId, !userStore.isLoggedIn)
    clientLog('info', 'detail.post.get.success', {
      postId,
      hasPost: !!res?.post,
      sectionId: res?.post?.sectionId || '',
      communityId: res?.post?.communityId || '',
      contentKeys: res?.post?.content ? Object.keys(res.post.content) : [],
    })
    if (!res?.post) {
      throw new Error('帖子数据为空，请稍后重试')
    }
    post.value = normalizeNativeArchiveDetailPost(res.post)
    if (post.value?.area === 'collaboration') {
      let template = res?.collaborationTemplate
      if (!template && post.value?.collaborationTemplateId) {
        const templateResponse = await collaborationTemplateApi.get(post.value.collaborationTemplateId)
        template = templateResponse?.template
      }
      section.value = template
        ? asCollaborationSection(template, post.value?.communityId)
        : null
    } else {
      section.value = post.value?.area === 'archive' && !post.value?.sectionId
        ? buildNativeArchiveDetailSection(post.value)
        : communityStore.currentSections.find((item: any) => item._id === post.value?.sectionId) || null
    }
    clientLog('debug', 'detail.section.cache.lookup', {
      postId,
      sectionId: post.value?.sectionId || '',
      found: !!section.value,
      cachedSectionCount: communityStore.currentSections.length,
    })

    if (post.value?.area !== 'collaboration' && !section.value && post.value?.sectionId) {
      clientLog('info', 'detail.section.get.start', {
        sectionId: post.value.sectionId,
      })
      const sectionRes = await sectionApi.get(post.value.sectionId, !userStore.isLoggedIn)
      section.value = sectionRes.section || null
      clientLog('info', 'detail.section.get.success', {
        sectionId: post.value.sectionId,
        found: !!section.value,
        widgetCount: section.value?.widgets?.length || 0,
      })
    }

    if (!section.value) {
      throw new Error('板块信息加载失败，请稍后重试')
    }
    await resolveDetailMediaUrls()
    await resolveAttendanceAvatarUrls()
    await loadActivityInviteState()
    clientLog('info', 'detail.load.success', {
      postId,
      sectionId: section.value?._id || '',
      regularWidgetCount: regularWidgets.value.length,
      attendanceWidgetCount: attendanceWidgets.value.length,
    })
  } catch (error: any) {
    clientLog('error', 'detail.load.fail', {
      postId,
      error,
      hasPost: !!post.value,
      hasSection: !!section.value,
    })
    if (error?.message?.includes('需要先加入社区后查看内容')) {
      communityStore.clearCommunityState()
      uni.showToast({ title: '需要先加入社区后查看内容', icon: 'none' })
      openOnboardingPreservingStack({ replaceCurrent: true })
      return
    }
    loadError.value = friendlyLoadError(error)
    uni.showToast({ title: loadError.value, icon: 'none' })
  } finally {
    loading.value = false
    clientLog('debug', 'detail.load.finally', {
      postId,
      hasPost: !!post.value,
      hasSection: !!section.value,
      loadError: loadError.value,
    })
  }
}

function clearRecord(record: Record<string, unknown>) {
  Object.keys(record).forEach((key) => {
    delete record[key]
  })
}

function collectCloudMediaUrls(value: unknown, target: string[] = []): string[] {
  if (typeof value === 'string') {
    if (value.startsWith('cloud://') && !target.includes(value)) target.push(value)
    if (value.includes('cloud://')) {
      extractRichNoteImageSources(value).forEach((src) => {
        if (src.startsWith('cloud://') && !target.includes(src)) target.push(src)
      })
    }
    return target
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectCloudMediaUrls(item, target))
    return target
  }
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    Object.keys(source).forEach((key) => collectCloudMediaUrls(source[key], target))
  }
  return target
}

async function resolveDetailMediaUrls() {
  const urls = collectCloudMediaUrls(post.value?.content || {})
  clientLog('debug', 'detail.media.resolve.start', {
    postId: currentPostId.value,
    urlCount: urls.length,
  })
  if (urls.length === 0) return
  urls.forEach((url) => {
    resolvedDetailMediaUrls[url] = ''
    settledDetailMediaUrls[url] = false
  })
  const primaryUrl = urls[0]
  const remainingUrls = urls.slice(1)
  let resolvedCount = 0
  try {
    const primaryResolved = await resolveCloudFileUrls([primaryUrl])
    resolvedCount += applyDetailMediaResolution(primaryResolved)
  } catch (error) {
    clientLog('warn', 'detail.media.resolve.primary.fail', {
      postId: currentPostId.value,
      error,
    })
  }
  if (remainingUrls.length) {
    try {
      const resolved = await resolveCloudFileUrls(remainingUrls)
      resolvedCount += applyDetailMediaResolution(resolved)
    } catch (error) {
      clientLog('warn', 'detail.media.resolve.rest.fail', {
        postId: currentPostId.value,
        urlCount: remainingUrls.length,
        error,
      })
    }
  }
  clientLog('debug', 'detail.media.resolve.success', {
    postId: currentPostId.value,
    resolvedCount,
  })
  urls.forEach((source) => {
    if (!settledDetailMediaUrls[source]) settledDetailMediaUrls[source] = true
  })
  urls
    .filter((source) => !resolvedDetailMediaUrls[source])
    .forEach((source) => {
      void onDetailMediaError(source)
    })
}

function applyDetailMediaResolution(resolved: Record<string, string>): number {
  let resolvedCount = 0
  Object.entries(resolved).forEach(([source, candidate]) => {
    const url = String(candidate || '').trim()
    resolvedDetailMediaUrls[source] = url && !url.startsWith('cloud://') ? url : ''
    settledDetailMediaUrls[source] = true
    if (resolvedDetailMediaUrls[source]) resolvedCount += 1
  })
  return resolvedCount
}

function canonicalDetailMediaSource(value: string): string {
  const current = String(value || '').trim()
  if (current.startsWith('cloud://')) return current
  return Object.entries(resolvedDetailMediaUrls)
    .find(([, resolved]) => resolved === current)?.[0] || ''
}

function onDetailMediaLoad(value: string) {
  const source = canonicalDetailMediaSource(value)
  if (source) detailMediaRecoveryAttempts.delete(source)
}

async function onDetailMediaError(value: string) {
  const source = canonicalDetailMediaSource(value)
  if (!source || detailMediaRecoveryPending.has(source)) return
  let attempts = detailMediaRecoveryAttempts.get(source) || 0
  if (attempts >= 2) {
    settledDetailMediaUrls[source] = true
    return
  }
  detailMediaRecoveryPending.add(source)
  clientLog('warn', 'detail.media.load.fail', {
    postId: currentPostId.value,
    attempt: attempts + 1,
  })
  try {
    while (attempts < 2) {
      attempts += 1
      detailMediaRecoveryAttempts.set(source, attempts)
      settledDetailMediaUrls[source] = false
      resolvedDetailMediaUrls[source] = ''
      const refreshed = await refreshCloudFileUrl(source)
      if (refreshed && !refreshed.startsWith('cloud://')) {
        resolvedDetailMediaUrls[source] = refreshed
        break
      }
    }
  } catch (error) {
    clientLog('warn', 'detail.media.refresh.fail', {
      postId: currentPostId.value,
      attempt: attempts,
      error,
    })
  } finally {
    settledDetailMediaUrls[source] = true
    detailMediaRecoveryVersion.value += 1
    detailMediaRecoveryPending.delete(source)
  }
}

function replaceResolvedMediaUrls(value: unknown, replacements: Record<string, string>): any {
  if (typeof value === 'string') {
    let next = value
    Object.keys(replacements).forEach((rawUrl) => {
      const resolvedUrl = replacements[rawUrl]
      if (rawUrl && rawUrl !== resolvedUrl) {
        next = next.split(rawUrl).join(resolvedUrl)
      }
    })
    return next
  }
  if (Array.isArray(value)) return value.map((item) => replaceResolvedMediaUrls(item, replacements))
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const next: Record<string, any> = {}
    Object.keys(source).forEach((key) => {
      next[key] = replaceResolvedMediaUrls(source[key], replacements)
    })
    return next
  }
  return value
}

async function loadActivityInviteState() {
  if (!post.value?._id || activityInviteWidgets.value.length === 0) {
    activityInviteState.value = null
    return
  }
  activityInviteLoading.value = true
  try {
    activityInviteState.value = await postApi.getActivityInviteState(post.value._id, !userStore.isLoggedIn)
  } catch (error: any) {
    clientLog('warn', 'detail.activityInvite.state.fail', {
      postId: post.value?._id || '',
      error,
    })
    activityInviteState.value = null
  } finally {
    activityInviteLoading.value = false
  }
}

function friendlyLoadError(error: any) {
  const message = String(error?.message || '')
  if (message.includes('缺少帖子参数')) return message
  if (message.includes('帖子数据为空')) return message
  if (message.includes('板块信息加载失败')) return message
  if (message.includes('not found') || message.includes('does not exist') || message.includes('帖子不存在')) {
    return '帖子不存在或已被删除'
  }
  if (message.includes('Missing OPENID')) return '登录状态已过期，请重新登录后再试'
  if (message.includes('cloud') || message.includes('request') || message.includes('HTTP')) {
    return '网络开小差了，请稍后重试'
  }
  return message || '帖子加载失败，请稍后重试'
}

function retryLoad() {
  if (!currentPostId.value) return
  clientLog('info', 'detail.retry.tap', { postId: currentPostId.value })
  void loadPost(currentPostId.value)
}

function goBack() {
  clientLog('info', 'detail.goBack.tap', { postId: currentPostId.value })
  navigateBackOrHome()
}

function goOriginPost() {
  const originPostId = String(post.value?.originPostId || '')
  if (!originPostId) return
  uni.navigateTo({ url: `/pages/detail/index?postId=${encodeURIComponent(originPostId)}` })
}

async function handleActivityInviteTap() {
  if (!post.value?._id) return
  if (activityInvite.value?.postId) {
    uni.navigateTo({ url: `/pages/detail/index?postId=${encodeURIComponent(activityInvite.value.postId)}` })
    return
  }
  if (!userStore.isLoggedIn) {
    uni.showToast({ title: '请先登录后发起召集', icon: 'none' })
    uni.switchTab({ url: '/pages/profile/index' })
    return
  }
  try {
    const returnTo = `/pages/detail/index?postId=${encodeURIComponent(post.value._id)}`
    uni.setStorageSync(ACTIVITY_INVITE_CREATE_INTENT_KEY, {
      sourcePostId: post.value._id,
      returnTo,
      createdAt: Date.now(),
    })
    uni.navigateTo({ url: `/pages/create/index?returnTo=${encodeURIComponent(returnTo)}` })
    return
  } catch {}
  uni.navigateTo({ url: '/pages/create/index' })
}

const deleteLock = useBusyLock(async () => {
  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '确认删除',
      content: '删除后不可恢复',
      success: (res) => resolve(res.confirm),
    })
  })
  if (!confirmed) return
  try {
    await postApi.delete(post.value._id)
    uni.showToast({ title: '已删除', icon: 'success' })
    navigateBackOrHome()
  } catch (error: any) {
    uni.showToast({ title: error?.message || '删除失败', icon: 'none' })
  }
})

function getAttendanceSummary(widget: any) {
  return post.value?.attendanceSummaryByWidget?.[widget.widgetId] || {
    count: 0,
    occupiedSeats: 0,
    isFull: false,
    isJoined: false,
    previewUsers: [],
  }
}

function resolvedAvatarUrl(rawUrl: unknown) {
  const url = String(rawUrl || '').trim()
  if (!url) return fallbackAvatar
  const resolved = String(resolvedAvatarUrls[url] || url).trim()
  return resolved.startsWith('cloud://') ? fallbackAvatar : resolved
}

function attendanceAvatarSrc(user: any) {
  const rawUrl = user?.userId === userStore.openId
    ? (userStore.avatarUrl || user?.avatarUrl || '')
    : (user?.avatarUrl || '')
  return resolvedAvatarUrl(rawUrl)
}

function collectAttendanceAvatarUrls() {
  const urls: string[] = []
  if (post.value?.authorAvatarUrl) urls.push(String(post.value.authorAvatarUrl))
  if (userStore.avatarUrl) urls.push(userStore.avatarUrl)
  const summaries = post.value?.attendanceSummaryByWidget || {}
  Object.keys(summaries).forEach((key) => {
    const summary = summaries[key] || {}
    ;(summary.previewUsers || []).forEach((user: any) => {
      if (user?.avatarUrl) urls.push(String(user.avatarUrl))
    })
  })
  ;(rosterMembers.value || []).forEach((member: any) => {
    if (member?.avatarUrl) urls.push(String(member.avatarUrl))
  })
  return urls
}

async function resolveAttendanceAvatarUrls() {
  const urls = collectAttendanceAvatarUrls()
  clientLog('debug', 'detail.avatar.resolve.start', {
    postId: currentPostId.value,
    urlCount: urls.length,
  })
  if (urls.length === 0) return
  try {
    const resolved = await resolveCloudFileUrls(urls)
    Object.assign(resolvedAvatarUrls, resolved)
    clientLog('debug', 'detail.avatar.resolve.success', {
      postId: currentPostId.value,
      resolvedCount: Object.keys(resolved).length,
    })
  } catch (_error) {
    clientLog('warn', 'detail.avatar.resolve.fail', {
      postId: currentPostId.value,
      urlCount: urls.length,
    })
    // Keep the original URL/fallback when temp URL resolution is unavailable.
  }
}

function attendanceCardClass(widget: any) {
  const s = getAttendanceSummary(widget)
  return {
    'is-joined': s.isJoined,
    'is-full': s.isFull && !s.isJoined,
  }
}

function attendanceTagClass(widget: any) {
  const s = getAttendanceSummary(widget)
  if (s.isJoined) return 'is-joined'
  if (s.isFull) return 'is-full'
  return 'is-join'
}

function attendanceTagText(widget: any) {
  const s = getAttendanceSummary(widget)
  if (s.isJoined) return '已参与'
  if (s.isFull) return '已满座'
  return '去报名'
}

function emptySlotCount(widget: any) {
  const s = getAttendanceSummary(widget)
  const cap = Number(s.capacity || 0)
  if (!cap) return 0
  const filled = Array.isArray(s.previewUsers) ? s.previewUsers.length : 0
  const remainingSeats = Math.max(0, cap - (s.occupiedSeats || 0))
  const remainingVisible = Math.max(0, ATTENDANCE_SLOT_DISPLAY_MAX - filled)
  return Math.min(remainingSeats, remainingVisible)
}

// 按 widgetId 锁：同一 widget 的并发点击被抑制，不同 widget 并发允许
const attendanceLock = useKeyedBusyLock(
  async (widget: any, seatCount: number) => {
    try {
      await postApi.joinAttendance(post.value._id, widget.widgetId, seatCount)
      await loadPost(currentPostId.value)
    } catch (error: any) {
      uni.showToast({ title: error?.message || '报名失败', icon: 'none' })
    }
  },
  (widget: any) => String(widget.widgetId),
)

async function handleAttendanceAction(widget: any) {
  if (!post.value) return
  if (!userStore.isLoggedIn) {
    uni.showToast({ title: '请先登录后再参与', icon: 'none' })
    uni.switchTab({ url: '/pages/profile/index' })
    return
  }
  const summary = getAttendanceSummary(widget)

  // 已参与 → 直接打开名单（取消动作在 sheet 里）
  if (summary.isJoined) {
    await openRoster(widget)
    return
  }
  // 已满座且未参与 → 只能看名单
  if (summary.isFull) {
    uni.showToast({ title: '已满座，可查看名单', icon: 'none' })
    await openRoster(widget)
    return
  }

  // 未参与 → 选人数后报名
  const capacity = Number(summary.capacity || 0)
  const occupied = Number(summary.occupiedSeats || 0)
  const remaining = capacity ? Math.max(1, capacity - occupied) : 6
  const maxChoices = Math.min(remaining, 6) // uni.showActionSheet 微信上限 6 项
  const itemList: string[] = []
  for (let i = 0; i < maxChoices; i += 1) {
    const n = i + 1
    itemList.push(n === 1 ? '仅我 1 人' : `我 + ${n - 1} 人（共 ${n} 座）`)
  }

  try {
    const res: any = await new Promise((resolve, reject) => {
      uni.showActionSheet({
        itemList,
        success: (r) => resolve(r),
        fail: (e) => reject(e),
      })
    })
    const tapIndex = res?.tapIndex === undefined || res?.tapIndex === null ? -1 : res.tapIndex
    const seatCount = Number(tapIndex) + 1
    if (seatCount < 1) return
    await attendanceLock.run(widget, seatCount)
  } catch (_) {
    // 用户取消 ActionSheet，不提示
  }
}

async function openRoster(widget: any) {
  if (!post.value) return
  if (!userStore.isLoggedIn) {
    uni.showToast({ title: '请先登录后查看名单', icon: 'none' })
    uni.switchTab({ url: '/pages/profile/index' })
    return
  }
  try {
    const res = await postApi.listAttendanceMembers(post.value._id, widget.widgetId)
    rosterMembers.value = res.members || []
    rosterTitle.value = resolveAttendanceWidgetLabel(widget) || '参与名单'
    rosterWidgetId.value = widget.widgetId
    rosterMeta.total = Number(res.total || 0)
    rosterMeta.occupiedSeats = Number(res.occupiedSeats || 0)
    rosterMeta.capacity = res.capacity
    await resolveAttendanceAvatarUrls()
    showRoster.value = true
  } catch (error: any) {
    uni.showToast({ title: error?.message || '加载名单失败', icon: 'none' })
  }
}

async function handleCancelInSheet() {
  if (!post.value || !rosterWidgetId.value || cancelBusy.value) return
  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '取消参与',
      content: '确定要取消这次报名吗？',
      success: (res) => resolve(res.confirm),
      fail: () => resolve(false),
    })
  })
  if (!confirmed) return
  cancelBusy.value = true
  try {
    await postApi.leaveAttendance(post.value._id, rosterWidgetId.value)
    await loadPost(currentPostId.value)
    // 刷新 sheet 内容，保持打开状态
    const widget = attendanceWidgets.value.find((w: any) => w.widgetId === rosterWidgetId.value)
    if (widget) {
      const res = await postApi.listAttendanceMembers(post.value._id, widget.widgetId)
      rosterMembers.value = res.members || []
      rosterMeta.total = Number(res.total || 0)
      rosterMeta.occupiedSeats = Number(res.occupiedSeats || 0)
      rosterMeta.capacity = res.capacity
      await resolveAttendanceAvatarUrls()
    }
    uni.showToast({ title: '已取消参与', icon: 'success' })
  } catch (error: any) {
    uni.showToast({ title: error?.message || '取消失败', icon: 'none' })
  } finally {
    cancelBusy.value = false
  }
}

function closeRoster() {
  showRoster.value = false
  rosterWidgetId.value = ''
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<style lang="scss" scoped>
.detail-page {
  padding: $hh-space-lg var(--hh-page-x);
  background: var(--hh-color-card);
  min-height: 100vh;
}

.detail-page--guide {
  padding: 0;
}

.detail-page--image-note {
  padding: 0;
  background: var(--hh-color-card);
}

.detail-page--text-note {
  background: var(--hh-color-card);
}

.detail-page--guide :deep(.guide-route) {
  border-radius: 0;
}

.detail-page--guide .post-flag-row,
.detail-page--guide .origin-card,
.detail-page--guide .activity-invite-card,
.detail-page--guide .meta {
  margin-left: var(--hh-page-x);
  margin-right: var(--hh-page-x);
}

.detail-page--image-note .post-flag-row,
.detail-page--image-note .origin-card,
.detail-page--image-note .attendance-card,
.detail-page--image-note .activity-invite-card,
.detail-page--image-note .meta {
  margin-left: var(--hh-page-x);
  margin-right: var(--hh-page-x);
}

.origin-card {
  margin-bottom: $hh-space-md;
  padding: $hh-space-md;
  border-radius: var(--hh-radius-card);
  background: var(--hh-color-brand-soft);
  border: 1rpx solid var(--hh-color-brand-line);
}

.origin-label {
  display: block;
  color: var(--hh-color-brand-primary);
  font-size: var(--hh-text-caption-lg-size);
  margin-bottom: 6rpx;
}

.origin-title {
  display: block;
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-body-base-size);
  font-weight: $hh-font-weight-medium;
}

.origin-action {
  display: block;
  margin-top: 8rpx;
  color: var(--hh-color-brand-strong);
  font-size: var(--hh-text-caption-lg-size);
}

.activity-invite-card {
  margin-top: $hh-space-lg;
  padding: $hh-space-md;
  border-radius: var(--hh-radius-card);
  background: linear-gradient(135deg, rgba(232, 248, 240, 0.95), rgba(255, 255, 255, 0.92));
  border: 1rpx solid var(--hh-color-brand-line);
  display: flex;
  align-items: center;
  gap: $hh-space-md;
}

.activity-invite-main {
  min-width: 0;
  flex: 1;
}

.activity-invite-kicker {
  display: block;
  color: var(--hh-color-brand-primary);
  font-size: var(--hh-text-caption-lg-size);
  margin-bottom: 6rpx;
}

.activity-invite-title {
  display: block;
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-body-lg-size);
  font-weight: $hh-font-weight-medium;
  line-height: 1.4;
}

.activity-invite-desc {
  display: block;
  margin-top: 8rpx;
  color: var(--hh-color-text-tertiary);
  font-size: var(--hh-text-caption-lg-size);
  line-height: 1.55;
}

.activity-invite-btn {
  flex: 0 0 auto;
  margin: 0;
  border: none;
  border-radius: $hh-radius-full;
  background: var(--hh-color-brand-primary);
  color: #fff;
  font-size: var(--hh-text-caption-lg-size);
  line-height: 2.2;
  padding: 0 24rpx;
}

.loading {
  text-align: center;
  padding: $hh-space-xxl;
  color: var(--hh-color-text-tertiary);
}

.detail-state {
  min-height: 56vh;
  padding: $hh-space-xxl $hh-space-lg;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: $hh-space-md;
  text-align: center;
}

.detail-state-title {
  font-family: $hh-font-serif;
  font-size: 34rpx;
  font-weight: $hh-font-weight-bold;
  color: var(--hh-color-text-primary);
}

.detail-state-desc {
  max-width: 560rpx;
  font-size: 26rpx;
  color: var(--hh-color-text-tertiary);
  line-height: 1.6;
}

.detail-state-actions {
  display: flex;
  align-items: center;
  gap: $hh-space-sm;
}

.detail-state-btn {
  margin: 0;
  min-width: 132rpx;
  background: var(--hh-color-card);
  color: var(--hh-color-text-secondary);
  border: 1rpx solid var(--hh-color-line);
  border-radius: var(--hh-radius-card);
  font-size: 26rpx;
}

.detail-state-btn.primary {
  color: var(--hh-color-brand-strong);
  border-color: var(--hh-color-brand-line);
}

/* Classical Dossier · 参与条 */
.attendance-card {
  position: relative;
  margin-top: $hh-space-lg;
  padding: $hh-space-lg $hh-space-lg $hh-space-md;
  border: 1rpx solid var(--hh-color-line);
  border-radius: var(--hh-radius-card);
  background: var(--hh-color-card);
  box-shadow: var(--hh-shadow-soft);
}

.attendance-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: $hh-space-md;
}

.attendance-title {
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 0;
  font-family: $hh-font-serif;
  font-size: 34rpx;
  color: var(--hh-color-text-primary);
  letter-spacing: $hh-tracking-serif-sm;
}

.attendance-count {
  font-family: $hh-font-num;
  font-weight: $hh-font-weight-bold;
  color: var(--hh-color-text-primary);
}

.attendance-sep {
  color: $hh-ink-3;
  margin: 0 4rpx;
}

.attendance-label {
  font-weight: $hh-font-weight-bold;
  color: $hh-ink-1;
}

.attendance-tag {
  flex-shrink: 0;
  font-family: $hh-font-sans;
  font-size: 24rpx;
  font-weight: $hh-font-weight-medium;
  padding: 10rpx 18rpx;
  border-radius: $hh-radius-sm;
  letter-spacing: 0.04em;

  &.is-join {
    background: $hh-accent;
    color: #fff;
    border: 1rpx solid $hh-accent;
  }
  &.is-joined {
    background: $hh-surface-1;
    color: $hh-accent-ink;
    border: 1rpx solid $hh-accent-line;
  }
  &.is-full {
    background: $hh-surface-2;
    color: $hh-ink-3;
    border: 1rpx solid $hh-ink-line;
  }
}

/* 头像堆叠 */
.hh-avatar-stack {
  margin-top: $hh-space-md;
  display: flex;
  align-items: center;
  min-height: 68rpx;
  padding-left: 6rpx;
}

.hh-avatar-slot {
  position: relative;
  width: 64rpx;
  height: 64rpx;
  margin-left: -12rpx;
  border-radius: 50%;
  background: $hh-surface-2;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;

  &:first-child {
    margin-left: 0;
  }

  &.is-self {
    box-shadow: 0 0 0 3rpx $hh-accent, 0 0 0 5rpx $hh-surface-1;
    z-index: 2;
  }
}

.hh-avatar-img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2rpx solid $hh-surface-1;
  background: $hh-surface-2;
}

.hh-avatar-slot--empty {
  border: 2rpx dashed $hh-ink-line;
  background: transparent;
}

.hh-avatar-empty-mark {
  font-size: 28rpx;
  color: $hh-ink-3;
  line-height: 1;
}

.hh-avatar-empty-text {
  font-size: 24rpx;
  color: $hh-ink-3;
  padding-left: $hh-space-xs;
}

.hh-avatar-badge {
  position: absolute;
  top: -4rpx;
  right: -4rpx;
  min-width: 28rpx;
  height: 28rpx;
  padding: 0 6rpx;
  border-radius: 14rpx;
  background: $hh-accent;
  color: #fff;
  font-family: $hh-font-num;
  font-size: 20rpx;
  font-weight: $hh-font-weight-bold;
  line-height: 28rpx;
  text-align: center;
  border: 2rpx solid $hh-surface-1;
  box-sizing: content-box;
}

.attendance-hint {
  margin-bottom: $hh-space-lg;
  padding: $hh-space-md;
  border-radius: $hh-radius-md;
  background: #f4f8ff;
}

.attendance-hint-text {
  display: block;
  margin-top: $hh-space-xs;
  font-size: $hh-font-caption;
  color: $hh-color-text-mute;
}

.post-flag-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
  flex-wrap: wrap;
  margin-bottom: $hh-space-md;
}

.post-flag {
  font-family: $hh-font-mono;
  font-size: 20rpx;
  line-height: 1;
  padding: 7rpx 12rpx;
  border-radius: $hh-radius-full;
  border: 1rpx solid var(--hh-color-line);
  color: var(--hh-color-text-tertiary);
  background: var(--hh-color-card);
}

.post-flag.pin {
  color: #8a5a00;
  border-color: #ead3a2;
  background: #fff6dc;
}

.post-flag.feature {
  color: #9a3a2f;
  border-color: #e8b7af;
  background: #fff1ee;
}

.meta {
  margin-top: $hh-space-xl;
  padding-top: $hh-space-md;
  border-top: 1rpx solid var(--hh-color-line-soft);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: $hh-space-md;
}

.meta-main {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-wrap: wrap;
}

.meta-author {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.meta-author-avatar {
  width: 34rpx;
  height: 34rpx;
  border-radius: 999rpx;
  flex: 0 0 auto;
  background: var(--hh-color-brand-soft);
  border: 1rpx solid var(--hh-color-brand-line);
}

.meta-author-avatar--generated {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--hh-color-brand-soft);
  color: var(--hh-color-brand-strong);
  font-size: 18rpx;
  font-weight: $hh-font-weight-bold;
}

.meta-author-name {
  max-width: 180rpx;
  color: var(--hh-color-text-tertiary);
  font-size: var(--hh-text-caption-lg-size);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.time {
  font-size: var(--hh-text-caption-lg-size);
  color: var(--hh-color-text-tertiary);
  line-height: 1.4;
}

.actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: $hh-space-md;
}

.post-settings-trigger {
  font-size: $hh-font-caption;
  color: var(--hh-color-text-tertiary);
  line-height: 1.5;
  padding: 10rpx 0 10rpx 20rpx;
}

.cancel-btn {
  font-size: $hh-font-caption;
  color: $hh-color-text-mute;
  padding: $hh-space-xs $hh-space-md;
}

.save-btn {
  font-size: $hh-font-caption;
  color: $hh-color-success;
  padding: $hh-space-xs $hh-space-md;
}

.post-settings-mask {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: flex-end;
  background: rgba(0, 0, 0, 0.48);
}

.post-settings-sheet {
  width: 100%;
  padding: 30rpx 28rpx calc(48rpx + env(safe-area-inset-bottom));
  border-radius: 32rpx 32rpx 0 0;
  background: #fff;
  box-sizing: border-box;
}

.post-settings-header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 58rpx;
}

.post-settings-title {
  color: #222;
  font-size: 32rpx;
  font-weight: 600;
}

.post-settings-close {
  position: absolute;
  right: 4rpx;
  top: -8rpx;
  padding: 8rpx;
  color: #333;
  font-size: 48rpx;
  font-weight: 300;
  line-height: 1;
}

.post-settings-actions {
  display: flex;
  align-items: flex-start;
  gap: 42rpx;
  margin-top: 34rpx;
  padding: 0 8rpx;
}

.post-settings-action {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
  min-width: 112rpx;
}

.post-settings-action.disabled {
  opacity: 0.45;
  pointer-events: none;
}

.post-settings-icon {
  width: 104rpx;
  height: 104rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #f5f5f5;
}

.post-settings-icon-image {
  width: 52rpx;
  height: 52rpx;
}

.post-settings-label {
  color: #555;
  font-size: 24rpx;
  line-height: 1.4;
}

.roster-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.46);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 20;
}

.roster-panel {
  width: 100%;
  max-height: 70vh;
  background: var(--hh-color-card);
  border-radius: var(--hh-radius-panel) var(--hh-radius-panel) 0 0;
  padding: $hh-space-lg;
}

.roster-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: $hh-space-md;
}

.roster-title {
  display: block;
  font-size: $hh-font-body-lg;
  color: $hh-color-text;
  font-weight: $hh-font-weight-medium;
}

.roster-subtitle {
  display: block;
  margin-top: $hh-space-xs;
  font-size: $hh-font-caption;
  color: $hh-color-text-mute;
}

.roster-actions {
  display: flex;
  align-items: center;
  gap: $hh-space-md;
}

.roster-cancel {
  font-size: $hh-font-caption;
  color: $hh-color-danger;
  padding: $hh-space-xs $hh-space-sm;

  &.disabled {
    color: $hh-ink-3;
    pointer-events: none;
  }
}

.roster-close {
  font-size: $hh-font-caption;
  color: $hh-ink-3;
  padding: $hh-space-xs $hh-space-sm;
}

.roster-companion {
  font-size: $hh-font-caption;
  color: $hh-accent-ink;
  margin-left: 8rpx;
}

.roster-list {
  max-height: 56vh;
  margin-top: $hh-space-lg;
}

.roster-item {
  display: flex;
  align-items: center;
  gap: $hh-space-md;
  padding: $hh-space-sm 0;
}

.roster-avatar {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: #edf2f7;
}

.roster-info {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.roster-name {
  font-size: $hh-font-body;
  color: $hh-color-text;
}

.roster-time {
  font-size: $hh-font-caption;
  color: $hh-color-text-mute;
}

.roster-empty {
  padding: $hh-space-xl 0;
  text-align: center;
  color: $hh-color-text-mute;
  font-size: $hh-font-caption;
}
</style>
