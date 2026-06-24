import cloud from 'wx-server-sdk'
import * as db from '../../lib/db'
import { resolveOpenId } from '../../lib/ctx'
import { getTempUrl } from '../../lib/storage'
import { sanitizeContent, validateContentValues, validateRequiredWidgets } from '../../lib/post-validate'
import { auditAndApply, isPostVisibleToMembers } from '../../lib/content-audit'
import { buildHomeBootstrap, buildHomeFeed } from '../../lib/home-snapshot'
import { ensureCommunityReadable } from '../../lib/public-community'
import { removePostSearchIndex, searchPostIndex } from '../../lib/post-search'
import type {
  AttendancePreviewUser,
  AttendanceSummary,
  AttendanceSummaryByWidget,
  PostAttendanceMember,
  Section,
  Widget,
  PostContent,
} from '../../shared/types'
import { normalizeGuideNoteSection } from '../../shared/guide-note-widgets'
import { resolveAuthorAvatarUrl } from '../../shared/simulated-author-avatars'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const ATTENDANCE_COLLECTION = 'post_attendance_members'
const ATTENDANCE_PREVIEW_LIMIT = 5
const COMMUNITY_READ_ERROR = '需要先加入社区后查看内容'
const HOME_POST_LIMIT_PER_SECTION = 20
const DEFAULT_SEARCH_LIMIT = 20

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

function normalizeCapacity(widget: Widget): number | undefined {
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
async function enrichPostsWithAuthor<T extends { _id?: string; authorId?: string }>(posts: T[]): Promise<Array<T & { authorNickname?: string; authorAvatarUrl?: string }>> {
  if (!posts.length) return posts as any
  const usersById = await getUsersByIds(posts.map((p) => p.authorId).filter(Boolean) as string[])
  return posts.map((p) => {
    const author = usersById[p.authorId || '']
    return {
      ...p,
      authorNickname: author?.nickName || '',
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
  postId: string,
  widget: Widget,
  viewerId?: string
): Promise<AttendanceSummary> {
  const records = await getAttendanceRecords(postId, widget.widgetId)
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
  const capacity = normalizeCapacity(widget)
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
  postId: string,
  section: Section,
  viewerId?: string
): Promise<AttendanceSummaryByWidget> {
  const summaries = await Promise.all(
    getAttendanceWidgets(section).map(async (widget) => ([
      widget.widgetId,
      await buildAttendanceSummary(postId, widget, viewerId),
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
        ? await buildAttendanceSummaryByWidget(post._id, section, viewerId)
        : {}
      return { ...post, attendanceSummaryByWidget }
    })
  )
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
  const capacity = normalizeCapacity(widget)
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
  const postId = await db.create('posts', {
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
  const enrichedPosts = await enrichPostsWithAuthor(withAttendance)
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
  const attendanceSummaryByWidget = await buildAttendanceSummaryByWidget(post._id, section, viewerId)
  const [enrichedPost] = await enrichPostsWithAuthor([{ ...post, attendanceSummaryByWidget }])
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
  return searchPostIndex({
    communityId,
    query: String(params.q ?? params.query ?? ''),
    sectionId: String(params.sectionId || '').trim(),
    skip: Number.isFinite(Number(params.skip)) ? Math.max(0, Math.floor(Number(params.skip))) : 0,
    limit: Number.isFinite(Number(params.limit)) && Number(params.limit) > 0
      ? Math.floor(Number(params.limit))
      : DEFAULT_SEARCH_LIMIT,
  })
}

export async function handleDelete(params: { postId: string }, openid: string) {
  if (!openid) throw new Error('Missing OPENID')

  const post = await db.getById('posts', params.postId) as { authorId: string; status: string }
  if (post.status === 'deleted') throw new Error('帖子已删除')
  if (post.authorId !== openid) throw new Error('无权删除')

  await db.updateById('posts', params.postId, {
    status: 'deleted',
    isPinned: false,
    pinnedAt: '',
    pinnedByAccountId: '',
    isFeatured: false,
    featuredAt: '',
    featuredByAccountId: '',
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
    await db.updateById('posts', params.postId, {
      pendingContent: db.replaceValue(sanitizedContent),
      pendingAuditStatus: 'pending',
      pendingAuditReason: 'content audit pending',
      pendingSubmittedAt: updatedAt,
      updatedAt,
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

  await db.updateById('posts', params.postId, {
    content: db.replaceValue(sanitizedContent),
    auditStatus: 'pending',
    auditReason: 'content audit pending',
    auditUpdatedAt: updatedAt,
    updatedAt,
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
    const capacity = normalizeCapacity(widget)
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

  const summary = await buildAttendanceSummary(post._id, widget, openid)
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

  const summary = await buildAttendanceSummary(post._id, widget, openid)
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
  const openid = resolveOpenId(event)
  const { action, _testOpenid, ...params } = event
  if (action === 'clientLog') return handleClientLog(params, openid)
  if (action === 'create') return handleCreate(params, openid)
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
