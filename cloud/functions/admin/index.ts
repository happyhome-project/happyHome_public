import cloud from 'wx-server-sdk'
import * as db from '../../lib/db'
import * as storage from '../../lib/storage'
import type { Community } from '../../shared/types'

cloud.init({ env: process.env.TCB_ENV || cloud.DYNAMIC_CURRENT_ENV })

// 临时管理员 token，上线前替换为真实鉴权
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'happyhome-admin-2024'

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
    const [active, pending] = await Promise.all([
      db.query('communities', { status: 'active' }, { orderBy: ['createdAt', 'desc'] }),
      db.query('communities', { status: 'pending' }, { orderBy: ['createdAt', 'desc'] }),
    ])
    return { communities: [...active, ...pending] }
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
    const sections = await db.query('sections', { communityId: params.communityId }, { orderBy: ['order', 'asc'] })
    return { sections }
  }
  if (action === 'section.create') {
    const sectionId = await db.create('sections', {
      communityId: params.communityId,
      name: params.name,
      icon: params.icon || '',
      order: params.order ?? 0,
      enableComment: true,
      enableLike: true,
      widgets: [],
      createdAt: new Date().toISOString(),
    })
    return { sectionId }
  }
  if (action === 'section.get') {
    const section = await db.getById('sections', params.sectionId)
    return { section }
  }
  if (action === 'section.updateWidgets') {
    const { v4: uuidv4 } = await import('uuid')
    const widgets = (params.widgets || []).map((w: any) => ({
      ...w,
      widgetId: w.widgetId || uuidv4(),
    }))
    // Validate showInList count <= 3
    const showInListCount = widgets.filter((w: any) => w.showInList).length
    if (showInListCount > 3) throw new Error('showInList 最多只能有 3 个控件')
    await db.updateById('sections', params.sectionId, { widgets })
    return { widgets }
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
    const members = await db.query('community_members', {
      communityId: params.communityId,
      status: 'pending',
    })
    return { members }
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
