import cloud from 'wx-server-sdk'
import * as db from '../../lib/db'
import { resolveOpenId } from '../../lib/ctx'
import { assertCommunityAdmin } from '../../lib/auth'
import { isBoundSuperAdmin } from '../../lib/admin-identity'
import {
  getNotificationTemplateConfig,
  getNotificationStatus,
  getNotificationSubscriptions,
  notifyMemberJoinPending,
  saveNotificationSubscription,
  type ApprovalNotificationEventType,
  type SubscriptionStatus,
} from '../../lib/approval-notifications'
import type { Community } from '../../shared/types'
import {
  MEMBER_STATE_COLLECTION,
  membershipStateId,
  type MembershipStateStatus,
} from '../../lib/membership-state'
import { approveMembership, leaveMembership, rejectMembership } from '../../lib/membership-transitions'

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

async function isSuperAdmin(openid: string) {
  try {
    const user = await db.getById('users', openid) as { role?: string } | null
    if (user?.role === 'superAdmin') return true
  } catch {
    // 用户记录缺失时继续查后台账号绑定，避免绑定源不同步导致审批入口消失。
  }
  return isBoundSuperAdmin(openid)
}

async function assertCommunityApprover(openid: string, communityId: string) {
  if (!communityId) throw new Error('communityId 不能为空')
  if (await isSuperAdmin(openid)) return
  await assertCommunityAdmin(openid, communityId)
}

export async function handleApply(params: { communityId: string }, openid: string) {
  if (!openid) throw new Error('Missing OPENID')
  const now = new Date().toISOString()
  const stateId = membershipStateId(params.communityId, openid)
  // Existing production records predate the state document. Read once outside
  // the transaction only to seed their current state; all new writes serialize
  // through the deterministic state document below.
  const legacy = await getLatestMembershipRecord(params.communityId, openid) as {
    _id?: string
    status?: MembershipStateStatus
  } | null

  const result = await db.runTransaction(async (transaction) => {
    const [communityRes, stateRes] = await Promise.all([
      transaction.collection('communities').doc(params.communityId).get(),
      transaction.collection(MEMBER_STATE_COLLECTION).doc(stateId).get(),
    ])
    const community = communityRes.data as Community | null
    if (!community || community.status !== 'active') throw new Error('社区暂不可加入')

    const state = stateRes.data as {
      status?: MembershipStateStatus
      memberId?: string
    } | null
    if ((state?.status === 'active' || state?.status === 'pending') && state.memberId) {
      const memberRes = await transaction.collection('community_members').doc(state.memberId).get()
      const member = memberRes.data as {
        communityId?: string
        userId?: string
        status?: MembershipStateStatus
      } | null
      const actualStatus = member?.communityId === params.communityId && member?.userId === openid
        ? member.status
        : undefined
      if (actualStatus === 'active' || actualStatus === 'pending') {
        if (actualStatus !== state.status) {
          await transaction.collection(MEMBER_STATE_COLLECTION).doc(stateId).set({
            data: { ...state, status: actualStatus, updatedAt: now },
          })
        }
        return {
          status: actualStatus,
          memberId: state.memberId,
          created: false,
          communityName: community.name,
        }
      }
    }

    if (!state && (legacy?.status === 'active' || legacy?.status === 'pending')) {
      await transaction.collection(MEMBER_STATE_COLLECTION).doc(stateId).set({
        data: {
          communityId: params.communityId,
          userId: openid,
          memberId: legacy._id || '',
          status: legacy.status,
          updatedAt: now,
        },
      })
      return {
        status: legacy.status,
        memberId: legacy._id || '',
        created: false,
        communityName: community.name,
      }
    }

    const status: MembershipStateStatus = community.joinType === 'open' ? 'active' : 'pending'
    const memberRes = await transaction.collection('community_members').add({
      data: {
        communityId: params.communityId,
        userId: openid,
        role: 'member',
        status,
        appliedAt: now,
        ...(status === 'active' ? { joinedAt: now } : {}),
      },
    })
    await transaction.collection(MEMBER_STATE_COLLECTION).doc(stateId).set({
      data: {
        communityId: params.communityId,
        userId: openid,
        memberId: memberRes._id,
        status,
        updatedAt: now,
      },
    })
    if (status === 'active') {
      await transaction.collection('communities').doc(params.communityId).update({
        data: { memberCount: Number(community.memberCount || 0) + 1 },
      })
    }
    return { status, memberId: memberRes._id, created: true, communityName: community.name }
  })

  if (result.status === 'pending' && result.created) {
    try {
      await notifyMemberJoinPending({
        communityId: params.communityId,
        communityName: result.communityName || '',
        memberId: result.memberId,
        applicantUserId: openid,
        appliedAt: now,
      })
    } catch (error) {
      console.warn('[member.apply] approval notification failed', error)
    }
  }

  return result.created
    ? { status: result.status }
    : { status: result.status, alreadyApplied: true }
}

export async function handleLeave(params: { communityId: string }, openid: string) {
  if (!openid) throw new Error('Missing OPENID')

  const members = await db.query('community_members', {
    communityId: params.communityId,
    userId: openid,
    status: 'active',
  })
  if (!members || members.length === 0) throw new Error('不是社区成员')

  return leaveMembership({ communityId: params.communityId, userId: openid, memberId: members[0]._id })
}

export async function handleMemberApprove(
  params: { communityId: string; memberId: string },
  openid: string,
) {
  if (!openid) throw new Error('Missing OPENID')
  await assertCommunityApprover(openid, params.communityId)

  return approveMembership(params)
}

export async function handleMemberReject(
  params: { communityId: string; memberId: string },
  openid: string,
) {
  if (!openid) throw new Error('Missing OPENID')
  await assertCommunityApprover(openid, params.communityId)

  return rejectMembership(params)
}

export async function handlePendingList(params: { communityId: string }, openid: string) {
  if (!openid) throw new Error('Missing OPENID')
  await assertCommunityApprover(openid, params.communityId)

  const members = await db.query('community_members', {
    communityId: params.communityId,
    status: 'pending',
  })
  return { members }
}

// 查询当前用户在指定社区的成员状态（给前端判断是否需要引导加入）
export async function handleMyStatus(params: { communityId: string }, openid: string) {
  if (!openid) return { isMember: false, status: null }
  const community = await db.getById('communities', params.communityId).catch(() => null) as Community | null
  if (!community || community.status !== 'active') return { isMember: false, status: null }
  const latest = await getLatestMembershipRecord(params.communityId, openid) as { status: string } | null
  if (!latest) return { isMember: false, status: null }
  return { isMember: latest.status === 'active', status: latest.status }
}

export async function handleMyCommunities(openid: string) {
  // 未登录时返回空列表，而不是抛错。前端应该用 isLoggedIn 前置守门，
  // 这里做后端兜底——万一前端忘守（或新页面接入）不至于让用户看到 "Missing OPENID" 原始错误。
  // 语义：没有 openid = 没有身份 = 没有社区归属，return [] 符合 user mental model。
  if (!openid) return { communities: [] }

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
  if (action === 'saveNotificationSubscription') {
    return saveNotificationSubscription(
      openid,
      String(params.eventType || '') as ApprovalNotificationEventType,
      String(params.templateId || ''),
      String(params.status || '') as SubscriptionStatus,
    )
  }
  if (action === 'notificationSubscriptions') return getNotificationSubscriptions(openid)
  if (action === 'notificationConfig') return getNotificationTemplateConfig(openid)
  if (action === 'notificationStatus') return getNotificationStatus(openid)
  throw new Error(`Unknown action: ${action}`)
}
