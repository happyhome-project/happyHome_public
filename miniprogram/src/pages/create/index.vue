<template>
  <view class="create-page">
    <view v-if="!userStore.isLoggedIn" class="guard-state">
      <text class="guard-title">请先登录</text>
      <text class="guard-desc">登录后才能发布内容</text>
      <button class="btn-primary-plain" size="mini" @tap="goLogin">去登录</button>
    </view>

    <view v-else-if="!communityStore.currentCommunityId" class="guard-state">
      <text class="guard-title">还没有加入社区</text>
      <text class="guard-desc">加入社区后才能发布</text>
      <button class="btn-primary-plain" size="mini" @tap="goOnboarding">去加入</button>
    </view>

    <view v-else-if="!membershipReady && membershipChecking" class="guard-state">
      <text class="guard-desc">检查社区成员身份中...</text>
    </view>

    <view v-else-if="!isMember" class="guard-state">
      <text class="guard-title">你还不是“{{ communityStore.currentCommunity?.name }}”的成员</text>
      <text class="guard-desc">{{ memberStatus === 'pending' ? '你的加入申请正在审批中，请耐心等待' : '加入社区后才能发布' }}</text>
      <button
        v-if="memberStatus !== 'pending'"
        class="btn-primary-plain"
        size="mini"
        :disabled="joining"
        @tap="handleJoin"
      >
        {{ joining ? '加入中...' : '加入社区' }}
      </button>
    </view>

    <template v-else>
      <view v-if="!selectedSection" class="section-picker">
        <text class="title">选择板块</text>
        <view
          v-for="section in activeSections"
          :key="section._id"
          class="section-option"
          :data-testid="`create-section-${section._id}`"
          @tap="selectSection(section)"
        >
          <text class="section-name">{{ section.name }}</text>
          <text class="arrow">→</text>
        </view>
        <view v-if="activeSections.length === 0" class="empty-hint">
          <text class="guard-desc">该社区还没有可发布的板块</text>
        </view>
      </view>

      <view v-else class="form" :class="{ 'form--figma': isFigmaCreateMode, 'form--image-note': isImageNoteCreateMode }">
        <view v-if="!isFigmaCreateMode" class="form-header">
          <text class="section-tag" @tap="handleFormBack">← {{ selectedSection.name }}</text>
          <text v-if="isActivityInviteMode" class="invite-mode-tag">从攻略发起召集</text>
        </view>

        <template v-if="isTextNoteCreateMode">
          <view v-if="textNoteStep === 'compose'" class="text-note-compose">
            <view class="figma-guide-main-card text-note-editor-card">
              <WidgetEditor v-if="textNoteTitleWidget" :widget="textNoteTitleWidget" variant="figma" embedded hide-label guide-role="title" placeholder="添加标题" :allow-rich-note-images="false" v-model="formData[textNoteTitleWidget.widgetId]" />
              <WidgetEditor v-if="textNoteBodyWidget" :widget="textNoteBodyWidget" variant="figma" embedded hide-label guide-role="body" placeholder="添加正文内容" :allow-rich-note-images="false" v-model="formData[textNoteBodyWidget.widgetId]" />
              <WidgetEditor v-if="textNoteTopicWidget" :widget="textNoteTopicWidget" variant="image-note-tool" embedded hide-label :allow-rich-note-images="false" v-model="formData[textNoteTopicWidget.widgetId]" />
            </view>
            <view class="text-note-compose-actions">
              <button v-if="!isEditMode" class="draft-btn" @tap="saveDraft">存草稿</button>
              <button class="btn-primary" data-testid="text-note-next" @tap="openTextNoteCover">下一步</button>
            </view>
          </view>
          <view v-else class="text-note-cover-step">
            <view class="text-note-preview">
              <TextNoteCover :title="textNoteContent.title" :body="textNoteContent.body" :theme="textNoteTheme" />
            </view>
            <text class="text-note-theme-heading">选择封面风格</text>
            <scroll-view class="text-note-theme-scroll" scroll-x :show-scrollbar="false">
              <view class="text-note-theme-list">
                <view v-for="theme in TEXT_NOTE_THEMES" :key="theme" class="text-note-theme-option" :class="{ 'text-note-theme-option--active': textNoteTheme === theme }" @tap="textNoteTheme = theme">
                  <TextNoteCover :title="textNoteContent.title" :body="textNoteContent.body" :theme="theme" />
                </view>
              </view>
            </scroll-view>
            <view class="text-note-cover-actions">
              <button class="draft-btn" @tap="textNoteStep = 'compose'">返回修改</button>
              <button class="btn-primary" data-testid="create-submit" :disabled="submitting" @tap="handleSubmit">{{ submitting ? (isEditMode ? '保存中...' : '发布中...') : (isEditMode ? '保存' : '发布') }}</button>
            </view>
          </view>
        </template>

        <!-- 未配置控件的板块：提示并禁用发布，避免空帖 -->
        <view
          v-else-if="editableWidgets.length === 0 && attendanceWidgets.length === 0"
          class="empty-widgets-hint"
        >
          <text class="empty-widgets-title">{{ adminNoticeWidgets.length > 0 ? '该板块由管理员维护' : '该板块尚未配置内容模板' }}</text>
          <text class="empty-widgets-desc">
            {{ adminNoticeWidgets.length > 0 ? '这里展示的是固定公告内容，成员无需发布帖子。' : '请联系社区管理员在"控件"里添加需要填写的字段后再来发布。' }}
          </text>
        </view>

        <template v-else>
          <view class="figma-form-list">
            <template v-for="block in createFormBlocks" :key="block.key">
              <view v-if="block.type === 'activityMain'" class="figma-activity-main-card">
                <WidgetEditor
                  :widget="block.titleWidget"
                  variant="figma"
                  embedded
                  hide-label
                  guide-role="title"
                  placeholder="添加活动名称"
                  :allow-rich-note-images="allowImagesForWidget(block.titleWidget)"
                  v-model="formData[block.titleWidget.widgetId]"
                />
                <WidgetEditor
                  :widget="block.bodyWidget"
                  variant="figma"
                  embedded
                  hide-label
                  guide-role="body"
                  placeholder="添加活动详情"
                  :allow-rich-note-images="allowImagesForWidget(block.bodyWidget)"
                  v-model="formData[block.bodyWidget.widgetId]"
                />
              </view>

              <view v-else-if="block.type === 'imageNoteMain'" class="figma-image-note-main-card">
                <WidgetEditor
                  v-if="block.imageWidget"
                  :widget="block.imageWidget"
                  variant="figma"
                  embedded
                  hide-label
                  guide-role="cover"
                  :allow-rich-note-images="false"
                  v-model="formData[block.imageWidget.widgetId]"
                />
                <WidgetEditor
                  v-if="block.titleWidget"
                  :widget="block.titleWidget"
                  variant="figma"
                  embedded
                  hide-label
                  guide-role="title"
                  placeholder="添加主题"
                  :allow-rich-note-images="false"
                  v-model="formData[block.titleWidget.widgetId]"
                />
                <WidgetEditor
                  v-if="block.bodyWidget"
                  :widget="block.bodyWidget"
                  variant="figma"
                  embedded
                  hide-label
                  guide-role="body"
                  placeholder="添加正文"
                  :allow-rich-note-images="false"
                  v-model="formData[block.bodyWidget.widgetId]"
                />
              </view>

              <view v-else-if="block.type === 'imageNoteTools'" class="figma-image-note-tools">
                <WidgetEditor
                  v-if="block.topicWidget"
                  :widget="block.topicWidget"
                  variant="image-note-tool"
                  embedded
                  hide-label
                  :allow-rich-note-images="false"
                  v-model="formData[block.topicWidget.widgetId]"
                />
                <WidgetEditor
                  v-if="block.locationWidget"
                  :widget="block.locationWidget"
                  variant="image-note-tool"
                  embedded
                  hide-label
                  :allow-rich-note-images="false"
                  v-model="formData[block.locationWidget.widgetId]"
                />
              </view>

              <view v-else-if="block.type === 'guideMain'" class="figma-guide-main-card">
                <WidgetEditor
                  v-if="block.imageWidget"
                  :widget="block.imageWidget"
                  variant="figma"
                  embedded
                  hide-label
                  guide-role="cover"
                  :allow-rich-note-images="allowImagesForWidget(block.imageWidget)"
                  v-model="formData[block.imageWidget.widgetId]"
                />
                <WidgetEditor
                  v-if="block.titleWidget"
                  :widget="block.titleWidget"
                  variant="figma"
                  embedded
                  hide-label
                  guide-role="title"
                  placeholder="添加主题"
                  :allow-rich-note-images="allowImagesForWidget(block.titleWidget)"
                  v-model="formData[block.titleWidget.widgetId]"
                />
                <WidgetEditor
                  v-if="block.bodyWidget"
                  :widget="block.bodyWidget"
                  variant="figma"
                  embedded
                  hide-label
                  guide-role="body"
                  placeholder="添加正文内容"
                  :allow-rich-note-images="allowImagesForWidget(block.bodyWidget)"
                  v-model="formData[block.bodyWidget.widgetId]"
                />
              </view>

              <view v-else-if="block.type === 'routeStats'" class="figma-route-stats-card">
                <WidgetEditor
                  v-for="widget in block.widgets"
                  :key="widget.widgetId"
                  :widget="widget"
                  variant="figma"
                  embedded
                  :allow-rich-note-images="allowImagesForWidget(widget)"
                  v-model="formData[widget.widgetId]"
                />
              </view>

              <WidgetEditor
                v-else
                :widget="block.widget"
                variant="figma"
                :allow-rich-note-images="allowImagesForWidget(block.widget)"
                v-model="formData[block.widget.widgetId]"
              />
            </template>
          </view>

          <view v-for="widget in attendanceWidgets" :key="widget.widgetId" class="attendance-hint">
            <text v-if="resolveAttendanceWidgetLabel(widget)" class="attendance-label">{{ resolveAttendanceWidgetLabel(widget) }}</text>
            <text class="attendance-desc">发布后成员可点击参与，人数和头像会自动统计。</text>
          </view>

          <view class="submit-dock">
            <button v-if="!isEditMode" class="draft-btn" @tap="saveDraft">
              <image
                class="draft-icon"
                src="/static/publish-icons/save-draft.svg"
                mode="aspectFit"
              />
              <text>存草稿</text>
            </button>
            <button class="btn-primary" data-testid="create-submit" :disabled="submitting" @tap="handleSubmit">
              {{ submitting ? (isEditMode ? '保存中...' : '发布中...') : (isEditMode ? '保存' : (isActivityInviteMode ? '发布邀约' : '发布')) }}
            </button>
          </view>
        </template>
      </view>
    </template>
    <AppTabBar v-if="!selectedSection" current="create" />
  </view>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { useCommunityStore } from '../../store/community'
import { useUserStore } from '../../store/user'
import { memberApi, postApi, sectionApi } from '../../api/cloud'
import { uploadCloudFile } from '../../api/storage'
import AppTabBar from '../../components/AppTabBar.vue'
import WidgetEditor from '../../components/widgets/WidgetEditor.vue'
import TextNoteCover from '../../components/TextNoteCover.vue'
import {
  CREATE_SECTION_INTENT_KEY,
  CREATE_SECTION_INTENT_TTL_MS,
  hideNativeTabBar,
} from '../../utils/app-tabbar'
import { resolveAttendanceWidgetLabel } from '../../utils/widget-form'
import { resolveActivityAnnouncementMain } from '../../utils/create-form-layout'
import { buildImageNoteCreateBlocks } from '../../utils/image-note-create'
import { isImageNoteSectionContract } from '../../utils/image-note'
import { isRichNoteEmpty, uploadRichNoteImages } from '../../utils/rich-note'
import { openOnboardingPreservingStack } from '../../utils/onboarding-nav'
import { ensureHierarchyStack, normalizeRouteUrl, openHierarchyParent } from '../../utils/hierarchy-nav'
import { extractTextNoteContent, TEXT_NOTE_THEMES, type TextNoteTheme } from '../../utils/text-note'

const communityStore = useCommunityStore()
const userStore = useUserStore()
const selectedSection = ref<any>(null)
const formData = reactive<Record<string, any>>({})
const editPostId = ref('')
const editPostSnapshot = ref<any>(null)
const submitting = ref(false)
const membershipChecking = ref(false)
const membershipReady = ref(false)
const isMember = ref(false)
const memberStatus = ref<string | null>(null)
const joining = ref(false)
let checkSeq = 0
const HOME_REFRESH_AFTER_POST_KEY = 'home_refresh_after_post'
const CREATE_DRAFT_KEY = 'create_draft_v1'
const ACTIVITY_INVITE_CREATE_INTENT_KEY = 'activity_invite_create_intent_v1'
const ACTIVITY_INVITE_INTENT_TTL_MS = 30 * 60 * 1000
const ACTIVITY_INVITE_WIDGET_IDS = {
  title: 'activity_invite_title',
  location: 'activity_invite_location',
  note: 'activity_invite_note',
} as const
const GUIDE_CREATE_NAME_HINTS = ['亲子出游', '周末遛娃', '村游攻略', '路线攻略', '出游攻略']
const CREATE_SECTION_EVENT = 'happyhome:create-section-intent'
const isActivityInviteMode = ref(false)
const activityInviteSourcePostId = ref('')
const activityInviteLoading = ref(false)
const createReturnTo = ref('')
const textNoteStep = ref<'compose' | 'cover'>('compose')
const textNoteTheme = ref<TextNoteTheme>('paper')
const archiveFormat = ref<'image_text' | 'text' | ''>('')
const collaborationOnly = ref(false)
const isEditMode = computed(() => !!editPostId.value)

// 只允许在 active 板块发帖。dormant / archived 板块既无法发帖也无处展示（首页已过滤）。
const activeSections = computed(() =>
  (communityStore.currentSections ?? []).filter((section: any) =>
    (section?.status ?? 'active') === 'active' && (!collaborationOnly.value || section?.type === 'realtime')
  )
)

const editableWidgets = computed(() =>
  (selectedSection.value?.widgets || []).filter((widget: any) => !['attendance', 'admin_notice', 'activity_invite'].includes(widget.type))
)

const attendanceWidgets = computed(() =>
  (selectedSection.value?.widgets || []).filter((widget: any) => widget.type === 'attendance')
)

const adminNoticeWidgets = computed(() =>
  (selectedSection.value?.widgets || []).filter((widget: any) => widget.type === 'admin_notice')
)

const isFigmaCreateMode = computed(() => !!selectedSection.value)
const isTextNoteCreateMode = computed(() => {
  const section = selectedSection.value
  return !!section && section.displayTemplate === 'text_note'
})
const textNoteTitleWidget = computed(() =>
  editableWidgets.value.find((widget: any) => String(widget?.widgetId || '') === 'text_title') || null
)
const textNoteBodyWidget = computed(() =>
  editableWidgets.value.find((widget: any) => String(widget?.widgetId || '') === 'text_body') || null
)
const textNoteTopicWidget = computed(() =>
  editableWidgets.value.find((widget: any) => String(widget?.fieldKey || '') === 'topics') || null
)
const textNoteContent = computed(() => extractTextNoteContent(formData))
const isGuideCreateMode = computed(() => {
  const section = selectedSection.value
  if (!section) return false
  if (section.displayTemplate === 'guide_note') return true
  const name = String(section.name || '').replace(/\s/g, '')
  return GUIDE_CREATE_NAME_HINTS.some((hint) => name.includes(hint))
})
const isImageNoteCreateMode = computed(() => isImageNoteSectionContract(selectedSection.value))

function allowImagesForWidget(widget: any) {
  if (isTextNoteCreateMode.value) return false
  if (isGuideCreateMode.value) return false
  if (isGuideCreateMode.value || isImageNoteCreateMode.value) return false
  if (isActivityInviteMode.value && String(widget?.widgetId || '') === ACTIVITY_INVITE_WIDGET_IDS.note) return false
  return true
}

const createFormBlocks = computed(() => {
  const blocks: any[] = []
  const widgets = editableWidgets.value
  if (isImageNoteCreateMode.value) {
    return buildImageNoteCreateBlocks(selectedSection.value, widgets)
  }
  const activityMain = selectedSection.value
    ? resolveActivityAnnouncementMain(selectedSection.value, widgets)
    : null
  if (activityMain) {
    blocks.push({
      type: 'activityMain',
      key: 'activity-main',
      titleWidget: activityMain.titleWidget,
      bodyWidget: activityMain.bodyWidget,
    })
    for (const widget of activityMain.remainingWidgets) {
      blocks.push({ type: 'widget', key: String(widget.widgetId), widget })
    }
    return blocks
  }

  const guideMain = getGuideMainWidgets(widgets)
  if (isGuideCreateMode.value && guideMain && (guideMain.imageWidget || guideMain.titleWidget || guideMain.bodyWidget)) {
    const usedWidgetIds = new Set<string>()
    ;[guideMain.imageWidget, guideMain.titleWidget, guideMain.bodyWidget].forEach((widget) => {
      if (widget?.widgetId) usedWidgetIds.add(String(widget.widgetId))
    })
    blocks.push(Object.assign({ type: 'guideMain', key: 'guide-main' }, guideMain))

    const locationWidgets = widgets.filter((widget: any) => isGuideLocationWidget(widget))
    const trackWidgets = widgets.filter((widget: any) => isGuideTrackWidget(widget))
    const routeStats = widgets.filter((widget: any) => isGuideRouteStatWidget(widget))

    for (const widget of locationWidgets) {
      if (usedWidgetIds.has(String(widget.widgetId))) continue
      usedWidgetIds.add(String(widget.widgetId))
      blocks.push({ type: 'widget', key: String(widget.widgetId), widget })
    }
    for (const widget of trackWidgets) {
      if (usedWidgetIds.has(String(widget.widgetId))) continue
      usedWidgetIds.add(String(widget.widgetId))
      blocks.push({ type: 'widget', key: String(widget.widgetId), widget })
    }
    const statWidgets = routeStats.filter((widget: any) => {
      if (usedWidgetIds.has(String(widget.widgetId))) return false
      usedWidgetIds.add(String(widget.widgetId))
      return true
    })
    if (statWidgets.length > 0) {
      blocks.push({ type: 'routeStats', key: `route-${statWidgets.map((item: any) => item.widgetId).join('-')}`, widgets: statWidgets })
    }
    for (const widget of widgets) {
      if (usedWidgetIds.has(String(widget.widgetId))) continue
      blocks.push({ type: 'widget', key: String(widget.widgetId), widget })
    }
    return blocks
  }

  const routeStats: any[] = []
  for (const widget of widgets) {
    if (guideMain && isGuideMainWidget(widget, guideMain)) continue
    if (isGuideRouteStatWidget(widget)) {
      routeStats.push(widget)
      continue
    }
    if (routeStats.length > 0) {
      blocks.push({ type: 'routeStats', key: `route-${routeStats.map((item) => item.widgetId).join('-')}`, widgets: routeStats.splice(0) })
    }
    blocks.push({ type: 'widget', key: String(widget.widgetId), widget })
  }
  if (routeStats.length > 0) {
    blocks.push({ type: 'routeStats', key: `route-${routeStats.map((item) => item.widgetId).join('-')}`, widgets: routeStats.splice(0) })
  }
  return blocks
})

onLoad(async (options: any) => {
  if (ensureHierarchyStack('/pages/create/index', options || {}, options?.returnTo)) return
  hideNativeTabBar()
  if (await loadPostForEdit(String(options?.editPostId || ''))) return
  collaborationOnly.value = String(options?.mode || '') === 'collaboration'
  const requestedArchiveFormat = String(options?.archiveFormat || '')
  if (requestedArchiveFormat === 'image_text' || requestedArchiveFormat === 'text') {
    // Resolve the product-level publishing route before the first await. Otherwise
    // membership refresh can commit the legacy section picker for one frame.
    enterArchiveEditor(requestedArchiveFormat, options?.returnTo)
  }
  await ensureSectionsLoaded()
  await checkMembership({ silent: false })
  if (requestedArchiveFormat === 'image_text' || requestedArchiveFormat === 'text') {
    return
  }
  await consumeCreateSectionIntent(options)
  await consumeActivityInviteIntent(options)
})

function buildArchiveEditorSection(format: 'image_text' | 'text') {
  const common = { _id: `archive-${format}`, communityId: communityStore.currentCommunityId, name: format === 'text' ? '写文字' : '发图文', type: 'evergreen', status: 'active' }
  if (format === 'text') return Object.assign({}, common, {
    displayTemplate: 'text_note',
    widgets: [
      { widgetId: 'text_title', fieldKey: 'title', type: 'short_text', label: '标题', required: true, order: 0, showInList: true },
      { widgetId: 'text_body', fieldKey: 'body', type: 'rich_note', label: '正文', required: true, order: 1, showInList: false },
      { widgetId: 'archive_text_topics', fieldKey: 'topics', type: 'topic', label: '添加话题', required: false, order: 2, showInList: false },
    ],
  })
  return Object.assign({}, common, {
    displayTemplate: 'image_note',
    widgets: [
      { widgetId: 'image_note_images', fieldKey: 'images', type: 'image_group', label: '图片', required: true, order: 0, showInList: false },
      { widgetId: 'image_note_title', fieldKey: 'title', type: 'short_text', label: '标题', required: true, order: 1, showInList: true },
      { widgetId: 'image_note_body', fieldKey: 'body', type: 'rich_note', label: '正文', required: false, order: 2, showInList: false },
      { widgetId: 'image_note_topics', fieldKey: 'topics', type: 'topic', label: '添加话题', required: false, order: 3, showInList: false },
      { widgetId: 'image_note_location', fieldKey: 'location', type: 'location', label: '添加地点', required: false, order: 4, showInList: false },
    ],
  })
}

function enterArchiveEditor(format: 'image_text' | 'text', returnTo?: string) {
  archiveFormat.value = format
  collaborationOnly.value = false
  selectSection(buildArchiveEditorSection(format), { returnTo: String(returnTo || '') })
}

async function loadPostForEdit(postId: string) {
  if (!postId) return false
  editPostId.value = postId
  createReturnTo.value = `/pages/detail/index?postId=${encodeURIComponent(postId)}`
  try {
    const response = await postApi.get(editPostId.value)
    const currentPost = response?.post
    if (!currentPost || String(currentPost.authorId || '') !== String(userStore.openId || '')) {
      throw new Error('只能编辑自己发布的内容')
    }
    editPostSnapshot.value = currentPost
    const communityId = String(currentPost.communityId || '')
    if (communityId && communityId !== String(communityStore.currentCommunityId || '')) {
      await communityStore.switchCommunity(communityId)
    }
    await ensureSectionsLoaded()
    await checkMembership({ silent: false, forceRefresh: true })

    if (currentPost.area === 'archive') {
      const format = currentPost.format === 'text' ? 'text' : 'image_text'
      archiveFormat.value = format
      const archiveSection = buildArchiveEditorSection(format)
      selectSection(archiveSection, { returnTo: createReturnTo.value })
      const archiveValues: Record<string, any> = {}
      for (const widget of archiveSection.widgets || []) {
        const fieldKey = String(widget.fieldKey || widget.widgetId)
        archiveValues[widget.widgetId] = fieldKey === 'topics'
          ? (Array.isArray(currentPost.topics) ? currentPost.topics : [])
          : currentPost.content?.[fieldKey]
      }
      Object.assign(formData, archiveValues)
      if (format === 'text') {
        textNoteTheme.value = currentPost.presentation?.textNoteTheme || 'paper'
      }
    } else {
      let editSection = communityStore.currentSections.find((item: any) => item._id === currentPost.sectionId)
      if (!editSection && currentPost.sectionId) {
        const sectionResponse = await sectionApi.get(currentPost.sectionId)
        editSection = sectionResponse?.section
      }
      if (!editSection) throw new Error('原板块已不可用，暂时无法编辑')
      selectSection(editSection, { returnTo: createReturnTo.value })
      Object.assign(formData, JSON.parse(JSON.stringify(currentPost.content || {})))
      if (editSection.displayTemplate === 'text_note') {
        textNoteTheme.value = currentPost.presentation?.textNoteTheme || 'paper'
      }
    }
    uni.setNavigationBarTitle({ title: '编辑内容' })
    return true
  } catch (error: any) {
    editPostId.value = ''
    editPostSnapshot.value = null
    uni.showModal({
      title: '无法编辑',
      content: error?.message || '内容加载失败，请稍后重试',
      showCancel: false,
      success: () => openHierarchyParent(createReturnTo.value),
    })
    return true
  }
}

onShow(() => {
  hideNativeTabBar()
  if (editPostId.value) return
  // 返回页面（例如地图选择返回）时静默刷新，不再打断表单操作。
  void ensureSectionsLoaded()
  void checkMembership({ silent: true })
  if (!archiveFormat.value) {
    void consumeCreateSectionIntent()
    void consumeActivityInviteIntent()
  }
})

watch(() => communityStore.currentCommunityId, async () => {
  if (editPostId.value) return
  if (archiveFormat.value) enterArchiveEditor(archiveFormat.value, createReturnTo.value)
  else selectedSection.value = null
  membershipReady.value = false
  await ensureSectionsLoaded()
  await checkMembership({ silent: false, forceRefresh: true })
  if (!archiveFormat.value) await consumeCreateSectionIntent()
})

watch([selectedSection, textNoteStep], (values) => {
  const section = values[0]
  const step = values[1]
  const title = section?.displayTemplate === 'text_note' && step === 'cover'
    ? '选择文字封面'
    : section?.name || '发布'
  uni.setNavigationBarTitle({ title })
}, { immediate: true })

try {
  ;(uni as any).$on?.(CREATE_SECTION_EVENT, handleCreateSectionIntentEvent)
} catch (_error) {}

onBeforeUnmount(() => {
  try {
    ;(uni as any).$off?.(CREATE_SECTION_EVENT, handleCreateSectionIntentEvent)
  } catch (_error) {}
})

async function checkMembership(options: { silent: boolean; forceRefresh?: boolean }) {
  const { silent, forceRefresh = false } = options
  const communityId = String(communityStore.currentCommunityId || '')
  const seq = ++checkSeq

  if (!communityId || !userStore.isLoggedIn) {
    isMember.value = false
    memberStatus.value = null
    membershipReady.value = true
    return
  }

  const cached = communityStore.getMembershipStatus(communityId)
  if (cached && !forceRefresh) {
    isMember.value = cached.isMember
    memberStatus.value = cached.status
    membershipReady.value = true
    if (silent) return
  }

  if (!silent && !membershipReady.value) {
    membershipChecking.value = true
  }

  try {
    await communityStore.refreshMembershipStatus(communityId)
    const latest = communityStore.getMembershipStatus(communityId)
    if (seq !== checkSeq) return
    isMember.value = !!latest?.isMember
    memberStatus.value = latest?.status ?? null
  } catch {
    if (seq !== checkSeq) return
    // 兜底到直接请求，避免 store 未更新时页面卡住。
    try {
      const res = await memberApi.myStatus(communityId)
      isMember.value = !!res.isMember
      memberStatus.value = res.status
    } catch {
      isMember.value = false
      memberStatus.value = null
    }
  } finally {
    if (seq !== checkSeq) return
    membershipReady.value = true
    membershipChecking.value = false
  }
}

async function handleJoin() {
  joining.value = true
  try {
    const res = await memberApi.apply(communityStore.currentCommunityId)
    if ((res as any).status === 'active') {
      isMember.value = true
      memberStatus.value = 'active'
      uni.showToast({ title: '加入成功', icon: 'success' })
    } else {
      memberStatus.value = 'pending'
      uni.showToast({ title: '申请已提交，等待审批', icon: 'none' })
    }
    await checkMembership({ silent: true, forceRefresh: true })
  } catch (error: any) {
    uni.showModal({ title: '加入失败', content: error?.message ?? '请重试' })
  } finally {
    joining.value = false
  }
}

function goLogin() {
  uni.switchTab({ url: '/pages/profile/index' })
}

function goOnboarding() {
  openOnboardingPreservingStack({ mode: 'discover' })
}

function selectSection(section: any, options: { returnTo?: string } = {}) {
  if (isActivityInviteMode.value) return
  selectedSection.value = section
  createReturnTo.value = normalizeRouteUrl(options.returnTo)
  Object.keys(formData).forEach((key) => delete formData[key])
  textNoteStep.value = 'compose'
  textNoteTheme.value = 'paper'
  for (const widget of section?.widgets || []) {
    if (widget?.type === 'topic' && widget?.widgetId) {
      formData[String(widget.widgetId)] = []
    }
  }
}

function handleFormBack() {
  if (isEditMode.value) {
    openHierarchyParent(createReturnTo.value)
    return
  }
  if (isTextNoteCreateMode.value && textNoteStep.value === 'cover') {
    textNoteStep.value = 'compose'
    return
  }
  handleBackToSectionPicker()
}

function openTextNoteCover() {
  if (!textNoteContent.value.title) {
    uni.showToast({ title: '请填写标题', icon: 'none' })
    return
  }
  if (!textNoteContent.value.body) {
    uni.showToast({ title: '请填写正文', icon: 'none' })
    return
  }
  textNoteStep.value = 'cover'
}

function handleBackToSectionPicker() {
  const returnTo = createReturnTo.value
  if (returnTo) {
    if (isActivityInviteMode.value) {
      clearActivityInviteMode()
    } else {
      selectedSection.value = null
      createReturnTo.value = ''
      Object.keys(formData).forEach((key) => delete formData[key])
    }
    openHierarchyParent(returnTo)
    return
  }
  if (isActivityInviteMode.value) {
    clearActivityInviteMode()
    return
  }
  selectedSection.value = null
  Object.keys(formData).forEach((key) => delete formData[key])
}

function clearActivityInviteMode() {
  isActivityInviteMode.value = false
  activityInviteSourcePostId.value = ''
  createReturnTo.value = ''
  selectedSection.value = null
  Object.keys(formData).forEach((key) => delete formData[key])
  try {
    uni.removeStorageSync(ACTIVITY_INVITE_CREATE_INTENT_KEY)
  } catch {}
}

function isGuideRouteStatWidget(widget: any) {
  if (!isGuideCreateMode.value) return false
  const label = String(widget?.label || '').replace(/\s/g, '')
  const fieldKey = String(widget?.fieldKey || '').toLowerCase()
  return [
    '距离',
    '最高海拔',
    '累计爬升',
    '参考用时',
    '驾车到达用时',
  ].includes(label) || [
    'distance',
    'routedistance',
    'totaldistance',
    'mileage',
    'highestaltitude',
    'altitude',
    'maxaltitude',
    'totalclimb',
    'climb',
    'ascent',
    'referenceduration',
    'duration',
    'timecost',
    'driveduration',
    'drivetime',
    'drivingtime',
    'arrivalduration',
    'arrivaltime',
  ].includes(fieldKey)
}

function isGuideLocationWidget(widget: any) {
  if (!isGuideCreateMode.value) return false
  return String(widget?.type || '') === 'location'
}

function isGuideTrackWidget(widget: any) {
  if (!isGuideCreateMode.value) return false
  const label = String(widget?.label || '').replace(/\s/g, '')
  const fieldKey = String(widget?.fieldKey || '').toLowerCase()
  return label.includes('两步路') || label.includes('轨迹') || fieldKey.includes('track')
}

function getGuideMainWidgets(widgets: any[]) {
  if (!isGuideCreateMode.value) return null
  const sorted = widgets.slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
  const imageWidget = sorted.find((widget) => widget.type === 'image_group') || null
  const titleWidget = sorted.find((widget) => {
    if (!['short_text', 'summary'].includes(widget.type)) return false
    const label = String(widget.label || '').replace(/\s/g, '')
    const fieldKey = String(widget.fieldKey || '').toLowerCase()
    return fieldKey === 'title' || fieldKey.includes('title') || ['标题', '名称', '名字'].some((item) => label.includes(item))
  }) || null
  const bodyWidget = sorted.find((widget) => ['rich_text', 'rich_note', 'summary'].includes(widget.type) && widget.widgetId !== titleWidget?.widgetId) || null
  return { imageWidget, titleWidget, bodyWidget }
}

function isGuideMainWidget(widget: any, guideMain: any) {
  return [guideMain.imageWidget, guideMain.titleWidget, guideMain.bodyWidget]
    .some((item) => item?.widgetId && item.widgetId === widget.widgetId)
}

async function ensureSectionsLoaded() {
  const communityId = String(communityStore.currentCommunityId || '')
  if (!communityId || communityStore.currentSections.length > 0) return
  try {
    await communityStore.switchCommunity(communityId)
  } catch (_error) {}
}

function handleCreateSectionIntentEvent(payload?: { sectionId?: string; returnTo?: string }) {
  void consumeCreateSectionIntent(payload)
}

function readCreateSectionIntent(options?: any) {
  const querySectionId = String(options?.sectionId || '').trim()
  const queryReturnTo = String(options?.returnTo || '').trim()
  if (querySectionId) return { sectionId: querySectionId, returnTo: queryReturnTo, removeStored: false }

  try {
    const saved = uni.getStorageSync(CREATE_SECTION_INTENT_KEY)
    const sectionId = String(saved?.sectionId || '').trim()
    const returnTo = String(saved?.returnTo || '').trim()
    const createdAt = Number(saved?.createdAt || 0)
    if (sectionId && createdAt && Date.now() - createdAt <= CREATE_SECTION_INTENT_TTL_MS) {
      return { sectionId, returnTo, removeStored: true }
    }
    if (sectionId || createdAt) uni.removeStorageSync(CREATE_SECTION_INTENT_KEY)
  } catch (_error) {}

  return null
}

async function consumeCreateSectionIntent(options?: any) {
  const intent = readCreateSectionIntent(options)
  if (!intent || isActivityInviteMode.value) return
  await ensureSectionsLoaded()
  const target = activeSections.value.find((section: any) => String(section?._id || '') === intent.sectionId)
  if (!target) return
  selectSection(target, { returnTo: intent.returnTo })
  if (intent.removeStored) {
    try {
      uni.removeStorageSync(CREATE_SECTION_INTENT_KEY)
    } catch (_error) {}
  }
}

function readActivityInviteIntent(options?: any) {
  const queryMode = String(options?.mode || '')
  const querySourcePostId = String(options?.sourcePostId || '').trim()
  const queryReturnTo = String(options?.returnTo || '').trim()
  if (queryMode === 'activityInvite' && querySourcePostId) {
    return { sourcePostId: querySourcePostId, returnTo: queryReturnTo }
  }
  try {
    const saved = uni.getStorageSync(ACTIVITY_INVITE_CREATE_INTENT_KEY)
    const sourcePostId = String(saved?.sourcePostId || '').trim()
    const returnTo = String(saved?.returnTo || '').trim()
    const createdAt = Number(saved?.createdAt || 0)
    if (sourcePostId && Date.now() - createdAt <= ACTIVITY_INVITE_INTENT_TTL_MS) {
      return { sourcePostId, returnTo }
    }
    if (sourcePostId) uni.removeStorageSync(ACTIVITY_INVITE_CREATE_INTENT_KEY)
  } catch {}
  return null
}

async function consumeActivityInviteIntent(options?: any) {
  const intent = readActivityInviteIntent(options)
  if (!intent || activityInviteLoading.value || activityInviteSourcePostId.value === intent.sourcePostId) return
  activityInviteLoading.value = true
  try {
    const state = await postApi.getActivityInviteState(intent.sourcePostId, !userStore.isLoggedIn)
    if (state?.invite?.postId) {
      uni.showToast({ title: '已有邀约，去参与', icon: 'none' })
      try {
        uni.removeStorageSync(ACTIVITY_INVITE_CREATE_INTENT_KEY)
      } catch {}
      uni.navigateTo({ url: `/pages/detail/index?postId=${encodeURIComponent(state.invite.postId)}` })
      return
    }
    const targetSection = state?.targetSection
    if (!targetSection?.widgets?.length) {
      throw new Error('邀约板块未准备好，请稍后重试')
    }
    isActivityInviteMode.value = true
    activityInviteSourcePostId.value = intent.sourcePostId
    createReturnTo.value = normalizeRouteUrl(intent.returnTo)
    selectedSection.value = Object.assign({}, targetSection, {
      _id: targetSection._id || targetSection.sectionId || 'activity_invite_virtual',
      name: targetSection.name || '出游邀约',
      type: 'realtime',
    })
    Object.keys(formData).forEach((key) => delete formData[key])
    if (state.prefill?.title) {
      formData[ACTIVITY_INVITE_WIDGET_IDS.title] = `${state.prefill.title}邀约`
    }
    if (state.prefill?.location) {
      formData[ACTIVITY_INVITE_WIDGET_IDS.location] = state.prefill.location
    }
  } catch (error: any) {
    uni.showModal({ title: '发起召集失败', content: error?.message || '请稍后重试' })
    clearActivityInviteMode()
  } finally {
    activityInviteLoading.value = false
  }
}

async function uploadImages(tempPaths: string[]): Promise<string[]> {
  return Promise.all(tempPaths.map(async (path) => {
    if (path.startsWith('cloud://')) return Promise.resolve(path)
    const ext = path.startsWith('blob:') ? 'jpg' : (path.split('.').pop()?.split('?')[0] || 'jpg')
    const cloudPath = `posts/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
    const result = await uploadCloudFile({ cloudPath, source: path })
    // #ifdef H5
    if ((import.meta as any).env?.DEV) {
      const key = 'hh-h5-smoke-uploaded-file-ids'
      const current = JSON.parse(sessionStorage.getItem(key) || '[]')
      sessionStorage.setItem(key, JSON.stringify([...current, result.fileID]))
    }
    // #endif
    return result.fileID
  }))
}

async function uploadNoteBlockImages(blocks: any[]): Promise<any[]> {
  return Promise.all((blocks || []).map(async (block) => {
    if (!block || block.type !== 'image') return block
    const uploaded = await uploadImages([String(block.fileID || '')])
    return Object.assign({}, block, { fileID: uploaded[0] })
  }))
}

function showModalAsync(options: { title: string; content: string }) {
  return new Promise<void>((resolve) => {
    uni.showModal({
      title: options.title,
      content: options.content,
      showCancel: false,
      success: () => resolve(),
      fail: () => resolve(),
    })
  })
}

async function handleAuditSubmitResult(result: any) {
  const auditStatus = String(result?.auditStatus || 'pass')
  const auditReason = String(result?.auditReason || '')
  if (auditStatus === 'rejected') {
    await showModalAsync({
      title: '发布未通过',
      content: auditReason || '内容未通过审核，请修改后再提交。',
    })
    return
  }

  if (auditStatus === 'pending' || auditStatus === 'review') {
    await showModalAsync({
      title: '已提交审核',
      content: auditStatus === 'review'
        ? '内容需要人工复核，通过后会展示在社区里。'
        : '内容正在审核，通过后会展示在社区里。',
    })
  } else {
    try {
      uni.setStorageSync(HOME_REFRESH_AFTER_POST_KEY, {
        communityId: communityStore.currentCommunityId,
        sectionId: selectedSection.value?._id || '',
        postId: result?.postId || '',
        createdAt: Date.now(),
      })
    } catch {}
    uni.showToast({ title: '发布成功', icon: 'success' })
    clearDraft()
  }

  selectedSection.value = null
  createReturnTo.value = ''
  uni.switchTab({ url: '/pages/index/index' })
}

async function handleEditSubmitResult(result: any) {
  const auditStatus = String(result?.auditStatus || 'pass')
  const auditReason = String(result?.auditReason || '')
  if (auditStatus === 'rejected') {
    await showModalAsync({
      title: '修改未通过',
      content: auditReason || '内容未通过审核，请修改后再保存。',
    })
    return
  }
  if (auditStatus === 'pending' || auditStatus === 'review') {
    await showModalAsync({
      title: '修改已提交审核',
      content: auditStatus === 'review'
        ? '修改内容需要人工复核，通过后会更新。'
        : '修改内容正在审核，通过后会更新。',
    })
  } else {
    uni.showToast({ title: '保存成功', icon: 'success' })
  }
  const returnTo = createReturnTo.value || `/pages/detail/index?postId=${encodeURIComponent(editPostId.value)}`
  setTimeout(() => openHierarchyParent(returnTo), 350)
}

function saveDraft() {
  if (!selectedSection.value) return
  try {
    uni.setStorageSync(CREATE_DRAFT_KEY, {
      communityId: communityStore.currentCommunityId,
      sectionId: selectedSection.value._id,
      sectionName: selectedSection.value.name,
      content: JSON.parse(JSON.stringify(formData)),
      presentation: isTextNoteCreateMode.value ? { textNoteTheme: textNoteTheme.value } : undefined,
      savedAt: Date.now(),
    })
    uni.showToast({ title: '已保存草稿', icon: 'success' })
  } catch (_error) {
    uni.showToast({ title: '保存失败', icon: 'none' })
  }
}

function clearDraft() {
  try {
    uni.removeStorageSync(CREATE_DRAFT_KEY)
  } catch (_error) {}
}

async function handleSubmit() {
  if (!selectedSection.value || submitting.value) return
  submitting.value = true
  try {
    const sectionId = selectedSection.value._id
    const content = Object.assign({}, formData)
    for (const widget of editableWidgets.value) {
      const value = content[widget.widgetId]
      const isEmpty =
        value === undefined ||
        value === null ||
        value === '' ||
        (Array.isArray(value) && value.length === 0) ||
        (widget.type === 'rich_note' && isRichNoteEmpty(value))
      if (widget.required && isEmpty) {
        uni.showToast({ title: `请填写${widget.label}`, icon: 'none' })
        return
      }
      // 媒体组由 admin 后台维护，普通用户发帖不携带该字段
      if (widget.type === 'video_group' || widget.type === 'audio_group') {
        delete content[widget.widgetId]
        continue
      }
      if (widget.type === 'image_group' && Array.isArray(content[widget.widgetId])) {
        content[widget.widgetId] = await uploadImages(content[widget.widgetId])
      }
      if (widget.type === 'note_blocks' && Array.isArray(content[widget.widgetId])) {
        content[widget.widgetId] = await uploadNoteBlockImages(content[widget.widgetId])
      }
      if (widget.type === 'rich_note') {
        content[widget.widgetId] = await uploadRichNoteImages(content[widget.widgetId], async (path) => {
          const uploaded = await uploadImages([path])
          return uploaded[0]
        })
      }
    }

    let archiveContent: Record<string, any> | null = null
    if (archiveFormat.value) {
      archiveContent = {}
      for (const widget of editableWidgets.value) {
        if (String(widget.fieldKey || '') === 'topics') continue
        archiveContent[String(widget.fieldKey || widget.widgetId)] = content[widget.widgetId]
      }
    }
    const archiveTopics = archiveFormat.value
      ? editableWidgets.value
          .filter((widget: any) => String(widget.fieldKey || '') === 'topics')
          .flatMap((widget: any) => Array.isArray(content[widget.widgetId]) ? content[widget.widgetId] : [])
      : []
    const updateOptions = archiveFormat.value
      ? {
          topics: archiveTopics,
          presentation: archiveFormat.value === 'text' ? { textNoteTheme: textNoteTheme.value } : undefined,
        }
      : {
          presentation: isTextNoteCreateMode.value ? { textNoteTheme: textNoteTheme.value } : undefined,
        }
    const result: any = isEditMode.value
      ? await postApi.update(editPostId.value, archiveContent || content, updateOptions)
      : isActivityInviteMode.value
      ? await postApi.createActivityInvite(activityInviteSourcePostId.value, content)
      : archiveFormat.value
        ? await postApi.createArchive({
            communityId: communityStore.currentCommunityId,
            area: 'archive',
            format: archiveFormat.value,
            topics: archiveTopics,
            content: archiveContent || {},
            presentation: archiveFormat.value === 'text' ? { textNoteTheme: textNoteTheme.value } : undefined,
          })
      : await postApi.create({
          communityId: communityStore.currentCommunityId,
          sectionId,
          content,
          presentation: isTextNoteCreateMode.value
            ? { textNoteTheme: textNoteTheme.value }
            : undefined,
        })
    // #ifdef H5
    if (import.meta.env.DEV && result?.postId) {
      sessionStorage.setItem('hh-h5-smoke-last-created-post-id', String(result.postId))
    }
    // #endif
    if (!isEditMode.value && isActivityInviteMode.value) {
      try {
        uni.removeStorageSync(ACTIVITY_INVITE_CREATE_INTENT_KEY)
      } catch {}
    }
    if (isEditMode.value) await handleEditSubmitResult(result)
    else await handleAuditSubmitResult(result)
  } catch (error: any) {
    uni.showModal({ title: isEditMode.value ? '保存失败' : '发布失败', content: error?.message ?? '请重试' })
  } finally {
    submitting.value = false
  }
}
</script>

<style lang="scss" scoped>
.create-page {
  padding: 0;
  background: #f4f5f9;
  min-height: 100vh;
  overflow-x: hidden;
}

.title {
  font-size: var(--hh-text-heading-md-size);
  font-weight: $hh-font-weight-medium;
  color: var(--hh-color-text-primary);
  display: block;
  margin-bottom: $hh-space-lg;
}

.section-picker {
  padding: $hh-space-lg var(--hh-page-x) calc(132rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.section-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: $hh-space-lg;
  border: 1rpx solid var(--hh-color-line);
  border-radius: var(--hh-radius-card);
  background: var(--hh-color-card);
  box-shadow: var(--hh-shadow-soft);
  margin-bottom: $hh-space-sm;
}

.section-name {
  font-size: $hh-font-body-lg;
  color: var(--hh-color-text-primary);
}

.form-header {
  display: flex;
  align-items: center;
  gap: $hh-space-sm;
  flex-wrap: wrap;
}

.invite-mode-tag {
  padding: 4rpx 12rpx;
  border-radius: $hh-radius-full;
  background: var(--hh-color-brand-soft);
  color: var(--hh-color-brand-strong);
  font-size: $hh-font-caption;
}

.arrow {
  font-size: $hh-font-h3;
  color: $hh-color-text-mute;
}

.empty-hint {
  padding: $hh-space-xl 0;
  text-align: center;
}

.form-header {
  margin-bottom: $hh-space-lg;
}

.form--figma {
  margin: 0;
  padding: 24rpx 32rpx calc(240rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
  min-height: 100vh;
  overflow-x: hidden;
}

.figma-form-list {
  display: grid;
  gap: 24rpx;
  min-width: 0;
  max-width: 100%;
}

.figma-guide-main-card,
.figma-image-note-main-card,
.figma-activity-main-card {
  padding: 32rpx;
  border-radius: 24rpx;
  background: #fff;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 32rpx;
}

.figma-image-note-tools {
  min-width: 0;
  padding: 24rpx 28rpx;
  display: flex;
  align-items: center;
  gap: 16rpx;
  border-radius: 24rpx;
  background: #fff;
  box-sizing: border-box;
}

.form--image-note :deep(.widget-editor--guide-cover .add-icon) {
  color: #ff2442;
}

.form--image-note .btn-primary {
  background: #ff2442;
}

.figma-ai-write {
  display: flex;
  align-items: center;
  gap: 12rpx;
  color: var(--hh-color-brand-primary);
  font-size: var(--hh-text-body-lg-size);
  font-weight: $hh-font-weight-bold;
  line-height: var(--hh-text-body-lg-line);
}

.figma-ai-icon {
  font-size: 32rpx;
  line-height: 1;
}

.figma-route-stats-card {
  overflow: hidden;
  border-radius: 24rpx;
  background: #fff;
  min-width: 0;
  max-width: 100%;
}

.section-tag {
  font-size: $hh-font-body;
  color: var(--hh-color-brand-strong);
}

.empty-widgets-hint {
  margin-top: $hh-space-xl;
  padding: $hh-space-lg;
  border: 1rpx dashed var(--hh-color-line);
  border-radius: var(--hh-radius-card);
  background: var(--hh-color-card);
  text-align: center;
}
.empty-widgets-title {
  display: block;
  font-size: $hh-font-body-lg;
  color: var(--hh-color-text-primary);
  margin-bottom: $hh-space-sm;
  font-weight: $hh-font-weight-medium;
}
.empty-widgets-desc {
  display: block;
  font-size: $hh-font-caption;
  color: var(--hh-color-text-tertiary);
  line-height: 1.6;
}

.attendance-hint {
  width: 100%;
  max-width: 100%;
  margin-bottom: $hh-space-lg;
  padding: $hh-space-md;
  border-radius: var(--hh-radius-card);
  background: var(--hh-color-brand-soft);
  box-sizing: border-box;
}

.attendance-label {
  display: block;
  font-size: $hh-font-body;
  color: var(--hh-color-text-primary);
  margin-bottom: $hh-space-xs;
}

.attendance-desc {
  display: block;
  font-size: $hh-font-caption;
  color: var(--hh-color-text-tertiary);
}

.btn-primary {
  flex: 1;
  height: 96rpx;
  margin: 0;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  background: var(--hh-color-brand-primary);
  color: #fff;
  border: none;
  border-radius: $hh-radius-full;
  font-size: var(--hh-text-body-lg-size);
  font-weight: $hh-font-weight-bold;
  line-height: 96rpx;
  box-shadow: none;
}

.btn-primary::after {
  border: none;
}

.btn-primary[disabled] {
  opacity: $hh-opacity-disabled;
}

.submit-dock {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: $hh-z-sticky;
  display: flex;
  align-items: center;
  gap: 64rpx;
  padding: 32rpx 32rpx calc(32rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
  background: #fff;
}

.draft-btn {
  width: 112rpx;
  min-width: 112rpx;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-body-base-size);
  line-height: 1.35;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
  white-space: nowrap;
}

.draft-btn::after {
  border: none;
}

.draft-icon {
  width: 48rpx;
  height: 48rpx;
  display: block;
}

.btn-primary-plain {
  margin-top: $hh-space-sm;
  background: var(--hh-color-card);
  color: var(--hh-color-brand-primary);
  border: 2rpx solid var(--hh-color-brand-primary);
  border-radius: var(--hh-radius-card);
  font-size: $hh-font-body;
}

.btn-primary-plain[disabled] {
  opacity: $hh-opacity-disabled;
}

.text-note-compose,
.text-note-cover-step {
  padding: 32rpx 32rpx calc(156rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.text-note-compose {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.text-note-editor-card {
  min-height: 620rpx;
}

.text-note-compose-actions,
.text-note-cover-actions {
  display: flex;
  align-items: center;
  gap: 32rpx;
  margin-top: 36rpx;
}

.text-note-preview {
  width: min(100%, 620rpx);
  margin: 0 auto 40rpx;
}

.text-note-theme-heading {
  display: block;
  margin-bottom: 20rpx;
  font-size: 30rpx;
  font-weight: 700;
  color: var(--hh-color-text-primary);
}

.text-note-theme-scroll { width: 100%; }

.text-note-theme-list {
  display: inline-flex;
  gap: 20rpx;
  padding: 4rpx 4rpx 16rpx;
}

.text-note-theme-option {
  width: 176rpx;
  flex: 0 0 176rpx;
  padding: 6rpx;
  border: 4rpx solid transparent;
  border-radius: 20rpx;
  box-sizing: border-box;
}

.text-note-theme-option--active {
  border-color: var(--hh-color-brand-primary);
}

.text-note-theme-option :deep(.text-note-cover-frame) { border-radius: 12rpx; }
.text-note-theme-option :deep(.text-note-cover-content) { padding: 18rpx 14rpx; }
.text-note-theme-option :deep(.text-note-cover-kicker) { margin-bottom: 6rpx; padding: 0; border-width: 0; font-size: 8rpx; letter-spacing: 1rpx; }
.text-note-theme-option :deep(.text-note-cover-title) { margin-bottom: 8rpx; font-size: 15rpx; }
.text-note-theme-option :deep(.text-note-cover-rule) { width: 24rpx; height: 2rpx; margin-bottom: 8rpx; }
.text-note-theme-option :deep(.text-note-cover-body) { font-size: 11rpx; }
.text-note-theme-option :deep(.text-note-cover-signature) { padding-top: 6rpx; font-size: 5rpx; letter-spacing: 0; }
.text-note-theme-option :deep(.text-note-cover-decoration) { transform: scale(0.32); transform-origin: center; }
.text-note-theme-option :deep(.text-note-cover-quote) { height: 20rpx; font-size: 28rpx; }

.guard-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  gap: $hh-space-md;
}

.guard-title {
  font-size: $hh-font-h3;
  font-weight: $hh-font-weight-medium;
  color: var(--hh-color-text-primary);
  text-align: center;
}

.guard-desc {
  font-size: $hh-font-body;
  color: var(--hh-color-text-tertiary);
  text-align: center;
}
</style>
