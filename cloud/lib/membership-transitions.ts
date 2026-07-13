import * as db from './db'
import { MEMBER_STATE_COLLECTION, membershipStateId, type MembershipStateStatus } from './membership-state'
import { appendPostRagOutboxEvent } from './post-rag-outbox'

type MembershipRecord = {
  _id?: string
  communityId?: string
  userId?: string
  role?: string
  status?: MembershipStateStatus
}

type CommunityRecord = {
  _id?: string
  creatorId?: string
  memberCount?: number
}

function nextMemberCount(community: CommunityRecord | null, delta: number) {
  return Math.max(0, Number(community?.memberCount || 0) + delta)
}

async function setMembershipState(
  transaction: db.DbTransaction,
  member: MembershipRecord,
  memberId: string,
  status: MembershipStateStatus,
  now: string,
) {
  const communityId = String(member.communityId || '')
  const userId = String(member.userId || '')
  await transaction.collection(MEMBER_STATE_COLLECTION).doc(membershipStateId(communityId, userId)).set({
    data: {
      communityId,
      userId,
      memberId: status === 'none' ? '' : memberId,
      status,
      updatedAt: now,
    },
  })
}

export async function leaveMembership(input: { communityId: string; userId: string; memberId: string }) {
  const now = new Date().toISOString()
  return db.runTransaction(async (transaction) => {
    const [community, member] = await Promise.all([
      db.transactionGetByIdOrNull<CommunityRecord>(transaction, 'communities', input.communityId),
      db.transactionGetByIdOrNull<MembershipRecord>(transaction, 'community_members', input.memberId),
    ])
    if (!member || member.communityId !== input.communityId || member.userId !== input.userId || member.status !== 'active') {
      return { success: true, changed: false }
    }
    if (community?.creatorId === input.userId) throw new Error('社区创建者不能退出社区')

    await transaction.collection('community_members').doc(input.memberId).remove()
    await transaction.collection('communities').doc(input.communityId).update({
      data: { memberCount: nextMemberCount(community, -1) },
    })
    await setMembershipState(transaction, member, input.memberId, 'none', now)
    await appendPostRagOutboxEvent(transaction, { communityId: input.communityId, aggregateId: input.communityId, reasonCode: 'community.acl_changed', now })
    return { success: true, changed: true }
  })
}

async function transitionPendingMembership(
  input: { communityId: string; memberId: string },
  status: 'active' | 'rejected',
) {
  const now = new Date().toISOString()
  return db.runTransaction(async (transaction) => {
    const [member, community] = await Promise.all([
      db.transactionGetByIdOrNull<MembershipRecord>(transaction, 'community_members', input.memberId),
      status === 'active'
        ? db.transactionGetByIdOrNull<CommunityRecord>(transaction, 'communities', input.communityId)
        : Promise.resolve(null),
    ])
    if (!member || member.communityId !== input.communityId || member.status !== 'pending') {
      return { success: true, changed: false }
    }

    const memberData = status === 'active'
      ? { status, joinedAt: now }
      : { status, rejectedAt: now }
    await transaction.collection('community_members').doc(input.memberId).update({ data: memberData })

    if (status === 'active') {
      await transaction.collection('communities').doc(input.communityId).update({
        data: { memberCount: nextMemberCount(community, 1) },
      })
    }

    await setMembershipState(transaction, member, input.memberId, status, now)
    if (status === 'active') await appendPostRagOutboxEvent(transaction, { communityId: input.communityId, aggregateId: input.communityId, reasonCode: 'community.acl_changed', now })
    return { success: true, changed: true }
  })
}

export function approveMembership(input: { communityId: string; memberId: string }) {
  return transitionPendingMembership(input, 'active')
}

export function rejectMembership(input: { communityId: string; memberId: string }) {
  return transitionPendingMembership(input, 'rejected')
}

export async function kickMembership(input: { communityId: string; memberId: string }) {
  const now = new Date().toISOString()
  return db.runTransaction(async (transaction) => {
    const [community, member] = await Promise.all([
      db.transactionGetByIdOrNull<CommunityRecord>(transaction, 'communities', input.communityId),
      db.transactionGetByIdOrNull<MembershipRecord>(transaction, 'community_members', input.memberId),
    ])
    if (!member || member.communityId !== input.communityId) throw new Error('member not found')
    if (member.userId === community?.creatorId) throw new Error('不能移出社区创建者')
    if (member.role !== 'member') throw new Error('不能移出管理员')
    if (!['active', 'rejected', 'pending'].includes(String(member.status || ''))) {
      throw new Error('当前状态不支持移除')
    }

    await transaction.collection('community_members').doc(input.memberId).remove()
    if (member.status === 'active') {
      await transaction.collection('communities').doc(input.communityId).update({
        data: { memberCount: nextMemberCount(community, -1) },
      })
    }
    await setMembershipState(transaction, member, input.memberId, 'none', now)
    await appendPostRagOutboxEvent(transaction, { communityId: input.communityId, aggregateId: input.communityId, reasonCode: 'community.acl_changed', now })
    return { success: true, changed: true }
  })
}
