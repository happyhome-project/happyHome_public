import cloud from 'wx-server-sdk'
import * as db from '../../lib/db'
import * as storage from '../../lib/storage'
import type { Community } from '../../shared/types'

cloud.init({ env: process.env.TCB_ENV || cloud.DYNAMIC_CURRENT_ENV })

// 临时管理员 token，上线前替换为真实鉴权
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'happyhome-admin-2024'

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

async function route(action: string, params: Record<string, any>) {
  // ---- 用户管理 ----
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

  // ---- 社区管理 ----
  if (action === 'community.list') {
    const [active, pending, rejected] = await Promise.all([
      db.query('communities', { status: 'active' }, { orderBy: ['createdAt', 'desc'] }),
      db.query('communities', { status: 'pending' }, { orderBy: ['createdAt', 'desc'] }),
      db.query('communities', { status: 'rejected' }, { orderBy: ['createdAt', 'desc'] }),
    ])
    return { communities: [...active, ...pending, ...rejected] }
  }
  if (action === 'community.approve') {
    await db.updateById('communities', params.communityId, { status: 'active' })
    return { success: true }
  }
  if (action === 'community.reject') {
    await db.updateById('communities', params.communityId, { status: 'rejected' })
    return { success: true }
  }
  if (action === 'community.disable') {
    const c = await db.getById('communities', params.communityId) as Community | null
    if (!c) throw new Error('community not found')
    if (c.status !== 'active') throw new Error('only active community can be disabled')
    await db.updateById('communities', params.communityId, { status: 'disabled' })
    return { success: true }
  }
  if (action === 'community.restore') {
    const c = await db.getById('communities', params.communityId) as Community | null
    if (!c) throw new Error('community not found')
    if (c.status !== 'disabled') throw new Error('only disabled community can be restored')
    await db.updateById('communities', params.communityId, { status: 'active' })
    return { success: true }
  }
  if (action === 'community.listDisabled') {
    const communities = await db.query(
      'communities',
      { status: 'disabled' },
      { orderBy: ['createdAt', 'desc'] }
    )
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
    if (Object.keys(updates).length === 0) throw new Error('无可更新字段')
    await db.updateById('communities', communityId, updates)
    return { success: true }
  }
  if (action === 'community.hardDelete') {
    const c = await db.getById('communities', params.communityId) as Community | null
    if (!c) throw new Error('community not found')
    if (c.status !== 'disabled') {
      throw new Error('only disabled community can be hard-deleted. disable it first.')
    }
    await hardDeleteCommunity(params.communityId, c)
    return { success: true }
  }

  // ---- 板块管理 ----
  if (action === 'section.list') {
    const raw = await db.query('sections', { communityId: params.communityId }, { orderBy: ['order', 'asc'] })
    const sections = raw.map((s: any) => normalizeSection(s))
    return { sections }
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
    const s: any = await db.getById('sections', params.sectionId)
    const section = s ? normalizeSection(s) : null
    return { section }
  }
  if (action === 'section.updateMeta') {
    const sectionId = String(params.sectionId || '').trim()
    if (!sectionId) throw new Error('sectionId 不能为空')
    const updates: Record<string, any> = {}
    if (typeof params.name === 'string') updates.name = params.name
    if (typeof params.icon === 'string') updates.icon = params.icon
    if (typeof params.order === 'number') updates.order = params.order
    if (params.type === 'realtime' || params.type === 'evergreen') updates.type = params.type
    if (params.status === 'active' || params.status === 'dormant' || params.status === 'archived') {
      updates.status = params.status
    }
    if (typeof params.accentColor === 'string') updates.accentColor = params.accentColor
    if (typeof params.enableComment === 'boolean') updates.enableComment = params.enableComment
    if (typeof params.enableLike === 'boolean') updates.enableLike = params.enableLike
    // evergreen 强制 active
    if (updates.type === 'evergreen') updates.status = 'active'
    if (Object.keys(updates).length === 0) throw new Error('无可更新字段')
    await db.updateById('sections', sectionId, updates)
    return { success: true }
  }
  if (action === 'section.updateStatus') {
    const sectionId = String(params.sectionId || '').trim()
    if (!sectionId) throw new Error('sectionId 不能为空')
    if (params.status !== 'active' && params.status !== 'dormant' && params.status !== 'archived') {
      throw new Error('status 必须是 active/dormant/archived 之一')
    }
    const s: any = await db.getById('sections', sectionId)
    if (!s) throw new Error('板块不存在')
    const currentType = s.type || 'evergreen'
    if (currentType === 'evergreen' && params.status !== 'active') {
      throw new Error('沉淀展示类板块（evergreen）只能保持 active 状态')
    }
    await db.updateById('sections', sectionId, { status: params.status })
    return { success: true }
  }
  if (action === 'section.updateWidgets') {
    const { v4: uuidv4 } = await import('uuid')
    const sectionId = String(params.sectionId || '').trim()
    if (!sectionId) throw new Error('sectionId 不能为空')
    const currentSection = normalizeSection(await db.getById('sections', sectionId))
    const widgets = (params.widgets || []).map((w: any) => ({
      ...w,
      widgetId: w.widgetId || uuidv4(),
    }))
    // Validate showInList count <= 3
    const showInListCount = widgets.filter((w: any) => w.showInList).length
    if (showInListCount > 3) throw new Error('showInList 最多只能有 3 个控件')
    for (const widget of widgets) {
      if (widget.showInList && !['short_text', 'summary', 'datetime', 'number'].includes(widget.type)) {
        throw new Error(`控件类型 ${widget.type} 不支持在列表展示`)
      }
    }

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

  // ---- 成员审批 ----
  if (action === 'member.pendingList') {
    const communityId = String(params.communityId || '').trim()
    if (!communityId) throw new Error('communityId 不能为空')
    const members = await db.query('community_members', {
      communityId,
      status: 'pending',
    })
    return { members }
  }
  if (action === 'member.list') {
    const communityId = String(params.communityId || '').trim()
    if (!communityId) throw new Error('communityId 不能为空')
    const keyword = normalizeKeyword(params.q)
    const statusFilter = String(params.status || 'all').trim()
    const visibleStatuses = new Set(['pending', 'active', 'rejected'])
    const community = await db.getById('communities', communityId) as Community
    const members = await db.query(
      'community_members',
      { communityId },
      { orderBy: ['appliedAt', 'desc'] }
    )
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
    const usersById = await getUsersByIds(activeMembers.map((m: any) => String(m.userId || '')))

    const list = activeMembers.map((m: any) => ({
      ...m,
      nickName: usersById[m.userId]?.nickName || '',
      avatarUrl: usersById[m.userId]?.avatarUrl || '',
      isCreator: m.userId === community.creatorId,
    })).filter((member: any) => {
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
    if (!member || member.communityId !== communityId) throw new Error('成员不存在')
    if (member.status !== 'active') throw new Error('只能移出已加入成员')
    if (member.userId === community.creatorId) throw new Error('不能移出社区创建者')
    if (member.role !== 'member') throw new Error('不能移出管理员')

    await db.removeById('community_members', memberId)
    await db.increment('communities', communityId, 'memberCount', -1)
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

  // ---- 帖子管理 ----
  if (action === 'post.listAdmin') {
    const communityId = String(params.communityId || '').trim()
    if (!communityId) throw new Error('communityId 不能为空')
    const sectionId = String(params.sectionId || '').trim()
    const authorKeyword = normalizeKeyword(params.authorQuery)
    const statusFilter = String(params.status || 'active').trim()
    const dateFrom = String(params.dateFrom || '').trim()
    const dateTo = String(params.dateTo || '').trim()
    const fromTimestamp = parseDateBoundary(dateFrom)
    const toTimestamp = parseDateBoundary(dateTo, true)

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

    const list = posts.map((post: any) => {
      const author = usersById[post.authorId]
      const section = sectionsById[post.sectionId]
      return {
        ...post,
        authorNickname: author?.nickName || '',
        sectionName: section?.name || '',
        sectionType: section?.type || '',
      }
    }).filter((post: any) => includesKeyword(post.authorId, post.authorNickname)(authorKeyword))

    return { posts: list, total: list.length }
  }
  if (action === 'post.getAdmin') {
    const postId = String(params.postId || '').trim()
    if (!postId) throw new Error('postId 不能为空')
    const post = await db.getById('posts', postId) as any
    const [author, section] = await Promise.all([
      post.authorId ? db.getById('users', post.authorId).catch(() => null) : null,
      post.sectionId ? db.getById('sections', post.sectionId).catch(() => null) : null,
    ])
    return {
      post: {
        ...post,
        authorNickname: (author as any)?.nickName || '',
      },
      section: section ? normalizeSection(section) : null,
    }
  }
  if (action === 'post.deleteAdmin') {
    const postId = String(params.postId || '').trim()
    if (!postId) throw new Error('postId 不能为空')
    const post = await db.getById('posts', postId) as any
    if (!post) throw new Error('帖子不存在')
    if (post.status === 'deleted') {
      return { success: true, alreadyDeleted: true }
    }
    await db.softDelete('posts', postId)
    return { success: true }
  }

  throw new Error(`Unknown action: ${action}`)
}

/**
 * 硬删社区 —— 真删文档 + 级联删子资源 + 清理 COS 文件
 * 前置：调用方已经校验 community 存在且 status === 'disabled'
 *
 * 顺序：
 *   1) 收集所有 COS fileID（封面 + 所有 post 的 image_group 图片）
 *   2) 批量 remove 数据文档（posts → sections → community_members → community 本体）
 *   3) 清 COS（失败不阻塞，最多留孤儿文件）
 */
async function hardDeleteCommunity(communityId: string, community: Community) {
  // 1) 收集 fileID
  const fileIDs: string[] = []
  if (community.coverImage) fileIDs.push(community.coverImage)

  const posts = await db.query('posts', { communityId })  // 不过滤 status，deleted 的也要扫
  for (const post of posts) {
    const content = (post as any).content || {}
    for (const val of Object.values(content)) {
      if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === 'string' && item.startsWith('cloud://')) {
            fileIDs.push(item)
          }
        }
      }
    }
  }

  // 2) 删文档（CloudBase 无批量 remove，循环调用）
  for (const post of posts) {
    await db.removeById('posts', (post as any)._id)
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

  // 3) 清 COS（失败不阻塞）
  if (fileIDs.length > 0) {
    try {
      await storage.deleteFile(fileIDs)
    } catch (e) {
      console.error('[hardDelete] COS cleanup failed, orphan files:', fileIDs, e)
    }
  }
}

export const main = async (event: any) => {
  const H = { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
  try {
    // HTTP trigger 调用（来自管理后台）
    if (event.httpMethod) {
      if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: { ...H, 'access-control-allow-headers': 'content-type,authorization', 'access-control-allow-methods': 'POST,OPTIONS' }, body: '' }
      }
      const auth = (event.headers?.authorization || event.headers?.Authorization || '') as string
      if (auth !== `Bearer ${ADMIN_TOKEN}`) {
        return { statusCode: 403, headers: H, body: JSON.stringify({ error: 'Unauthorized' }) }
      }
      let body: any = {}
      try { body = JSON.parse(event.body || '{}') } catch {}
      const { action, ...params } = body
      const result = await route(action, params)
      return { statusCode: 200, headers: H, body: JSON.stringify(result) }
    }

    // 云函数直接调用（控制台测试用）
    const { action, ...params } = event
    return route(action, params)
  } catch (e: any) {
    if (event.httpMethod) {
      return { statusCode: 500, headers: H, body: JSON.stringify({ error: e.message, stack: e.stack }) }
    }
    throw e
  }
}
