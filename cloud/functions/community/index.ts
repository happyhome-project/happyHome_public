import cloud from 'wx-server-sdk'
import * as db from '../../lib/db'
import { resolveOpenId } from '../../lib/ctx'
import { assertSuperAdmin } from '../../lib/auth'
import { notifyCommunityCreatePending } from '../../lib/approval-notifications'
import type { Community } from '../../shared/types'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

async function getLatestViewerStatus(communityId: string, openid: string) {
  if (!openid) return null
  const records = await db.query('community_members', {
    communityId,
    userId: openid,
  }, {
    orderBy: ['appliedAt', 'desc'],
    limit: 1,
  })
  return records[0]?.status || null
}

export async function handleCreate(
  params: {
    name: string
    description: string
    coverImage: string
    location: Community['location']
    joinType: Community['joinType']
    suppressNotification?: boolean
  },
  openid: string,
) {
  if (!openid) throw new Error('Missing OPENID')

  const now = new Date().toISOString()
  const communityId = await db.create('communities', {
    name: params.name,
    description: params.description,
    coverImage: params.coverImage,
    location: params.location,
    joinType: params.joinType,
    creatorId: openid,
    status: 'pending',
    memberCount: 0,
    createdAt: now,
  })

  await db.create('community_members', {
    communityId,
    userId: openid,
    role: 'admin',
    status: 'active',
    appliedAt: now,
    joinedAt: now,
  })

  if (!params.suppressNotification) {
    try {
      await notifyCommunityCreatePending({
        communityId,
        communityName: params.name,
        creatorUserId: openid,
        createdAt: now,
      })
    } catch (error) {
      console.warn('[community.create] approval notification failed', error)
    }
  }

  return { communityId }
}

export async function handleApprove(params: { communityId: string }, openid: string) {
  if (!openid) throw new Error('Missing OPENID')
  await assertSuperAdmin(openid)
  await db.updateById('communities', params.communityId, { status: 'active' })
  return { success: true }
}

export async function handleReject(params: { communityId: string }, openid: string) {
  if (!openid) throw new Error('Missing OPENID')
  await assertSuperAdmin(openid)
  await db.updateById('communities', params.communityId, { status: 'rejected' })
  return { success: true }
}

export async function handlePendingList(openid: string) {
  if (!openid) throw new Error('Missing OPENID')
  await assertSuperAdmin(openid)
  const communities = await db.query('communities', { status: 'pending' }, {
    orderBy: ['createdAt', 'desc'],
  })
  return { communities }
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

export async function handleListDiscoverable(openid: string) {
  // active 社区（所有人可见，用于发现和申请加入）
  // 以及 viewer 自己创建的还在审核的社区（让创建者能看到"我的申请还在审核"）
  const [activeList, myPendingCreations] = await Promise.all([
    db.query('communities', { status: 'active' }, { orderBy: ['createdAt', 'desc'] }),
    openid
      ? db.query('communities', { status: 'pending', creatorId: openid }, { orderBy: ['createdAt', 'desc'] })
      : Promise.resolve([]),
  ])

  const result = []
  // 先塞自己创建的 pending（放最上面，让创建者一眼看到状态）
  for (const community of myPendingCreations) {
    result.push({ ...community, viewerStatus: 'creator-pending' })
  }
  // 再塞 active 社区，过滤掉已经是成员的（不再出现在"发现"列表）
  for (const community of activeList) {
    const viewerStatus = await getLatestViewerStatus(community._id, openid)
    if (viewerStatus === 'active') continue
    result.push({ ...community, viewerStatus })
  }

  return { communities: result }
}

export const main = async (event: any) => {
  const openid = resolveOpenId(event)
  const { action, _testOpenid, ...params } = event
  if (action === 'create') return handleCreate(params, openid)
  if (action === 'approve') return handleApprove(params, openid)
  if (action === 'reject') return handleReject(params, openid)
  if (action === 'pendingList') return handlePendingList(openid)
  if (action === 'list') return handleList(params)
  if (action === 'get') return handleGet(params)
  if (action === 'listDiscoverable') return handleListDiscoverable(openid)
  throw new Error(`Unknown action: ${action}`)
}
