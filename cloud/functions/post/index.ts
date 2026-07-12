import cloud from 'wx-server-sdk'
import * as db from '../../lib/db'
import { resolveOpenId } from '../../lib/ctx'
import { getTempUrl } from '../../lib/storage'
import { sanitizeContent, validateContentValues, validateRequiredWidgets } from '../../lib/post-validate'
import { auditAndApply, isPostVisibleToMembers } from '../../lib/content-audit'
import { buildHomeBootstrap, buildHomeFeed } from '../../lib/home-snapshot'
import { ensureCommunityReadable } from '../../lib/public-community'
import {
  ACTIVITY_INVITE_SECTION_NAME,
  ACTIVITY_INVITE_SYSTEM_KEY,
  ACTIVITY_INVITE_WIDGET_IDS,
  buildActivityInviteSectionWidgets,
  isActivityInviteInProgress,
  isActivityInviteSection,
} from '../../shared/activity-invite'
import { removePostSearchIndex } from '../../lib/post-search'
import { enqueuePostRagDeleteJobInTransaction, enqueuePostRagJob, searchPostsWithRag } from '../../lib/post-rag'
import { appendPostRagOutboxEvent } from '../../lib/post-rag-outbox'
import type {
  AttendancePreviewUser,
  AttendanceSummary,
  AttendanceSummaryByWidget,
  PostAttendanceMember,
  Section,
  Widget,
  PostContent,
  Post,
} from '../../shared/types'
import { normalizeGuideNoteSection } from '../../shared/guide-note-widgets'
import { resolveAuthorAvatarUrl } from '../../shared/simulated-author-avatars'
import { resolvePostAuthorNickname } from '../../shared/post-author'

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

function normalizeSectionForClient(section: Section): Section {
  const normalized = normalizePostSection(section)
  return {
    ...normalized,
    type: normalized.type || 'evergreen',
    status: normalized.status || 'active',
    enableComment: normalized.enableComment !== false,
    enableLike: normalized.enableLike !== false,
  } as Section
}

function getAttendanceWidgets(section: Section): Widget[] {
  return (section.widgets || []).filter((widget) => widget.type === 'attendance')
}

function normalizePostSection(section: Section): Section {
  return normalizeGuideNoteSection(section) as Section
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

async function findActivityInviteSection(communityId: string): Promise<Section | null> {
  const sections = await db.query('sections', { communityId }, { orderBy: ['order', 'asc'] }) as Section[]
  const found = sections.find((section) => isActivityInviteSection(section))
  if (!found) return null
  return normalizeSectionForClient({
    ...found,
    systemKey: ACTIVITY_INVITE_SYSTEM_KEY,
    widgets: found.widgets?.length ? found.widgets : buildActivityInviteSectionWidgets(),
  } as Section)
}

async function ensureActivityInviteSection(communityId: string): Promise<Section> {
  const existing = await findActivityInviteSection(communityId)
  if (existing) return {
    ...existing,
    systemKey: ACTIVITY_INVITE_SYSTEM_KEY,
    widgets: existing.widgets?.length ? existing.widgets : buildActivityInviteSectionWidgets(),
  }

  const now = new Date().toISOString()
  const sectionData = {
    communityId,
    name: ACTIVITY_INVITE_SECTION_NAME,
    icon: '👣',
    order: 999,
    enableComment: true,
    enableLike: true,
    widgets: buildActivityInviteSectionWidgets(),
    createdAt: now,
    type: 'realtime',
    status: 'active',
    displayTemplate: 'default',
    systemKey: ACTIVITY_INVITE_SYSTEM_KEY,
  }
  const sectionId = await db.create('sections', sectionData)
  return normalizeSectionForClient({ ...sectionData, _id: sectionId } as Section)
}

function buildVirtualActivityInviteSection(communityId: string): Section {
  return normalizeSectionForClient({
    _id: '',
    communityId,
    name: ACTIVITY_INVITE_SECTION_NAME,
    icon: '👣',
    order: 999,
    enableComment: true,
    enableLike: true,
    widgets: buildActivityInviteSectionWidgets(),
    createdAt: new Date().toISOString(),
    type: 'realtime',
    status: 'active',
    displayTemplate: 'default',
    systemKey: ACTIVITY_INVITE_SYSTEM_KEY,
  } as Section)
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
  const section = await db.getById('sections', post.sectionId) as Section
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

export async function handleCreate(
  params: { communityId: string; sectionId: string; content: PostContent },
  openid: string,
) {
  if (!openid) throw new Error('Missing OPENID')
  await ensureActiveCommunityMember(params.communityId, openid)

  const section = normalizePostSection(await db.getById('sections', params.sectionId) as Section)
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

  const now = new Date().toISOString()
  const postData = {
    communityId: params.communityId,
    sectionId: params.sectionId,
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
    await appendPostRagOutboxEvent(transaction, { communityId: params.communityId, aggregateId: created._id, reasonCode: 'post.created', now })
    return created._id
  })

  const audit = await auditAndApply({
    postId,
    communityId: params.communityId,
    sectionId: params.sectionId,
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
  const inviteSection = invitePost?.sectionId
    ? normalizeSectionForClient(await db.getById('sections', invitePost.sectionId) as Section)
    : (await findActivityInviteSection(sourcePost.communityId) || buildVirtualActivityInviteSection(sourcePost.communityId))
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
          sectionId: inviteSection._id,
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

  const targetSection = await ensureActivityInviteSection(sourcePost.communityId)
  const sanitizedContent = sanitizeContent(params.content, targetSection)
  validateRequiredWidgets(targetSection, sanitizedContent)
  validateContentValues(targetSection, sanitizedContent)
  validateActivityInviteContent(sanitizedContent)

  const now = new Date().toISOString()
  const originTitle = resolveSourceTitle(sourcePost, sourceSection)
  const eventStartsAt = String(sanitizedContent[ACTIVITY_INVITE_WIDGET_IDS.startsAt] || '').trim()
  const inviteData = {
    communityId: sourcePost.communityId,
    sectionId: targetSection._id,
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
    await appendPostRagOutboxEvent(transaction, { communityId: sourcePost.communityId, aggregateId: created._id, reasonCode: 'post.created', now })
    return created._id
  })

  const audit = await auditAndApply({
    postId,
    communityId: sourcePost.communityId,
    sectionId: targetSection._id,
    section: targetSection,
    content: sanitizedContent,
    authorId: openid,
    source: 'user',
    contentSlot: 'content',
  })

  return {
    postId,
    alreadyExists: false,
    sectionId: targetSection._id,
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
}, openid?: string) {
  return buildHomeBootstrap(params.asGuest ? '' : (openid || ''), {
    currentCommunityId: params.currentCommunityId,
    limitPerSection: params.limitPerSection,
  })
}

export async function handleGet(params: { postId: string; asGuest?: boolean }, openid?: string) {
  const post = await db.getById('posts', params.postId) as any
  if (!post || post.status === 'deleted' || !isPostVisibleToMembers(post)) throw new Error('帖子不存在')
  const viewerId = params.asGuest ? '' : (openid || '')
  await ensureCommunityReadable(post.communityId, viewerId, COMMUNITY_READ_ERROR)
  const section = normalizePostSection(await db.getById('sections', post.sectionId) as Section)
  const canViewMemberOnly = await isActiveCommunityMember(post.communityId, viewerId)
  const visiblePost = maskMemberOnlyContent(post, section, canViewMemberOnly)
  const attendanceSummaryByWidget = await buildAttendanceSummaryByWidget(post, section, viewerId)
  const [enrichedPost] = await enrichPostsWithAuthor([{ ...visiblePost, attendanceSummaryByWidget }])
  return { post: enrichedPost }
}

export async function handleSearch(params: {
  communityId: string
  q?: string
  query?: string
  sectionId?: string
  skip?: number
  limit?: number
  asGuest?: boolean
}, openid?: string) {
  const communityId = String(params.communityId || '').trim()
  if (!communityId) throw new Error('communityId 不能为空')
  const viewerId = params.asGuest ? '' : (openid || '')
  await ensureCommunityReadable(communityId, viewerId, COMMUNITY_READ_ERROR)
  const canViewMemberOnly = await isActiveCommunityMember(communityId, viewerId)
  return searchPostsWithRag({
    communityId,
    query: String(params.q ?? params.query ?? ''),
    sectionId: String(params.sectionId || '').trim(),
    skip: Number.isFinite(Number(params.skip)) ? Math.max(0, Math.floor(Number(params.skip))) : 0,
    limit: Number.isFinite(Number(params.limit)) && Number(params.limit) > 0
      ? Math.floor(Number(params.limit))
      : DEFAULT_SEARCH_LIMIT,
    includeMemberOnly: canViewMemberOnly,
  })
}

export async function handleDelete(params: { postId: string }, openid: string) {
  if (!openid) throw new Error('Missing OPENID')

  const post = await db.getById('posts', params.postId) as {
    authorId: string
    status: string
    communityId?: string
    sectionId?: string
  }
  if (post.authorId !== openid) throw new Error('无权删除')

  if (post.status === 'deleted') {
    await db.runTransaction(async transaction => {
      await enqueuePostRagDeleteJobInTransaction(transaction, {
        postId: params.postId,
        communityId: post.communityId,
        sectionId: post.sectionId,
        reason: 'post.delete.compensate',
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
    await appendPostRagOutboxEvent(transaction, { communityId: String(post.communityId || ''), aggregateId: params.postId, reasonCode: 'post.deleted', now: new Date().toISOString() })
    await enqueuePostRagDeleteJobInTransaction(transaction, {
      postId: params.postId,
      communityId: post.communityId,
      sectionId: post.sectionId,
      reason: 'post.delete',
    })
  })
  await removePostSearchIndex(params.postId)
  return { success: true }
}

export async function handleUpdate(
  params: { postId: string; content: PostContent },
  openid: string,
) {
  if (!openid) throw new Error('Missing OPENID')

  const post = await db.getById('posts', params.postId) as {
    communityId: string
    sectionId: string
    authorId: string
    status: string
    auditStatus?: string
  }
  if (post.status === 'deleted') throw new Error('帖子已删除')
  if (post.authorId !== openid) throw new Error('无权修改')

  const section = normalizePostSection(await db.getById('sections', post.sectionId) as Section)
  if (!section || !Array.isArray(section.widgets) || section.widgets.length === 0) {
    throw new Error('该板块尚未配置内容模板，无法编辑')
  }
  const sanitizedContent = sanitizeContent(params.content, section)
  validateRequiredWidgets(section, sanitizedContent)
  validateContentValues(section, sanitizedContent)

  const updatedAt = new Date().toISOString()
  if (post.auditStatus === 'pass' || !post.auditStatus) {
    await db.runTransaction(async transaction => {
      await transaction.collection('posts').doc(params.postId).update({ data: {
      pendingContent: db.replaceValue(sanitizedContent),
      pendingAuditStatus: 'pending',
      pendingAuditReason: 'content audit pending',
      pendingSubmittedAt: updatedAt,
      updatedAt,
      } })
      await appendPostRagOutboxEvent(transaction, { communityId: post.communityId, aggregateId: params.postId, reasonCode: 'post.updated', now: updatedAt })
    })
    const audit = await auditAndApply({
      postId: params.postId,
      communityId: post.communityId,
      sectionId: post.sectionId,
      section,
      content: sanitizedContent,
      authorId: openid,
      source: 'user',
      contentSlot: 'pendingContent',
    })
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
    await appendPostRagOutboxEvent(transaction, { communityId: post.communityId, aggregateId: params.postId, reasonCode: 'post.updated', now: updatedAt })
  })
  const audit = await auditAndApply({
    postId: params.postId,
    communityId: post.communityId,
    sectionId: post.sectionId,
    section,
    content: sanitizedContent,
    authorId: openid,
    source: 'user',
    contentSlot: 'content',
  })
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

export const main = async (event: any) => {
  const { action, _testOpenid, __happyhomeSmokeIdentity, ...params } = event
  const smokeIdentity = resolvePostRagSmokeIdentity(event, action, String(params.communityId || '').trim())
  logPostRagSmokeIdentityAudit(event, action, String(params.communityId || '').trim(), smokeIdentity)
  const openid = smokeIdentity?.userId || resolveOpenId(event)
  if (smokeIdentity) await ensureActivePostRagSmokeRun(smokeIdentity)
  if (action === 'clientLog') return handleClientLog(params, openid)
  if (action === 'create') return handleCreate(params, openid)
  if (action === 'getActivityInviteState') return handleGetActivityInviteState(params, openid)
  if (action === 'createActivityInvite') return handleCreateActivityInvite(params, openid)
  if (action === 'list') return handleList(params, openid)
  if (action === 'home') return handleHome(params, openid)
  if (action === 'bootstrap') return handleBootstrap(params, openid)
  if (action === 'get') return handleGet(params, openid)
  if (action === 'search') return handleSearch(params, openid)
  if (action === 'delete') return handleDelete(params, openid)
  if (action === 'update') return handleUpdate(params, openid)
  if (action === 'joinAttendance') return handleJoinAttendance(params, openid)
  if (action === 'leaveAttendance') return handleLeaveAttendance(params, openid)
  if (action === 'listAttendanceMembers') return handleListAttendanceMembers(params, openid)
  if (action === 'getMediaUrl') return handleGetMediaUrl(params)
  throw new Error(`Unknown action: ${action}`)
}
