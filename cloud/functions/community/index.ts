import cloud from 'wx-server-sdk'
import * as db from '../../lib/db'
import { assertSuperAdmin } from '../../lib/auth'
import type { Community } from '../../shared/types'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

export async function handleCreate(params: {
  name: string
  description: string
  coverImage: string
  location: Community['location']
  joinType: Community['joinType']
}) {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) throw new Error('Missing OPENID')

  const now = new Date().toISOString()
  const communityId = await db.create('communities', {
    name: params.name,
    description: params.description,
    coverImage: params.coverImage,
    location: params.location,
    joinType: params.joinType,
    creatorId: OPENID,
    status: 'pending',
    memberCount: 0,
    createdAt: now,
  })

  await db.create('community_members', {
    communityId,
    userId: OPENID,
    role: 'admin',
    status: 'active',
    appliedAt: now,
    joinedAt: now,
  })

  return { communityId }
}

export async function handleApprove(params: { communityId: string }) {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) throw new Error('Missing OPENID')
  await assertSuperAdmin(OPENID)
  await db.updateById('communities', params.communityId, { status: 'active' })
  return { success: true }
}

export async function handleReject(params: { communityId: string }) {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) throw new Error('Missing OPENID')
  await assertSuperAdmin(OPENID)
  await db.updateById('communities', params.communityId, { status: 'disabled' })
  return { success: true }
}

export async function handleList(params: { includeAll?: boolean }) {
  // wx-server-sdk 不支持 $in 操作符，includeAll 时分两次查询
  if (params.includeAll) {
    const [active, pending] = await Promise.all([
      db.query('communities', { status: 'active' }, { orderBy: ['createdAt', 'desc'] }),
      db.query('communities', { status: 'pending' }, { orderBy: ['createdAt', 'desc'] }),
    ])
    return { communities: [...active, ...pending] }
  }

  const communities = await db.query('communities', { status: 'active' }, {
    orderBy: ['createdAt', 'desc'],
  })
  return { communities }
}

export async function handleGet(params: { communityId: string }) {
  const community = await db.getById('communities', params.communityId)
  return { community }
}

export const main = async (event: { action: string; params?: any }) => {
  const { action, params = {} } = event
  if (action === 'create') return handleCreate(params)
  if (action === 'approve') return handleApprove(params)
  if (action === 'reject') return handleReject(params)
  if (action === 'list') return handleList(params)
  if (action === 'get') return handleGet(params)
  throw new Error(`Unknown action: ${action}`)
}
