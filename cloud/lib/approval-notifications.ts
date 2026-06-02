import cloud from 'wx-server-sdk'
import * as db from './db'

export type ApprovalNotificationEventType = 'member_join_pending' | 'community_create_pending'
export type SubscriptionStatus = 'accept' | 'reject'

const SUBSCRIPTIONS = 'admin_notification_subscriptions'
const NOTIFICATIONS = 'admin_notifications'

const TEMPLATE_ENV_BY_EVENT: Record<ApprovalNotificationEventType, string> = {
  member_join_pending: 'APPROVAL_MEMBER_JOIN_TEMPLATE_ID',
  community_create_pending: 'APPROVAL_COMMUNITY_CREATE_TEMPLATE_ID',
}

const TEMPLATE_FIELDS_ENV_BY_EVENT: Record<ApprovalNotificationEventType, string> = {
  member_join_pending: 'APPROVAL_MEMBER_JOIN_TEMPLATE_FIELDS',
  community_create_pending: 'APPROVAL_COMMUNITY_CREATE_TEMPLATE_FIELDS',
}

const DEFAULT_TEMPLATE_FIELDS = {
  communityName: 'thing1',
  action: 'thing2',
  time: 'time3',
  status: 'phrase4',
}

function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

async function querySafe<T = any>(collection: string, where: object, options?: any): Promise<T[]> {
  try {
    return asArray<T>(await db.query(collection, where, options))
  } catch {
    return []
  }
}

function nowIso() {
  return new Date().toISOString()
}

function uniqueUserIds(userIds: string[]) {
  return Array.from(new Set(userIds.map((id) => String(id || '').trim()).filter(Boolean)))
}

function templateIdFor(eventType: ApprovalNotificationEventType) {
  return String(process.env[TEMPLATE_ENV_BY_EVENT[eventType]] || '').trim()
}

function templateFieldsFor(eventType: ApprovalNotificationEventType) {
  const raw = String(process.env[TEMPLATE_FIELDS_ENV_BY_EVENT[eventType]] || '').trim()
  if (!raw) return DEFAULT_TEMPLATE_FIELDS
  try {
    const parsed = JSON.parse(raw)
    return {
      communityName: String(parsed.communityName || DEFAULT_TEMPLATE_FIELDS.communityName),
      action: String(parsed.action || DEFAULT_TEMPLATE_FIELDS.action),
      time: String(parsed.time || DEFAULT_TEMPLATE_FIELDS.time),
      status: String(parsed.status || ''),
    }
  } catch {
    return DEFAULT_TEMPLATE_FIELDS
  }
}

function truncateTemplateValue(value: unknown, max = 20) {
  return Array.from(String(value || '').trim()).slice(0, max).join('') || '待审批'
}

function formatTemplateTime(value: unknown) {
  const date = new Date(String(value || ''))
  if (Number.isNaN(date.getTime())) return nowIso().slice(0, 16).replace('T', ' ')
  return date.toISOString().slice(0, 16).replace('T', ' ')
}

function buildSubscribeData(eventType: ApprovalNotificationEventType, payload: any) {
  const fields = templateFieldsFor(eventType)
  const data: Record<string, { value: string }> = {}
  const put = (fieldKey: string, value: string) => {
    if (fieldKey) data[fieldKey] = { value }
  }
  if (eventType === 'community_create_pending') {
    put(fields.communityName, truncateTemplateValue(payload.communityName))
    put(fields.action, '新社区待审批')
    put(fields.time, formatTemplateTime(payload.createdAt))
    put(fields.status, '待审批')
    return data
  }
  put(fields.communityName, truncateTemplateValue(payload.communityName))
  put(fields.action, '成员加入申请')
  put(fields.time, formatTemplateTime(payload.appliedAt))
  put(fields.status, '待审批')
  return data
}

function buildPage(eventType: ApprovalNotificationEventType) {
  // 第一版先回到管理员工具页；真正处理动作仍在 Admin Web 待办中心完成。
  return eventType === 'community_create_pending'
    ? 'pages/profile/index'
    : 'pages/profile/index'
}

async function getAcceptedSubscription(userId: string, eventType: ApprovalNotificationEventType, templateId: string) {
  if (!templateId) return null
  const rows = await querySafe(SUBSCRIPTIONS, { userId, eventType, templateId, status: 'accept' }, { limit: 1 })
  return rows[0] || null
}

async function createNotificationRecord(record: Record<string, any>) {
  await db.create(NOTIFICATIONS, {
    ...record,
    createdAt: nowIso(),
  })
}

async function trySendSubscribeMessage(
  eventType: ApprovalNotificationEventType,
  recipientUserId: string,
  templateId: string,
  payload: any,
) {
  const openapi = (cloud as any).openapi
  const sender = openapi?.subscribeMessage?.send
  if (typeof sender !== 'function') {
    return { status: 'skipped' as const, reason: 'subscribe_api_unavailable' }
  }
  try {
    await sender({
      touser: recipientUserId,
      templateId,
      page: buildPage(eventType),
      data: buildSubscribeData(eventType, payload),
    })
    return { status: 'sent' as const, reason: '' }
  } catch (error: any) {
    return { status: 'failed' as const, reason: String(error?.message || error || 'send_failed') }
  }
}

async function notifyRecipients(eventType: ApprovalNotificationEventType, recipientUserIds: string[], payload: any) {
  const templateId = templateIdFor(eventType)
  for (const recipientUserId of uniqueUserIds(recipientUserIds)) {
    if (!templateId) {
      await createNotificationRecord({
        eventType,
        recipientUserId,
        communityId: payload.communityId,
        memberId: payload.memberId || '',
        status: 'skipped',
        reason: 'template_not_configured',
        payload,
      })
      continue
    }

    const subscription = await getAcceptedSubscription(recipientUserId, eventType, templateId)
    if (!subscription) {
      await createNotificationRecord({
        eventType,
        recipientUserId,
        communityId: payload.communityId,
        memberId: payload.memberId || '',
        templateId,
        status: 'skipped',
        reason: 'not_subscribed',
        payload,
      })
      continue
    }

    const sendResult = await trySendSubscribeMessage(eventType, recipientUserId, templateId, payload)
    await createNotificationRecord({
      eventType,
      recipientUserId,
      communityId: payload.communityId,
      memberId: payload.memberId || '',
      templateId,
      status: sendResult.status,
      reason: sendResult.reason,
      payload,
      sentAt: sendResult.status === 'sent' ? nowIso() : '',
    })
  }
}

export async function saveNotificationSubscription(
  userId: string,
  eventType: ApprovalNotificationEventType,
  templateId: string,
  status: SubscriptionStatus,
) {
  if (!userId) throw new Error('Missing OPENID')
  if (!['member_join_pending', 'community_create_pending'].includes(eventType)) {
    throw new Error('不支持的通知类型')
  }
  if (!templateId) throw new Error('templateId 不能为空')
  if (!['accept', 'reject'].includes(status)) throw new Error('不支持的订阅状态')

  const existing = await querySafe(SUBSCRIPTIONS, { userId, eventType, templateId }, { limit: 1 })
  const data = { userId, eventType, templateId, status, updatedAt: nowIso() }
  if (existing[0]?._id) {
    await db.updateById(SUBSCRIPTIONS, existing[0]._id, data)
  } else {
    await db.create(SUBSCRIPTIONS, { ...data, createdAt: data.updatedAt })
  }
  return { success: true }
}

export async function getNotificationSubscriptions(userId: string) {
  if (!userId) throw new Error('Missing OPENID')
  const subscriptions = await querySafe(SUBSCRIPTIONS, { userId })
  return { subscriptions }
}

export async function notifyMemberJoinPending(params: {
  communityId: string
  communityName?: string
  memberId: string
  applicantUserId: string
  appliedAt: string
}) {
  const [communityAdmins, superAdmins] = await Promise.all([
    querySafe('community_members', { communityId: params.communityId, role: 'admin', status: 'active' }),
    querySafe('admin_accounts', { role: 'superAdmin', status: 'active' }),
  ])
  await notifyRecipients('member_join_pending', [
    ...communityAdmins.map((member: any) => String(member.userId || '')),
    ...superAdmins.map((account: any) => String(account.userId || '')),
  ], params)
}

export async function notifyCommunityCreatePending(params: {
  communityId: string
  communityName: string
  creatorUserId: string
  createdAt: string
}) {
  const superAdmins = await querySafe('admin_accounts', { role: 'superAdmin', status: 'active' })
  await notifyRecipients('community_create_pending', superAdmins.map((account: any) => String(account.userId || '')), params)
}
