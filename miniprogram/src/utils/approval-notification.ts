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

export interface ApprovalNotificationSubscriptionSave {
  eventType: ApprovalNotificationEventType
  templateId: string
  status: ApprovalSubscriptionStatus
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

function errorMessageOf(error: any) {
  return String(error?.errMsg || error?.message || error || '')
}

function errorCodeOf(error: any) {
  const explicit = Number(error?.errCode)
  if (Number.isFinite(explicit)) return explicit
  const matched = errorMessageOf(error).match(/errCode:\s*(-?\d+)/i)
  return matched ? Number(matched[1]) : NaN
}

export function isRetryableApprovalSubscriptionSaveError(error: any) {
  return error?.action === 'saveNotificationSubscription' && errorCodeOf(error) === -504002
}

export function approvalReminderErrorMessage(error: any) {
  const message = errorMessageOf(error)
  const code = errorCodeOf(error)
  const codeSuffix = Number.isFinite(code) ? `（${code}）` : ''

  if (error?.action === 'saveNotificationSubscription') {
    return `提醒授权已返回，但保存失败${codeSuffix}，请稍后重试`
  }
  if (/requestSubscribeMessage/i.test(message) && /cancel|deny|reject/i.test(message)) {
    return '未开启提醒，可稍后再试'
  }
  if (/requestSubscribeMessage/i.test(message)) {
    return '微信订阅授权失败，请稍后重试'
  }
  return message || '开启提醒失败，请稍后重试'
}

function wait(ms: number) {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function saveApprovalSubscriptionWithRetry<T>(
  item: ApprovalNotificationSubscriptionSave,
  save: (item: ApprovalNotificationSubscriptionSave) => Promise<T>,
  retryDelayMs = 600,
) {
  try {
    return await save(item)
  } catch (error) {
    if (!isRetryableApprovalSubscriptionSaveError(error)) throw error
    await wait(retryDelayMs)
    return save(item)
  }
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
