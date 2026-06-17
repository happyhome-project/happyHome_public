import * as db from './db'
import { ensureBackgroundFetchToken } from './background-fetch-token'
import { isPostVisibleToMembers } from './content-audit'
import { getGuestIntroConfig } from './guest-intro-config'
import { ensureCommunityReadable, getActivePublicCommunity, getDefaultPublicCommunityId } from './public-community'
import { normalizeGuideNoteSection } from '../shared/guide-note-widgets'
import { resolveAuthorAvatarUrl } from '../shared/simulated-author-avatars'
import type {
  AttendancePreviewUser,
  AttendanceSummary,
  AttendanceSummaryByWidget,
  Community,
  HomeBootstrapResponse,
  HomeSnapshot,
  Post,
  PostAttendanceMember,
  PostContent,
  Section,
  User,
  Widget,
} from '../shared/types'

const ATTENDANCE_COLLECTION = 'post_attendance_members'
const ATTENDANCE_PREVIEW_LIMIT = 5
const COMMUNITY_READ_ERROR = '需要先加入社区后查看内容'
const HOME_POST_LIMIT_PER_SECTION = 20
export const HOME_SNAPSHOT_SCHEMA_VERSION = 1
export const HOME_PREFETCH_MAX_BYTES = 256 * 1024

function normalizePostSection(section: Section): Section {
  return normalizeGuideNoteSection(section) as Section
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

function normalizeCapacity(widget: Widget): number | undefined {
  const value = Number(widget.capacity)
  if (!Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
}

export async function ensureActiveCommunityMember(communityId: string, userId: string) {
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
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)))
  const entries = await Promise.all(uniqueIds.map(async (userId) => {
    try {
      return [userId, await db.getById('users', userId)] as const
    } catch {
      return [userId, null] as const
    }
  }))
  return Object.fromEntries(entries)
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

function trimText(value: unknown, max = 500) {
  const text = String(value || '')
  return text.length > max ? text.slice(0, max) : text
}

function slimContentValue(value: any, widget: Widget) {
  if (value === undefined || value === null) return value
  if (widget.type === 'image_group' && Array.isArray(value)) return value.slice(0, 3)
  if (widget.type === 'rich_note' && typeof value === 'object' && !Array.isArray(value)) {
    return {
      format: 'markdown',
      markdown: trimText(value.markdown || value.text || '', 700),
      html: '',
      text: trimText(value.text || value.markdown || '', 220),
      imageFileIDs: Array.isArray(value.imageFileIDs) ? value.imageFileIDs.slice(0, 3) : [],
      schemaVersion: 1,
    }
  }
  if (widget.type === 'rich_text') return trimText(value, 500)
  if (['video_group', 'audio_group', 'note_blocks'].includes(widget.type)) return undefined
  if (typeof value === 'string') return trimText(value, 300)
  return value
}

function slimPostContent(content: PostContent, section: Section): PostContent {
  const output: PostContent = {}
  for (const widget of section.widgets || []) {
    const value = slimContentValue((content || {})[widget.widgetId], widget)
    if (value !== undefined) output[widget.widgetId] = value
  }
  return output
}

function slimPostForHome(post: any, section: Section): Post {
  return {
    ...post,
    content: slimPostContent(post.content || {}, section),
  }
}

export async function buildHomeFeed(
  communityId: string,
  openid: string,
  options: { limitPerSection?: number; skipMembershipCheck?: boolean } = {},
) {
  const normalizedCommunityId = String(communityId || '').trim()
  if (!normalizedCommunityId) throw new Error('communityId 不能为空')
  if (!options.skipMembershipCheck) {
    await ensureCommunityReadable(normalizedCommunityId, openid || '', COMMUNITY_READ_ERROR)
  }

  const rawSections = await db.query('sections', { communityId: normalizedCommunityId }, { orderBy: ['order', 'asc'] })
  const sections = (rawSections as Section[]).map(normalizeSectionForClient)
  const sectionById: Record<string, Section | null> = Object.fromEntries(
    sections.map((section) => [section._id, section])
  )
  const sectionIdSet = new Set(sections.map((section) => section._id))
  const limitPerSection = Math.min(
    50,
    Math.max(1, Math.floor(Number(options.limitPerSection || HOME_POST_LIMIT_PER_SECTION)))
  )

  const slicedBySection: Record<string, any[]> = {}
  await Promise.all(sections.map(async (section) => {
    const sectionPosts = await db.query('posts', {
      sectionId: section._id,
      status: 'active',
    }, {
      orderBy: ['createdAt', 'desc'],
      limit: 100,
    })
    slicedBySection[section._id] = (sectionPosts as any[])
      .filter((post) => sectionIdSet.has(post.sectionId))
      .filter(isPostVisibleToMembers)
      .slice()
      .sort(comparePostListOrder)
      .slice(0, limitPerSection)
  }))

  const slicedPosts = Object.values(slicedBySection).flat()
  const withAttendance = await enrichPostsWithAttendance(slicedPosts, sectionById, openid)
  const enrichedPosts = await enrichPostsWithAuthor(withAttendance)
  const enrichedById = new Map(enrichedPosts.map((post: any) => [post._id, post]))
  const postsBySection: Record<string, Post[]> = {}
  for (const section of sections) {
    postsBySection[section._id] = (slicedBySection[section._id] || [])
      .map((post) => enrichedById.get(post._id) || post)
      .map((post) => slimPostForHome(post, section))
  }

  return { sections, postsBySection }
}

export function emptyHomeSnapshot(viewerOpenId = ''): HomeSnapshot {
  return {
    schemaVersion: HOME_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    viewerOpenId,
    currentCommunityId: '',
    currentCommunity: null,
    communities: [],
    sections: [],
    postsBySection: {},
  }
}

async function getActiveCommunitiesForUser(openid: string): Promise<Community[]> {
  if (!openid) return []
  const memberships = await db.query('community_members', {
    userId: openid,
    status: 'active',
  }, {
    orderBy: ['joinedAt', 'desc'],
  })
  const communities = await Promise.all((memberships as any[]).map(async (membership) => {
    try {
      const community = await db.getById('communities', membership.communityId) as Community | null
      return community && community.status === 'active' ? community : null
    } catch {
      return null
    }
  }))
  return communities.filter(Boolean) as Community[]
}

export async function buildHomeSnapshot(
  openid: string,
  options: { currentCommunityId?: string; limitPerSection?: number; user?: Partial<User> | null } = {},
): Promise<HomeSnapshot> {
  const publicCommunityId = getDefaultPublicCommunityId()
  const publicCommunity = publicCommunityId ? await getActivePublicCommunity(publicCommunityId) : null
  if (!openid) {
    if (!publicCommunity) return emptyHomeSnapshot('')
    const feed = await buildHomeFeed(publicCommunity._id, '', {
      limitPerSection: options.limitPerSection,
      skipMembershipCheck: true,
    })
    return {
      schemaVersion: HOME_SNAPSHOT_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      viewerOpenId: '',
      currentCommunityId: publicCommunity._id,
      currentCommunity: publicCommunity,
      communities: [],
      ...feed,
    }
  }
  const communities = await getActiveCommunitiesForUser(openid)
  const user = options.user !== undefined
    ? options.user
    : await db.getById('users', openid).catch(() => null) as User | null
  const preferred = String(options.currentCommunityId || user?.lastHomeCommunityId || '').trim()
  const preferredJoinedCommunity = communities.find((community) => community._id === preferred)
  const currentCommunity = preferredJoinedCommunity?._id ||
    communities[0]?._id ||
    (preferred && publicCommunity?._id === preferred ? preferred : publicCommunity?._id || '')
  const currentCommunityObject = communities.find((community) => community._id === currentCommunity) ||
    (publicCommunity?._id === currentCommunity ? publicCommunity : null)
  if (!currentCommunity) {
    return {
      ...emptyHomeSnapshot(openid),
      communities,
    }
  }
  const feed = await buildHomeFeed(currentCommunity, openid, {
    limitPerSection: options.limitPerSection,
    skipMembershipCheck: true,
  })
  return {
    schemaVersion: HOME_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    viewerOpenId: openid,
    currentCommunityId: currentCommunity,
    currentCommunity: currentCommunityObject,
    communities,
    ...feed,
  }
}

export async function buildHomeBootstrap(
  openid: string,
  options: { currentCommunityId?: string; limitPerSection?: number } = {},
): Promise<HomeBootstrapResponse> {
  if (!openid) {
    const snapshot = await buildHomeSnapshot('', options)
    return {
      ...snapshot,
      ...(snapshot.currentCommunityId ? { guestIntroConfig: await getGuestIntroConfig() } : {}),
      backgroundFetchToken: '',
      backgroundFetchTokenExpiresAt: '',
    }
  }
  const user = await db.getById('users', openid).catch(() => null) as User | null
  const token = await ensureBackgroundFetchToken(openid, user)
  const snapshot = await buildHomeSnapshot(openid, { ...options, user })
  if (user && snapshot.currentCommunityId && user.lastHomeCommunityId !== snapshot.currentCommunityId) {
    await db.updateById('users', openid, {
      lastHomeCommunityId: snapshot.currentCommunityId,
      lastHomeCommunityAt: new Date().toISOString(),
    })
  }
  return {
    ...snapshot,
    backgroundFetchToken: token.backgroundFetchToken,
    backgroundFetchTokenExpiresAt: token.backgroundFetchTokenExpiresAt,
  }
}

export function serializeHomeSnapshotForPrefetch(snapshot: HomeSnapshot) {
  const body = JSON.stringify(snapshot)
  if (Buffer.byteLength(body, 'utf8') > HOME_PREFETCH_MAX_BYTES) {
    return JSON.stringify(emptyHomeSnapshot(snapshot.viewerOpenId))
  }
  return body
}
