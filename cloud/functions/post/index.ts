import cloud from 'wx-server-sdk'
import * as db from '../../lib/db'
import { resolveOpenId } from '../../lib/ctx'
import { getTempUrl } from '../../lib/storage'
import { sanitizeContent, validateRequiredWidgets } from '../../lib/post-validate'
import type {
  AttendancePreviewUser,
  AttendanceSummary,
  AttendanceSummaryByWidget,
  PostAttendanceMember,
  Section,
  Widget,
  PostContent,
} from '../../shared/types'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const ATTENDANCE_COLLECTION = 'post_attendance_members'
const ATTENDANCE_PREVIEW_LIMIT = 5
const COMMUNITY_READ_ERROR = '需要先加入社区后查看内容'

function getAttendanceWidgets(section: Section): Widget[] {
  return (section.widgets || []).filter((widget) => widget.type === 'attendance')
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
async function enrichPostsWithAuthor<T extends { authorId?: string }>(posts: T[]): Promise<Array<T & { authorNickname?: string; authorAvatarUrl?: string }>> {
  if (!posts.length) return posts as any
  const usersById = await getUsersByIds(posts.map((p) => p.authorId).filter(Boolean) as string[])
  return posts.map((p) => ({
    ...p,
    authorNickname: usersById[p.authorId || '']?.nickName || '',
    authorAvatarUrl: usersById[p.authorId || '']?.avatarUrl || '',
  }))
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
  const usersById = await getUsersByIds(records.map((record) => record.userId))
  const previewUsers: AttendancePreviewUser[] = records.slice(0, ATTENDANCE_PREVIEW_LIMIT).map((record) => ({
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
  if (!post || post.status === 'deleted') throw new Error('帖子不存在')
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

  const section = await db.getById('sections', params.sectionId) as Section
  // 板块尚未配置控件时，禁止发帖（否则会产生无任何字段的空 post）
  if (!section || !Array.isArray(section.widgets) || section.widgets.length === 0) {
    throw new Error('该板块尚未配置内容模板，请联系管理员完善板块设置后再发布')
  }
  const sanitizedContent = sanitizeContent(params.content, section)
  validateRequiredWidgets(section, sanitizedContent)

  const now = new Date().toISOString()
  const postId = await db.create('posts', {
    communityId: params.communityId,
    sectionId: params.sectionId,
    authorId: openid,
    status: 'active',
    content: sanitizedContent,
    commentCount: 0,
    likeCount: 0,
    createdAt: now,
    updatedAt: now,
  })

  return { postId }
}

export async function handleList(params: {
  sectionId: string
  skip?: number
  limit?: number
}, openid?: string) {
  const section = await db.getById('sections', params.sectionId) as Section
  await ensureActiveCommunityMember(section.communityId, openid || '')
  const posts = await db.query('posts', {
    sectionId: params.sectionId,
    status: 'active',
  }, {
    orderBy: ['createdAt', 'desc'],
    skip: params.skip ?? 0,
    limit: params.limit ?? 20,
  })
  const withAttendance = await enrichPostsWithAttendance(posts as any[], { [params.sectionId]: section }, openid)
  const enrichedPosts = await enrichPostsWithAuthor(withAttendance)
  return { posts: enrichedPosts }
}

export async function handleGet(params: { postId: string }, openid?: string) {
  const post = await db.getById('posts', params.postId) as any
  if (post.status === 'deleted') throw new Error('帖子不存在')
  await ensureActiveCommunityMember(post.communityId, openid || '')
  const section = await db.getById('sections', post.sectionId) as Section
  const attendanceSummaryByWidget = await buildAttendanceSummaryByWidget(post._id, section, openid)
  const [enrichedPost] = await enrichPostsWithAuthor([{ ...post, attendanceSummaryByWidget }])
  return { post: enrichedPost }
}

export async function handleDelete(params: { postId: string }, openid: string) {
  if (!openid) throw new Error('Missing OPENID')

  const post = await db.getById('posts', params.postId) as { authorId: string; status: string }
  if (post.status === 'deleted') throw new Error('帖子已删除')
  if (post.authorId !== openid) throw new Error('无权删除')

  await db.softDelete('posts', params.postId)
  return { success: true }
}

export async function handleUpdate(
  params: { postId: string; content: PostContent },
  openid: string,
) {
  if (!openid) throw new Error('Missing OPENID')

  const post = await db.getById('posts', params.postId) as {
    sectionId: string
    authorId: string
    status: string
  }
  if (post.status === 'deleted') throw new Error('帖子已删除')
  if (post.authorId !== openid) throw new Error('无权修改')

  const section = await db.getById('sections', post.sectionId) as Section
  if (!section || !Array.isArray(section.widgets) || section.widgets.length === 0) {
    throw new Error('该板块尚未配置内容模板，无法编辑')
  }
  const sanitizedContent = sanitizeContent(params.content, section)
  validateRequiredWidgets(section, sanitizedContent)

  const updatedAt = new Date().toISOString()
  await db.updateById('posts', params.postId, {
    content: sanitizedContent,
    updatedAt,
  })
  return { success: true, updatedAt }
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

export const main = async (event: any) => {
  const openid = resolveOpenId(event)
  const { action, _testOpenid, ...params } = event
  if (action === 'create') return handleCreate(params, openid)
  if (action === 'list') return handleList(params, openid)
  if (action === 'get') return handleGet(params, openid)
  if (action === 'delete') return handleDelete(params, openid)
  if (action === 'update') return handleUpdate(params, openid)
  if (action === 'joinAttendance') return handleJoinAttendance(params, openid)
  if (action === 'leaveAttendance') return handleLeaveAttendance(params, openid)
  if (action === 'listAttendanceMembers') return handleListAttendanceMembers(params, openid)
  if (action === 'getMediaUrl') return handleGetMediaUrl(params)
  throw new Error(`Unknown action: ${action}`)
}
