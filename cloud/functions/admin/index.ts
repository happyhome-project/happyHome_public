import cloud from 'wx-server-sdk'
import crypto from 'crypto'
import * as db from '../../lib/db'
import * as storage from '../../lib/storage'
import { extractCloudFileIDsFromContent } from '../../lib/extract-file-ids'
import {
  AUDIT_TASKS,
  auditAndApply,
  approvePostAudit,
  handleAuditCallback,
  isPostVisibleToMembers,
  rejectPostAudit,
} from '../../lib/content-audit'
import { getEditableWidgetIds, sanitizeContent, validateContentValues, validateRequiredWidgets } from '../../lib/post-validate'
import { getWxacodeUnlimited } from '../../lib/wx-openapi'
import { searchAmapPoi } from '../../lib/amap'
import { getGuestIntroConfig, saveGuestIntroConfig } from '../../lib/guest-intro-config'
import {
  backfillPostSearchIndexesForCommunity,
  backfillPostSearchIndexesForSection,
  backfillPostSearchIndexesForSectionBatch,
  refreshPostSearchIndexById,
  removePostSearchIndex,
  removePostSearchIndexesForSection,
} from '../../lib/post-search'
import { schedulePostRagSync, schedulePostRagSyncForCurrentPosts, schedulePostRagSyncInTransaction } from '../../lib/post-rag-sync'
import {
  assertOwnCommunityOrSuper,
  generateSalt,
  generateSessionToken,
  hashPassword,
  listOwnedCommunityIds,
  verifyPassword,
} from '../../lib/auth'
import { syncMiniProgramUserRoleForAdminAccount } from '../../lib/admin-identity'
import { resolveCommunityRagIndexPolicy } from '../../shared/community-rag-policy'
import { handleCreate as handleCommunityCreate } from '../community'
import { MEMBER_STATE_COLLECTION } from '../../lib/membership-state'
import { approveMembership, kickMembership, rejectMembership } from '../../lib/membership-transitions'
import type {
  AdminAccount,
  AdminCtx,
  AdminRole,
  AdminSession,
  CollaborationTemplate,
  Community,
  HomeBanner,
  Section,
  SectionType,
  Widget,
} from '../../shared/types'
import { AUDIO_ALLOWED_EXTS } from '../../shared/types'
import {
  buildDefaultGuideNoteWidgets,
  getGuideNoteLockedWidget,
  GUIDE_NOTE_LOCKED_WIDGETS,
  isGuideNoteSection,
  normalizeGuideNoteWidgets,
  normalizeSectionDisplayTemplate,
} from '../../shared/guide-note-widgets'
import {
  buildDefaultTextNoteWidgets,
  isTextNoteSection,
  normalizeTextNoteWidgets,
  TEXT_NOTE_LOCKED_WIDGETS,
} from '../../shared/text-note-widgets'
import {
  buildDefaultImageNoteWidgets,
  getImageNoteLockedWidget,
  IMAGE_NOTE_LOCKED_WIDGETS,
  isImageNoteSection,
  normalizeImageNoteWidgets,
} from '../../shared/image-note-widgets'
import { resolveAuthorAvatarUrl } from '../../shared/simulated-author-avatars'
import { resolvePostAuthorNickname } from '../../shared/post-author'
import { normalizeArchiveTopic } from '../../shared/archive-topics'
import { archiveTopicId, buildArchiveSortKey, syncArchivePostTopics, updateArchivePostTopicLinks } from '../../lib/archive-topic-index'
import { parseArchivePostCreateInput, type ArchivePostFormat } from '../../shared/archive-post'
import {
  collaborationTemplateAsSection,
  findUnsafeCollaborationTemplateChanges,
  normalizeCollaborationTemplate,
} from '../../shared/collaboration-templates'

cloud.init({ env: process.env.TCB_ENV || cloud.DYNAMIC_CURRENT_ENV })

const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || '').trim()
const ADMIN_LEGACY_TOKEN_FALLBACK = process.env.ADMIN_LEGACY_TOKEN_FALLBACK === '1'

async function schedulePostRagSyncForSection(sectionId: string, reason: string, preloadedPosts?: any[]) {
  const posts = preloadedPosts || (await db.query('posts', { sectionId, status: 'active' }) as any[])
  const safePosts = Array.isArray(posts) ? posts : []
  await Promise.all(safePosts.map((post: any) => schedulePostRagSync({
    postId: String(post._id || ''),
    communityId: String(post.communityId || ''),
    sectionId: String(post.sectionId || sectionId),
    reason,
  })))
}
// Bootstrap 登录：当 admin_accounts 为空时，命中这两个环境变量的用户名/密码可一键
// 创建首个 superAdmin。和老的 VITE_ADMIN_USERNAME/PASSWORD 共用一组凭据即可。
const BOOTSTRAP_ADMIN_ENABLED = process.env.BOOTSTRAP_ADMIN_ENABLED === 'true'
const BOOTSTRAP_ADMIN_USERNAME = String(process.env.BOOTSTRAP_ADMIN_USERNAME || '').trim()
const BOOTSTRAP_ADMIN_PASSWORD = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || '')
const ATTENDANCE_COLLECTION = 'post_attendance_members'
const ATTENDANCE_PREVIEW_LIMIT = 5
const ADMIN_ACCOUNTS = 'admin_accounts'
const ADMIN_SESSIONS = 'admin_sessions'
const ADMIN_LOGIN_TICKETS = 'admin_login_tickets'
const SESSION_TTL_MS = Math.max(
  1,
  Number(process.env.ADMIN_SESSION_TTL_DAYS || 7)
) * 24 * 60 * 60 * 1000
const WX_LOGIN_TICKET_TTL_MS = 5 * 60 * 1000  // 5 分钟，扫码登录 ticket 有效期
const WXACODE_PAGE = 'pages/admin-login/index'
const WXACODE_ENV_VERSION = (process.env.WXACODE_ENV_VERSION || 'release') as 'release' | 'trial' | 'develop'

type WxLoginStatus = 'pending' | 'success' | 'no_account' | 'expired' | 'denied'

function adminAmapJsConfig() {
  return {
    jsKey: String(
      process.env.AMAP_JS_KEY ||
        process.env.GAODE_JS_KEY ||
        process.env.AMAP_WEB_JS_KEY ||
        process.env.GAODE_WEB_JS_KEY ||
        process.env.VITE_AMAP_JS_KEY ||
        process.env.VITE_GAODE_JS_KEY ||
        ''
    ).trim(),
    securityCode: String(
      process.env.AMAP_SECURITY_CODE ||
        process.env.GAODE_SECURITY_CODE ||
        process.env.AMAP_JS_SECURITY_CODE ||
        process.env.VITE_AMAP_SECURITY_CODE ||
        process.env.VITE_GAODE_SECURITY_CODE ||
        ''
    ).trim(),
  }
}

interface LoginTicket {
  _id: string                  // ticket = 32 hex chars
  status: WxLoginStatus
  accountId?: string
  token?: string
  role?: AdminRole
  userId?: string
  username?: string
  createdAt: string
  expiresAt: string
}

const PUBLIC_ACTIONS = new Set([
  'auth.login',
  'auth.wxLoginStart',
  'auth.wxLoginPoll',
  'auth.wxLoginConfirm',
  'audit.callback',
])

function safeTokenEquals(actual: unknown, expected: unknown): boolean {
  const actualBuffer = Buffer.from(String(actual || ''), 'utf8')
  const expectedBuffer = Buffer.from(String(expected || ''), 'utf8')
  return actualBuffer.length > 0 &&
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
}

function resolveNonHttpAdminContext(event: any): AdminCtx {
  const expectedToken = String(process.env.ADMIN_INTERNAL_CALL_TOKEN || '').trim()
  if (!expectedToken || !safeTokenEquals(event?._internalToken, expectedToken)) {
    throw new Error('Unauthorized')
  }
  const actAs = event?._actAs
  if (!actAs || !['superAdmin', 'communityAdmin'].includes(String(actAs.role || ''))) {
    throw new Error('Unauthorized')
  }
  return {
    accountId: String(actAs.accountId || ''),
    role: actAs.role,
    userId: String(actAs.userId || ''),
    username: String(actAs.username || ''),
  }
}
const SUPER_ADMIN_ONLY: Array<string | RegExp> = [
  'post.ragCommunityPageAdmin',
  'post.ragClassifyCommunityAdmin',
  'post.ragReconcileCurrentAdmin',
  'post.ragCurrentHealthAdmin',
  'community.approve',
  'community.reject',
  'community.disable',
  'community.restore',
  'community.hardDelete',
  'community.listDisabled',
  'user.setSuperAdmin',
  /^audit\./,
  /^admin\.(?!approvalSummary$)/,
  /^appConfig\./,
  'collaborationTemplate.createAdmin',
  'collaborationTemplate.updateAdmin',
  'collaborationTemplate.disableAdmin',
  'collaborationTemplate.deleteAdmin',
]
// 这些 action 需要校验对 communityId 的归属（superAdmin 自动放行）
const COMMUNITY_SCOPED_ACTIONS = new Set([
  'community.updateMeta',
  'community.updateHomeBanners',
  'section.list',
  'section.create',
  'member.pendingList',
  'member.list',
  'member.approve',
  'member.reject',
  'member.kick',
  'post.listAdmin',
  'post.createAdmin',
  'post.rebuildSearchIndexAdmin',
  'archiveTopic.list',
  'archiveTopic.save',
  'archiveTopic.create',
  'archiveTopic.rename',
  'archiveTopic.setEnabled',
  'archiveTopic.reorder',
  'archiveTopic.delete',
])
// 这些 action 只给了实体 id，需要先查出 communityId 再校验
const ENTITY_TO_COMMUNITY_ACTIONS: Record<string, { collection: string; idParam: string }> = {
  'section.get': { collection: 'sections', idParam: 'sectionId' },
  'section.updateMeta': { collection: 'sections', idParam: 'sectionId' },
  'section.updateStatus': { collection: 'sections', idParam: 'sectionId' },
  'section.updateWidgets': { collection: 'sections', idParam: 'sectionId' },
  'section.delete': { collection: 'sections', idParam: 'sectionId' },
  'post.rebuildSearchIndexSectionAdmin': { collection: 'sections', idParam: 'sectionId' },
  'post.rebuildSearchIndexSectionBatchAdmin': { collection: 'sections', idParam: 'sectionId' },
  'post.getAdmin': { collection: 'posts', idParam: 'postId' },
  'post.deleteAdmin': { collection: 'posts', idParam: 'postId' },
  'post.updateAdmin': { collection: 'posts', idParam: 'postId' },
  'post.pinAdmin': { collection: 'posts', idParam: 'postId' },
  'post.unpinAdmin': { collection: 'posts', idParam: 'postId' },
  'post.featureAdmin': { collection: 'posts', idParam: 'postId' },
  'post.unfeatureAdmin': { collection: 'posts', idParam: 'postId' },
  'post.removeAttendanceMemberAdmin': { collection: 'posts', idParam: 'postId' },
}

const ADMIN_POST_EDITABLE_WIDGET_TYPES = new Set([
  'short_text',
  'summary',
  'number',
  'datetime',
  'rich_text',
  'note_blocks',
  'rich_note',
  'image_group',
  'location',
  'topic',
  'video_group',
  'audio_group',
])

function matchesAction(action: string, rules: Array<string | RegExp>): boolean {
  return rules.some((rule) => (typeof rule === 'string' ? rule === action : rule.test(action)))
}

function normalizeSection(section: any) {
  const normalized = {
    ...section,
    type: section?.type || 'evergreen',
    status: section?.status || 'active',
    displayTemplate: normalizeSectionDisplayTemplate(section?.displayTemplate),
    enableComment: section?.enableComment !== false,
    enableLike: section?.enableLike !== false,
  }
  const guideNormalized = {
    ...normalized,
    widgets: normalizeTextNoteWidgets({ ...normalized, widgets: normalizeGuideNoteWidgets(normalized) }),
  }
  return {
    ...guideNormalized,
    widgets: normalizeImageNoteWidgets(guideNormalized),
  }
}

function getLockedTemplateDefinition(section: Section) {
  if (isGuideNoteSection(section)) {
    return {
      label: '图文攻略',
      widgets: GUIDE_NOTE_LOCKED_WIDGETS,
      getLockedWidget: getGuideNoteLockedWidget,
    }
  }
  if (isImageNoteSection(section)) {
    return {
      label: '图文_new',
      widgets: IMAGE_NOTE_LOCKED_WIDGETS,
      getLockedWidget: getImageNoteLockedWidget,
    }
  }
  return null
}

function assertTemplateLockedWidgets(section: Section, widgets: Widget[]) {
  const definition = getLockedTemplateDefinition(section)
  if (!definition) return

  for (const lockedWidget of definition.widgets) {
    const incoming = widgets.find((widget) => widget.widgetId === lockedWidget.widgetId)
    if (!incoming) {
      throw new Error(`${definition.label}固定控件「${lockedWidget.label}」不能删除`)
    }

    const immutableFields: Array<keyof Widget> = ['type', 'label', 'fieldKey', 'required', 'order', 'showInList']
    const changedField = immutableFields.find((field) => incoming[field] !== lockedWidget[field])
    if (changedField) {
      throw new Error(`${definition.label}固定控件「${lockedWidget.label}」不能修改`)
    }
  }
}

function assertTextNoteLockedWidgets(section: Section, widgets: Widget[]) {
  if (!isTextNoteSection(section)) return
  if (widgets.length !== TEXT_NOTE_LOCKED_WIDGETS.length || widgets.some((widget) => !TEXT_NOTE_LOCKED_WIDGETS.some((locked) => locked.widgetId === widget.widgetId))) {
    throw new Error('纯文字笔记只能包含标题和正文固定控件')
  }
  for (const lockedWidget of TEXT_NOTE_LOCKED_WIDGETS) {
    const incoming = widgets.find((widget) => widget.widgetId === lockedWidget.widgetId)
    if (!incoming) throw new Error(`纯文字笔记固定控件「${lockedWidget.label}」不能删除`)
    const immutableFields: Array<keyof Widget> = ['type', 'label', 'fieldKey', 'required', 'order', 'showInList']
    if (immutableFields.some((field) => incoming[field] !== lockedWidget[field])) {
      throw new Error(`纯文字笔记固定控件「${lockedWidget.label}」不能修改`)
    }
  }
}

function applyGuideNoteLockedFlags(section: Section, widgets: Widget[]) {
  if (!isGuideNoteSection(section)) return widgets
  return widgets.map((widget) => {
    const lockedWidget = getGuideNoteLockedWidget(widget.widgetId)
    return lockedWidget ? { ...lockedWidget } : { ...widget, locked: false }
  })
}

function applyTemplateLockedFlags(section: Section, widgets: Widget[]) {
  const definition = getLockedTemplateDefinition(section)
  if (!definition) return widgets
  return widgets.map((widget) => {
    const lockedWidget = definition.getLockedWidget(widget.widgetId)
    return lockedWidget ? { ...lockedWidget } : { ...widget, locked: false }
  })
}

function applyTextNoteLockedFlags(section: Section, widgets: Widget[]) {
  if (!isTextNoteSection(section)) return widgets
  const lockedById = new Map(TEXT_NOTE_LOCKED_WIDGETS.map((widget) => [widget.widgetId, widget]))
  return widgets.map((widget) => lockedById.has(widget.widgetId)
    ? { ...lockedById.get(widget.widgetId)! }
    : { ...widget, locked: false })
}

function normalizeKeyword(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

function parseDateBoundary(value: string, endOfDay = false) {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return Date.parse(`${value}${endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z'}`)
  }
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? null : timestamp
}

function parseOptionalBoolean(value: unknown): boolean | null {
  if (value === true || value === 'true' || value === 1 || value === '1') return true
  if (value === false || value === 'false' || value === 0 || value === '0') return false
  return null
}

function includesKeyword(...parts: Array<unknown>) {
  const haystack = parts.map((part) => String(part || '').toLowerCase()).join(' ')
  return (keyword: string) => !keyword || haystack.includes(keyword)
}

function getAdminPostEditableWidgetIds(section: Section): Set<string> {
  return new Set(
    (section.widgets || [])
      .filter((widget: any) => ADMIN_POST_EDITABLE_WIDGET_TYPES.has(String(widget.type || '')))
      .map((widget: any) => String(widget.widgetId || ''))
      .filter(Boolean)
  )
}

function mergeAdminPostContent(existingContent: any, incomingContent: any, section: Section) {
  const currentPostContentIds = getEditableWidgetIds(section, true)
  const adminEditableIds = getAdminPostEditableWidgetIds(section)
  const merged: Record<string, any> = {}

  for (const [key, value] of Object.entries(existingContent || {})) {
    if (currentPostContentIds.has(key) && !adminEditableIds.has(key)) {
      merged[key] = value
    }
  }

  for (const [key, value] of Object.entries(incomingContent || {})) {
    if (adminEditableIds.has(key)) {
      merged[key] = value
    }
  }

  return merged
}

function resolveArchivePostFormat(format: unknown): ArchivePostFormat {
  if (format === 'text' || format === 'video') return format
  return 'image_text'
}

function buildAdminArchiveContentSection(communityId: string, format: unknown): Section {
  const resolvedFormat = resolveArchivePostFormat(format)
  const common = {
    _id: '',
    communityId,
    icon: '',
    order: 0,
    enableComment: true,
    enableLike: true,
    createdAt: '',
    type: 'evergreen' as const,
    status: 'active' as const,
  }
  const topicsWidget: Widget = {
    widgetId: 'topics', type: 'topic', label: '话题', fieldKey: 'topics',
    required: false, order: 3, showInList: false,
  }

  if (resolvedFormat === 'text') {
    return {
      ...common,
      name: '文字',
      displayTemplate: 'text_note',
      widgets: [
        { widgetId: 'title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true },
        { widgetId: 'body', type: 'rich_note', label: '正文', fieldKey: 'body', required: true, order: 1, showInList: false },
        { ...topicsWidget, order: 2 },
      ],
    } as Section
  }

  if (resolvedFormat === 'video') {
    return {
      ...common,
      name: '视频',
      displayTemplate: 'default',
      widgets: [
        { widgetId: 'title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true },
        { widgetId: 'body', type: 'rich_note', label: '正文', fieldKey: 'body', required: false, order: 1, showInList: false },
        { widgetId: 'videos', type: 'video_group', label: '视频', fieldKey: 'videos', required: true, order: 2, showInList: false },
        topicsWidget,
        { widgetId: 'location', type: 'location', label: '地点', fieldKey: 'location', required: false, order: 4, showInList: false },
      ],
    } as Section
  }

  return {
    ...common,
    name: '图文',
    displayTemplate: 'image_note',
    widgets: [
      { widgetId: 'images', type: 'image_group', label: '图片', fieldKey: 'images', required: true, order: 0, showInList: false },
      { widgetId: 'title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 1, showInList: true },
      { widgetId: 'body', type: 'rich_note', label: '正文', fieldKey: 'body', required: false, order: 2, showInList: false },
      topicsWidget,
      { widgetId: 'location', type: 'location', label: '地点', fieldKey: 'location', required: false, order: 4, showInList: false },
    ],
  } as Section
}

function archiveContentForAdmin(post: any) {
  if (post?.area !== 'archive') return post?.content || {}
  return {
    ...(post.content || {}),
    topics: Array.isArray(post.topics) ? post.topics.map(String) : [],
  }
}

function isTestAccountId(userId: string) {
  const normalized = String(userId || '').trim().toLowerCase()
  return (
    normalized.startsWith('dev-') ||
    normalized.startsWith('h5-') ||
    normalized.startsWith('test-') ||
    normalized.startsWith('mock-') ||
    normalized.startsWith('qa-')
  )
}

function normalizeMemberNickName(userId: string, nickName: unknown) {
  const raw = String(nickName || '').trim()
  if (raw && raw !== '未设置') return raw
  if (isTestAccountId(userId)) return `测试账号(${String(userId || '').slice(0, 12)})`
  return '微信用户'
}

function normalizeCapacity(value: unknown) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return undefined
  return Math.floor(num)
}

function normalizeNoticeContent(value: unknown) {
  return Array.from(String(value || '').trim()).slice(0, 500).join('')
}

function normalizeWidgetForSave(widget: any): Widget {
  const normalized: Widget = {
    ...widget,
    required: ['attendance', 'admin_notice', 'activity_invite'].includes(widget?.type) ? false : widget?.required === true,
    showInList: ['admin_notice', 'activity_invite'].includes(widget?.type) ? false : widget?.showInList === true,
  }
  if (normalized.type === 'attendance') {
    normalized.capacity = normalizeCapacity(normalized.capacity)
    if (typeof widget?.capacityWidgetId === 'string') {
      normalized.capacityWidgetId = widget.capacityWidgetId
    }
    const label = String(normalized.label || '').trim().toLowerCase()
    if (!label || label === '新控件' || label === 'new widget' || isGenericWidgetLabel(normalized.label)) {
      normalized.label = ''
    }
  } else {
    delete normalized.capacity
    delete normalized.capacityWidgetId
  }
  if (normalized.type === 'admin_notice') {
    normalized.noticeContent = normalizeNoticeContent(widget?.noticeContent)
  } else {
    delete normalized.noticeContent
  }
  return normalized
}

function isGenericWidgetLabel(label: unknown) {
  const text = String(label || '').trim()
  return [
    '短文字',
    '一句话简介',
    '日期时间',
    '数字',
    '图片组',
    '视频列表',
    '正文',
    '位置',
    '活动参与',
    '公告',
  ].includes(text)
}

function validateSectionWidgets(sectionType: SectionType, widgets: any[]) {
  const showInListCount = widgets.filter((widget: any) => widget.showInList).length
  if (showInListCount > 3) throw new Error('showInList 最多只能有 3 个控件')

  const attendanceWidgets = widgets.filter((widget: any) => widget.type === 'attendance')
  if (attendanceWidgets.length > 1) throw new Error('每个板块最多只能配置 1 个活动参与控件')
  if (attendanceWidgets.length > 0 && sectionType !== 'realtime') {
    throw new Error('活动参与控件只能用于 realtime 板块')
  }
  const activityInviteWidgets = widgets.filter((widget: any) => widget.type === 'activity_invite')
  if (activityInviteWidgets.length > 1) throw new Error('每个板块最多只能配置 1 个活动召集控件')
  if (activityInviteWidgets.length > 0 && sectionType !== 'evergreen') {
    throw new Error('活动召集控件只能用于沉淀展示板块')
  }

  for (const widget of widgets) {
    if (widget.showInList && !['short_text', 'summary', 'datetime', 'number', 'attendance'].includes(widget.type)) {
      throw new Error(`控件类型 ${widget.type} 不支持在列表展示`)
    }
    if (['attendance', 'admin_notice', 'activity_invite'].includes(widget.type) && widget.required) {
      throw new Error('活动参与/公告/活动召集控件不能设为必填')
    }
  }
}

async function getUsersByIds(userIds: string[]) {
  const usersById: Record<string, any> = {}
  for (const userId of Array.from(new Set(userIds.filter(Boolean)))) {
    try {
      usersById[userId] = await db.getById('users', userId)
    } catch {
      usersById[userId] = null
    }
  }
  return usersById
}

async function getSectionsByIds(sectionIds: string[]) {
  const sectionsById: Record<string, any> = {}
  for (const sectionId of Array.from(new Set(sectionIds.filter(Boolean)))) {
    try {
      const section = await db.getById('sections', sectionId)
      sectionsById[sectionId] = normalizeSection(section)
    } catch {
      sectionsById[sectionId] = null
    }
  }
  return sectionsById
}

async function getCollaborationTemplatesByIds(templateIds: string[]) {
  const templatesById: Record<string, CollaborationTemplate | null> = {}
  for (const templateId of Array.from(new Set(templateIds.filter(Boolean)))) {
    try {
      const template = await db.getById('collaboration_templates', templateId) as CollaborationTemplate
      templatesById[templateId] = template ? normalizeCollaborationTemplate(template) : null
    } catch {
      templatesById[templateId] = null
    }
  }
  return templatesById
}

async function resolveAdminPostContentContract(post: any): Promise<{
  section: Section | null
  collaborationTemplate: CollaborationTemplate | null
}> {
  if (post?.area === 'archive') {
    return {
      section: buildAdminArchiveContentSection(String(post.communityId || ''), post.format),
      collaborationTemplate: null,
    }
  }

  if (post?.area === 'collaboration') {
    const templateId = String(post.collaborationTemplateId || '').trim()
    if (!templateId) return { section: null, collaborationTemplate: null }
    const raw = await db.getById('collaboration_templates', templateId).catch(() => null) as CollaborationTemplate | null
    const collaborationTemplate = raw ? normalizeCollaborationTemplate(raw) : null
    return {
      section: collaborationTemplate
        ? collaborationTemplateAsSection(collaborationTemplate, String(post.communityId || ''))
        : null,
      collaborationTemplate,
    }
  }

  const sectionId = String(post?.sectionId || '').trim()
  if (!sectionId) return { section: null, collaborationTemplate: null }
  const raw = await db.getById('sections', sectionId).catch(() => null) as Section | null
  return {
    section: raw ? normalizeSection(raw) as Section : null,
    collaborationTemplate: null,
  }
}

async function reindexCollaborationTemplatePosts(posts: any[], reason: string) {
  for (const post of posts) {
    const postId = String(post?._id || '').trim()
    const communityId = String(post?.communityId || '').trim()
    if (!postId || !communityId) continue
    await schedulePostRagSync({
      postId,
      communityId,
      sectionId: '',
      reason,
    })
    await refreshPostSearchIndexById(postId)
  }
}

async function getAttendanceRecords(postId: string, widgetId: string) {
  const records = await db.query(
    ATTENDANCE_COLLECTION,
    { postId, widgetId },
    { orderBy: ['joinedAt', 'desc'] }
  )
  return Array.isArray(records) ? records : []
}

async function buildAttendanceSummaryByWidget(post: any, section: any) {
  const attendanceWidgets = (section?.widgets || []).filter((widget: any) => widget.type === 'attendance')
  if (attendanceWidgets.length === 0) return {}

  const entries = await Promise.all(attendanceWidgets.map(async (widget: any) => {
    const records = await getAttendanceRecords(post._id, widget.widgetId)
    const usersById = await getUsersByIds(records.map((record: any) => String(record.userId || '')))
    const count = records.length
    const capacity = normalizeCapacity(widget.capacity)
    return [
      widget.widgetId,
      {
        count,
        ...(typeof capacity === 'number' ? { capacity } : {}),
        isFull: typeof capacity === 'number' ? count >= capacity : false,
        isJoined: false,
        previewUsers: records.slice(0, ATTENDANCE_PREVIEW_LIMIT).map((record: any) => ({
          userId: String(record.userId || ''),
          nickName: usersById[record.userId]?.nickName || '',
          avatarUrl: usersById[record.userId]?.avatarUrl || '',
        })),
      },
    ] as const
  }))
  return Object.fromEntries(entries)
}

async function listAttendanceMembersForAdmin(postId: string, widgetId: string) {
  const records = await getAttendanceRecords(postId, widgetId)
  const usersById = await getUsersByIds(records.map((record: any) => String(record.userId || '')))
  return records.map((record: any) => ({
    recordId: String(record._id || ''),
    userId: String(record.userId || ''),
    nickName: usersById[record.userId]?.nickName || '',
    avatarUrl: usersById[record.userId]?.avatarUrl || '',
    joinedAt: record.joinedAt,
  }))
}

// ============================================================
// 身份解析 / Session
// ============================================================

function extractBearer(authHeader: string): string {
  const m = String(authHeader || '').match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : ''
}

async function resolveSession(authHeader: string): Promise<AdminCtx | null> {
  const token = extractBearer(authHeader)
  if (!token) return null

  // 迁移期 fallback：旧共享 token 认作虚拟 superAdmin
  if (ADMIN_LEGACY_TOKEN_FALLBACK && token === ADMIN_TOKEN) {
    return {
      accountId: 'legacy',
      role: 'superAdmin',
      userId: '',
      username: 'legacy',
    }
  }

  let session: AdminSession | null
  try {
    session = (await db.getById(ADMIN_SESSIONS, token)) as AdminSession
  } catch {
    return null
  }
  if (!session) return null
  if (session.expiresAt && Date.parse(session.expiresAt) < Date.now()) {
    try { await db.removeById(ADMIN_SESSIONS, token) } catch { /* best effort */ }
    return null
  }
  if (!session.userId && session.accountId) {
    try {
      const account = (await db.getById(ADMIN_ACCOUNTS, session.accountId)) as AdminAccount | null
      if (account?.userId) {
        session.userId = account.userId
        await db.updateById(ADMIN_SESSIONS, token, { userId: account.userId })
      }
    } catch {
      // Best effort: old sessions without userId should not break auth if account lookup fails.
    }
  }
  return {
    accountId: session.accountId,
    role: session.role,
    userId: session.userId,
    username: session.username,
  }
}

async function findAccountByUsername(username: string): Promise<AdminAccount | null> {
  const matches = (await db.query(ADMIN_ACCOUNTS, { username }, { limit: 1 })) as AdminAccount[]
  return matches[0] || null
}

async function findAccountByUserId(userId: string): Promise<AdminAccount | null> {
  if (!userId) return null
  const matches = (await db.query(ADMIN_ACCOUNTS, { userId }, { limit: 1 })) as AdminAccount[]
  return matches[0] || null
}

async function listCreatorCommunities(userId: string): Promise<Community[]> {
  if (!userId) return []
  return (await db.query('communities', { creatorId: userId })) as Community[]
}

async function listApprovalSummaryCommunities(ctx: AdminCtx): Promise<Community[]> {
  if (ctx.role === 'superAdmin') {
    return (await db.query('communities', { status: 'active' }, { orderBy: ['createdAt', 'desc'] })) as Community[]
  }
  const ownedIds = await listOwnedCommunityIds(ctx.userId)
  if (ownedIds.length === 0) return []
  const docs = await Promise.all(ownedIds.map((id) => db.getById('communities', id).catch(() => null)))
  return (docs.filter(Boolean) as Community[]).filter((community) => community.status === 'active')
}

async function buildApprovalSummary(ctx: AdminCtx) {
  const [pendingCommunities, manageableCommunities] = await Promise.all([
    ctx.role === 'superAdmin'
      ? db.query('communities', { status: 'pending' }, { orderBy: ['createdAt', 'desc'] }) as Promise<Community[]>
      : Promise.resolve([]),
    listApprovalSummaryCommunities(ctx),
  ])

  const communities = []
  let pendingMemberCount = 0
  for (const community of manageableCommunities) {
    const members = (await db.query('community_members', {
      communityId: community._id,
      status: 'pending',
    })) as any[]
    if (!Array.isArray(members) || members.length === 0) continue
    pendingMemberCount += members.length
    communities.push({
      communityId: community._id,
      communityName: community.name,
      pendingMemberCount: members.length,
    })
  }

  return {
    pendingCommunityCount: pendingCommunities.length,
    pendingMemberCount,
    communities,
  }
}

async function createSessionForAccount(account: AdminAccount): Promise<{ token: string; expiresAt: string }> {
  const token = generateSessionToken()
  const now = Date.now()
  const expiresAt = new Date(now + SESSION_TTL_MS).toISOString()
  await db.create(ADMIN_SESSIONS, {
    _id: token,
    accountId: account._id,
    role: account.role,
    userId: account.userId || '',
    username: account.username,
    createdAt: new Date(now).toISOString(),
    expiresAt,
  })
  return { token, expiresAt }
}

// ============================================================
// Public（不需要 session）路由
// ============================================================

async function publicRoute(action: string, params: Record<string, any>, openid = '') {
  if (action === 'audit.callback') {
    return handleAuditCallback(params)
  }

  if (action === 'auth.login') {
    const username = String(params.username || '').trim()
    const password = String(params.password || '')
    if (!username || !password) throw new Error('用户名和密码不能为空')

    let account = await findAccountByUsername(username)

    // ---- Bootstrap：admin_accounts 为空 + 命中 env 凭据时自动 seed 首个 superAdmin ----
    if (!account
      && BOOTSTRAP_ADMIN_ENABLED
      && BOOTSTRAP_ADMIN_USERNAME
      && BOOTSTRAP_ADMIN_PASSWORD
      && username === BOOTSTRAP_ADMIN_USERNAME
      && password === BOOTSTRAP_ADMIN_PASSWORD) {
      const total = (await db.query(ADMIN_ACCOUNTS, {}, { limit: 1 })) as any[]
      if (total.length === 0) {
        const salt = generateSalt()
        const hash = hashPassword(password, salt)
        const accountId = await db.create(ADMIN_ACCOUNTS, {
          username,
          passwordHash: hash,
          passwordSalt: salt,
          userId: '',
          role: 'superAdmin',
          status: 'active',
          createdAt: new Date().toISOString(),
          createdBy: 'bootstrap',
        })
        account = {
          _id: accountId,
          username,
          passwordHash: hash,
          passwordSalt: salt,
          userId: '',
          role: 'superAdmin',
          status: 'active',
          createdAt: new Date().toISOString(),
          createdBy: 'bootstrap',
        }
      }
    }

    if (!account) throw new Error('用户名或密码错误')
    if (account.status !== 'active') throw new Error('账号已停用')
    if (!verifyPassword(password, account.passwordSalt, account.passwordHash)) {
      throw new Error('用户名或密码错误')
    }

    const { token, expiresAt } = await createSessionForAccount(account)
    return {
      token,
      expiresAt,
      role: account.role,
      userId: account.userId || '',
      username: account.username,
    }
  }

  // ─────────────────────────────────────────────────────────
  // 微信扫码登录（三段：admin-web start/poll + 小程序 confirm）
  //   start   ← admin-web HTTP    → 生成 ticket + 小程序码 PNG
  //   poll    ← admin-web HTTP    → 轮询 ticket 状态拿 token
  //   confirm ← 小程序 wx.cloud   → admin 在小程序内点确认绑定
  // 三个 action 都注册到 PUBLIC_ACTIONS，不需要 session。
  // ─────────────────────────────────────────────────────────

  if (action === 'auth.wxLoginStart') {
    const ticket = crypto.randomBytes(16).toString('hex')  // 32 hex chars
    const now = Date.now()
    const expiresAt = new Date(now + WX_LOGIN_TICKET_TTL_MS).toISOString()

    // 调微信开放接口生成无限带参小程序码。
    // CloudBase 函数环境跟「微信小程序云开发」是不同产品，cloud.openapi 不通
    // （实测 errMsg=invalid wx openapi access_token），所以直接走 HTTP +
    // 自管 access_token。详见 cloud/lib/wx-openapi.ts。
    let qrCodeBase64: string
    try {
      const buffer = await getWxacodeUnlimited({
        scene: ticket,
        page: WXACODE_PAGE,
        width: 280,
        envVersion: WXACODE_ENV_VERSION,
        checkPath: false,  // 开发期 page 还没发布时关掉路径校验
      })
      qrCodeBase64 = `data:image/png;base64,${buffer.toString('base64')}`
    } catch (err: any) {
      // 不写 ticket，直接报错让调用方知道 — 否则前端会显示空二维码轮询到过期
      throw new Error(`生成小程序码失败：${err?.errMsg || err?.message || 'unknown'}`)
    }

    await db.create(ADMIN_LOGIN_TICKETS, {
      _id: ticket,
      status: 'pending' as WxLoginStatus,
      createdAt: new Date(now).toISOString(),
      expiresAt,
    })
    return { ticket, qrCodeBase64, expiresAt }
  }

  if (action === 'auth.wxLoginPoll') {
    const ticket = String(params.ticket || '').trim()
    if (!ticket) throw new Error('ticket 不能为空')
    let row: LoginTicket | null = null
    try {
      row = await db.getById(ADMIN_LOGIN_TICKETS, ticket) as LoginTicket
    } catch {
      return { status: 'expired' as WxLoginStatus }
    }
    if (!row) return { status: 'expired' as WxLoginStatus }
    // 懒过期：超时则更新状态再返回
    if (row.status === 'pending' && Date.parse(row.expiresAt) < Date.now()) {
      try { await db.updateById(ADMIN_LOGIN_TICKETS, ticket, { status: 'expired' }) }
      catch { /* best effort */ }
      return { status: 'expired' as WxLoginStatus }
    }
    if (row.status !== 'success') {
      return { status: row.status, userId: row.userId || '' }
    }
    // success：返回完整 session 信息，并主动 invalidate ticket（防重放）
    const payload = {
      status: 'success' as WxLoginStatus,
      token: row.token || '',
      role: row.role || ('communityAdmin' as AdminRole),
      userId: row.userId || '',
      username: row.username || '',
    }
    try { await db.removeById(ADMIN_LOGIN_TICKETS, ticket) } catch { /* best effort */ }
    return payload
  }

  if (action === 'auth.wxLoginConfirm') {
    const ticket = String(params.ticket || '').trim()
    if (!ticket) throw new Error('ticket 不能为空')
    if (!openid) throw new Error('Missing OPENID（必须从微信小程序内调用）')

    let row: LoginTicket | null = null
    try {
      row = await db.getById(ADMIN_LOGIN_TICKETS, ticket) as LoginTicket
    } catch {
      throw new Error('登录会话不存在或已过期')
    }
    if (!row) throw new Error('登录会话不存在或已过期')
    if (row.status !== 'pending') throw new Error('登录会话已被使用或已过期')
    if (Date.parse(row.expiresAt) < Date.now()) {
      try { await db.updateById(ADMIN_LOGIN_TICKETS, ticket, { status: 'expired' }) }
      catch { /* best effort */ }
      throw new Error('登录会话已过期，请刷新后重新扫码')
    }

    const account = await findAccountByUserId(openid)
    if (!account) {
      await db.updateById(ADMIN_LOGIN_TICKETS, ticket, {
        status: 'no_account' as WxLoginStatus,
        userId: openid,
      })
      return {
        success: false,
        reason: 'no_account' as const,
        message: '该微信未绑定管理员账号，请联系超管在 admin-web 添加',
      }
    }
    if (account.status !== 'active') throw new Error('该管理员账号已停用')

    await syncMiniProgramUserRoleForAdminAccount(openid, account.role, { nickName: account.username })
    const { token } = await createSessionForAccount(account)
    await db.updateById(ADMIN_LOGIN_TICKETS, ticket, {
      status: 'success' as WxLoginStatus,
      accountId: account._id,
      token,
      role: account.role,
      userId: openid,
      username: account.username,
    })
    return {
      success: true,
      role: account.role,
      username: account.username,
    }
  }

  throw new Error(`Unknown public action: ${action}`)
}

// ============================================================
// 权限守卫（在 route 分发前执行）
// ============================================================

async function resolveScopedCommunityId(action: string, params: Record<string, any>): Promise<string> {
  const entityMap = ENTITY_TO_COMMUNITY_ACTIONS[action]
  if (!entityMap) return String(params.communityId || '').trim()

  const entityId = String(params[entityMap.idParam] || '').trim()
  if (!entityId) throw new Error(`${entityMap.idParam} 不能为空`)
  try {
    const entity = (await db.getById(entityMap.collection, entityId)) as any
    return String(entity?.communityId || '').trim()
  } catch {
    throw new Error(`${entityMap.idParam} 不存在`)
  }
}

async function enforceActionAccess(action: string, params: Record<string, any>, ctx: AdminCtx): Promise<void> {
  if (matchesAction(action, SUPER_ADMIN_ONLY)) {
    if (ctx.role !== 'superAdmin') throw new Error('权限不足')
    return
  }
  if (COMMUNITY_SCOPED_ACTIONS.has(action) || ENTITY_TO_COMMUNITY_ACTIONS[action]) {
    if (ctx.role === 'superAdmin') return
    const communityId = await resolveScopedCommunityId(action, params)
    await assertOwnCommunityOrSuper(ctx, communityId)
  }
}

async function route(action: string, params: Record<string, any>, ctx: AdminCtx) {
  await enforceActionAccess(action, params, ctx)

  // ---- auth.me / auth.logout 放在守卫后（只需有 session 即可） ----
  if (action === 'auth.me') {
    return {
      role: ctx.role,
      userId: ctx.userId,
      username: ctx.username,
      accountId: ctx.accountId,
    }
  }
  if (action === 'auth.logout') {
    if (ctx.accountId !== 'legacy') {
      try { await db.removeById(ADMIN_SESSIONS, params.__token__ || '') } catch { /* best effort */ }
    }
    return { success: true }
  }
  if (action === 'admin.approvalSummary') {
    return buildApprovalSummary(ctx)
  }

  if (action === 'geo.mapConfig') {
    return adminAmapJsConfig()
  }

  if (action === 'geo.searchLocation') {
    const keyword = String(params.keyword || '').trim()
    if (!keyword) throw new Error('地点关键字不能为空')
    const region = String(params.region || '').trim()
    const candidates = await searchAmapPoi({ keyword, region, limit: 8 })
    return { candidates }
  }

  if (action === 'appConfig.getGuestIntro') {
    return { config: await getGuestIntroConfig() }
  }

  if (action === 'appConfig.updateGuestIntro') {
    const config = await saveGuestIntroConfig(params.config || {}, {
      publishNewVersion: params.publishNewVersion === true,
      updatedBy: ctx.username || ctx.accountId,
    })
    return { config }
  }

  if (action === 'user.setSuperAdmin') {
    const openId = String(params.openId || '').trim()
    if (!openId) throw new Error('openId 不能为空')

    const now = new Date().toISOString()
    try {
      await db.getById('users', openId)
      await db.updateById('users', openId, { role: 'superAdmin' })
    } catch (err: any) {
      const isNotFound = err?.errCode === -502001 ||
        (err?.message && (err.message.includes('not found') || err.message.includes('does not exist')))
      if (!isNotFound) throw err

      await db.create('users', {
        _id: openId,
        nickName: 'SuperAdmin',
        avatarUrl: '',
        role: 'superAdmin',
        createdAt: now,
      })
    }

    return { success: true, openId, role: 'superAdmin' }
  }

  if (action === 'community.list') {
    if (ctx.role === 'superAdmin') {
      const [active, pending, rejected, disabled] = await Promise.all([
        db.query('communities', { status: 'active' }, { orderBy: ['createdAt', 'desc'] }),
        db.query('communities', { status: 'pending' }, { orderBy: ['createdAt', 'desc'] }),
        db.query('communities', { status: 'rejected' }, { orderBy: ['createdAt', 'desc'] }),
        db.query('communities', { status: 'disabled' }, { orderBy: ['createdAt', 'desc'] }),
      ])
      return { communities: [...active, ...pending, ...rejected, ...disabled] }
    }
    const ownedIds = await listOwnedCommunityIds(ctx.userId)
    if (ownedIds.length === 0) return { communities: [] }
    const docs = await Promise.all(
      ownedIds.map((id) => db.getById('communities', id).catch(() => null))
    )
    const communities = (docs.filter(Boolean) as Community[])
      .filter((c) => c.status !== 'disabled' || ctx.role === 'superAdmin')
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    return { communities }
  }
  if (action === 'community.createAdmin') {
    if (!ctx.userId) throw new Error('当前账号未绑定用户身份，暂不能创建社区')
    const result = await handleCommunityCreate({
      name: String(params.name || '').trim(),
      description: String(params.description || ''),
      coverImage: String(params.coverImage || ''),
      location: params.location,
      joinType: params.joinType === 'approval' ? 'approval' : 'open',
      requestId: String(params.requestId || ''),
      suppressNotification: ctx.role === 'superAdmin',
    }, ctx.userId)
    // superAdmin 创建的社区可直接 active
    if (ctx.role === 'superAdmin') {
      await db.updateById('communities', result.communityId, { status: 'active' })
    }
    return result
  }
  if (action === 'community.approve') {
    const communityId = String(params.communityId || '').trim()
    if (!communityId) throw new Error('communityId 不能为空')
    await db.runTransaction(async transaction => {
      await transaction.collection('communities').doc(communityId).update({ data: { status: 'active' } })
    })
    await schedulePostRagSyncForCurrentPosts({ communityId, reason: 'community.status_changed' })

    // ---- 自动给社区创建者发一个 communityAdmin 账号（按 userId=openId 去重）----
    // openId 在微信侧 per-app 永久稳定，重复"注册"不会变。同一个 creator 的多个社区
    // 共用同一个 admin 账号——这里幂等：已存在就只回返既有信息，不重置密码。
    const community = await db.getById('communities', communityId) as Community | null
    let adminAccount: { username: string; password?: string; alreadyExisted: boolean } | null = null

    if (community?.creatorId) {
      const existing = await findAccountByUserId(community.creatorId)
      if (existing) {
        adminAccount = { username: existing.username, alreadyExisted: true }
      } else {
        // 用户名 = `c-${openId 后8位}`，可读且不易撞；密码 12 位随机
        const suffix = community.creatorId.slice(-8) || Date.now().toString(36).slice(-8)
        let username = `c-${suffix}`
        // 极小概率撞名时加一位
        if (await findAccountByUsername(username)) {
          username = `c-${suffix}-${Math.random().toString(36).slice(2, 4)}`
        }
        const password = generateSessionToken().slice(0, 12)
        const salt = generateSalt()
        const hash = hashPassword(password, salt)
        await db.create(ADMIN_ACCOUNTS, {
          username,
          passwordHash: hash,
          passwordSalt: salt,
          userId: community.creatorId,
          role: 'communityAdmin',
          status: 'active',
          createdAt: new Date().toISOString(),
          createdBy: ctx.accountId,
        })
        adminAccount = { username, password, alreadyExisted: false }
      }
    }

    return { success: true, adminAccount }
  }
  if (action === 'community.reject') {
    await db.runTransaction(async transaction => {
      await transaction.collection('communities').doc(params.communityId).update({ data: { status: 'rejected' } })
    })
    await schedulePostRagSyncForCurrentPosts({ communityId: params.communityId, reason: 'community.status_changed' })
    return { success: true }
  }
  if (action === 'community.disable') {
    const community = await db.getById('communities', params.communityId) as Community | null
    if (!community) throw new Error('community not found')
    if (community.status !== 'active') throw new Error('only active community can be disabled')
    await db.runTransaction(async transaction => {
      await transaction.collection('communities').doc(params.communityId).update({ data: { status: 'disabled' } })
    })
    await schedulePostRagSyncForCurrentPosts({ communityId: params.communityId, reason: 'community.status_changed' })
    return { success: true }
  }
  if (action === 'community.restore') {
    const community = await db.getById('communities', params.communityId) as Community | null
    if (!community) throw new Error('community not found')
    if (community.status !== 'disabled') throw new Error('only disabled community can be restored')
    await db.runTransaction(async transaction => {
      await transaction.collection('communities').doc(params.communityId).update({ data: { status: 'active' } })
    })
    await schedulePostRagSyncForCurrentPosts({ communityId: params.communityId, reason: 'community.status_changed' })
    return { success: true }
  }
  if (action === 'community.listDisabled') {
    const communities = await db.query('communities', { status: 'disabled' }, { orderBy: ['createdAt', 'desc'] })
    return { communities }
  }
  if (action === 'community.updateMeta') {
    const communityId = String(params.communityId || '').trim()
    if (!communityId) throw new Error('communityId 不能为空')
    const updates: Record<string, any> = {}
    let ragPolicyChanged = false
    if (typeof params.name === 'string') updates.name = params.name
    if (typeof params.description === 'string') updates.description = params.description
    if (typeof params.motto === 'string') updates.motto = params.motto
    if (typeof params.mottoCite === 'string') updates.mottoCite = params.mottoCite
    if (params.joinType === 'open' || params.joinType === 'approval') updates.joinType = params.joinType
    else if (typeof params.joinType !== 'undefined') throw new Error('joinType must be open or approval')
    if (Object.keys(updates).length === 0) throw new Error('没有可更新字段')
    await db.runTransaction(async transaction => {
      if (typeof params.name === 'string') {
        const currentCommunity = await db.transactionGetByIdOrNull<any>(transaction, 'communities', communityId)
        if (!currentCommunity) throw new Error('community not found')
        const ragIndexPolicy = resolveCommunityRagIndexPolicy({
          name: params.name,
          fixtureKey: currentCommunity.fixtureKey,
          currentPolicy: currentCommunity.ragIndexPolicy,
        })
        if (ragIndexPolicy !== currentCommunity.ragIndexPolicy) {
          updates.ragIndexPolicy = ragIndexPolicy
          ragPolicyChanged = true
        }
      }
      await transaction.collection('communities').doc(communityId).update({ data: updates })
    })
    if (ragPolicyChanged) {
      await schedulePostRagSyncForCurrentPosts({ communityId, reason: 'community.rag_policy_changed' })
    }
    return { success: true }
  }
  if (action === 'community.updateHomeBanners') {
    const communityId = String(params.communityId || '').trim()
    if (!communityId) throw new Error('communityId 不能为空')
    const banners = await normalizeCommunityHomeBanners(communityId, params.banners)
    if (params.expectedBanners !== undefined) {
      const expectedBanners = canonicalCommunityHomeBanners(params.expectedBanners)
      await db.runTransaction(async (transaction) => {
        const community = await db.transactionGetByIdOrNull<any>(transaction, 'communities', communityId)
        if (!community) throw new Error('community not found')
        const currentBanners = canonicalCommunityHomeBanners(community.homeBanners)
        if (JSON.stringify(currentBanners) !== JSON.stringify(expectedBanners)) {
          throw new Error('Banner 配置已变化，请重新 dry-run')
        }
        await transaction.collection('communities').doc(communityId).update({ data: { homeBanners: banners } })
      })
    } else {
      await db.updateById('communities', communityId, { homeBanners: banners })
    }
    return { success: true }
  }
  if (action === 'community.hardDelete') {
    const community = await db.getById('communities', params.communityId) as Community | null
    if (!community) throw new Error('community not found')
    if (community.status !== 'disabled') {
      throw new Error('only disabled community can be hard-deleted. disable it first.')
    }
    await hardDeleteCommunity(params.communityId, community)
    return { success: true }
  }

  if (action === 'collaborationTemplate.listAdmin') {
    const templates = await db.query(
      'collaboration_templates',
      {},
      { orderBy: ['order', 'asc'] },
    ) as CollaborationTemplate[]
    return { templates: templates.map(normalizeCollaborationTemplate) }
  }
  if (action === 'collaborationTemplate.getAdmin') {
    const templateId = String(params.templateId || '').trim()
    if (!templateId) throw new Error('templateId 不能为空')
    const raw = await db.getById('collaboration_templates', templateId).catch(() => null) as CollaborationTemplate | null
    return { template: raw ? normalizeCollaborationTemplate(raw) : null }
  }
  if (action === 'collaborationTemplate.createAdmin') {
    const name = String(params.name || '').trim()
    if (!name || name.length > 40) throw new Error('模板名称应为 1 到 40 个字符')
    const existingNames = await db.query('collaboration_templates', { name }, { limit: 1 }) as CollaborationTemplate[]
    if (existingNames.length > 0) throw new Error('模板名称已存在')
    const requestedSystemKey = String(params.systemKey || '').trim()
    if (requestedSystemKey && !/^[a-z][a-z0-9_]{1,63}$/.test(requestedSystemKey)) {
      throw new Error('systemKey 格式不正确')
    }
    const systemKey = requestedSystemKey || `custom_${crypto.randomUUID().replace(/-/g, '')}`
    const existingKeys = await db.query('collaboration_templates', { systemKey }, { limit: 1 }) as CollaborationTemplate[]
    if (existingKeys.length > 0) throw new Error('systemKey 已存在')
    const now = new Date().toISOString()
    const templateId = await db.create('collaboration_templates', {
      systemKey,
      name,
      icon: String(params.icon || '').trim(),
      order: Number.isFinite(Number(params.order)) ? Number(params.order) : 0,
      status: 'active',
      enableComment: params.enableComment !== false,
      enableLike: params.enableLike !== false,
      widgets: [],
      protectedSystemKey: false,
      createdAt: now,
      updatedAt: now,
      createdByAccountId: ctx.accountId,
      updatedByAccountId: ctx.accountId,
    })
    return { templateId }
  }
  if (action === 'collaborationTemplate.updateAdmin') {
    const templateId = String(params.templateId || '').trim()
    if (!templateId) throw new Error('templateId 不能为空')
    const raw = await db.getById('collaboration_templates', templateId).catch(() => null) as CollaborationTemplate | null
    if (!raw) throw new Error('协作模板不存在')
    const current = normalizeCollaborationTemplate(raw)
    const updates: Record<string, any> = {}
    if (typeof params.name === 'string') {
      const name = params.name.trim()
      if (!name || name.length > 40) throw new Error('模板名称应为 1 到 40 个字符')
      if (name !== current.name) {
        const duplicates = await db.query('collaboration_templates', { name }, { limit: 1 }) as CollaborationTemplate[]
        if (duplicates.some((template) => template._id !== templateId)) throw new Error('模板名称已存在')
      }
      updates.name = name
    }
    if (typeof params.icon === 'string') updates.icon = params.icon.trim()
    if (Number.isFinite(Number(params.order))) updates.order = Number(params.order)
    if (typeof params.enableComment === 'boolean') updates.enableComment = params.enableComment
    if (typeof params.enableLike === 'boolean') updates.enableLike = params.enableLike

    let activePosts: any[] = []
    let unsafeChanges: string[] = []
    if (Array.isArray(params.widgets)) {
      const { v4: uuidv4 } = await import('uuid')
      const widgets = params.widgets.map((widget: any) => normalizeWidgetForSave({
        ...widget,
        widgetId: widget.widgetId || uuidv4(),
      })) as Widget[]
      validateSectionWidgets('realtime', widgets)
      unsafeChanges = findUnsafeCollaborationTemplateChanges(current.widgets || [], widgets)
      activePosts = await db.query('posts', {
        area: 'collaboration',
        collaborationTemplateId: templateId,
        status: 'active',
      }) as any[]
      const impact = {
        activePostCount: activePosts.length,
        unsafeChanges,
        requireMigration: activePosts.length > 0 && unsafeChanges.length > 0,
      }
      if (params.preview === true) return { template: current, ...impact }
      if (impact.requireMigration) {
        throw new Error('模板已有历史帖子，不兼容的控件结构变更必须通过数据迁移')
      }
      updates.widgets = widgets
    }
    if (!Array.isArray(params.widgets) && updates.name && updates.name !== current.name) {
      activePosts = await db.query('posts', {
        area: 'collaboration',
        collaborationTemplateId: templateId,
        status: 'active',
      }) as any[]
    }
    if (Object.keys(updates).length === 0) throw new Error('没有可更新字段')
    updates.updatedAt = new Date().toISOString()
    updates.updatedByAccountId = ctx.accountId
    await db.updateById('collaboration_templates', templateId, updates)
    if (activePosts.length > 0) {
      await reindexCollaborationTemplatePosts(activePosts, 'collaborationTemplate.updateAdmin')
    }
    return {
      success: true,
      activePostCount: activePosts.length,
      unsafeChanges,
      requireMigration: false,
    }
  }
  if (action === 'collaborationTemplate.disableAdmin') {
    const templateId = String(params.templateId || '').trim()
    if (!templateId) throw new Error('templateId 不能为空')
    const template = await db.getById('collaboration_templates', templateId).catch(() => null) as CollaborationTemplate | null
    if (!template) throw new Error('协作模板不存在')
    const status = params.disabled === false ? 'active' : 'disabled'
    await db.updateById('collaboration_templates', templateId, {
      status,
      updatedAt: new Date().toISOString(),
      updatedByAccountId: ctx.accountId,
    })
    return { success: true, status }
  }
  if (action === 'collaborationTemplate.deleteAdmin') {
    const templateId = String(params.templateId || '').trim()
    if (!templateId) throw new Error('templateId 不能为空')
    const template = await db.getById('collaboration_templates', templateId).catch(() => null) as CollaborationTemplate | null
    if (!template) throw new Error('协作模板不存在')
    if (template.protectedSystemKey) throw new Error('内置模板不能删除，可以停用')
    const posts = await db.query('posts', {
      area: 'collaboration',
      collaborationTemplateId: templateId,
    }, { limit: 1 }) as any[]
    if (posts.length > 0) throw new Error('该模板已有帖子，只能停用，不能删除')
    await db.removeById('collaboration_templates', templateId)
    return { success: true }
  }

  if (action === 'section.list') {
    const raw = await db.query('sections', { communityId: params.communityId }, { orderBy: ['order', 'asc'] })
    return { sections: raw.map((section: any) => normalizeSection(section)) }
  }
  if (action === 'archiveTopic.list') {
    const communityId = String(params.communityId || '').trim()
    const [community, topics] = await Promise.all([
      db.getById('communities', communityId) as Promise<Community>,
      db.query('archive_topics', { communityId }) as Promise<any[]>,
    ])
    const activeTopics = topics.filter((topic) => topic.status !== 'deleted')
    const order = Array.isArray(community?.archiveTopicOrder) ? community.archiveTopicOrder : []
    const byKey = new Map(activeTopics.map((topic) => [String(topic.topicKey), topic]))
    const ordered = order.map((key) => byKey.get(key)).filter(Boolean)
    const included = new Set(ordered.map((topic: any) => String(topic.topicKey)))
    ordered.push(...activeTopics.filter((topic) => !included.has(String(topic.topicKey))).sort((left, right) =>
      Number(left.legacyOrder ?? Number.MAX_SAFE_INTEGER) - Number(right.legacyOrder ?? Number.MAX_SAFE_INTEGER)
      || Number(left.adminOrder ?? Number.MAX_SAFE_INTEGER) - Number(right.adminOrder ?? Number.MAX_SAFE_INTEGER)
      || String(left.displayName || '').localeCompare(String(right.displayName || ''), 'zh-CN')
    ))
    return {
      topics: ordered,
      orderRevision: Number(community?.archiveTopicOrderRevision || 0),
    }
  }
  if (action === 'archiveTopic.reorder') {
    const communityId = String(params.communityId || '').trim()
    const orderedTopicKeys = Array.isArray(params.orderedTopicKeys)
      ? params.orderedTopicKeys.map((key: unknown) => normalizeArchiveTopic(key).topicKey)
      : []
    if (new Set(orderedTopicKeys).size !== orderedTopicKeys.length) throw new Error('话题顺序不能包含重复项')
    const expectedRevision = Number(params.expectedRevision)
    return db.runTransaction(async transaction => {
      const community = await db.transactionGetByIdOrNull<Community>(transaction, 'communities', communityId)
      if (!community) throw new Error('社区不存在')
      const revision = Number(community.archiveTopicOrderRevision || 0)
      if (expectedRevision !== revision) throw new Error('话题顺序已更新，请刷新后重试')
      await transaction.collection('communities').doc(communityId).update({ data: {
        archiveTopicOrder: orderedTopicKeys,
        archiveTopicOrderRevision: revision + 1,
      } })
      return { success: true, orderRevision: revision + 1 }
    })
  }
  if (action === 'archiveTopic.delete') {
    const communityId = String(params.communityId || '').trim()
    const { topicKey } = normalizeArchiveTopic(params.topicKey)
    const expectedRevision = Number(params.expectedRevision)
    const id = archiveTopicId(communityId, topicKey)
    return db.runTransaction(async transaction => {
      const community = await db.transactionGetByIdOrNull<Community>(transaction, 'communities', communityId)
      if (!community) throw new Error('社区不存在')
      const revision = Number(community.archiveTopicOrderRevision || 0)
      const existing = await db.transactionGetByIdOrNull<any>(transaction, 'archive_topics', id)
      if (!existing || existing.status === 'deleted') return { success: true, orderRevision: revision }
      if (expectedRevision !== revision) throw new Error('话题顺序已更新，请刷新后重试')
      const now = new Date().toISOString()
      const { _id: _existingId, ...existingData } = existing
      await transaction.collection('archive_topics').doc(id).set({ data: {
        ...existingData, status: 'deleted', deletedAt: now, deletedByAccountId: ctx.accountId, updatedAt: now,
      } })
      await transaction.collection('communities').doc(communityId).update({ data: {
        archiveTopicOrder: (community.archiveTopicOrder || []).filter((key) => key !== topicKey),
        archiveTopicOrderRevision: revision + 1,
      } })
      return { success: true, orderRevision: revision + 1 }
    })
  }
  if (action === 'archiveTopic.create' || action === 'archiveTopic.rename' || action === 'archiveTopic.setEnabled') {
    const communityId = String(params.communityId || '').trim()
    const normalized = normalizeArchiveTopic(params.topicKey || params.displayName)
    const id = archiveTopicId(communityId, normalized.topicKey)
    const existing = await db.getByIdOrNull<any>('archive_topics', id)
    if (action !== 'archiveTopic.create' && !existing) throw new Error('话题不存在')
    const now = new Date().toISOString()
    const displayName = action === 'archiveTopic.rename'
      ? normalizeArchiveTopic(params.displayName).displayName
      : String(existing?.displayName || normalized.displayName)
    const { _id: _existingId, deletedAt: _deletedAt, deletedByAccountId: _deletedBy, ...existingData } = existing || {}
    await db.setById('archive_topics', id, {
      ...existingData,
      communityId,
      topicKey: normalized.topicKey,
      displayName,
      origins: Array.from(new Set([...(existing?.origins || []), ...(action === 'archiveTopic.create' ? ['admin'] : [])])),
      enabled: action === 'archiveTopic.setEnabled' ? params.enabled !== false : (action === 'archiveTopic.create' ? true : existing?.enabled !== false),
      status: 'active',
      recentScore: Number(existing?.recentScore || 0),
      recentPostCount: Number(existing?.recentPostCount || 0),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      updatedByAccountId: ctx.accountId,
    })
    if (action === 'archiveTopic.create' && (!existing || existing.status === 'deleted')) {
      await db.runTransaction(async transaction => {
        const community = await db.transactionGetByIdOrNull<Community>(transaction, 'communities', communityId)
        if (!community) throw new Error('社区不存在')
        const order = (community.archiveTopicOrder || []).filter((key) => key !== normalized.topicKey)
        await transaction.collection('communities').doc(communityId).update({ data: {
          archiveTopicOrder: [...order, normalized.topicKey],
          archiveTopicOrderRevision: Number(community.archiveTopicOrderRevision || 0) + 1,
        } })
      })
    }
    return { success: true, topicKey: normalized.topicKey }
  }
  if (action === 'archiveTopic.save') {
    const communityId = String(params.communityId || '').trim()
    const normalized = normalizeArchiveTopic(params.topicKey || params.displayName)
    if (!normalized.topicKey || normalized.displayName.length > 24) throw new Error('话题名称应为 1 到 24 个字符')
    const id = archiveTopicId(communityId, normalized.topicKey)
    const existing = await db.getByIdOrNull<any>('archive_topics', id)
    const now = new Date().toISOString()
    if (params.removeAdmin === true) {
      if (!existing) return { success: true }
      const origins = (existing.origins || []).filter((origin: string) => origin !== 'admin')
      if (origins.length === 0) await db.removeById('archive_topics', id)
      else {
        const { _id: _existingId, ...existingData } = existing
        await db.setById('archive_topics', id, { ...existingData, origins, updatedAt: now })
      }
      return { success: true }
    }
    const display = normalizeArchiveTopic(params.displayName || existing?.displayName || normalized.displayName).displayName
    const origins = Array.from(new Set([...(existing?.origins || []), 'admin']))
    const { _id: _existingId, ...existingData } = existing || {}
    await db.setById('archive_topics', id, {
      ...existingData,
      communityId,
      topicKey: normalized.topicKey,
      displayName: display,
      origins,
      enabled: typeof params.enabled === 'undefined' ? existing?.enabled !== false : params.enabled !== false,
      adminOrder: Number.isFinite(Number(params.adminOrder)) ? Math.max(0, Math.floor(Number(params.adminOrder))) : Number(existing?.adminOrder || 0),
      recentScore: Number(existing?.recentScore || 0),
      recentPostCount: Number(existing?.recentPostCount || 0),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      updatedByAccountId: ctx.accountId,
    })
    return { success: true, topicKey: normalized.topicKey }
  }
  if (action === 'section.create') {
    if (params.type === 'realtime') {
      throw new Error('实时协作已改为全局协作模板，请在全局协作模板中创建')
    }
    if (typeof params.displayTemplate !== 'undefined' &&
        !['default', 'guide_note', 'text_note', 'image_note'].includes(params.displayTemplate)) {
      throw new Error('不支持的展示模板')
    }
    const type = params.type === 'realtime' ? 'realtime' : 'evergreen'
    const displayTemplate = type === 'evergreen'
      ? normalizeSectionDisplayTemplate(params.displayTemplate)
      : 'default'
    const sectionId = await db.create('sections', {
      communityId: params.communityId,
      name: params.name,
      icon: params.icon || '',
      order: params.order ?? 0,
      enableComment: params.enableComment !== false,
      enableLike: params.enableLike !== false,
      widgets: displayTemplate === 'guide_note'
        ? buildDefaultGuideNoteWidgets()
        : displayTemplate === 'image_note'
          ? buildDefaultImageNoteWidgets()
          : displayTemplate === 'text_note'
            ? buildDefaultTextNoteWidgets()
            : [],
      createdAt: new Date().toISOString(),
      type,
      status: 'active',
      displayTemplate,
      ...(params.accentColor ? { accentColor: String(params.accentColor) } : {}),
    })
    return { sectionId }
  }
  if (action === 'section.get') {
    const section = await db.getById('sections', params.sectionId).catch(() => null)
    return { section: section ? normalizeSection(section) : null }
  }
  if (action === 'section.updateMeta') {
    const sectionId = String(params.sectionId || '').trim()
    if (!sectionId) throw new Error('sectionId 不能为空')
    const updates: Record<string, any> = {}
    if (typeof params.name === 'string') updates.name = params.name
    if (typeof params.icon === 'string') updates.icon = params.icon
    if (typeof params.order === 'number') updates.order = params.order
    if (params.type === 'realtime' || params.type === 'evergreen') updates.type = params.type
    if (params.status === 'active' || params.status === 'dormant' || params.status === 'archived') updates.status = params.status
    if (typeof params.displayTemplate !== 'undefined') {
      if (!['default', 'guide_note', 'text_note', 'image_note'].includes(params.displayTemplate)) throw new Error('不支持的展示模板')
      updates.displayTemplate = params.displayTemplate
    }
    if (typeof params.accentColor === 'string') updates.accentColor = params.accentColor
    if (typeof params.enableComment === 'boolean') updates.enableComment = params.enableComment
    if (typeof params.enableLike === 'boolean') updates.enableLike = params.enableLike
    if (updates.type === 'evergreen') updates.status = 'active'
    if (Object.keys(updates).length === 0) throw new Error('没有可更新字段')
    await db.runTransaction(async transaction => {
      const sectionBefore = await db.transactionGetByIdOrNull<any>(transaction, 'sections', sectionId)
      if (!sectionBefore) throw new Error('section not found')
      if (updates.type === 'realtime' && (sectionBefore.type || 'evergreen') !== 'realtime') {
        throw new Error('沉淀板块不允许切换为 realtime')
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'displayTemplate') &&
          updates.displayTemplate !== normalizeSectionDisplayTemplate(sectionBefore.displayTemplate)) {
        throw new Error('已创建板块不允许切换展示模板')
      }
      await transaction.collection('sections').doc(sectionId).update({ data: updates })
    })
    await schedulePostRagSyncForSection(sectionId, 'section.updateMeta')
    await backfillPostSearchIndexesForSection(sectionId)
    return { success: true }
  }
  if (action === 'section.updateStatus') {
    const sectionId = String(params.sectionId || '').trim()
    if (!sectionId) throw new Error('sectionId 不能为空')
    if (!['active', 'dormant', 'archived'].includes(params.status)) {
      throw new Error('status 必须是 active/dormant/archived')
    }
    const section = await db.getById('sections', sectionId)
    if (!section) throw new Error('section not found')
    if ((section.type || 'evergreen') === 'evergreen' && params.status !== 'active') {
      throw new Error('evergreen 板块只能保持 active')
    }
    await db.runTransaction(async transaction => {
      await transaction.collection('sections').doc(sectionId).update({ data: { status: params.status } })
    })
    await schedulePostRagSyncForSection(sectionId, 'section.updateStatus')
    await backfillPostSearchIndexesForSection(sectionId)
    return { success: true }
  }
  if (action === 'section.updateWidgets') {
    const { v4: uuidv4 } = await import('uuid')
    const sectionId = String(params.sectionId || '').trim()
    if (!sectionId) throw new Error('sectionId 不能为空')

    const currentSection = normalizeSection(await db.getById('sections', sectionId))
    let widgets = (params.widgets || []).map((widget: any) => normalizeWidgetForSave({
      ...widget,
      widgetId: widget.widgetId || uuidv4(),
    }))
    assertTextNoteLockedWidgets(currentSection, widgets)
    widgets = applyTextNoteLockedFlags(currentSection, widgets)
    assertTemplateLockedWidgets(currentSection, widgets)
    widgets = applyTemplateLockedFlags(currentSection, widgets)
    validateSectionWidgets(currentSection.type, widgets)

    const currentWidgets = currentSection.widgets || []
    const nextIds = new Set(widgets.map((widget: any) => String(widget.widgetId || '')))
    const removedWidgets = currentWidgets.filter((widget: any) => !nextIds.has(String(widget.widgetId || '')))
    const currentById = new Map<string, any>(currentWidgets.map((widget: any) => [String(widget.widgetId || ''), widget]))
    const changedTypeWidgets = widgets.filter((widget: any) => {
      const current = currentById.get(String(widget.widgetId || ''))
      return current && current.type !== widget.type
    })
    const changedIndexMetadataWidgets = widgets.filter((widget: any) => {
      const current = currentById.get(String(widget.widgetId || ''))
      return current && (
        current.label !== widget.label ||
        current.fieldKey !== widget.fieldKey ||
        current.order !== widget.order
      )
    })
    const hasStructuralChanges =
      removedWidgets.length > 0 ||
      changedTypeWidgets.length > 0
    const shouldReindexExistingPosts = hasStructuralChanges || changedIndexMetadataWidgets.length > 0
    const activePosts = shouldReindexExistingPosts ? await db.query('posts', { sectionId, status: 'active' }) : []
    const hasActivePosts = activePosts.length > 0
    const impact = {
      hasActivePosts,
      activePostCount: activePosts.length,
      structuralChanges: {
        removedWidgetIds: removedWidgets.map((widget: any) => widget.widgetId),
        removedLabels: removedWidgets.map((widget: any) => widget.label || widget.fieldKey || widget.widgetId),
        changedTypeWidgetIds: changedTypeWidgets.map((widget: any) => widget.widgetId),
        changedTypeLabels: changedTypeWidgets.map((widget: any) => widget.label || widget.fieldKey || widget.widgetId),
      },
    }

    if (params.preview) {
      return { widgets, ...impact, requireConfirmation: hasActivePosts && hasStructuralChanges }
    }
    if (hasActivePosts && hasStructuralChanges && !params.confirmStructureChange) {
      throw new Error('板块已有内容，本次结构变更需要确认')
    }

    await db.runTransaction(async transaction => {
      await transaction.collection('sections').doc(sectionId).update({ data: { widgets } })
    })
    if (shouldReindexExistingPosts) {
      await schedulePostRagSyncForSection(sectionId, 'section.updateWidgets', activePosts)
    }
    await backfillPostSearchIndexesForSection(sectionId)
    return { widgets, ...impact, requireConfirmation: false }
  }
  if (action === 'section.delete') {
    const sectionId = String(params.sectionId || '').trim()
    if (!sectionId) throw new Error('sectionId 不能为空')

    const activePosts = await db.query('posts', { sectionId, status: 'active' }, { limit: 1 })
    if (activePosts.length > 0) {
      throw new Error('该板块下已有帖子，暂不支持删除')
    }

    await db.removeById('sections', sectionId)
    await removePostSearchIndexesForSection(sectionId)
    return { success: true }
  }

  if (action === 'member.pendingList') {
    const communityId = String(params.communityId || '').trim()
    if (!communityId) throw new Error('communityId 不能为空')
    const members = await db.query('community_members', { communityId, status: 'pending' })
    return { members }
  }
  if (action === 'member.list') {
    const communityId = String(params.communityId || '').trim()
    if (!communityId) throw new Error('communityId 不能为空')
    const keyword = normalizeKeyword(params.q)
    const statusFilter = String(params.status || 'all').trim()
    const visibleStatuses = new Set(['pending', 'active', 'rejected'])
    const community = await db.getById('communities', communityId) as Community
    const members = await db.query('community_members', { communityId }, { orderBy: ['appliedAt', 'desc'] })

    const legacyLeftMembers = members.filter((member: any) => String(member.status || '').trim() === 'left')
    if (legacyLeftMembers.length > 0) {
      await Promise.all(
        legacyLeftMembers
          .map((member: any) => String(member._id || '').trim())
          .filter(Boolean)
          .map((memberId: string) => db.removeById('community_members', memberId))
      )
    }

    const activeMembers = members.filter((member: any) => String(member.status || '').trim() !== 'left')
    const usersById = await getUsersByIds(activeMembers.map((member: any) => String(member.userId || '')))

    const list = activeMembers
      .map((member: any) => ({
        ...member,
        nickName: normalizeMemberNickName(member.userId, usersById[member.userId]?.nickName),
        avatarUrl: usersById[member.userId]?.avatarUrl || '',
        isCreator: member.userId === community.creatorId,
      }))
      .filter((member: any) => {
        if (!visibleStatuses.has(String(member.status || '').trim())) return false
        if (statusFilter !== 'all' && member.status !== statusFilter) return false
        return includesKeyword(member.userId, member.nickName)(keyword)
      })

    return { members: list, communityCreatorId: community.creatorId }
  }
  if (action === 'member.kick') {
    const communityId = String(params.communityId || '').trim()
    const memberId = String(params.memberId || '').trim()
    if (!communityId) throw new Error('communityId 不能为空')
    if (!memberId) throw new Error('memberId 不能为空')

    return kickMembership({ communityId, memberId })
  }
  if (action === 'member.approve') {
    return approveMembership({ communityId: params.communityId, memberId: params.memberId })
  }
  if (action === 'member.reject') {
    return rejectMembership({ communityId: params.communityId, memberId: params.memberId })
  }

  if (action === 'post.listAdmin') {
    const communityId = String(params.communityId || '').trim()
    if (!communityId) throw new Error('communityId 不能为空')
    const sectionId = String(params.sectionId || '').trim()
    const collaborationTemplateId = String(params.collaborationTemplateId || '').trim()
    const areaFilter = String(params.area || 'all').trim()
    const authorKeyword = normalizeKeyword(params.authorQuery)
    const statusFilter = String(params.status || 'active').trim()
    const auditStatusFilter = String(params.auditStatus || 'all').trim()
    const pinnedFilter = parseOptionalBoolean(params.pinned)
    const featuredFilter = parseOptionalBoolean(params.featured)
    const fromTimestamp = parseDateBoundary(String(params.dateFrom || '').trim())
    const toTimestamp = parseDateBoundary(String(params.dateTo || '').trim(), true)

    let posts = await db.query('posts', { communityId }, { orderBy: ['createdAt', 'desc'] })
    if (sectionId) posts = posts.filter((post: any) => post.sectionId === sectionId)
    if (collaborationTemplateId) {
      posts = posts.filter((post: any) =>
        post.area === 'collaboration' && post.collaborationTemplateId === collaborationTemplateId
      )
    }
    if (areaFilter === 'collaboration') posts = posts.filter((post: any) => post.area === 'collaboration')
    if (areaFilter === 'archive') posts = posts.filter((post: any) => post.area === 'archive')
    if (areaFilter === 'legacy') posts = posts.filter((post: any) => !post.area)
    if (statusFilter !== 'all') posts = posts.filter((post: any) => post.status === statusFilter)
    if (auditStatusFilter !== 'all') {
      posts = posts.filter((post: any) => (post.auditStatus || 'pass') === auditStatusFilter || post.pendingAuditStatus === auditStatusFilter)
    }
    if (pinnedFilter !== null) posts = posts.filter((post: any) => Boolean(post.isPinned) === pinnedFilter)
    if (featuredFilter !== null) posts = posts.filter((post: any) => Boolean(post.isFeatured) === featuredFilter)
    if (fromTimestamp !== null) {
      posts = posts.filter((post: any) => Date.parse(String(post.createdAt || '')) >= fromTimestamp)
    }
    if (toTimestamp !== null) {
      posts = posts.filter((post: any) => Date.parse(String(post.createdAt || '')) <= toTimestamp)
    }

    const usersById = await getUsersByIds(posts.map((post: any) => String(post.authorId || '')))
    const sectionsById = await getSectionsByIds(posts.map((post: any) => String(post.sectionId || '')))
    const templatesById = await getCollaborationTemplatesByIds(
      posts.map((post: any) => String(post.collaborationTemplateId || '')),
    )

    const list = await Promise.all(posts.map(async (post: any) => {
      const author = usersById[post.authorId]
      const template = post.area === 'collaboration'
        ? templatesById[String(post.collaborationTemplateId || '')]
        : null
      const section = template
        ? collaborationTemplateAsSection(template, String(post.communityId || ''))
        : post.area === 'archive'
          ? buildAdminArchiveContentSection(String(post.communityId || ''), post.format)
          : sectionsById[post.sectionId]
      return {
        ...post,
        authorNickname: resolvePostAuthorNickname(post, author?.nickName, { audience: 'admin' }),
        authorAvatarUrl: resolveAuthorAvatarUrl(author?.avatarUrl, post._id || post.authorId || ''),
        sectionName: section?.name || '',
        sectionType: section?.type || '',
        isVisibleToMembers: isPostVisibleToMembers(post),
        attendanceSummaryByWidget: section ? await buildAttendanceSummaryByWidget(post, section) : {},
      }
    }))

    const filtered = list.filter((post: any) => includesKeyword(post.authorId, post.authorNickname)(authorKeyword))
    return { posts: filtered, total: filtered.length }
  }
  if (action === 'post.getAdmin') {
    const postId = String(params.postId || '').trim()
    if (!postId) throw new Error('postId 不能为空')
    const post = await db.getById('posts', postId) as any
    const [author, contract] = await Promise.all([
      post.authorId ? db.getById('users', post.authorId).catch(() => null) : null,
      resolveAdminPostContentContract(post),
    ])
    const normalizedSection = contract.section
    const auditTasks = postId ? await db.query(AUDIT_TASKS, { postId }, { orderBy: ['createdAt', 'desc'] }).catch(() => []) : []
    const attendanceSummaryByWidget = normalizedSection ? await buildAttendanceSummaryByWidget(post, normalizedSection) : {}
    const attendanceMembersByWidget = normalizedSection
      ? Object.fromEntries(
          await Promise.all(
            ((normalizedSection.widgets || []).filter((widget: any) => widget.type === 'attendance')).map(async (widget: any) => ([
              widget.widgetId,
              await listAttendanceMembersForAdmin(post._id, widget.widgetId),
            ]))
          )
        )
      : {}
    return {
      post: {
        ...post,
        content: archiveContentForAdmin(post),
        authorNickname: resolvePostAuthorNickname(post, (author as any)?.nickName, { audience: 'admin' }),
        authorAvatarUrl: resolveAuthorAvatarUrl((author as any)?.avatarUrl, post._id || post.authorId || ''),
        attendanceSummaryByWidget,
      },
      section: normalizedSection,
      collaborationTemplate: contract.collaborationTemplate,
      attendanceMembersByWidget,
      auditTasks,
    }
  }
  if (action === 'post.deleteAdmin') {
    const postId = String(params.postId || '').trim()
    if (!postId) throw new Error('postId 不能为空')
    const post = await db.getById('posts', postId) as any
    if (!post) throw new Error('post not found')
    if (post.status === 'deleted') {
      await schedulePostRagSync({
        postId,
        communityId: post.communityId,
        sectionId: post.sectionId,
        reason: 'post.deleteAdmin.alreadyDeleted',
      })
      await removePostSearchIndex(postId)
      return { success: true, alreadyDeleted: true }
    }
    await db.runTransaction(async transaction => {
      await transaction.collection('posts').doc(postId).update({ data: {
        status: 'deleted', isPinned: false, pinnedAt: '', pinnedByAccountId: '',
        isFeatured: false, featuredAt: '', featuredByAccountId: '',
      } })
      await schedulePostRagSyncInTransaction(transaction, { postId, communityId: String(post.communityId || ''), sectionId: String(post.sectionId || ''), reason: 'post.deleted', now: new Date().toISOString() })
    })
    await removePostSearchIndex(postId)
    return { success: true }
  }
  if (action === 'post.rebuildSearchIndexAdmin') {
    const communityId = String(params.communityId || '').trim()
    if (!communityId) throw new Error('communityId 不能为空')
    return backfillPostSearchIndexesForCommunity(communityId)
  }
  if (action === 'post.rebuildSearchIndexSectionAdmin') {
    const sectionId = String(params.sectionId || '').trim()
    if (!sectionId) throw new Error('sectionId 不能为空')
    return backfillPostSearchIndexesForSection(sectionId)
  }
  if (action === 'post.rebuildSearchIndexSectionBatchAdmin') {
    const sectionId = String(params.sectionId || '').trim()
    if (!sectionId) throw new Error('sectionId 不能为空')
    return backfillPostSearchIndexesForSectionBatch(sectionId, {
      skip: params.skip,
      limit: params.limit,
    })
  }
  if (action === 'post.ragCommunityPageAdmin') {
    const afterId = String(params.afterId || '').trim() || null
    const limit = Math.max(1, Math.min(100, Math.floor(Number(params.limit || 100))))
    const items = await db.queryAfterId('communities', {}, afterId, limit) as any[]
    const sanitized = items.map((community) => ({
      communityId: String(community._id || ''),
      status: String(community.status || ''),
      ragIndexPolicy: ['business', 'validation', 'excluded'].includes(community.ragIndexPolicy) ? community.ragIndexPolicy : 'unclassified',
      fixtureOwned: Boolean(community.fixtureKey),
    }))
    return { items: sanitized, hasMore: items.length === limit, nextAfterId: items.length === limit ? String(items[items.length - 1]._id || '') : null }
  }
  if (action === 'post.ragClassifyCommunityAdmin') {
    const communityId = String(params.communityId || '').trim()
    const policy = String(params.policy || '')
    if (!communityId) throw new Error('communityId 不能为空')
    if (!['business', 'validation', 'excluded'].includes(policy)) throw new Error('invalid RAG index policy')
    const community = await db.getById('communities', communityId) as any
    if (!community) throw new Error('community not found')
    if (community.fixtureKey && policy !== 'excluded') throw new Error('fixture community must remain excluded')
    await db.updateById('communities', communityId, { ragIndexPolicy: policy })
    const scheduled = await schedulePostRagSyncForCurrentPosts({ communityId, reason: 'community.rag_policy_changed' })
    return { success: true, communityId, policy, ...scheduled }
  }
  if (action === 'post.ragReconcileCurrentAdmin') {
    const communityId = String(params.communityId || '').trim()
    if (!communityId) throw new Error('communityId 不能为空')
    return { communityId, ...(await schedulePostRagSyncForCurrentPosts({ communityId, reason: 'rag.current_state_reconcile' })) }
  }
  if (action === 'post.ragCurrentHealthAdmin') {
    const communityId = String(params.communityId || '').trim()
    if (!communityId) throw new Error('communityId 不能为空')
    const [pending, processing, retryWait, synced, deadLetter, indexed] = await Promise.all([
      db.count('post_rag_sync_state', { communityId, status: 'pending' }),
      db.count('post_rag_sync_state', { communityId, status: 'processing' }),
      db.count('post_rag_sync_state', { communityId, status: 'retry_wait' }),
      db.count('post_rag_sync_state', { communityId, status: 'synced' }),
      db.count('post_rag_sync_state', { communityId, status: 'dead_letter' }),
      db.count('post_rag_index_state', { communityId, status: 'indexed' }),
    ])
    return { communityId, pending, processing, retryWait, synced, deadLetter, indexed }
  }
  if (action === 'post.pinAdmin' || action === 'post.unpinAdmin' || action === 'post.featureAdmin' || action === 'post.unfeatureAdmin') {
    const postId = String(params.postId || '').trim()
    if (!postId) throw new Error('postId 不能为空')
    const post = await db.getById('posts', postId) as any
    if (!post) throw new Error('post not found')
    if (post.status === 'deleted') throw new Error('已删除帖子不能置顶或加精')

    const now = new Date().toISOString()
    if (action === 'post.pinAdmin') {
      await db.updateById('posts', postId, {
        isPinned: true,
        pinnedAt: now,
        pinnedByAccountId: ctx.accountId,
      })
      return { success: true, isPinned: true, pinnedAt: now }
    }
    if (action === 'post.unpinAdmin') {
      await db.updateById('posts', postId, {
        isPinned: false,
        pinnedAt: '',
        pinnedByAccountId: '',
      })
      return { success: true, isPinned: false }
    }
    if (action === 'post.featureAdmin') {
      await db.updateById('posts', postId, {
        isFeatured: true,
        featuredAt: now,
        featuredByAccountId: ctx.accountId,
      })
      return { success: true, isFeatured: true, featuredAt: now }
    }
    await db.updateById('posts', postId, {
      isFeatured: false,
      featuredAt: '',
      featuredByAccountId: '',
    })
    return { success: true, isFeatured: false }
  }
  if (action === 'post.updateAdmin') {
    const postId = String(params.postId || '').trim()
    if (!postId) throw new Error('postId 不能为空')
    const post = await db.getById('posts', postId) as any
    if (!post) throw new Error('post not found')
    if (post.status === 'deleted') throw new Error('post is deleted')

    const { section } = await resolveAdminPostContentContract(post)
    if (!section || !Array.isArray(section.widgets) || section.widgets.length === 0) {
      throw new Error('该板块尚未配置内容模板，无法编辑')
    }

    const mergedAdminContent = mergeAdminPostContent(archiveContentForAdmin(post), params.content || {}, section)
    const archive = post.area === 'archive'
      ? parseArchivePostCreateInput({
          area: 'archive',
          format: resolveArchivePostFormat(post.format),
          topics: mergedAdminContent.topics,
          content: Object.fromEntries(Object.entries(mergedAdminContent).filter(([key]) => key !== 'topics')),
          ...(resolveArchivePostFormat(post.format) === 'text'
            ? { presentation: post.presentation }
            : {}),
        })
      : null
    const merged = (archive ? archive.content : mergedAdminContent) as Record<string, any>
    const adminEditableIds = getAdminPostEditableWidgetIds(section)
    const adminValidationSection = {
      ...section,
      widgets: (section.widgets || []).filter((widget: any) => adminEditableIds.has(String(widget.widgetId || ''))),
    } as Section
    validateRequiredWidgets(adminValidationSection, merged, { allowAdminOnly: true })
    validateContentValues(section, merged, { allowAdminOnly: true })

    const updatedAt = new Date().toISOString()
    if (post.auditStatus === 'pass' || !post.auditStatus) {
      await db.runTransaction(async transaction => {
        await transaction.collection('posts').doc(postId).update({ data: {
          pendingContent: db.replaceValue(merged), pendingAuditStatus: 'pending', pendingAuditReason: 'content audit pending',
          ...(archive ? { pendingTopics: db.replaceValue(archive.topics) } : {}),
          pendingSubmittedAt: updatedAt, updatedAt, adminEditedAt: updatedAt,
          adminEditedByAccountId: ctx.accountId, adminEditedByUsername: ctx.username,
        } })
        await schedulePostRagSyncInTransaction(transaction, { postId, communityId: post.communityId, sectionId: post.sectionId || '', reason: 'post.updated', now: updatedAt })
      })
      const audit = await auditAndApply({
        postId,
        communityId: post.communityId,
        sectionId: post.area === 'collaboration' ? '' : post.sectionId,
        section,
        content: merged,
        authorId: ctx.userId,
        source: 'admin',
        contentSlot: 'pendingContent',
        postSnapshot: {
          ...post,
          pendingContent: merged,
          ...(archive ? { pendingTopics: archive.topics } : {}),
        } as any,
      })
      return { success: true, updatedAt, adminEditedAt: updatedAt, auditStatus: audit.status, auditReason: audit.reason }
    }

    await db.runTransaction(async transaction => {
      await transaction.collection('posts').doc(postId).update({ data: {
        content: db.replaceValue(merged), auditStatus: 'pending', auditReason: 'content audit pending',
        auditUpdatedAt: updatedAt, updatedAt, adminEditedAt: updatedAt,
        adminEditedByAccountId: ctx.accountId, adminEditedByUsername: ctx.username,
      } })
      await schedulePostRagSyncInTransaction(transaction, { postId, communityId: post.communityId, sectionId: post.sectionId || '', reason: 'post.updated', now: updatedAt })
    })
    const audit = await auditAndApply({
      postId,
      communityId: post.communityId,
      sectionId: post.area === 'collaboration' ? '' : post.sectionId,
      section,
      content: merged,
      authorId: ctx.userId,
      source: 'admin',
      contentSlot: 'content',
      postSnapshot: { ...post, content: merged } as any,
    })
    if (archive && audit.status === 'pass') {
      await db.updateById('posts', postId, { topics: db.replaceValue(archive.topics) })
      await updateArchivePostTopicLinks(postId, { status: 'deleted' })
      await syncArchivePostTopics({
        _id: postId,
        communityId: String(post.communityId || ''),
        topics: archive.topics,
        createdAt: String(post.createdAt || updatedAt),
        status: String(post.status || 'active'),
        auditStatus: 'pass',
      })
    }
    return { success: true, updatedAt, adminEditedAt: updatedAt, auditStatus: audit.status, auditReason: audit.reason }
  }
  if (action === 'post.removeAttendanceMemberAdmin') {
    const postId = String(params.postId || '').trim()
    const widgetId = String(params.widgetId || '').trim()
    const userId = String(params.userId || '').trim()
    if (!postId || !widgetId || !userId) throw new Error('postId/widgetId/userId 不能为空')
    const existing = await db.query(ATTENDANCE_COLLECTION, { postId, widgetId, userId }, { limit: 1 })
    if (existing[0]?._id) {
      await db.removeById(ATTENDANCE_COLLECTION, existing[0]._id)
    }
    const members = await listAttendanceMembersForAdmin(postId, widgetId)
    return { success: true, members, total: members.length }
  }

  if (action === 'audit.listAdmin') {
    const auditStatus = String(params.auditStatus || 'actionable').trim()
    const communityId = String(params.communityId || '').trim()
    let posts = await db.query('posts', communityId ? { communityId } : {}, { orderBy: ['updatedAt', 'desc'] }) as any[]
    if (auditStatus === 'actionable') {
      posts = posts.filter((post: any) =>
        ['pending', 'review'].includes(String(post.auditStatus || '')) ||
        ['pending', 'review'].includes(String(post.pendingAuditStatus || ''))
      )
    } else if (auditStatus !== 'all') {
      posts = posts.filter((post: any) => (post.auditStatus || 'pass') === auditStatus || post.pendingAuditStatus === auditStatus)
    }
    const usersById = await getUsersByIds(posts.map((post: any) => String(post.authorId || '')))
    const sectionsById = await getSectionsByIds(posts.map((post: any) => String(post.sectionId || '')))
    const templatesById = await getCollaborationTemplatesByIds(
      posts.map((post: any) => String(post.collaborationTemplateId || '')),
    )
    const rows = posts.map((post: any) => ({
      ...post,
      authorNickname: usersById[post.authorId]?.nickName || '',
      authorAvatarUrl: resolveAuthorAvatarUrl(usersById[post.authorId]?.avatarUrl, post._id || post.authorId || ''),
      sectionName: post.area === 'collaboration'
        ? templatesById[String(post.collaborationTemplateId || '')]?.name || ''
        : sectionsById[post.sectionId]?.name || '',
      sectionType: post.area === 'collaboration'
        ? 'realtime'
        : sectionsById[post.sectionId]?.type || '',
      isVisibleToMembers: isPostVisibleToMembers(post),
    }))
    return { posts: rows, total: rows.length }
  }

  if (action === 'audit.getAdmin') {
    const postId = String(params.postId || '').trim()
    if (!postId) throw new Error('postId cannot be empty')
    const post = await db.getById('posts', postId) as any
    if (!post) throw new Error('post not found')
    const [author, contract, auditTasks] = await Promise.all([
      post.authorId ? db.getById('users', post.authorId).catch(() => null) : null,
      resolveAdminPostContentContract(post),
      db.query(AUDIT_TASKS, { postId }, { orderBy: ['createdAt', 'desc'] }).catch(() => []),
    ])
    return {
      post: {
        ...post,
        authorNickname: (author as any)?.nickName || '',
        authorAvatarUrl: resolveAuthorAvatarUrl((author as any)?.avatarUrl, post._id || post.authorId || ''),
        isVisibleToMembers: isPostVisibleToMembers(post),
      },
      section: contract.section,
      collaborationTemplate: contract.collaborationTemplate,
      auditTasks,
    }
  }

  if (action === 'audit.approveAdmin') {
    const postId = String(params.postId || '').trim()
    if (!postId) throw new Error('postId cannot be empty')
    return approvePostAudit(postId)
  }

  if (action === 'audit.rejectAdmin') {
    const postId = String(params.postId || '').trim()
    if (!postId) throw new Error('postId cannot be empty')
    return rejectPostAudit(postId, String(params.reason || '').trim())
  }

  if (action === 'audit.retryAdmin') {
    const postId = String(params.postId || '').trim()
    if (!postId) throw new Error('postId cannot be empty')
    const post = await db.getById('posts', postId) as any
    if (!post) throw new Error('post not found')
    const { section } = await resolveAdminPostContentContract(post)
    if (!section) throw new Error('section not found')
    const slot = post.pendingContent ? 'pendingContent' : 'content'
    const oldTasks = await db.query(AUDIT_TASKS, { postId, contentSlot: slot }).catch(() => []) as any[]
    await Promise.all(oldTasks.map((task) => task._id ? db.removeById(AUDIT_TASKS, task._id).catch(() => null) : null))
    const audit = await auditAndApply({
      postId,
      communityId: post.communityId,
      sectionId: post.area === 'collaboration' ? '' : post.sectionId,
      section,
      content: slot === 'pendingContent' ? post.pendingContent : post.content,
      authorId: post.authorId,
      source: post.adminEditedByAccountId ? 'admin' : 'user',
      contentSlot: slot,
    })
    return { success: true, auditStatus: audit.status, auditReason: audit.reason }
  }

  if (action === 'admin.listAccounts') {
    const accounts = (await db.query(ADMIN_ACCOUNTS, {}, { orderBy: ['createdAt', 'desc'] })) as AdminAccount[]
    const enriched = await Promise.all(accounts.map(async (a) => {
      const creatorCommunities = await listCreatorCommunities(a.userId || '')
      return {
        _id: a._id,
        username: a.username,
        role: a.role,
        status: a.status,
        userId: a.userId || '',
        createdAt: a.createdAt,
        createdBy: a.createdBy || '',
        creatorCommunityCount: creatorCommunities.length,
        creatorCommunityNames: creatorCommunities.map((c: any) => c.name || c._id).filter(Boolean),
      }
    }))
    return {
      accounts: enriched,
    }
  }
  if (action === 'admin.createAccount') {
    const username = String(params.username || '').trim()
    const password = String(params.password || '')
    const role: AdminRole = params.role === 'superAdmin' ? 'superAdmin' : 'communityAdmin'
    const userId = String(params.userId || '').trim()
    if (!username) throw new Error('username 不能为空')
    if (password.length < 6) throw new Error('密码至少 6 位')

    const existing = await findAccountByUsername(username)
    if (existing) throw new Error('用户名已存在')

    const salt = generateSalt()
    const hash = hashPassword(password, salt)
    const now = new Date().toISOString()
    const accountId = await db.create(ADMIN_ACCOUNTS, {
      username,
      passwordHash: hash,
      passwordSalt: salt,
      userId,
      role,
      status: 'active',
      createdAt: now,
      createdBy: ctx.accountId,
    })
    if (userId) {
      await syncMiniProgramUserRoleForAdminAccount(userId, role, { nickName: username })
    }
    return { accountId }
  }
  if (action === 'admin.resetPassword') {
    const accountId = String(params.accountId || '').trim()
    const password = String(params.password || '')
    if (!accountId) throw new Error('accountId 不能为空')
    if (password.length < 6) throw new Error('密码至少 6 位')
    const salt = generateSalt()
    const hash = hashPassword(password, salt)
    await db.updateById(ADMIN_ACCOUNTS, accountId, { passwordHash: hash, passwordSalt: salt })
    // 重置密码后踢下线所有已有 session
    const sessions = (await db.query(ADMIN_SESSIONS, { accountId })) as AdminSession[]
    await Promise.all(sessions.map((s) => db.removeById(ADMIN_SESSIONS, s._id).catch(() => null)))
    return { success: true, revokedSessions: sessions.length }
  }
  if (action === 'admin.deleteAccount') {
    const accountId = String(params.accountId || '').trim()
    if (!accountId) throw new Error('accountId 不能为空')
    if (accountId === ctx.accountId) throw new Error('不能删除自己的账号')
    const account = (await db.getById(ADMIN_ACCOUNTS, accountId)) as AdminAccount
    const creatorCommunities = await listCreatorCommunities(account.userId || '')
    if (creatorCommunities.length > 0) {
      const names = creatorCommunities.map((c: any) => c.name || c._id).filter(Boolean).join('、')
      throw new Error(`该账号是未删除社区的创建者管理员账号，不能删除${names ? `：${names}` : ''}`)
    }
    const sessions = (await db.query(ADMIN_SESSIONS, { accountId })) as AdminSession[]
    await Promise.all(sessions.map((s) => db.removeById(ADMIN_SESSIONS, s._id).catch(() => null)))
    await db.removeById(ADMIN_ACCOUNTS, accountId)
    return { success: true, revokedSessions: sessions.length }
  }
  if (action === 'admin.bindWechat') {
    const accountId = String(params.accountId || '').trim()
    const openId = String(params.openId || '').trim()
    if (!accountId || !openId) throw new Error('accountId 和 openId 不能为空')
    const existing = await findAccountByUserId(openId)
    if (existing && existing._id !== accountId) {
      throw new Error('该微信身份已绑定到其他账号')
    }
    const account = await db.getById(ADMIN_ACCOUNTS, accountId) as AdminAccount | null
    if (!account) throw new Error('账号不存在')
    if (account.status !== 'active') throw new Error('该管理员账号已停用')
    await db.updateById(ADMIN_ACCOUNTS, accountId, { userId: openId })
    await db.updateWhere(ADMIN_SESSIONS, { accountId }, { userId: openId })
    await syncMiniProgramUserRoleForAdminAccount(openId, account.role, { nickName: account.username })
    return { success: true }
  }

  if (action === 'video.requestUpload') {
    const fileName = String(params.fileName || '').trim()
    if (!fileName) throw new Error('fileName 不能为空')
    const match = fileName.match(/\.([a-zA-Z0-9]+)$/)
    const ext = match ? match[1].toLowerCase() : ''
    const VIDEO_EXTS = new Set(['mp4', 'mov', 'm4v', 'webm'])
    const COVER_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp'])
    let sub: 'videos' | 'covers'
    if (VIDEO_EXTS.has(ext)) sub = 'videos'
    else if (COVER_EXTS.has(ext)) sub = 'covers'
    else throw new Error('不支持的文件类型')
    const rand = Math.random().toString(36).slice(2, 8)
    const cloudPath = `posts/${sub}/${Date.now()}_${rand}.${ext}`
    return await storage.requestUploadMetadata(cloudPath)
  }

  if (action === 'audio.requestUpload') {
    const fileName = String(params.fileName || '').trim()
    if (!fileName) throw new Error('fileName 不能为空')
    const match = fileName.match(/\.([a-zA-Z0-9]+)$/)
    const ext = match ? match[1].toLowerCase() : ''
    if (!AUDIO_ALLOWED_EXTS.includes(ext as any)) throw new Error('不支持的文件类型')
    const rand = Math.random().toString(36).slice(2, 8)
    const cloudPath = `posts/audios/${Date.now()}_${rand}.${ext}`
    return await storage.requestUploadMetadata(cloudPath)
  }

  if (action === 'image.requestUpload') {
    const fileName = String(params.fileName || '').trim()
    if (!fileName) throw new Error('fileName 不能为空')
    const match = fileName.match(/\.([a-zA-Z0-9]+)$/)
    const ext = match ? match[1].toLowerCase() : ''
    const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])
    if (!IMAGE_EXTS.has(ext)) throw new Error('不支持的文件类型')
    const rand = Math.random().toString(36).slice(2, 8)
    const cloudPath = `posts/images/${Date.now()}_${rand}.${ext}`
    return await storage.requestUploadMetadata(cloudPath)
  }

  if (action === 'media.getUrls') {
    const fileIDs = Array.isArray(params.fileIDs)
      ? Array.from(new Set(params.fileIDs.map((item: unknown) => String(item || '').trim()).filter((item: string) => item.startsWith('cloud://'))))
      : []
    const entries = await Promise.all(fileIDs.map(async (fileID) => {
      try {
        return [fileID, await storage.getTempUrl(fileID)] as const
      } catch {
        return [fileID, ''] as const
      }
    }))
    return { urls: Object.fromEntries(entries) }
  }

  if (action === 'post.createAdmin') {
    const communityId = String(params.communityId || '').trim()
    const sectionId = String(params.sectionId || '').trim()
    if (!communityId) throw new Error('communityId 不能为空')
    if (!ctx.userId) {
      throw new Error('当前管理员未绑定微信身份，请先在账号管理中绑定 openId')
    }
    const area = String(params.area || '').trim()
    let section: Section | null = null
    let content: Record<string, any> = {}
    let postIdentity: Record<string, any> = {}
    let archive: ReturnType<typeof parseArchivePostCreateInput> | null = null

    if (area === 'archive') {
      archive = parseArchivePostCreateInput(params)
      section = buildAdminArchiveContentSection(communityId, archive.format)
      content = archive.content as Record<string, any>
      postIdentity = {
        area: 'archive',
        origin: 'native_archive',
        format: archive.format,
        topics: archive.topics,
        ...(archive.format === 'text' ? { presentation: archive.presentation } : {}),
      }
    } else if (area === 'collaboration') {
      const templateId = String(params.collaborationTemplateId || '').trim()
      if (!templateId) throw new Error('collaborationTemplateId 不能为空')
      const rawTemplate = await db.getById('collaboration_templates', templateId).catch(() => null) as CollaborationTemplate | null
      if (!rawTemplate) throw new Error('实时协作模板不存在')
      const template = normalizeCollaborationTemplate(rawTemplate)
      if (template.status !== 'active') throw new Error('实时协作模板已停用')
      section = collaborationTemplateAsSection(template, communityId)
      content = sanitizeContent(params.content || {}, section, { allowAdminOnly: true })
      postIdentity = {
        area: 'collaboration',
        collaborationTemplateId: template._id,
        collaborationSystemKey: template.systemKey,
      }
    } else {
      if (!sectionId) throw new Error('sectionId 不能为空')
      const rawSection = await db.getById('sections', sectionId) as Section | null
      section = rawSection ? normalizeSection(rawSection) as Section : null
      if (!section) throw new Error('板块不存在')
      if (section.communityId !== communityId) throw new Error('板块不属于当前社区')
      content = sanitizeContent(params.content || {}, section, { allowAdminOnly: true })
      postIdentity = { sectionId }
    }

    if (!Array.isArray(section.widgets) || section.widgets.length === 0) {
      throw new Error('该板块尚未配置内容模板')
    }
    validateRequiredWidgets(section, content, { allowAdminOnly: true })
    validateContentValues(section, content, { allowAdminOnly: true })
    const now = new Date().toISOString()
    const postData = {
      communityId,
      ...postIdentity,
      authorId: ctx.userId,
      status: 'active',
      auditStatus: 'pending',
      auditReason: 'content audit pending',
      auditUpdatedAt: now,
      content,
      commentCount: 0,
      likeCount: 0,
      isPinned: false,
      isFeatured: false,
      adminCreatedAt: now,
      adminCreatedByAccountId: ctx.accountId,
      adminCreatedByUsername: ctx.username,
      createdAt: now,
      updatedAt: now,
    }
    const postId = await db.runTransaction(async transaction => {
      const created = await transaction.collection('posts').add({ data: postData })
      await schedulePostRagSyncInTransaction(transaction, { postId: created._id, communityId, sectionId, reason: 'post.created', now })
      return created._id
    })
    if (archive) {
      await db.updateById('posts', postId, { sortKey: buildArchiveSortKey(now, postId) })
    }
    const audit = await auditAndApply({
      postId,
      communityId,
      sectionId: area ? '' : sectionId,
      section,
      content,
      authorId: ctx.userId,
      source: 'admin',
      contentSlot: 'content',
      postSnapshot: { _id: postId, ...postData } as any,
    })
    if (archive) {
      await syncArchivePostTopics({
        _id: postId,
        communityId,
        topics: archive.topics,
        createdAt: now,
        status: 'active',
        auditStatus: audit.status,
      })
    }
    return { postId, auditStatus: audit.status, auditReason: audit.reason }
  }

  throw new Error(`Unknown action: ${action}`)
}

async function normalizeCommunityHomeBanners(communityId: string, input: unknown): Promise<HomeBanner[]> {
  const rows = Array.isArray(input) ? input : []
  const normalized: HomeBanner[] = []
  const seenPostIds = new Set<string>()

  for (const [index, rawValue] of rows.entries()) {
    const raw = rawValue as Record<string, unknown>
    const postId = String(raw?.postId || '').trim()
    const title = String(raw?.title || '').trim()
    const coverImage = String(raw?.coverImage || '').trim()
    const enabled = raw?.enabled !== false

    if (!postId) throw new Error('Banner 必须选择关联帖子')
    if (!coverImage) throw new Error('Banner 必须上传封面图')
    if (seenPostIds.has(postId)) throw new Error('Banner 关联帖子不能重复')
    seenPostIds.add(postId)

    const post = await db.getById('posts', postId) as any
    if (!post || post.status === 'deleted') throw new Error('Banner 关联帖子不存在或已删除')
    if (String(post.communityId || '') !== communityId) {
      throw new Error('Banner 只能关联当前社区的帖子')
    }

    const bannerId = String(raw?.bannerId || '').trim() || `${postId}-${index}`
    normalized.push({
      bannerId,
      postId,
      title,
      coverImage,
      order: index,
      enabled,
    })
  }

  return normalized
}

function canonicalCommunityHomeBanners(input: unknown) {
  return (Array.isArray(input) ? input : []).map((banner: any) => ({
    bannerId: String(banner?.bannerId || '').trim(),
    postId: String(banner?.postId || '').trim(),
    title: String(banner?.title || '').trim(),
    coverImage: String(banner?.coverImage || '').trim(),
    enabled: banner?.enabled !== false,
    order: Number(banner?.order || 0),
  }))
}

async function hardDeleteCommunity(communityId: string, community: Community) {
  const fileIDs: string[] = []
  if (community.coverImage) fileIDs.push(community.coverImage)
  for (const banner of community.homeBanners || []) {
    if (banner.coverImage) fileIDs.push(banner.coverImage)
  }

  await db.runTransaction(async transaction => {
    const persisted = await db.transactionGetByIdOrNull<any>(transaction, 'communities', communityId)
    if (!persisted || persisted.status !== 'disabled') {
      throw new Error('only disabled community can be hard-deleted. disable it first.')
    }
    await transaction.collection('communities').doc(communityId).update({ data: { status: 'disabled' } })
  })

  const drainByCommunity = async (
    collectionName: string,
    remove: (document: any) => Promise<void>,
  ) => {
    let afterId: string | null = null
    while (true) {
      const page = await db.queryAfterId(collectionName, { communityId }, afterId, 100) as any[]
      if (page.length === 0) {
        if (afterId === null) return
        afterId = null
        continue
      }
      for (const document of page) await remove(document)
      afterId = String(page[page.length - 1]._id || '')
    }
  }

  await drainByCommunity('posts', async post => {
    fileIDs.push(...extractCloudFileIDsFromContent((post as any).content))
    fileIDs.push(...extractCloudFileIDsFromContent((post as any).pendingContent))
    await removePostSearchIndex(String((post as any)._id || ''))
    await db.runTransaction(async transaction => {
      await transaction.collection('posts').doc((post as any)._id).remove()
      await schedulePostRagSyncInTransaction(transaction, {
        postId: String((post as any)._id || ''),
        communityId,
        sectionId: String((post as any).sectionId || ''),
        reason: 'community.hardDelete',
        now: new Date().toISOString(),
      })
    })
  })

  for (const collectionName of [
    ATTENDANCE_COLLECTION,
    'sections',
    'community_members',
    MEMBER_STATE_COLLECTION,
    'community_create_requests',
  ]) {
    await drainByCommunity(collectionName, async document => {
      await db.removeById(collectionName, String(document._id || ''))
    })
  }

  await db.removeById('communities', communityId)

  if (fileIDs.length > 0) {
    try {
      await storage.deleteFile(fileIDs)
    } catch (error) {
      console.error('[hardDelete] COS cleanup failed, orphan files:', fileIDs, error)
    }
  }
}

export const main = async (event: any) => {
  const headers = {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
  }

  try {
    if (event.httpMethod) {
      if (event.httpMethod === 'OPTIONS') {
        return {
          statusCode: 200,
          headers: {
            ...headers,
            'access-control-allow-headers': 'content-type,authorization',
            'access-control-allow-methods': 'POST,OPTIONS',
          },
          body: '',
        }
      }

      let body: any = {}
      try {
        body = JSON.parse(event.body || '{}')
      } catch {
        body = {}
      }
      const { action, ...params } = body
      const authHeader = String(event.headers?.authorization || event.headers?.Authorization || '')

      if (PUBLIC_ACTIONS.has(action)) {
        // HTTP 触发不可能携带小程序 OPENID（cloud.getWXContext 在 HTTP 下为空）
        // wxLoginConfirm 必须从小程序内调用 → publicRoute 内会拒绝
        const result = await publicRoute(action, params, '')
        return { statusCode: 200, headers, body: JSON.stringify(result) }
      }

      const ctx = await resolveSession(authHeader)
      if (!ctx) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) }
      }
      // auth.logout 需要原始 token 才能删对应 session
      if (action === 'auth.logout') {
        params.__token__ = extractBearer(authHeader)
      }
      const result = await route(action, params, ctx)
      return { statusCode: 200, headers, body: JSON.stringify(result) }
    }

    // 非 HTTP 触发（小程序 wx.cloud.callFunction / 内部云函数 / 测试直调）
    // 小程序路径下 cloud.getWXContext().OPENID 自动有值 → 传给 publicRoute 给 wxLoginConfirm 用
    const { action, _actAs, _internalToken, _testOpenid, ...params } = event
    if (PUBLIC_ACTIONS.has(action)) {
      let openid = ''
      try {
        const ctxFromWx: any = (cloud as any).getWXContext?.() || {}
        openid = String(ctxFromWx.OPENID || '')
      } catch { /* CloudBase HTTP-only env 时可能不可用，留空即可 */ }
      // 测试直调允许注入 _testOpenid（同 user/post 函数的约定）
      if (!openid && process.env.ALLOW_TEST_OPENID === 'true' && _testOpenid) {
        openid = String(_testOpenid)
      }
      return publicRoute(action, params, openid)
    }
    const ctx = resolveNonHttpAdminContext({ _actAs, _internalToken })
    return route(action, params, ctx)
  } catch (error: any) {
    if (event.httpMethod) {
      const msg = String(error?.message || 'internal error')
      const status = /^(用户名或密码错误|权限不足|账号已停用|Unauthorized)$/.test(msg)
        ? (msg === '权限不足' ? 403 : 401)
        : 500
      return {
        statusCode: status,
        headers,
        body: JSON.stringify({ error: msg }),
      }
    }
    throw error
  }
}
