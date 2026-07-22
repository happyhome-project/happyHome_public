import cloud from 'wx-server-sdk'
import * as db from '../../lib/db'
import { resolveOpenId } from '../../lib/ctx'
import { deleteFile, getTempUrl, inspectRemoteObject, materializeFile, requestUploadMetadata } from '../../lib/storage'
import { assertOwnedMemberVideoUpload, finalizeMemberArchiveVideoContent, requestMemberVideoUpload } from '../../lib/member-video-upload'
import { sanitizeContent, validateContentValues, validateRequiredWidgets } from '../../lib/post-validate'
import { auditAndApply, isPostVisibleToMembers } from '../../lib/content-audit'
import { buildHomeBootstrap, buildHomeFeed } from '../../lib/home-snapshot'
import { ensureCommunityReadable } from '../../lib/public-community'
import {
  ACTIVITY_INVITE_SYSTEM_KEY,
  ACTIVITY_INVITE_WIDGET_IDS,
  isActivityInviteInProgress,
} from '../../shared/activity-invite'
import { removePostSearchIndex } from '../../lib/post-search'
import { schedulePostRagSyncInTransaction } from '../../lib/post-rag-sync'
import { searchPostsWithRag } from '../../lib/post-rag'
import { isTextNoteSection, normalizeTextNoteSection, normalizeTextNoteTheme } from '../../shared/text-note-widgets'
import type {
  AttendancePreviewUser,
  AttendanceSummary,
  AttendanceSummaryByWidget,
  PostAttendanceMember,
  Section,
  Widget,
  PostContent,
  Post,
  Community,
} from '../../shared/types'
import { normalizeSectionTemplates } from '../../shared/section-templates'
import { resolveAuthorAvatarUrl } from '../../shared/simulated-author-avatars'
import { resolvePostAuthorNickname } from '../../shared/post-author'
import { parseArchivePostCreateInput, type ArchivePostFormat } from '../../shared/archive-post'
import { decodeArchiveCursor, encodeArchiveCursor, normalizeArchiveTopic, selectArchiveTabs } from '../../shared/archive-topics'
import { archiveTopicId, buildArchiveSortKey, syncArchivePostTopics, updateArchivePostTopicLinks } from '../../lib/archive-topic-index'
import {
  ACTIVITY_INVITE_TEMPLATE_ID,
  collaborationTemplateAsSection,
  normalizeCollaborationTemplate,
} from '../../shared/collaboration-templates'
import type { CollaborationTemplate } from '../../shared/types'

type PostRagSmokeIdentity = {
  version: number
  action: string
  communityId: string
  runId: string
  userId: string
  expiresAt: number
}

const { verifyPostRagSmokeIdentity }: {
  verifyPostRagSmokeIdentity: (value: unknown, options: {
    secret: string
    action: string
    communityId: string
  }) => PostRagSmokeIdentity | null
} = require('../../shared/post-rag-smoke-identity.cjs')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const ATTENDANCE_COLLECTION = 'post_attendance_members'
const POST_RAG_SMOKE_RUNS_COLLECTION = 'post_rag_smoke_runs'
const ATTENDANCE_PREVIEW_LIMIT = 5
const COMMUNITY_READ_ERROR = '需要先加入社区后查看内容'
const HOME_POST_LIMIT_PER_SECTION = 20
const DEFAULT_SEARCH_LIMIT = 20
export function resetPostSemanticSearchServiceForTests() {}

function resolvePostRagSmokeIdentity(event: any, action: string, communityId: string): PostRagSmokeIdentity | null {
  if (action !== 'search') return null
  const secret = String(process.env.POST_RAG_SMOKE_IDENTITY_SECRET || '').trim()
  return verifyPostRagSmokeIdentity(event?.__happyhomeSmokeIdentity, {
    secret,
    action,
    communityId,
  })
}

function logPostRagSmokeIdentityAudit(event: any, action: string, communityId: string, identity: PostRagSmokeIdentity | null) {
  const candidate = event?.__happyhomeSmokeIdentity
  const present = Boolean(candidate && typeof candidate === 'object')
  if (!present && event?.happyhomeSmokeAudit !== true) return
  const auditCandidate = present ? candidate : {}
  const expiresAt = Number(auditCandidate.expiresAt)
  console.info('[post.rag.smoke.identity]', JSON.stringify({
    present,
    accepted: Boolean(identity),
    actionMatches: String(auditCandidate.action || '') === action,
    communityMatches: String(auditCandidate.communityId || '').trim() === communityId,
    hasConfiguredSecret: Boolean(String(process.env.POST_RAG_SMOKE_IDENTITY_SECRET || '').trim()),
    hasSignature: typeof auditCandidate.signature === 'string' && auditCandidate.signature.length > 0,
    expiresInMs: Number.isFinite(expiresAt) ? Math.round(expiresAt - Date.now()) : null,
  }))
}

async function ensureActivePostRagSmokeRun(identity: PostRagSmokeIdentity) {
  const runs = await db.query(POST_RAG_SMOKE_RUNS_COLLECTION, {
    runId: identity.runId,
    communityId: identity.communityId,
    userId: identity.userId,
    status: 'active',
  }, { limit: 1 })
  const expiresAt = Number(runs?.[0]?.expiresAt)
  if (
    !runs?.length
    || !Number.isSafeInteger(expiresAt)
    || expiresAt !== identity.expiresAt
    || expiresAt < Date.now()
  ) {
    throw new Error('Invalid RAG smoke identity')
  }
}

function getAttendanceWidgets(section: Section): Widget[] {
  return (section.widgets || []).filter((widget) => widget.type === 'attendance')
}

function normalizePostSection(section: Section): Section {
  return normalizeSectionTemplates(section) as Section
}

async function loadCollaborationTemplate(
  templateId: string,
  options: { activeOnly?: boolean } = {},
): Promise<CollaborationTemplate> {
  const normalizedId = String(templateId || '').trim()
  if (!normalizedId) throw new Error('collaborationTemplateId 不能为空')
  const template = await db.getById('collaboration_templates', normalizedId) as CollaborationTemplate | null
  if (!template) throw new Error('协作板块不存在')
  const normalized = normalizeCollaborationTemplate(template)
  if (options.activeOnly && normalized.status !== 'active') throw new Error('协作板块已停用')
  return normalized
}

async function resolvePostContentContract(post: {
  communityId: string
  sectionId?: string
  area?: string
  format?: ArchivePostFormat
  collaborationTemplateId?: string
}) {
  if (post.area === 'archive') {
    const section = buildArchiveContentSection(
      post.communityId,
      resolveArchivePostFormat(post.format),
    )
    return { section, collaborationTemplate: null as CollaborationTemplate | null }
  }
  if (post.area === 'collaboration') {
    const collaborationTemplate = await loadCollaborationTemplate(String(post.collaborationTemplateId || ''))
    return {
      section: collaborationTemplateAsSection(collaborationTemplate, post.communityId),
      collaborationTemplate,
    }
  }
  const section = normalizePostSection(await db.getById('sections', String(post.sectionId || '')) as Section)
  return { section, collaborationTemplate: null as CollaborationTemplate | null }
}

function normalizeCapacityValue(value: unknown): number | undefined {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return undefined
  return Math.floor(num)
}

function normalizeCapacity(widget: Widget, post?: Pick<Post, 'content'>): number | undefined {
  const dynamicWidgetId = String(widget.capacityWidgetId || '').trim()
  if (dynamicWidgetId && post?.content) {
    const dynamicCapacity = normalizeCapacityValue((post.content as any)[dynamicWidgetId])
    if (dynamicCapacity) return dynamicCapacity
  }
  const value = Number(widget.capacity)
  if (!Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
}

async function ensureActiveCommunityMember(communityId: string, userId: string) {
  if (!userId) throw new Error(COMMUNITY_READ_ERROR)
  const members = await db.query('community_members', {
    communityId,
    userId,
    status: 'active',
  })
  if (!members || members.length === 0) throw new Error(COMMUNITY_READ_ERROR)
}

async function isActiveCommunityMember(communityId: string, userId?: string) {
  if (!userId) return false
  const members = await db.query('community_members', {
    communityId,
    userId,
    status: 'active',
  }, { limit: 1 })
  return Array.isArray(members) && members.length > 0
}

function maskMemberOnlyContent<T extends { content?: PostContent }>(
  post: T,
  section: Section,
  canViewMemberOnly: boolean,
): T {
  if (canViewMemberOnly) return post
  const memberOnlyWidgetIds = (section.widgets || [])
    .filter((widget) => widget.visibility === 'member')
    .map((widget) => widget.widgetId)
  if (memberOnlyWidgetIds.length === 0) return post

  const content = { ...(post.content || {}) } as PostContent
  memberOnlyWidgetIds.forEach((widgetId) => {
    if (Object.prototype.hasOwnProperty.call(content, widgetId)) {
      ;(content as any)[widgetId] = ''
    }
  })
  return { ...post, content }
}

function timeValue(value: unknown): number {
  const timestamp = Date.parse(String(value || ''))
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function comparePostListOrder(a: any, b: any): number {
  const pinnedDiff = Number(Boolean(b?.isPinned)) - Number(Boolean(a?.isPinned))
  if (pinnedDiff !== 0) return pinnedDiff
  if (a?.isPinned && b?.isPinned) {
    const pinnedTimeDiff = timeValue(b?.pinnedAt || b?.createdAt) - timeValue(a?.pinnedAt || a?.createdAt)
    if (pinnedTimeDiff !== 0) return pinnedTimeDiff
  }
  return timeValue(b?.createdAt) - timeValue(a?.createdAt)
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

/**
 * 给 posts 附上作者昵称/头像。post 表只存 authorId（openid），展示时 JOIN users 取最新昵称。
 * 这样用户改昵称后所有历史帖子同步显示新昵称（不走发帖时快照）。
 */
async function enrichPostsWithAuthor<T extends { _id?: string; authorId?: string; adminCreatedByUsername?: unknown }>(posts: T[]): Promise<Array<T & { authorNickname?: string; authorAvatarUrl?: string }>> {
  if (!posts.length) return posts as any
  const usersById = await getUsersByIds(posts.map((p) => p.authorId).filter(Boolean) as string[])
  return posts.map((p) => {
    const author = usersById[p.authorId || '']
    return {
      ...p,
      authorNickname: resolvePostAuthorNickname(p, author?.nickName),
      authorAvatarUrl: resolveAuthorAvatarUrl(author?.avatarUrl, p._id || p.authorId || ''),
    }
  })
}

async function getAttendanceRecords(postId: string, widgetId: string) {
  const rows = await db.query(
    ATTENDANCE_COLLECTION,
    { postId, widgetId },
    { orderBy: ['joinedAt', 'desc'] }
  )
  return rows as PostAttendanceMember[]
}

function normalizeSeatCount(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.floor(n)
}

function sumOccupiedSeats(records: Pick<PostAttendanceMember, 'seatCount'>[]): number {
  return records.reduce((sum, r) => sum + normalizeSeatCount(r.seatCount), 0)
}

async function buildAttendanceSummary(
  post: Pick<Post, '_id' | 'content'>,
  widget: Widget,
  viewerId?: string
): Promise<AttendanceSummary> {
  const records = await getAttendanceRecords(post._id, widget.widgetId)
  const previewRecords = viewerId ? records.slice(0, ATTENDANCE_PREVIEW_LIMIT) : []
  const usersById = await getUsersByIds(previewRecords.map((record) => record.userId))
  const previewUsers: AttendancePreviewUser[] = previewRecords.map((record) => ({
    userId: record.userId,
    nickName: usersById[record.userId]?.nickName || '',
    avatarUrl: usersById[record.userId]?.avatarUrl || '',
    seatCount: normalizeSeatCount(record.seatCount),
  }))
  const count = records.length
  const occupiedSeats = sumOccupiedSeats(records)
  const capacity = normalizeCapacity(widget, post)
  const myRecord = viewerId ? records.find((record) => record.userId === viewerId) : undefined
  return {
    count,
    occupiedSeats,
    ...(capacity ? { capacity } : {}),
    isFull: capacity ? occupiedSeats >= capacity : false,
    isJoined: Boolean(myRecord),
    ...(myRecord ? { mySeatCount: normalizeSeatCount(myRecord.seatCount) } : {}),
    previewUsers,
  }
}

async function buildAttendanceSummaryByWidget(
  post: Pick<Post, '_id' | 'content'>,
  section: Section,
  viewerId?: string
): Promise<AttendanceSummaryByWidget> {
  const summaries = await Promise.all(
    getAttendanceWidgets(section).map(async (widget) => ([
      widget.widgetId,
      await buildAttendanceSummary(post, widget, viewerId),
    ] as const))
  )
  return Object.fromEntries(summaries)
}

async function enrichPostsWithAttendance<T extends { _id: string; sectionId: string }>(
  posts: T[],
  sectionById: Record<string, Section | null>,
  viewerId?: string
): Promise<Array<T & { attendanceSummaryByWidget: AttendanceSummaryByWidget }>> {
  return Promise.all(
    posts.map(async (post) => {
      const section = sectionById[post.sectionId]
      const attendanceSummaryByWidget = section
        ? await buildAttendanceSummaryByWidget(post as any, section, viewerId)
        : {}
      return { ...post, attendanceSummaryByWidget }
    })
  )
}

function hasActivityInviteWidget(section: Section): boolean {
  return (section.widgets || []).some((widget) => widget.type === 'activity_invite')
}

function textFromContentValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return ''
}

function resolveSourceTitle(post: Pick<Post, 'content'>, section: Section): string {
  const titleWidget = (section.widgets || []).find((widget) =>
    ['guide_title', 'title'].includes(widget.widgetId) ||
    ['title', 'name'].includes(String(widget.fieldKey || '').toLowerCase()) ||
    ['标题', '名称'].includes(String(widget.label || '').trim())
  )
  if (titleWidget) {
    const title = textFromContentValue((post.content || {})[titleWidget.widgetId])
    if (title) return title
  }
  return '出游邀约'
}

function resolveSourceLocation(post: Pick<Post, 'content'>, section: Section) {
  const locationWidget = (section.widgets || []).find((widget) =>
    widget.type === 'location' && (
      widget.widgetId === 'guide_location' ||
      String(widget.fieldKey || '').toLowerCase().includes('location') ||
      String(widget.label || '').includes('位置') ||
      String(widget.label || '').includes('地点')
    )
  )
  const value = locationWidget ? (post.content || {})[locationWidget.widgetId] : null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const lat = Number((value as any).lat)
  const lng = Number((value as any).lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return value
}

function buildActivityInvitePrefill(sourcePost: Post, sourceSection: Section) {
  return {
    title: resolveSourceTitle(sourcePost, sourceSection),
    location: resolveSourceLocation(sourcePost, sourceSection),
  }
}

async function findCurrentActivityInvite(
  sourcePostId: string,
  options: { visibleOnly?: boolean } = {},
) {
  const invites = await db.query('posts', {
    originPostId: sourcePostId,
    originLinkType: 'activity_invite',
    status: 'active',
  }, { orderBy: ['eventStartsAt', 'asc'] }) as any[]
  const visibleOnly = options.visibleOnly !== false
  return invites
    .filter((post) => !visibleOnly || isPostVisibleToMembers(post))
    .filter((post) => visibleOnly ? isActivityInviteInProgress(post) : isActivityInviteTimeInProgress(post))
    .sort((a, b) => timeValue(a.eventStartsAt) - timeValue(b.eventStartsAt))[0] || null
}

async function buildActivityInviteSummary(invitePost: any, inviteSection: Section | null, viewerId?: string) {
  if (!invitePost) return null
  const attendanceWidget = (inviteSection?.widgets || []).find((widget) => widget.type === 'attendance')
  const attendanceSummary = attendanceWidget
    ? await buildAttendanceSummary(invitePost, attendanceWidget, viewerId)
    : null
  const capacity = attendanceSummary?.capacity ?? normalizeCapacityValue(invitePost.content?.[ACTIVITY_INVITE_WIDGET_IDS.capacity])
  return {
    postId: invitePost._id,
    sectionId: invitePost.sectionId,
    eventStartsAt: invitePost.eventStartsAt || '',
    title: textFromContentValue(invitePost.content?.[ACTIVITY_INVITE_WIDGET_IDS.title]),
    occupiedSeats: attendanceSummary?.occupiedSeats || 0,
    count: attendanceSummary?.count || 0,
    ...(capacity ? { capacity } : {}),
    isFull: Boolean(attendanceSummary?.isFull),
    isJoined: Boolean(attendanceSummary?.isJoined),
  }
}

async function loadActivityInviteSource(sourcePostId: string, viewerId?: string) {
  const sourcePost = await db.getById('posts', sourcePostId) as Post
  if (!sourcePost || sourcePost.status === 'deleted' || !isPostVisibleToMembers(sourcePost)) {
    throw new Error('源帖子不存在或不可用')
  }
  await ensureCommunityReadable(sourcePost.communityId, viewerId || '', COMMUNITY_READ_ERROR)
  const sourceSection = normalizePostSection(await db.getById('sections', sourcePost.sectionId) as Section)
  if (!hasActivityInviteWidget(sourceSection)) {
    throw new Error('该板块未启用活动召集')
  }
  return { sourcePost, sourceSection }
}

function validateActivityInviteContent(content: PostContent) {
  const startsAt = String(content[ACTIVITY_INVITE_WIDGET_IDS.startsAt] || '').trim()
  if (!Number.isFinite(Date.parse(startsAt))) throw new Error('出发时间不正确')
  const capacity = normalizeCapacityValue(content[ACTIVITY_INVITE_WIDGET_IDS.capacity])
  if (!capacity) throw new Error('人数上限必须大于 0')
}

function isActivityInviteTimeInProgress(post: { status?: string; eventStartsAt?: string }, now = Date.now()): boolean {
  if (!post || post.status === 'deleted') return false
  const startsAt = Date.parse(String(post.eventStartsAt || ''))
  return Number.isFinite(startsAt) && startsAt > now
}

async function getAttendanceWidgetForPost(postId: string, widgetId?: string) {
  const post = await db.getById('posts', postId) as any
  if (!post || post.status === 'deleted' || !isPostVisibleToMembers(post)) throw new Error('帖子不存在')
  const { section } = await resolvePostContentContract(post)
  const attendanceWidgets = getAttendanceWidgets(section)
  if (attendanceWidgets.length === 0) throw new Error('该板块下没有可以报名的控件')
  const widget = widgetId
    ? attendanceWidgets.find((item) => item.widgetId === widgetId)
    : attendanceWidgets[0]
  if (!widget) throw new Error('报名控件不存在')
  return { post, section, widget }
}

async function listAttendanceMembersInternal(postId: string, widgetId?: string) {
  const { post, widget } = await getAttendanceWidgetForPost(postId, widgetId)
  const records = await getAttendanceRecords(postId, widget.widgetId)
  const usersById = await getUsersByIds(records.map((record) => record.userId))
  const members = records.map((record) => ({
    userId: record.userId,
    nickName: usersById[record.userId]?.nickName || '',
    avatarUrl: usersById[record.userId]?.avatarUrl || '',
    seatCount: normalizeSeatCount(record.seatCount),
    joinedAt: record.joinedAt,
  }))
  const occupiedSeats = sumOccupiedSeats(records)
  const capacity = normalizeCapacity(widget, post)
  return {
    widgetId: widget.widgetId,
    members,
    total: members.length,
    occupiedSeats,
    ...(capacity ? { capacity } : {}),
    isFull: capacity ? occupiedSeats >= capacity : false,
    post,
  }
}

function buildArchiveContentSection(communityId: string, format: ArchivePostFormat): Section {
  const common = {
    _id: '', communityId, name: '沉淀区', icon: '', order: 0,
    enableComment: true, enableLike: true, createdAt: '', type: 'evergreen', status: 'active',
  } as const
  let widgets: Widget[]
  if (format === 'image_text') {
    widgets = [
        { widgetId: 'images', type: 'image_group', label: '图片', fieldKey: 'images', required: true, order: 0, showInList: false },
        { widgetId: 'title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 1, showInList: true },
        { widgetId: 'body', type: 'rich_note', label: '正文', fieldKey: 'body', required: false, order: 2, showInList: false },
        { widgetId: 'location', type: 'location', label: '地点', fieldKey: 'location', required: false, order: 3, showInList: false },
      ]
  } else if (format === 'video') {
    widgets = [
      { widgetId: 'title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true },
      { widgetId: 'body', type: 'rich_note', label: '正文', fieldKey: 'body', required: false, order: 1, showInList: false },
      { widgetId: 'videos', type: 'video_group', label: '视频', fieldKey: 'videos', required: true, order: 2, showInList: false },
      { widgetId: 'location', type: 'location', label: '地点', fieldKey: 'location', required: false, order: 3, showInList: false },
    ]
  } else {
    widgets = [
        { widgetId: 'title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true },
        { widgetId: 'body', type: 'rich_note', label: '正文', fieldKey: 'body', required: true, order: 1, showInList: false },
      ]
  }
  return { ...common, widgets } as Section
}

function resolveArchivePostFormat(format: unknown): ArchivePostFormat {
  if (format === 'text' || format === 'video') return format
  return 'image_text'
}

function archiveDisplayMetadata(format: unknown): { sectionName: string; displayTemplate: string } {
  if (format === 'text') return { sectionName: '文字', displayTemplate: 'text_note' }
  if (format === 'video') return { sectionName: '视频', displayTemplate: 'video_note' }
  return { sectionName: '图文', displayTemplate: 'image_note' }
}

type CreatePostParams = {
  communityId: string
  sectionId?: string
  area?: unknown
  format?: unknown
  topics?: unknown
  content: PostContent
  presentation?: unknown
}

export async function handleCreate(
  params: CreatePostParams,
  openid: string,
) {
  if (!openid) throw new Error('Missing OPENID')
  await ensureActiveCommunityMember(params.communityId, openid)

  if (params.area === 'archive') {
    const archive = parseArchivePostCreateInput(params)
    const section = buildArchiveContentSection(params.communityId, archive.format)
    let content = archive.content as unknown as PostContent
    const validationOptions = archive.format === 'video'
      ? { memberEditableVideoWidgetIds: ['videos'] }
      : undefined
    validateRequiredWidgets(section, content, validationOptions)
    validateContentValues(section, content, validationOptions)
    if (archive.format === 'video') {
      content = await finalizeMemberArchiveVideoContent(content, openid, params.communityId, {
        requestUploadMetadata, getTempUrl, inspectRemoteObject, materializeFile, deleteFile,
      })
    }

    const now = new Date().toISOString()
    const postData = {
      communityId: params.communityId,
      area: archive.area,
      origin: 'native_archive',
      format: archive.format,
      topics: archive.topics,
      authorId: openid,
      status: 'active',
      auditStatus: 'pending',
      auditReason: 'content audit pending',
      auditUpdatedAt: now,
      content,
      ...(archive.format === 'text' ? { presentation: archive.presentation } : {}),
      commentCount: 0,
      likeCount: 0,
      isPinned: false,
      isFeatured: false,
      createdAt: now,
      updatedAt: now,
    }
    const postId = await db.runTransaction(async transaction => {
      const created = await transaction.collection('posts').add({ data: postData })
      return created._id
    })
    const sortKey = buildArchiveSortKey(now, postId)
    await db.updateById('posts', postId, { sortKey })
    const audit = await auditAndApply({
      postId,
      communityId: params.communityId,
      sectionId: '',
      section,
      content,
      authorId: openid,
      source: 'user',
      contentSlot: 'content',
      postSnapshot: { _id: postId, ...postData } as unknown as Post,
    })
    await syncArchivePostTopics({
      _id: postId,
      communityId: params.communityId,
      topics: archive.topics,
      createdAt: now,
      status: 'active',
      auditStatus: audit.status,
    })
    return { postId, auditStatus: audit.status, auditReason: audit.reason }
  }

  const sectionId = String(params.sectionId || '').trim()
  const section = normalizePostSection(await db.getById('sections', sectionId) as Section)
  // 板块尚未配置控件时，禁止发帖（否则会产生无任何字段的空 post）
  if (!section || !Array.isArray(section.widgets) || section.widgets.length === 0) {
    throw new Error('该板块尚未配置内容模板，请联系管理员完善板块设置后再发布')
  }
  if (section.communityId !== params.communityId) {
    throw new Error('板块不属于当前社区')
  }
  const sanitizedContent = sanitizeContent(params.content, section)
  validateRequiredWidgets(section, sanitizedContent)
  validateContentValues(section, sanitizedContent)

  const presentation = isTextNoteSection(section)
    ? { textNoteTheme: normalizeTextNoteTheme((params.presentation as any)?.textNoteTheme) }
    : undefined

  const now = new Date().toISOString()
  const postData = {
    communityId: params.communityId,
    sectionId,
    authorId: openid,
    status: 'active',
    auditStatus: 'pending',
    auditReason: 'content audit pending',
    auditUpdatedAt: now,
    content: sanitizedContent,
    ...(presentation ? { presentation } : {}),
    commentCount: 0,
    likeCount: 0,
    isPinned: false,
    isFeatured: false,
    createdAt: now,
    updatedAt: now,
  }
  const postId = await db.runTransaction(async transaction => {
    const created = await transaction.collection('posts').add({ data: postData })
    await schedulePostRagSyncInTransaction(transaction, { postId: created._id, communityId: params.communityId, sectionId, reason: 'post.created', now })
    return created._id
  })

  const audit = await auditAndApply({
    postId,
    communityId: params.communityId,
    sectionId,
    section,
    content: sanitizedContent,
    authorId: openid,
    source: 'user',
    contentSlot: 'content',
  })
  return { postId, auditStatus: audit.status, auditReason: audit.reason }
}

export async function handleCreateCollaboration(
  params: {
    communityId: string
    collaborationTemplateId: string
    content: PostContent
  },
  openid: string,
) {
  if (!openid) throw new Error('Missing OPENID')
  const communityId = String(params.communityId || '').trim()
  if (!communityId) throw new Error('communityId 不能为空')
  await ensureActiveCommunityMember(communityId, openid)

  const template = await loadCollaborationTemplate(params.collaborationTemplateId, { activeOnly: true })
  const section = collaborationTemplateAsSection(template, communityId)
  const sanitizedContent = sanitizeContent(params.content, section)
  validateRequiredWidgets(section, sanitizedContent)
  validateContentValues(section, sanitizedContent)

  const now = new Date().toISOString()
  const postData = {
    communityId,
    area: 'collaboration',
    collaborationTemplateId: template._id,
    collaborationSystemKey: template.systemKey,
    authorId: openid,
    status: 'active',
    auditStatus: 'pending',
    auditReason: 'content audit pending',
    auditUpdatedAt: now,
    content: sanitizedContent,
    commentCount: 0,
    likeCount: 0,
    isPinned: false,
    isFeatured: false,
    createdAt: now,
    updatedAt: now,
  }
  const postId = await db.runTransaction(async transaction => {
    const created = await transaction.collection('posts').add({ data: postData })
    await schedulePostRagSyncInTransaction(transaction, { postId: created._id, communityId, sectionId: '', reason: 'post.created', now })
    return created._id
  })
  const audit = await auditAndApply({
    postId,
    communityId,
    sectionId: '',
    section,
    content: sanitizedContent,
    authorId: openid,
    source: 'user',
    contentSlot: 'content',
  })
  return { postId, auditStatus: audit.status, auditReason: audit.reason }
}

export async function handleGetActivityInviteState(
  params: { sourcePostId: string; asGuest?: boolean },
  openid?: string,
) {
  const viewerId = params.asGuest ? '' : (openid || '')
  const { sourcePost, sourceSection } = await loadActivityInviteSource(params.sourcePostId, viewerId)
  const invitePost = await findCurrentActivityInvite(sourcePost._id)
  const inviteTemplate = await loadCollaborationTemplate(
    String(invitePost?.collaborationTemplateId || ACTIVITY_INVITE_TEMPLATE_ID),
  )
  const inviteSection = collaborationTemplateAsSection(inviteTemplate, sourcePost.communityId)
  const invite = invitePost
    ? await buildActivityInviteSummary(invitePost, inviteSection, viewerId)
    : null
  return {
    enabled: true,
    sourcePostId: sourcePost._id,
    prefill: buildActivityInvitePrefill(sourcePost, sourceSection),
    invite,
    targetSection: inviteSection
      ? {
          ...inviteSection,
          sectionId: '',
          collaborationTemplateId: inviteTemplate._id,
          name: inviteSection.name,
          systemKey: inviteSection.systemKey || ACTIVITY_INVITE_SYSTEM_KEY,
        }
      : null,
  }
}

export async function handleCreateActivityInvite(
  params: { sourcePostId: string; content: PostContent },
  openid: string,
) {
  if (!openid) throw new Error('Missing OPENID')
  const { sourcePost, sourceSection } = await loadActivityInviteSource(params.sourcePostId, openid)
  await ensureActiveCommunityMember(sourcePost.communityId, openid)

  const existingInvite = await findCurrentActivityInvite(sourcePost._id, { visibleOnly: false })
  if (existingInvite) {
    return {
      postId: existingInvite._id,
      alreadyExists: true,
      eventStartsAt: existingInvite.eventStartsAt || '',
    }
  }

  const targetTemplate = await loadCollaborationTemplate(ACTIVITY_INVITE_TEMPLATE_ID, { activeOnly: true })
  const targetSection = collaborationTemplateAsSection(targetTemplate, sourcePost.communityId)
  const sanitizedContent = sanitizeContent(params.content, targetSection)
  validateRequiredWidgets(targetSection, sanitizedContent)
  validateContentValues(targetSection, sanitizedContent)
  validateActivityInviteContent(sanitizedContent)

  const now = new Date().toISOString()
  const originTitle = resolveSourceTitle(sourcePost, sourceSection)
  const eventStartsAt = String(sanitizedContent[ACTIVITY_INVITE_WIDGET_IDS.startsAt] || '').trim()
  const inviteData = {
    communityId: sourcePost.communityId,
    area: 'collaboration',
    collaborationTemplateId: targetTemplate._id,
    collaborationSystemKey: targetTemplate.systemKey,
    authorId: openid,
    status: 'active',
    auditStatus: 'pending',
    auditReason: 'content audit pending',
    auditUpdatedAt: now,
    content: sanitizedContent,
    commentCount: 0,
    likeCount: 0,
    isPinned: false,
    isFeatured: false,
    originPostId: sourcePost._id,
    originSectionId: sourcePost.sectionId,
    originCommunityId: sourcePost.communityId,
    originTitle,
    originLinkType: 'activity_invite',
    eventStartsAt,
    createdAt: now,
    updatedAt: now,
  }
  const postId = await db.runTransaction(async transaction => {
    const created = await transaction.collection('posts').add({ data: inviteData })
    await schedulePostRagSyncInTransaction(transaction, { postId: created._id, communityId: sourcePost.communityId, sectionId: '', reason: 'post.created', now })
    return created._id
  })

  const audit = await auditAndApply({
    postId,
    communityId: sourcePost.communityId,
    sectionId: '',
    section: targetSection,
    content: sanitizedContent,
    authorId: openid,
    source: 'user',
    contentSlot: 'content',
  })

  return {
    postId,
    alreadyExists: false,
    collaborationTemplateId: targetTemplate._id,
    eventStartsAt,
    auditStatus: audit.status,
    auditReason: audit.reason,
  }
}

export async function handleList(params: {
  sectionId: string
  skip?: number
  limit?: number
  asGuest?: boolean
}, openid?: string) {
  const section = normalizePostSection(await db.getById('sections', params.sectionId) as Section)
  const viewerId = params.asGuest ? '' : (openid || '')
  await ensureCommunityReadable(section.communityId, viewerId, COMMUNITY_READ_ERROR)
  const posts = await db.query('posts', {
    sectionId: params.sectionId,
    status: 'active',
  }, {
    orderBy: ['createdAt', 'desc'],
  })
  const orderedPosts = (posts as any[]).filter(isPostVisibleToMembers).slice().sort(comparePostListOrder)
  const slicedPosts = orderedPosts.slice(params.skip ?? 0, (params.skip ?? 0) + (params.limit ?? 20))
  const withAttendance = await enrichPostsWithAttendance(slicedPosts, { [params.sectionId]: section }, viewerId)
  const canViewMemberOnly = await isActiveCommunityMember(section.communityId, viewerId)
  const visiblePosts = withAttendance.map((post) => maskMemberOnlyContent(post, section, canViewMemberOnly))
  const enrichedPosts = await enrichPostsWithAuthor(visiblePosts)
  return { posts: enrichedPosts }
}

export async function handleListCollaboration(params: {
  communityId: string
  collaborationTemplateId: string
  skip?: number
  limit?: number
  asGuest?: boolean
}, openid?: string) {
  const communityId = String(params.communityId || '').trim()
  if (!communityId) throw new Error('communityId 不能为空')
  const viewerId = params.asGuest ? '' : (openid || '')
  await ensureCommunityReadable(communityId, viewerId, COMMUNITY_READ_ERROR)
  const template = await loadCollaborationTemplate(params.collaborationTemplateId)
  const section = collaborationTemplateAsSection(template, communityId)
  const posts = await db.query('posts', {
    communityId,
    area: 'collaboration',
    collaborationTemplateId: template._id,
    status: 'active',
  }, { orderBy: ['createdAt', 'desc'] }) as any[]
  const orderedPosts = posts.filter(isPostVisibleToMembers).slice().sort(comparePostListOrder)
  const skip = Math.max(0, Math.floor(Number(params.skip) || 0))
  const limit = Math.min(50, Math.max(1, Math.floor(Number(params.limit) || 20)))
  const page = orderedPosts.slice(skip, skip + limit)
  const canViewMemberOnly = await isActiveCommunityMember(communityId, viewerId)
  const withAttendance = await Promise.all(page.map(async (post) => ({
    ...post,
    attendanceSummaryByWidget: await buildAttendanceSummaryByWidget(post, section, viewerId),
  })))
  const visiblePosts = withAttendance.map((post) => maskMemberOnlyContent(post, section, canViewMemberOnly))
  return {
    template,
    posts: await enrichPostsWithAuthor(visiblePosts),
    total: orderedPosts.length,
    skip,
    limit,
    hasMore: skip + page.length < orderedPosts.length,
  }
}

async function getDocumentsByIdsInBatches(collectionName: string, ids: string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  const batches: string[][] = []
  for (let index = 0; index < uniqueIds.length; index += 100) {
    batches.push(uniqueIds.slice(index, index + 100))
  }
  const loaded = await Promise.all(batches.map((batch) => db.getByIds(collectionName, batch) as Promise<any[]>))
  return loaded.flat()
}

async function queryAllAfterId(collectionName: string, query: Record<string, any>) {
  const records: any[] = []
  let afterId: string | null = null
  const batchSize = 100
  for (let batch = 0; batch < 20; batch += 1) {
    const rows = await db.queryAfterId(collectionName, query, afterId, batchSize) as any[]
    records.push(...rows)
    if (rows.length < batchSize) break
    afterId = String(rows[rows.length - 1]?._id || '')
    if (!afterId) break
  }
  return records
}

function sortPersonalPosts(posts: any[]) {
  return posts.slice().sort((left, right) => {
    const created = String(right?.createdAt || '').localeCompare(String(left?.createdAt || ''))
    return created || String(right?._id || '').localeCompare(String(left?._id || ''))
  })
}

async function enrichPersonalPosts(posts: any[]) {
  const communityIds = [...new Set(posts.map((post) => String(post?.communityId || '')).filter(Boolean))]
  const sectionIds = [...new Set(posts.map((post) => String(post?.sectionId || '')).filter(Boolean))]
  const collaborationTemplateIds = [...new Set(posts
    .filter((post) => post?.area === 'collaboration')
    .map((post) => String(post?.collaborationTemplateId || ''))
    .filter(Boolean))]
  const [communities, sections, collaborationTemplates] = await Promise.all([
    getDocumentsByIdsInBatches('communities', communityIds),
    getDocumentsByIdsInBatches('sections', sectionIds),
    getDocumentsByIdsInBatches('collaboration_templates', collaborationTemplateIds),
  ])
  const communitiesById = new Map(communities.map((community) => [String(community?._id || ''), community]))
  const sectionsById = new Map(sections.map((section) => [String(section?._id || ''), section]))
  const collaborationTemplatesById = new Map(collaborationTemplates.map((template) => {
    const normalized = normalizeCollaborationTemplate(template as CollaborationTemplate)
    return [String(normalized._id || ''), normalized]
  }))
  return posts.map((post) => {
    const isArchive = post?.area === 'archive'
    const collaborationTemplate = post?.area === 'collaboration'
      ? collaborationTemplatesById.get(String(post?.collaborationTemplateId || ''))
      : undefined
    const section = collaborationTemplate
      ? collaborationTemplateAsSection(collaborationTemplate, String(post?.communityId || ''))
      : sectionsById.get(String(post?.sectionId || ''))
    const archiveMetadata = isArchive ? archiveDisplayMetadata(post?.format) : null
    return {
      ...post,
      communityName: String(communitiesById.get(String(post?.communityId || ''))?.name || '社区'),
      sectionName: isArchive
        ? archiveMetadata!.sectionName
        : String(section?.name || '已下线板块'),
      displayTemplate: isArchive
        ? archiveMetadata!.displayTemplate
        : String(section?.displayTemplate || 'default'),
      ...(collaborationTemplate ? { collaborationTemplate } : {}),
      section: section ? {
        _id: section._id,
        name: section.name,
        displayTemplate: section.displayTemplate,
        widgets: section.widgets || [],
      } : null,
    }
  })
}

function paginatePersonalPosts(posts: any[], params: { skip?: number; limit?: number }) {
  const skip = Math.max(0, Math.floor(Number(params?.skip) || 0))
  const limit = Math.min(50, Math.max(1, Math.floor(Number(params?.limit) || 20)))
  const page = posts.slice(skip, skip + limit)
  return { posts: page, total: posts.length, skip, limit, hasMore: skip + page.length < posts.length }
}

export async function handleListMine(
  params: { skip?: number; limit?: number },
  openid: string,
) {
  if (!openid) throw new Error('Missing OPENID')
  const authoredPosts = (await queryAllAfterId('posts', { authorId: openid }))
    .filter((post) => post?.status !== 'deleted')
  const enriched = await enrichPersonalPosts(sortPersonalPosts(authoredPosts))
  return paginatePersonalPosts(enriched, params)
}

export async function handleListMyActivities(
  params: { skip?: number; limit?: number },
  openid: string,
) {
  if (!openid) throw new Error('Missing OPENID')

  const [authoredRows, attendanceRows] = await Promise.all([
    queryAllAfterId('posts', { authorId: openid }),
    queryAllAfterId(ATTENDANCE_COLLECTION, { userId: openid }),
  ])
  const authoredActivities = authoredRows.filter((post) => (
    post?.area === 'collaboration' && post?.status !== 'deleted'
  ))
  const attendedPostIds = attendanceRows.map((row) => String(row?.postId || '')).filter(Boolean)
  const attendedActivities = (await getDocumentsByIdsInBatches('posts', attendedPostIds))
    .filter((post) => post?.area === 'collaboration' && isPostVisibleToMembers(post))

  const activitiesById = new Map<string, any>()
  for (const post of attendedActivities) activitiesById.set(String(post?._id || ''), post)
  for (const post of authoredActivities) activitiesById.set(String(post?._id || ''), post)
  activitiesById.delete('')

  const enriched = await enrichPersonalPosts(sortPersonalPosts([...activitiesById.values()]))
  return paginatePersonalPosts(enriched, params)
}

export async function handleListArchive(params: {
  communityId: string
  topicKey?: string
  cursor?: string
  limit?: number
  asGuest?: boolean
}, openid?: string) {
  const communityId = String(params.communityId || '').trim()
  if (!communityId) throw new Error('communityId 不能为空')
  const viewerId = params.asGuest ? '' : (openid || '')
  await ensureCommunityReadable(communityId, viewerId, COMMUNITY_READ_ERROR)

  const limit = Number.isFinite(Number(params.limit)) && Number(params.limit) > 0
    ? Math.min(50, Math.floor(Number(params.limit)))
    : 20
  const cursor = decodeArchiveCursor(params.cursor)
  if (params.cursor && !cursor) throw new Error('无效的分页游标')
  const rawTopic = String(params.topicKey || '').trim()
  if (!rawTopic) {
    const rows = await db.queryBefore('posts', {
      communityId, area: 'archive', status: 'active', auditStatus: 'pass',
    }, 'sortKey', cursor?.sortKey || null, limit + 1) as any[]
    const page = rows.slice(0, limit)
    const enrichedPosts = await enrichPostsWithAuthor(page)
    const last = page[page.length - 1]
    return {
      posts: enrichedPosts,
      hasMore: rows.length > limit,
      nextCursor: last ? encodeArchiveCursor({ sortKey: last.sortKey, postId: last._id }) : '',
    }
  }

  const { topicKey } = normalizeArchiveTopic(rawTopic)
  const topic = await db.getByIdOrNull<any>('archive_topics', archiveTopicId(communityId, topicKey))
  if (!topic || topic.status === 'deleted') {
    return { topicUnavailable: true, posts: [], hasMore: false, nextCursor: '' }
  }
  const links = await db.queryBefore('archive_post_topics', {
    communityId, topicKey, status: 'active', auditStatus: 'pass',
  }, 'sortKey', cursor?.sortKey || null, limit + 1) as any[]
  const pageLinks = links.slice(0, limit)
  const loaded = await db.getByIds('posts', pageLinks.map((link) => link.postId)) as any[]
  const byId = new Map(loaded.map((post) => [post._id, post]))
  const posts = pageLinks
    .map((link) => byId.get(link.postId))
    .filter((post) => post
      && post.communityId === communityId
      && post.area === 'archive'
      && post.status === 'active'
      && post.auditStatus === 'pass')
  const enrichedPosts = await enrichPostsWithAuthor(posts)
  const last = pageLinks[pageLinks.length - 1]
  return {
    posts: enrichedPosts,
    hasMore: links.length > limit,
    nextCursor: last ? encodeArchiveCursor({ sortKey: last.sortKey, postId: last.postId }) : '',
  }
}

export async function handleListArchiveTabs(params: { communityId: string; asGuest?: boolean }, openid?: string) {
  const communityId = String(params.communityId || '').trim()
  if (!communityId) throw new Error('communityId 不能为空')
  await ensureCommunityReadable(communityId, params.asGuest ? '' : (openid || ''), COMMUNITY_READ_ERROR)
  const [community, records] = await Promise.all([
    db.getById('communities', communityId) as Promise<Community>,
    db.query('archive_topics', { communityId, enabled: true }) as Promise<any[]>,
  ])
  return {
    tabs: [
      { topicKey: '', displayName: '全部' },
      ...selectArchiveTabs(records, 7, community.archiveTopicOrder).map(({ topicKey, displayName }) => ({ topicKey, displayName })),
    ],
  }
}

export async function handleHome(params: {
  communityId: string
  limitPerSection?: number
  asGuest?: boolean
}, openid?: string) {
  return buildHomeFeed(params.communityId, params.asGuest ? '' : (openid || ''), {
    limitPerSection: params.limitPerSection,
  })
}

export async function handleBootstrap(params: {
  currentCommunityId?: string
  limitPerSection?: number
  asGuest?: boolean
  _trace?: unknown
}, openid?: string) {
  return buildHomeBootstrap(params.asGuest ? '' : (openid || ''), {
    currentCommunityId: params.currentCommunityId,
    limitPerSection: params.limitPerSection,
    trace: params._trace,
  })
}

export async function handleGet(params: { postId: string; asGuest?: boolean }, openid?: string) {
  const post = await db.getById('posts', params.postId) as any
  const viewerId = params.asGuest ? '' : (openid || '')
  if (
    !post
    || post.status === 'deleted'
    || (!isPostVisibleToMembers(post) && String(post.authorId || '') !== viewerId)
  ) throw new Error('帖子不存在')
  await ensureCommunityReadable(post.communityId, viewerId, COMMUNITY_READ_ERROR)
  if (post.area === 'archive') {
    const [enrichedPost] = await enrichPostsWithAuthor([post])
    return { post: enrichedPost }
  }
  const { section, collaborationTemplate } = await resolvePostContentContract(post)
  const canViewMemberOnly = await isActiveCommunityMember(post.communityId, viewerId)
  const visiblePost = maskMemberOnlyContent(post, section, canViewMemberOnly)
  const attendanceSummaryByWidget = await buildAttendanceSummaryByWidget(post, section, viewerId)
  const [enrichedPost] = await enrichPostsWithAuthor([{ ...visiblePost, attendanceSummaryByWidget }])
  return {
    post: enrichedPost,
    ...(collaborationTemplate ? { collaborationTemplate } : {}),
  }
}

export async function handleSearch(params: {
  communityId: string
  q?: string
  query?: string
  sectionId?: string
  skip?: number
  limit?: number
  asGuest?: boolean
  _ragIndexScope?: 'business' | 'validation'
}, openid?: string) {
  const communityId = String(params.communityId || '').trim()
  if (!communityId) throw new Error('communityId 不能为空')
  const viewerId = params.asGuest ? '' : (openid || '')
  await ensureCommunityReadable(communityId, viewerId, COMMUNITY_READ_ERROR)
  const canViewMemberOnly = await isActiveCommunityMember(communityId, viewerId)
  try {
    return await searchPostsWithRag({
      communityId,
      query: String(params.q ?? params.query ?? ''),
      sectionId: String(params.sectionId || '').trim() || undefined,
      skip: Number.isFinite(Number(params.skip)) ? Math.max(0, Math.floor(Number(params.skip))) : 0,
      limit: Number.isFinite(Number(params.limit)) && Number(params.limit) > 0 ? Math.floor(Number(params.limit)) : DEFAULT_SEARCH_LIMIT,
      includeMemberOnly: canViewMemberOnly,
      indexScope: params._ragIndexScope === 'validation' ? 'validation' : 'business',
    })
  } catch { throw new Error('智能搜索暂不可用，请稍后重试') }
}

export async function handleDelete(params: { postId: string }, openid: string) {
  if (!openid) throw new Error('Missing OPENID')

  const post = await db.getById('posts', params.postId) as {
    authorId: string
    status: string
    communityId?: string
    sectionId?: string
    area?: string
  }
  if (post.authorId !== openid) throw new Error('无权删除')

  if (post.status === 'deleted') {
    if (post.area === 'archive') await updateArchivePostTopicLinks(params.postId, { status: 'deleted' })
    await db.runTransaction(async transaction => {
      await schedulePostRagSyncInTransaction(transaction, {
        postId: params.postId,
        communityId: String(post.communityId || ''),
        sectionId: String(post.sectionId || ''),
        reason: 'post.delete.compensate',
        now: new Date().toISOString(),
      })
    })
    await removePostSearchIndex(params.postId)
    return { success: true, alreadyDeleted: true }
  }

  await db.runTransaction(async transaction => {
    await transaction.collection('posts').doc(params.postId).update({ data: {
      status: 'deleted', isPinned: false, pinnedAt: '', pinnedByAccountId: '',
      isFeatured: false, featuredAt: '', featuredByAccountId: '',
    } })
    const now = new Date().toISOString()
    await schedulePostRagSyncInTransaction(transaction, {
      postId: params.postId,
      communityId: String(post.communityId || ''),
      sectionId: String(post.sectionId || ''),
      reason: 'post.delete',
      now,
    })
  })
  await removePostSearchIndex(params.postId)
  if (post.area === 'archive') await updateArchivePostTopicLinks(params.postId, { status: 'deleted' })
  return { success: true }
}

export async function handleUpdate(
  params: { postId: string; content: PostContent; topics?: unknown; presentation?: unknown },
  openid: string,
) {
  if (!openid) throw new Error('Missing OPENID')

  const post = await db.getById('posts', params.postId) as {
    communityId: string
    sectionId?: string
    authorId: string
    status: string
    auditStatus?: string
    area?: string
    format?: ArchivePostFormat
    topics?: string[]
    presentation?: unknown
    createdAt?: string
    collaborationTemplateId?: string
    content?: PostContent
    pendingContent?: PostContent
  }
  if (post.status === 'deleted') throw new Error('帖子已删除')
  if (post.authorId !== openid) throw new Error('无权修改')

  const archive = post.area === 'archive'
    ? parseArchivePostCreateInput({
        area: 'archive',
        format: post.format,
        topics: params.topics === undefined ? (post.topics || []) : params.topics,
        content: params.content,
        ...(post.format === 'text'
          ? { presentation: params.presentation === undefined ? post.presentation : params.presentation }
          : {}),
      })
    : null
  const section = archive
    ? buildArchiveContentSection(post.communityId, archive.format)
    : (await resolvePostContentContract(post)).section
  if (!section || !Array.isArray(section.widgets) || section.widgets.length === 0) {
    throw new Error('该板块尚未配置内容模板，无法编辑')
  }
  let sanitizedContent = archive
    ? archive.content as unknown as PostContent
    : sanitizeContent(params.content, section)
  const validationOptions = archive?.format === 'video'
    ? { memberEditableVideoWidgetIds: ['videos'] }
    : undefined
  validateRequiredWidgets(section, sanitizedContent, validationOptions)
  validateContentValues(section, sanitizedContent, validationOptions)
  if (archive?.format === 'video') {
    await ensureActiveCommunityMember(post.communityId, openid)
    const existingFinalizedFileIDs = {
      video: new Set<string>(),
      cover: new Set<string>(),
    }
    for (const existingContent of [post.content, post.pendingContent]) {
      const existingVideo = Array.isArray((existingContent as any)?.videos)
        ? (existingContent as any).videos[0]
        : null
      if (typeof existingVideo?.fileID === 'string') existingFinalizedFileIDs.video.add(existingVideo.fileID)
      if (typeof existingVideo?.cover === 'string') existingFinalizedFileIDs.cover.add(existingVideo.cover)
    }
    sanitizedContent = await finalizeMemberArchiveVideoContent(sanitizedContent, openid, post.communityId, {
      requestUploadMetadata, getTempUrl, inspectRemoteObject, materializeFile, deleteFile, existingFinalizedFileIDs,
    })
  }
  const presentation = archive?.format === 'text'
    ? archive.presentation
    : (!archive && isTextNoteSection(section)
        ? { textNoteTheme: normalizeTextNoteTheme((params.presentation as any)?.textNoteTheme) }
        : undefined)

  const applyAcceptedMetadata = async (auditStatus: string) => {
    if (auditStatus !== 'pass') return
    if (presentation) await db.updateById('posts', params.postId, { presentation })
    if (!archive) return
    await db.updateById('posts', params.postId, { topics: archive.topics })
    await syncArchivePostTopics({
      _id: params.postId,
      communityId: post.communityId,
      topics: archive.topics,
      createdAt: String(post.createdAt || updatedAt),
      status: 'active',
      auditStatus: 'pass',
    })
  }

  const updatedAt = new Date().toISOString()
  if (post.auditStatus === 'pass' || !post.auditStatus) {
    await db.runTransaction(async transaction => {
      await transaction.collection('posts').doc(params.postId).update({ data: {
      pendingContent: db.replaceValue(sanitizedContent),
      ...(archive ? { pendingTopics: db.replaceValue(archive.topics) } : {}),
      ...(presentation ? { pendingPresentation: db.replaceValue(presentation) } : {}),
      pendingAuditStatus: 'pending',
      pendingAuditReason: 'content audit pending',
      pendingSubmittedAt: updatedAt,
      updatedAt,
      } })
      await schedulePostRagSyncInTransaction(transaction, { postId: params.postId, communityId: post.communityId, sectionId: post.sectionId || '', reason: 'post.updated', now: updatedAt })
    })
    const audit = await auditAndApply({
      postId: params.postId,
      communityId: post.communityId,
      sectionId: post.sectionId || '',
      section,
      content: sanitizedContent,
      authorId: openid,
      source: 'user',
      contentSlot: 'pendingContent',
    })
    await applyAcceptedMetadata(audit.status)
    return { success: true, updatedAt, auditStatus: audit.status, auditReason: audit.reason }
  }

  await db.runTransaction(async transaction => {
    await transaction.collection('posts').doc(params.postId).update({ data: {
    content: db.replaceValue(sanitizedContent),
    auditStatus: 'pending',
    auditReason: 'content audit pending',
    auditUpdatedAt: updatedAt,
    updatedAt,
    } })
    await schedulePostRagSyncInTransaction(transaction, { postId: params.postId, communityId: post.communityId, sectionId: post.sectionId || '', reason: 'post.updated', now: updatedAt })
  })
  const audit = await auditAndApply({
    postId: params.postId,
    communityId: post.communityId,
    sectionId: post.sectionId || '',
    section,
    content: sanitizedContent,
    authorId: openid,
    source: 'user',
    contentSlot: 'content',
  })
  await applyAcceptedMetadata(audit.status)
  return { success: true, updatedAt, auditStatus: audit.status, auditReason: audit.reason }
}

export async function handleJoinAttendance(
  params: { postId: string; widgetId?: string; seatCount?: number },
  openid: string,
) {
  if (!openid) throw new Error('Missing OPENID')
  const seatCount = normalizeSeatCount(params.seatCount)
  const { post, widget } = await getAttendanceWidgetForPost(params.postId, params.widgetId)
  await ensureActiveCommunityMember(post.communityId, openid)

  const existing = await db.query(ATTENDANCE_COLLECTION, {
    postId: post._id,
    widgetId: widget.widgetId,
    userId: openid,
  }, { limit: 1 })
  if (existing.length === 0) {
    const current = await getAttendanceRecords(post._id, widget.widgetId)
    const capacity = normalizeCapacity(widget, post)
    const occupied = sumOccupiedSeats(current)
    if (capacity && occupied + seatCount > capacity) {
      const remaining = Math.max(0, capacity - occupied)
      throw new Error(
        seatCount === 1
          ? '已满员，暂时无法参与'
          : `剩余 ${remaining} 座，无法容纳 ${seatCount} 位`
      )
    }
    const newId = await db.create(ATTENDANCE_COLLECTION, {
      postId: post._id,
      widgetId: widget.widgetId,
      communityId: post.communityId,
      sectionId: post.sectionId,
      userId: openid,
      seatCount,
      joinedAt: new Date().toISOString(),
    })
    // 并发防御：写入后重新校验总席位，若超容则回滚（防止两个请求同时看见"还有剩余"导致超卖）
    if (capacity) {
      const after = await getAttendanceRecords(post._id, widget.widgetId)
      const occupiedAfter = sumOccupiedSeats(after)
      if (occupiedAfter > capacity && typeof newId === 'string') {
        await db.removeById(ATTENDANCE_COLLECTION, newId)
        throw new Error('已满员，暂时无法参与')
      }
    }
  }

  const summary = await buildAttendanceSummary(post, widget, openid)
  return { widgetId: widget.widgetId, summary }
}

export async function handleLeaveAttendance(
  params: { postId: string; widgetId?: string },
  openid: string,
) {
  if (!openid) throw new Error('Missing OPENID')
  const { post, widget } = await getAttendanceWidgetForPost(params.postId, params.widgetId)
  await ensureActiveCommunityMember(post.communityId, openid)

  const existing = await db.query(ATTENDANCE_COLLECTION, {
    postId: post._id,
    widgetId: widget.widgetId,
    userId: openid,
  }, { limit: 1 })
  if (existing[0]?._id) {
    await db.removeById(ATTENDANCE_COLLECTION, existing[0]._id)
  }

  const summary = await buildAttendanceSummary(post, widget, openid)
  return { widgetId: widget.widgetId, summary }
}

export async function handleListAttendanceMembers(
  params: { postId: string; widgetId?: string },
  openid: string,
) {
  if (!openid) throw new Error('Missing OPENID')
  const result = await listAttendanceMembersInternal(params.postId, params.widgetId)
  await ensureActiveCommunityMember(result.post.communityId, openid)
  return {
    widgetId: result.widgetId,
    members: result.members,
    total: result.total,
    occupiedSeats: result.occupiedSeats,
    ...(typeof result.capacity === 'number' ? { capacity: result.capacity } : {}),
    isFull: result.isFull,
  }
}

export async function handleGetMediaUrl(params: { fileID?: string }) {
  const fileID = String(params?.fileID || '')
  if (!fileID.startsWith('cloud://')) throw new Error('invalid fileID')
  const url = await getTempUrl(fileID)
  return { url }
}

export async function handleRequestMemberVideoUpload(
  params: { communityId?: string; fileName?: string },
  openid: string,
  kind: 'video' | 'cover',
) {
  const communityId = String(params?.communityId || '').trim()
  if (!communityId) throw new Error('communityId 不能为空')
  await ensureActiveCommunityMember(communityId, openid)
  return requestMemberVideoUpload(
    { kind, communityId, fileName: String(params?.fileName || '').trim() },
    openid,
    { requestUploadMetadata },
  )
}

function containsExactFileID(value: unknown, fileID: string): boolean {
  if (value === fileID) return true
  if (Array.isArray(value)) return value.some(item => containsExactFileID(item, fileID))
  if (!value || typeof value !== 'object') return false
  return Object.values(value as Record<string, unknown>).some(item => containsExactFileID(item, fileID))
}

async function isMemberUploadReferenced(openid: string, fileID: string): Promise<boolean> {
  let afterId: string | null = null
  for (;;) {
    const posts = await db.queryAfterId('posts', { authorId: openid }, afterId, 100)
    for (const post of posts) {
      if (post?.status === 'deleted') continue
      if (containsExactFileID(post?.content, fileID) || containsExactFileID(post?.pendingContent, fileID)) return true
    }
    if (posts.length < 100) return false
    afterId = String(posts[posts.length - 1]?._id || '')
    if (!afterId) throw new Error('无法确认上传文件引用状态')
  }
}

export async function handleDeleteMemberVideoUpload(
  params: { communityId?: string; fileID?: string; kind?: string },
  openid: string,
) {
  const communityId = String(params?.communityId || '').trim()
  if (!communityId) throw new Error('communityId 不能为空')
  await ensureActiveCommunityMember(communityId, openid)
  const kind = params?.kind
  if (kind !== 'video' && kind !== 'cover') throw new Error('上传文件类型无效')
  const fileID = String(params?.fileID || '').trim()
  const { cloudPath } = assertOwnedMemberVideoUpload(fileID, openid, communityId, kind)
  const expected = await requestUploadMetadata(cloudPath)
  if (String(expected?.fileId || '') !== fileID) throw new Error('上传文件不属于当前应用')
  if (await isMemberUploadReferenced(openid, fileID)) {
    return { success: true as const, deleted: false as const, reason: 'referenced' as const }
  }
  await deleteFile([fileID])
  return { success: true as const, deleted: true as const }
}

function sanitizeClientLogValue(value: any, depth = 0): any {
  if (value === null || value === undefined) return value
  const valueType = typeof value
  if (valueType === 'string') return value.length > 700 ? `${value.slice(0, 700)}...` : value
  if (valueType === 'number' || valueType === 'boolean') return value
  if (valueType === 'function') return '[function]'
  if (depth >= 4) return '[max-depth]'
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeClientLogValue(item, depth + 1))
  if (valueType === 'object') {
    const output: Record<string, any> = {}
    for (const key of Object.keys(value).slice(0, 40)) {
      output[key] = /token|secret|password|authorization|cookie/i.test(key)
        ? '[redacted]'
        : sanitizeClientLogValue(value[key], depth + 1)
    }
    return output
  }
  return String(value)
}

export async function handleClientLog(params: any, openid?: string) {
  const payload = sanitizeClientLogValue({
    openidTail: openid ? String(openid).slice(-6) : '',
    level: params.level || 'info',
    event: params.event || '',
    sessionId: params.sessionId || '',
    route: params.route || '',
    clientTime: params.clientTime || '',
    build: params.build || {},
    details: params.details || {},
  })
  console.log('[clientLog]', JSON.stringify(payload))
  return { success: true, receivedAt: new Date().toISOString() }
}

export const main = async (event: any, context?: any) => {
  const { action, _testOpenid, __happyhomeSmokeIdentity, ...params } = event
  const smokeIdentity = resolvePostRagSmokeIdentity(event, action, String(params.communityId || '').trim())
  logPostRagSmokeIdentityAudit(event, action, String(params.communityId || '').trim(), smokeIdentity)
  const openid = smokeIdentity?.userId || resolveOpenId(event, context)
  if (smokeIdentity) await ensureActivePostRagSmokeRun(smokeIdentity)
  if (action === 'clientLog') return handleClientLog(params, openid)
  if (action === 'requestMemberVideoUpload') return handleRequestMemberVideoUpload(params, openid, 'video')
  if (action === 'requestMemberVideoCoverUpload') return handleRequestMemberVideoUpload(params, openid, 'cover')
  if (action === 'deleteMemberVideoUpload') return handleDeleteMemberVideoUpload(params, openid)
  if (action === 'create') return handleCreate(params, openid)
  if (action === 'createCollaboration') return handleCreateCollaboration(params, openid)
  if (action === 'getActivityInviteState') return handleGetActivityInviteState(params, openid)
  if (action === 'createActivityInvite') return handleCreateActivityInvite(params, openid)
  if (action === 'list') return handleList(params, openid)
  if (action === 'listCollaboration') return handleListCollaboration(params, openid)
  if (action === 'listMine') return handleListMine(params, openid)
  if (action === 'listMyActivities') return handleListMyActivities(params, openid)
  if (action === 'listArchive') return handleListArchive(params, openid)
  if (action === 'listArchiveTabs') return handleListArchiveTabs(params, openid)
  if (action === 'home') return handleHome(params, openid)
  if (action === 'bootstrap') return handleBootstrap(params, openid)
  if (action === 'get') return handleGet(params, openid)
  if (action === 'search') return handleSearch({ ...params, _ragIndexScope: smokeIdentity ? 'validation' : 'business' }, openid)
  if (action === 'delete') return handleDelete(params, openid)
  if (action === 'update') return handleUpdate(params, openid)
  if (action === 'joinAttendance') return handleJoinAttendance(params, openid)
  if (action === 'leaveAttendance') return handleLeaveAttendance(params, openid)
  if (action === 'listAttendanceMembers') return handleListAttendanceMembers(params, openid)
  if (action === 'getMediaUrl') return handleGetMediaUrl(params)
  throw new Error(`Unknown action: ${action}`)
}
