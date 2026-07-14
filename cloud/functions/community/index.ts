import cloud from 'wx-server-sdk'
import crypto from 'crypto'
import * as db from '../../lib/db'
import { resolveOpenId } from '../../lib/ctx'
import { assertSuperAdmin } from '../../lib/auth'
import { notifyCommunityCreatePending } from '../../lib/approval-notifications'
import { appendPostRagOutboxEvent } from '../../lib/post-rag-outbox'
import { parsePerformanceTrace, recordDatabaseStage } from '../../lib/performance-trace'
import type { Community, CommunityMember } from '../../shared/types'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function createRequestDocumentId(openid: string, requestId: string) {
  return crypto.createHash('sha256')
    .update(`${openid}\n${requestId}`)
    .digest('hex')
}

export async function handleCreate(
  params: {
    name: string
    description: string
    coverImage: string
    location: Community['location']
    joinType: Community['joinType']
    requestId?: string
    suppressNotification?: boolean
  },
  openid: string,
) {
  if (!openid) throw new Error('Missing OPENID')

  const now = new Date().toISOString()
  // The current clients send a stable id for a submit/retry. Keep a unique
  // fallback for older trusted callers so their existing requests keep working.
  const requestId = String(params.requestId || crypto.randomBytes(16).toString('hex')).trim()
  const requestDocId = createRequestDocumentId(openid, requestId)
  const result = await db.runTransaction(async (transaction) => {
    const request = await db.transactionGetByIdOrNull<{ communityId?: string }>(
      transaction,
      'community_create_requests',
      requestDocId,
    )
    if (request?.communityId) {
      return { communityId: String(request.communityId), created: false }
    }

    const communityRes = await transaction.collection('communities').add({
      data: {
        name: params.name,
        description: params.description,
        coverImage: params.coverImage,
        location: params.location,
        joinType: params.joinType,
        creatorId: openid,
        status: 'pending',
        memberCount: 0,
        createdAt: now,
      },
    })
    await transaction.collection('community_members').add({
      data: {
        communityId: communityRes._id,
        userId: openid,
        role: 'admin',
        status: 'active',
        appliedAt: now,
        joinedAt: now,
      },
    })
    await transaction.collection('community_create_requests').doc(requestDocId).set({
      data: {
        communityId: communityRes._id,
        creatorId: openid,
        requestId,
        createdAt: now,
      },
    })
    return { communityId: communityRes._id, created: true }
  })

  if (!params.suppressNotification && result.created) {
    try {
      await notifyCommunityCreatePending({
        communityId: result.communityId,
        communityName: params.name,
        creatorUserId: openid,
        createdAt: now,
      })
    } catch (error) {
      console.warn('[community.create] approval notification failed', error)
    }
  }

  return result.created
    ? { communityId: result.communityId }
    : { communityId: result.communityId, alreadyCreated: true }
}

export async function handleApprove(params: { communityId: string }, openid: string) {
  if (!openid) throw new Error('Missing OPENID')
  await assertSuperAdmin(openid)
  await db.runTransaction(async transaction => {
    await transaction.collection('communities').doc(params.communityId).update({ data: { status: 'active' } })
    await appendPostRagOutboxEvent(transaction, { communityId: params.communityId, aggregateId: params.communityId, reasonCode: 'community.status_changed' })
  })
  return { success: true }
}

export async function handleReject(params: { communityId: string }, openid: string) {
  if (!openid) throw new Error('Missing OPENID')
  await assertSuperAdmin(openid)
  await db.runTransaction(async transaction => {
    await transaction.collection('communities').doc(params.communityId).update({ data: { status: 'rejected' } })
    await appendPostRagOutboxEvent(transaction, { communityId: params.communityId, aggregateId: params.communityId, reasonCode: 'community.status_changed' })
  })
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

export async function handleList(params: { includeAll?: boolean }, openid = '') {
  // wx-server-sdk 不支持 $in 操作符，includeAll 时分两次查询
  if (params.includeAll) {
    await assertSuperAdmin(openid)
    const [active, pending] = await Promise.all([
      db.query('communities', { status: 'active' }, { orderBy: ['createdAt', 'desc'] }),
      db.query('communities', { status: 'pending' }, { orderBy: ['createdAt', 'desc'] }),
    ])
    return { communities: [...active, ...pending] }
  }

  const communities = await db.query('communities', { status: 'active' }, {
    orderBy: ['createdAt', 'desc'],
  })
  return { communities: communities.filter((community: Community) => community.discoverable !== false) }
}

export async function handleGet(params: { communityId: string }) {
  const community = await db.getById('communities', params.communityId)
  if (!community || community.status !== 'active') throw new Error('社区不存在或尚未开放')
  return { community }
}

export async function handleListDiscoverable(openid: string, traceInput?: unknown) {
  const trace = parsePerformanceTrace(traceInput)
  // 社区是否出现在小程序目录，由审核状态和 discoverable 开关共同决定。
  // 成员记录仅用于渲染“已加入 / 审核中 / 我要加入”，不能让 pending 社区提前曝光。
  const activeStartedAt = Date.now()
  const activeList = await db.query('communities', { status: 'active' }, {
    orderBy: ['createdAt', 'desc'],
    limit: 100,
  })
  recordDatabaseStage(trace, 'community.listDiscoverable', 'active_communities', activeStartedAt, {
    communities: activeList.length,
  })

  const membershipStartedAt = Date.now()
  const memberships = openid
    ? await db.query('community_members', { userId: openid }, {
      orderBy: ['appliedAt', 'desc'],
      limit: 100,
    }) as CommunityMember[]
    : []
  recordDatabaseStage(trace, 'community.listDiscoverable', 'viewer_memberships', membershipStartedAt, {
    memberships: memberships.length,
  })
  const latestMembershipByCommunity = new Map<string, CommunityMember>()
  for (const membership of memberships) {
    if (!latestMembershipByCommunity.has(membership.communityId)) {
      latestMembershipByCommunity.set(membership.communityId, membership)
    }
  }

  const result = activeList
    .filter((item: Community) => item.discoverable !== false)
    .map((community: Community) => {
      const membership = latestMembershipByCommunity.get(community._id)
      const viewerStatus = membership?.status || null
      return {
        ...community,
        viewerStatus,
        viewerRole: viewerStatus === 'active' ? membership?.role || null : null,
      }
    })

  return { communities: result }
}

export const main = async (event: any, context?: any) => {
  const openid = resolveOpenId(event, context)
  const { action, _testOpenid, _trace, ...params } = event
  if (action === 'create') return handleCreate(params, openid)
  if (action === 'approve') return handleApprove(params, openid)
  if (action === 'reject') return handleReject(params, openid)
  if (action === 'pendingList') return handlePendingList(openid)
  if (action === 'list') return handleList(params, openid)
  if (action === 'get') return handleGet(params)
  if (action === 'listDiscoverable') return handleListDiscoverable(openid, _trace)
  throw new Error(`Unknown action: ${action}`)
}
