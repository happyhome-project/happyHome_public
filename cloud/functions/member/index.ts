import cloud from 'wx-server-sdk'
import * as db from '../../lib/db'
import { resolveOpenId } from '../../lib/ctx'
import { assertCommunityAdmin } from '../../lib/auth'
import type { Community } from '../../shared/types'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

async function getLatestMembershipRecord(communityId: string, openid: string) {
  const records = await db.query('community_members', {
    communityId,
    userId: openid,
  }, {
    orderBy: ['appliedAt', 'desc'],
    limit: 1,
  })
  return records[0] || null
}

export async function handleApply(params: { communityId: string }, openid: string) {
  if (!openid) throw new Error('Missing OPENID')

  // Check if already an active or pending member (prevent duplicate records)
  const existingActive = await db.query('community_members', {
    communityId: params.communityId,
    userId: openid,
    status: 'active',
  })
  if (existingActive && existingActive.length > 0) throw new Error('已是社区成员')

  const existingPending = await db.query('community_members', {
    communityId: params.communityId,
    userId: openid,
    status: 'pending',
  })
  if (existingPending && existingPending.length > 0) throw new Error('已有待审批的申请')

  const community = await db.getById('communities', params.communityId) as Community
  const now = new Date().toISOString()

  if (community.joinType === 'open') {
    await db.create('community_members', {
      communityId: params.communityId,
      userId: openid,
      role: 'member',
      status: 'active',
      appliedAt: now,
      joinedAt: now,
    })
    await db.increment('communities', params.communityId, 'memberCount', 1)
    return { status: 'active' }
  } else {
    await db.create('community_members', {
      communityId: params.communityId,
      userId: openid,
      role: 'member',
      status: 'pending',
      appliedAt: now,
    })
    return { status: 'pending' }
  }
}

export async function handleLeave(params: { communityId: string }, openid: string) {
  if (!openid) throw new Error('Missing OPENID')

  const members = await db.query('community_members', {
    communityId: params.communityId,
    userId: openid,
    status: 'active',
  })
  if (!members || members.length === 0) throw new Error('不是社区成员')

  // 注意：管理员也可以退出，退出后其帖子保留。
  // 若社区只剩该管理员，退出后社区将无管理员，需在产品层面处理（当前版本不限制）。
  const memberId = members[0]._id
  await db.removeById('community_members', memberId)
  await db.increment('communities', params.communityId, 'memberCount', -1)
  return { success: true }
}

export async function handleMemberApprove(
  params: { communityId: string; memberId: string },
  openid: string,
) {
  if (!openid) throw new Error('Missing OPENID')
  await assertCommunityAdmin(openid, params.communityId)

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

export async function handleMemberReject(
  params: { communityId: string; memberId: string },
  openid: string,
) {
  if (!openid) throw new Error('Missing OPENID')
  await assertCommunityAdmin(openid, params.communityId)

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

export async function handlePendingList(params: { communityId: string }, openid: string) {
  if (!openid) throw new Error('Missing OPENID')
  await assertCommunityAdmin(openid, params.communityId)

  const members = await db.query('community_members', {
    communityId: params.communityId,
    status: 'pending',
  })
  return { members }
}

// 查询当前用户在指定社区的成员状态（给前端判断是否需要引导加入）
export async function handleMyStatus(params: { communityId: string }, openid: string) {
  if (!openid) return { isMember: false, status: null }
  const latest = await getLatestMembershipRecord(params.communityId, openid) as { status: string } | null
  if (!latest) return { isMember: false, status: null }
  return { isMember: latest.status === 'active', status: latest.status }
}

export async function handleMyCommunities(openid: string) {
  if (!openid) throw new Error('Missing OPENID')

  const memberships = await db.query('community_members', {
    userId: openid,
    status: 'active',
  }, {
    orderBy: ['joinedAt', 'desc'],
  })

  const communities = []
  for (const membership of memberships) {
    const community = await db.getById('communities', membership.communityId) as Community | null
    if (community && community.status === 'active') {
      communities.push(community)
    }
  }

  return { communities }
}

export const main = async (event: any) => {
  const openid = resolveOpenId(event)
  const { action, _testOpenid, ...params } = event
  if (action === 'apply') return handleApply(params, openid)
  if (action === 'leave') return handleLeave(params, openid)
  if (action === 'memberApprove') return handleMemberApprove(params, openid)
  if (action === 'memberReject') return handleMemberReject(params, openid)
  if (action === 'pendingList') return handlePendingList(params, openid)
  if (action === 'myStatus') return handleMyStatus(params, openid)
  if (action === 'myCommunities') return handleMyCommunities(openid)
  throw new Error(`Unknown action: ${action}`)
}
