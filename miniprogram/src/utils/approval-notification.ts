export type ApprovalNotificationEventType = 'member_join_pending' | 'community_create_pending'
export type ApprovalSubscriptionStatus = 'accept' | 'reject'

export interface ApprovalNotificationTemplate {
  eventType: ApprovalNotificationEventType
  templateId: string
}

export interface ApprovalNotificationSubscription {
  eventType: ApprovalNotificationEventType
  templateId: string
  status: string
}

export type ApprovalReminderState =
  | { kind: 'hidden' }
  | { kind: 'prompt'; title: string; message: string; canRequest: true }
  | { kind: 'info'; title: string; message: string; canRequest: false }

export function configuredApprovalTemplates(templates: ApprovalNotificationTemplate[]) {
  return templates.filter((item) => String(item.templateId || '').trim())
}

export function uniqueTemplateIds(templates: ApprovalNotificationTemplate[]) {
  return Array.from(new Set(configuredApprovalTemplates(templates).map((item) => item.templateId)))
}

export function buildSubscriptionSaves(
  templates: ApprovalNotificationTemplate[],
  result: Record<string, string>,
) {
  return configuredApprovalTemplates(templates).map((item) => ({
    eventType: item.eventType,
    templateId: item.templateId,
    status: result[item.templateId] === 'accept' ? 'accept' as const : 'reject' as const,
  }))
}

function hasAcceptedAllConfigured(
  templates: ApprovalNotificationTemplate[],
  subscriptions: ApprovalNotificationSubscription[],
) {
  const configured = configuredApprovalTemplates(templates)
  if (configured.length === 0) return false
  return configured.every((template) => subscriptions.some((sub) =>
    sub.eventType === template.eventType
    && sub.templateId === template.templateId
    && sub.status === 'accept'
  ))
}

export function buildApprovalReminderState(params: {
  hasAdminTools: boolean
  pendingApprovalCount: number
  templates: ApprovalNotificationTemplate[]
  subscriptions: ApprovalNotificationSubscription[]
  supportsSubscribeMessage: boolean
  backendNeedsAuthorization: boolean
}): ApprovalReminderState {
  if (!params.hasAdminTools) return { kind: 'hidden' }
  if (params.pendingApprovalCount <= 0 && !params.backendNeedsAuthorization) return { kind: 'hidden' }

  const configured = configuredApprovalTemplates(params.templates)
  if (configured.length === 0) {
    return {
      kind: 'info',
      title: '审批提醒',
      message: '提醒模板尚未配置，暂时只能在后台查看待办。',
      canRequest: false,
    }
  }

  if (!params.backendNeedsAuthorization && hasAcceptedAllConfigured(configured, params.subscriptions)) {
    return { kind: 'hidden' }
  }

  if (!params.supportsSubscribeMessage) {
    return {
      kind: 'info',
      title: '审批提醒',
      message: '请在真机微信中开启审批提醒。',
      canRequest: false,
    }
  }

  return {
    kind: 'prompt',
    title: '开启审批提醒',
    message: '有新的审批待办时，微信会尽量发服务通知提醒你。',
    canRequest: true,
  }
}
