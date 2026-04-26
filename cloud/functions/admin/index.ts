import cloud from 'wx-server-sdk'
import * as db from '../../lib/db'
import * as storage from '../../lib/storage'
import {
  assertOwnCommunityOrSuper,
  generateSalt,
  generateSessionToken,
  hashPassword,
  listOwnedCommunityIds,
  verifyPassword,
} from '../../lib/auth'
import { handleCreate as handleCommunityCreate } from '../community'
import type {
  AdminAccount,
  AdminCtx,
  AdminRole,
  AdminSession,
  Community,
  SectionType,
  Widget,
} from '../../shared/types'

cloud.init({ env: process.env.TCB_ENV || cloud.DYNAMIC_CURRENT_ENV })

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'happyhome-admin-2024'
const ADMIN_LEGACY_TOKEN_FALLBACK = process.env.ADMIN_LEGACY_TOKEN_FALLBACK === '1'
// Bootstrap 登录：当 admin_accounts 为空时，命中这两个环境变量的用户名/密码可一键
// 创建首个 superAdmin。和老的 VITE_ADMIN_USERNAME/PASSWORD 共用一组凭据即可。
const BOOTSTRAP_ADMIN_USERNAME = process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin'
const BOOTSTRAP_ADMIN_PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'happyhome2024'
const ATTENDANCE_COLLECTION = 'post_attendance_members'
const ATTENDANCE_PREVIEW_LIMIT = 5
const ADMIN_ACCOUNTS = 'admin_accounts'
const ADMIN_SESSIONS = 'admin_sessions'
const SESSION_TTL_MS = Math.max(
  1,
  Number(process.env.ADMIN_SESSION_TTL_DAYS || 7)
) * 24 * 60 * 60 * 1000

const PUBLIC_ACTIONS = new Set(['auth.login', 'auth.wxLogin'])
const SUPER_ADMIN_ONLY: Array<string | RegExp> = [
  'community.approve',
  'community.reject',
  'community.disable',
  'community.restore',
  'community.hardDelete',
  'community.listDisabled',
  'user.setSuperAdmin',
  /^admin\./,
]
// 这些 action 需要校验对 communityId 的归属（superAdmin 自动放行）
const COMMUNITY_SCOPED_ACTIONS = new Set([
  'community.updateMeta',
  'section.list',
  'section.create',
  'member.pendingList',
  'member.list',
  'member.approve',
  'member.reject',
  'member.kick',
  'post.listAdmin',
])
// 这些 action 只给了实体 id，需要先查出 communityId 再校验
const ENTITY_TO_COMMUNITY_ACTIONS: Record<string, { collection: string; idParam: string }> = {
  'section.get': { collection: 'sections', idParam: 'sectionId' },
  'section.updateMeta': { collection: 'sections', idParam: 'sectionId' },
  'section.updateStatus': { collection: 'sections', idParam: 'sectionId' },
  'section.updateWidgets': { collection: 'sections', idParam: 'sectionId' },
  'section.delete': { collection: 'sections', idParam: 'sectionId' },
  'post.getAdmin': { collection: 'posts', idParam: 'postId' },
  'post.deleteAdmin': { collection: 'posts', idParam: 'postId' },
  'post.removeAttendanceMemberAdmin': { collection: 'posts', idParam: 'postId' },
}

function matchesAction(action: string, rules: Array<string | RegExp>): boolean {
  return rules.some((rule) => (typeof rule === 'string' ? rule === action : rule.test(action)))
}

function normalizeSection(section: any) {
  return {
    ...section,
    type: section?.type || 'evergreen',
    status: section?.status || 'active',
    enableComment: section?.enableComment !== false,
    enableLike: section?.enableLike !== false,
  }
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

function includesKeyword(...parts: Array<unknown>) {
  const haystack = parts.map((part) => String(part || '').toLowerCase()).join(' ')
  return (keyword: string) => !keyword || haystack.includes(keyword)
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

function normalizeWidgetForSave(widget: any): Widget {
  const normalized: Widget = {
    ...widget,
    required: widget?.type === 'attendance' ? false : widget?.required === true,
  }
  if (normalized.type === 'attendance') {
    normalized.capacity = normalizeCapacity(normalized.capacity)
  } else {
    delete normalized.capacity
  }
  return normalized
}

function isInvalidWidgetLabel(label: unknown) {
  const text = String(label || '').trim().toLowerCase()
  return !text || text === '新控件' || text === 'new widget'
}

function validateSectionWidgets(sectionType: SectionType, widgets: any[]) {
  const showInListCount = widgets.filter((widget: any) => widget.showInList).length
  if (showInListCount > 3) throw new Error('showInList 最多只能有 3 个控件')

  const attendanceWidgets = widgets.filter((widget: any) => widget.type === 'attendance')
  if (attendanceWidgets.length > 1) throw new Error('每个板块最多只能配置 1 个活动参与控件')
  if (attendanceWidgets.length > 0 && sectionType !== 'realtime') {
    throw new Error('活动参与控件只能用于 realtime 板块')
  }

  for (const widget of widgets) {
    if (isInvalidWidgetLabel(widget.label)) {
      throw new Error('控件标签名不能为空或占位文案')
    }
    if (widget.showInList && !['short_text', 'summary', 'datetime', 'number', 'attendance'].includes(widget.type)) {
      throw new Error(`控件类型 ${widget.type} 不支持在列表展示`)
    }
    if (widget.type === 'attendance' && widget.required) {
      throw new Error('活动参与控件不能设为必填')
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

async function getAttendanceRecords(postId: string, widgetId: string) {
  return db.query(
    ATTENDANCE_COLLECTION,
    { postId, widgetId },
    { orderBy: ['joinedAt', 'desc'] }
  )
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

async function publicRoute(action: string, params: Record<string, any>) {
  if (action === 'auth.login') {
    const username = String(params.username || '').trim()
    const password = String(params.password || '')
    if (!username || !password) throw new Error('用户名和密码不能为空')

    let account = await findAccountByUsername(username)

    // ---- Bootstrap：admin_accounts 为空 + 命中 env 凭据时自动 seed 首个 superAdmin ----
    if (!account
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

  if (action === 'auth.wxLogin') {
    // 扩展位：目前暂未实现。未来流程：
    //   1. 用 cloud.getWXContext() 或 CloudBase 自定义登录 解出 openId
    //   2. 按 userId === openId 查 admin_accounts
    //   3. 命中则 createSessionForAccount，否则返回 account_not_bound
    throw new Error('wechat login not configured yet')
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
    await db.updateById('communities', communityId, { status: 'active' })

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
    await db.updateById('communities', params.communityId, { status: 'rejected' })
    return { success: true }
  }
  if (action === 'community.disable') {
    const community = await db.getById('communities', params.communityId) as Community | null
    if (!community) throw new Error('community not found')
    if (community.status !== 'active') throw new Error('only active community can be disabled')
    await db.updateById('communities', params.communityId, { status: 'disabled' })
    return { success: true }
  }
  if (action === 'community.restore') {
    const community = await db.getById('communities', params.communityId) as Community | null
    if (!community) throw new Error('community not found')
    if (community.status !== 'disabled') throw new Error('only disabled community can be restored')
    await db.updateById('communities', params.communityId, { status: 'active' })
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
    if (typeof params.name === 'string') updates.name = params.name
    if (typeof params.description === 'string') updates.description = params.description
    if (typeof params.motto === 'string') updates.motto = params.motto
    if (typeof params.mottoCite === 'string') updates.mottoCite = params.mottoCite
    if (Object.keys(updates).length === 0) throw new Error('没有可更新字段')
    await db.updateById('communities', communityId, updates)
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

  if (action === 'section.list') {
    const raw = await db.query('sections', { communityId: params.communityId }, { orderBy: ['order', 'asc'] })
    return { sections: raw.map((section: any) => normalizeSection(section)) }
  }
  if (action === 'section.create') {
    const type = params.type === 'realtime' ? 'realtime' : 'evergreen'
    const sectionId = await db.create('sections', {
      communityId: params.communityId,
      name: params.name,
      icon: params.icon || '',
      order: params.order ?? 0,
      enableComment: params.enableComment !== false,
      enableLike: params.enableLike !== false,
      widgets: [],
      createdAt: new Date().toISOString(),
      type,
      status: 'active',
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
    if (typeof params.accentColor === 'string') updates.accentColor = params.accentColor
    if (typeof params.enableComment === 'boolean') updates.enableComment = params.enableComment
    if (typeof params.enableLike === 'boolean') updates.enableLike = params.enableLike
    if (updates.type === 'evergreen') updates.status = 'active'
    if (Object.keys(updates).length === 0) throw new Error('没有可更新字段')
    await db.updateById('sections', sectionId, updates)
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
    await db.updateById('sections', sectionId, { status: params.status })
    return { success: true }
  }
  if (action === 'section.updateWidgets') {
    const { v4: uuidv4 } = await import('uuid')
    const sectionId = String(params.sectionId || '').trim()
    if (!sectionId) throw new Error('sectionId 不能为空')

    const currentSection = normalizeSection(await db.getById('sections', sectionId))
    const widgets = (params.widgets || []).map((widget: any) => normalizeWidgetForSave({
      ...widget,
      widgetId: widget.widgetId || uuidv4(),
    }))
    validateSectionWidgets(currentSection.type, widgets)

    const currentWidgets = currentSection.widgets || []
    const nextIds = new Set(widgets.map((widget: any) => String(widget.widgetId || '')))
    const removedWidgets = currentWidgets.filter((widget: any) => !nextIds.has(String(widget.widgetId || '')))
    const currentById = new Map<string, any>(currentWidgets.map((widget: any) => [String(widget.widgetId || ''), widget]))
    const changedTypeWidgets = widgets.filter((widget: any) => {
      const current = currentById.get(String(widget.widgetId || ''))
      return current && current.type !== widget.type
    })
    const activePosts = await db.query('posts', { sectionId, status: 'active' })
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
    const hasStructuralChanges =
      impact.structuralChanges.removedWidgetIds.length > 0 ||
      impact.structuralChanges.changedTypeWidgetIds.length > 0

    if (params.preview) {
      return { widgets, ...impact, requireConfirmation: hasActivePosts && hasStructuralChanges }
    }
    if (hasActivePosts && hasStructuralChanges && !params.confirmStructureChange) {
      throw new Error('板块已有内容，本次结构变更需要确认')
    }

    await db.updateById('sections', sectionId, { widgets })
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

    const community = await db.getById('communities', communityId) as Community
    const member = await db.getById('community_members', memberId) as any
    if (!member || member.communityId !== communityId) throw new Error('member not found')
    if (member.userId === community.creatorId) throw new Error('不能移出社区创建者')
    if (member.role !== 'member') throw new Error('不能移出管理员')

    const status = String(member.status || '').trim()
    if (!['active', 'rejected', 'pending'].includes(status)) {
      throw new Error('当前状态不支持移除')
    }

    await db.removeById('community_members', memberId)
    if (status === 'active') {
      await db.increment('communities', communityId, 'memberCount', -1)
    }
    return { success: true }
  }
  if (action === 'member.approve') {
    const updateRes = await db.updateWhere('community_members', {
      _id: params.memberId,
      communityId: params.communityId,
      status: 'pending',
    }, {
      status: 'active',
      joinedAt: new Date().toISOString(),
    })
    if ((updateRes as any)?.stats?.updated > 0) {
      await db.increment('communities', params.communityId, 'memberCount', 1)
    }
    return { success: true, changed: (updateRes as any)?.stats?.updated > 0 }
  }
  if (action === 'member.reject') {
    const updateRes = await db.updateWhere('community_members', {
      _id: params.memberId,
      communityId: params.communityId,
      status: 'pending',
    }, {
      status: 'rejected',
      rejectedAt: new Date().toISOString(),
    })
    return { success: true, changed: (updateRes as any)?.stats?.updated > 0 }
  }

  if (action === 'post.listAdmin') {
    const communityId = String(params.communityId || '').trim()
    if (!communityId) throw new Error('communityId 不能为空')
    const sectionId = String(params.sectionId || '').trim()
    const authorKeyword = normalizeKeyword(params.authorQuery)
    const statusFilter = String(params.status || 'active').trim()
    const fromTimestamp = parseDateBoundary(String(params.dateFrom || '').trim())
    const toTimestamp = parseDateBoundary(String(params.dateTo || '').trim(), true)

    let posts = await db.query('posts', { communityId }, { orderBy: ['createdAt', 'desc'] })
    if (sectionId) posts = posts.filter((post: any) => post.sectionId === sectionId)
    if (statusFilter !== 'all') posts = posts.filter((post: any) => post.status === statusFilter)
    if (fromTimestamp !== null) {
      posts = posts.filter((post: any) => Date.parse(String(post.createdAt || '')) >= fromTimestamp)
    }
    if (toTimestamp !== null) {
      posts = posts.filter((post: any) => Date.parse(String(post.createdAt || '')) <= toTimestamp)
    }

    const usersById = await getUsersByIds(posts.map((post: any) => String(post.authorId || '')))
    const sectionsById = await getSectionsByIds(posts.map((post: any) => String(post.sectionId || '')))

    const list = await Promise.all(posts.map(async (post: any) => {
      const author = usersById[post.authorId]
      const section = sectionsById[post.sectionId]
      return {
        ...post,
        authorNickname: author?.nickName || '',
        sectionName: section?.name || '',
        sectionType: section?.type || '',
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
    const [author, section] = await Promise.all([
      post.authorId ? db.getById('users', post.authorId).catch(() => null) : null,
      post.sectionId ? db.getById('sections', post.sectionId).catch(() => null) : null,
    ])
    const normalizedSection = section ? normalizeSection(section) : null
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
        authorNickname: (author as any)?.nickName || '',
        attendanceSummaryByWidget,
      },
      section: normalizedSection,
      attendanceMembersByWidget,
    }
  }
  if (action === 'post.deleteAdmin') {
    const postId = String(params.postId || '').trim()
    if (!postId) throw new Error('postId 不能为空')
    const post = await db.getById('posts', postId) as any
    if (!post) throw new Error('post not found')
    if (post.status === 'deleted') {
      return { success: true, alreadyDeleted: true }
    }
    await db.softDelete('posts', postId)
    return { success: true }
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

  if (action === 'admin.listAccounts') {
    const accounts = (await db.query(ADMIN_ACCOUNTS, {}, { orderBy: ['createdAt', 'desc'] })) as AdminAccount[]
    return {
      accounts: accounts.map((a) => ({
        _id: a._id,
        username: a.username,
        role: a.role,
        status: a.status,
        userId: a.userId || '',
        createdAt: a.createdAt,
        createdBy: a.createdBy || '',
      })),
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
  if (action === 'admin.disableAccount') {
    const accountId = String(params.accountId || '').trim()
    if (!accountId) throw new Error('accountId 不能为空')
    if (accountId === ctx.accountId) throw new Error('不能停用自己的账号')
    await db.updateById(ADMIN_ACCOUNTS, accountId, { status: 'disabled' })
    const sessions = (await db.query(ADMIN_SESSIONS, { accountId })) as AdminSession[]
    await Promise.all(sessions.map((s) => db.removeById(ADMIN_SESSIONS, s._id).catch(() => null)))
    return { success: true, revokedSessions: sessions.length }
  }
  if (action === 'admin.enableAccount') {
    const accountId = String(params.accountId || '').trim()
    if (!accountId) throw new Error('accountId 不能为空')
    await db.updateById(ADMIN_ACCOUNTS, accountId, { status: 'active' })
    return { success: true }
  }
  if (action === 'admin.bindWechat') {
    const accountId = String(params.accountId || '').trim()
    const openId = String(params.openId || '').trim()
    if (!accountId || !openId) throw new Error('accountId 和 openId 不能为空')
    const existing = await findAccountByUserId(openId)
    if (existing && existing._id !== accountId) {
      throw new Error('该微信身份已绑定到其他账号')
    }
    await db.updateById(ADMIN_ACCOUNTS, accountId, { userId: openId })
    return { success: true }
  }

  throw new Error(`Unknown action: ${action}`)
}

async function hardDeleteCommunity(communityId: string, community: Community) {
  const fileIDs: string[] = []
  if (community.coverImage) fileIDs.push(community.coverImage)

  const posts = await db.query('posts', { communityId })
  for (const post of posts) {
    const content = (post as any).content || {}
    for (const value of Object.values(content)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string' && item.startsWith('cloud://')) {
            fileIDs.push(item)
          }
        }
      }
    }
  }

  for (const post of posts) {
    await db.removeById('posts', (post as any)._id)
  }

  const attendanceRecords = await db.query(ATTENDANCE_COLLECTION, { communityId })
  for (const record of attendanceRecords) {
    await db.removeById(ATTENDANCE_COLLECTION, (record as any)._id)
  }

  const sections = await db.query('sections', { communityId })
  for (const section of sections) {
    await db.removeById('sections', (section as any)._id)
  }

  const members = await db.query('community_members', { communityId })
  for (const member of members) {
    await db.removeById('community_members', (member as any)._id)
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
        const result = await publicRoute(action, params)
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

    // 非 HTTP 触发（内部云函数 / 测试直调）：视为 superAdmin，允许注入 ctx
    const { action, _actAs, ...params } = event
    if (PUBLIC_ACTIONS.has(action)) return publicRoute(action, params)
    const ctx: AdminCtx = _actAs || {
      accountId: 'internal',
      role: 'superAdmin',
      userId: '',
      username: 'internal',
    }
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
        body: JSON.stringify({ error: msg, stack: error.stack }),
      }
    }
    throw error
  }
}
