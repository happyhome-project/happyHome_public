import cloud from 'wx-server-sdk'
import * as db from '../../lib/db'
import type { Community, CommunityMember } from '../../shared/types'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

async function assertCommunityAdmin(openId: string, communityId: string): Promise<void> {
  const members = await db.query('community_members', {
    communityId,
    userId: openId,
    role: 'admin',
    status: 'active',
  })
  if (!members || members.length === 0) throw new Error('权限不足')
}

export async function handleApply(params: { communityId: string }) {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) throw new Error('Missing OPENID')

  // Check if already an active member
  const existing = await db.query('community_members', {
    communityId: params.communityId,
    userId: OPENID,
    status: 'active',
  })
  if (existing && existing.length > 0) throw new Error('已是社区成员')

  const community = await db.getById('communities', params.communityId) as Community
  const now = new Date().toISOString()

  if (community.joinType === 'open') {
    await db.create('community_members', {
      communityId: params.communityId,
      userId: OPENID,
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
      userId: OPENID,
      role: 'member',
      status: 'pending',
      appliedAt: now,
    })
    return { status: 'pending' }
  }
}

export async function handleLeave(params: { communityId: string }) {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) throw new Error('Missing OPENID')

  const members = await db.query('community_members', {
    communityId: params.communityId,
    userId: OPENID,
    status: 'active',
  })
  if (!members || members.length === 0) throw new Error('不是社区成员')

  const memberId = members[0]._id
  await db.updateById('community_members', memberId, {
    status: 'left',
    leftAt: new Date().toISOString(),
  })
  await db.increment('communities', params.communityId, 'memberCount', -1)
  return { success: true }
}

export async function handleMemberApprove(params: { communityId: string; memberId: string }) {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) throw new Error('Missing OPENID')
  await assertCommunityAdmin(OPENID, params.communityId)

  await db.updateById('community_members', params.memberId, {
    status: 'active',
    joinedAt: new Date().toISOString(),
  })
  await db.increment('communities', params.communityId, 'memberCount', 1)
  return { success: true }
}

export async function handleMemberReject(params: { communityId: string; memberId: string }) {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) throw new Error('Missing OPENID')
  await assertCommunityAdmin(OPENID, params.communityId)

  await db.updateById('community_members', params.memberId, {
    status: 'rejected',
    rejectedAt: new Date().toISOString(),
  })
  return { success: true }
}

export async function handlePendingList(params: { communityId: string }) {
  const members = await db.query('community_members', {
    communityId: params.communityId,
    status: 'pending',
  })
  return { members }
}

export const main = async (event: { action: string; params?: any }) => {
  const { action, params = {} } = event
  if (action === 'apply') return handleApply(params)
  if (action === 'leave') return handleLeave(params)
  if (action === 'memberApprove') return handleMemberApprove(params)
  if (action === 'memberReject') return handleMemberReject(params)
  if (action === 'pendingList') return handlePendingList(params)
  throw new Error(`Unknown action: ${action}`)
}
