import type { ApprovalNotificationEventType } from '../api/cloud'

export type ProfileNotificationTemplate = {
  eventType: ApprovalNotificationEventType
  label?: string
  templateId: string
}

export type ProfileNotificationSubscription = {
  eventType: ApprovalNotificationEventType
  templateId: string
  status: string
}

function subscriptionKey(eventType: ApprovalNotificationEventType, templateId: string) {
  return `${eventType}::${templateId}`
}

export function subscriptionStatusLabel(
  subscriptions: ProfileNotificationSubscription[],
  eventType: ApprovalNotificationEventType,
  templateId: string,
) {
  const item = subscriptions.find((sub) => sub.eventType === eventType && sub.templateId === templateId)
  if (!item) return '未开启'
  if (item.status === 'accept') return '已开启'
  return '未授权'
}

export function mergeNotificationSubscribeResult(
  existing: ProfileNotificationSubscription[],
  templates: ProfileNotificationTemplate[],
  requestResult: Record<string, string>,
) {
  const byKey = new Map<string, ProfileNotificationSubscription>()
  for (const item of existing) {
    if (!item.eventType || !item.templateId) continue
    byKey.set(subscriptionKey(item.eventType, item.templateId), { ...item })
  }
  for (const item of templates) {
    if (!item.templateId) continue
    byKey.set(subscriptionKey(item.eventType, item.templateId), {
      eventType: item.eventType,
      templateId: item.templateId,
      status: requestResult[item.templateId] === 'accept' ? 'accept' : 'reject',
    })
  }
  return Array.from(byKey.values())
}

export function areAllNotificationTemplatesAccepted(
  templates: ProfileNotificationTemplate[],
  subscriptions: ProfileNotificationSubscription[],
) {
  return templates.length > 0 && templates.every(
    (item) => subscriptionStatusLabel(subscriptions, item.eventType, item.templateId) === '已开启',
  )
}

export function hasAnyNotificationTemplateAccepted(
  templates: ProfileNotificationTemplate[],
  subscriptions: ProfileNotificationSubscription[],
) {
  return templates.some(
    (item) => subscriptionStatusLabel(subscriptions, item.eventType, item.templateId) === '已开启',
  )
}

export function getApplicationNotificationStatusText(
  templates: ProfileNotificationTemplate[],
  subscriptions: ProfileNotificationSubscription[],
) {
  if (hasAnyNotificationTemplateAccepted(templates, subscriptions)) return '已开启'
  const hasAnySavedStatus = templates.some(
    (item) => subscriptions.some((sub) => sub.eventType === item.eventType && sub.templateId === item.templateId),
  )
  return hasAnySavedStatus ? '未授权' : '未开启'
}

export function getNotificationSubscribeButtonText(
  isBusy: boolean,
  templates: ProfileNotificationTemplate[],
  subscriptions: ProfileNotificationSubscription[],
) {
  if (isBusy) return '开启中...'
  if (hasAnyNotificationTemplateAccepted(templates, subscriptions)) return '申请通知已开启'
  return '接收申请通知'
}
