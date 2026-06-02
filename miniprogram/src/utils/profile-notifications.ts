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
  const merged: ProfileNotificationSubscription[] = []
  const upsert = (item: ProfileNotificationSubscription) => {
    const key = subscriptionKey(item.eventType, item.templateId)
    const existingIndex = merged.findIndex((sub) => subscriptionKey(sub.eventType, sub.templateId) === key)
    const normalized = {
      eventType: item.eventType,
      templateId: item.templateId,
      status: item.status,
    }
    if (existingIndex >= 0) {
      merged[existingIndex] = normalized
    } else {
      merged.push(normalized)
    }
  }

  for (const item of existing) {
    if (!item.eventType || !item.templateId) continue
    upsert(item)
  }
  for (const item of templates) {
    if (!item.templateId) continue
    upsert({
      eventType: item.eventType,
      templateId: item.templateId,
      status: requestResult[item.templateId] === 'accept' ? 'accept' : 'reject',
    })
  }
  return merged
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
