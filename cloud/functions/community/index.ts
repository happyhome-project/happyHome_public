import cloud from 'wx-server-sdk'
import * as db from '../../lib/db'
import type { Community, User } from '../../shared/types'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

async function assertSuperAdmin(openId: string): Promise<void> {
  let user: User | null = null
  try {
    user = await db.getById('users', openId) as User
  } catch (err: any) {
    const isNotFound =
      err?.errCode === -502001 ||
      (err?.message &&
        (err.message.includes('not found') || err.message.includes('does not exist')))
    if (isNotFound) throw new Error('权限不足')
    throw err
  }
  if (!user || user.role !== 'superAdmin') throw new Error('权限不足')
}

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
  const where = params.includeAll
    ? { status: db.query !== undefined ? { $in: ['active', 'pending'] } : 'active' }
    : { status: 'active' }

  // wx-server-sdk doesn't support $in directly in where object for query helper
  // We need to handle includeAll differently
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
