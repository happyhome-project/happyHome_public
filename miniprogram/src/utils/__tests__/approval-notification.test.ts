import { describe, expect, test, vi } from 'vitest'
import {
  approvalReminderErrorMessage,
  buildApprovalReminderState,
  buildSubscriptionSaves,
  isRetryableApprovalSubscriptionSaveError,
  saveApprovalSubscriptionWithRetry,
  uniqueTemplateIds,
  type ApprovalNotificationTemplate,
} from '../approval-notification'

const templates: ApprovalNotificationTemplate[] = [
  { eventType: 'member_join_pending', templateId: 'tmpl-shared' },
  { eventType: 'community_create_pending', templateId: 'tmpl-shared' },
]

describe('approval notification helper', () => {
  test('deduplicates template ids before requesting WeChat subscription', () => {
    expect(uniqueTemplateIds(templates)).toEqual(['tmpl-shared'])
  })

  test('maps one shared WeChat subscription result back to both approval events', () => {
    expect(buildSubscriptionSaves(templates, { 'tmpl-shared': 'accept' })).toEqual([
      { eventType: 'member_join_pending', templateId: 'tmpl-shared', status: 'accept' },
      { eventType: 'community_create_pending', templateId: 'tmpl-shared', status: 'accept' },
    ])
  })

  test('shows a light prompt only when an admin has pending approvals and needs authorization', () => {
    expect(buildApprovalReminderState({
      hasAdminTools: true,
      pendingApprovalCount: 2,
      templates,
      subscriptions: [],
      supportsSubscribeMessage: true,
      backendNeedsAuthorization: false,
    })).toEqual({
      kind: 'prompt',
      title: '开启审批提醒',
      message: '有新的审批待办时，微信会尽量发服务通知提醒你。',
      canRequest: true,
    })
  })

  test('hides reminder after all configured approval reminders are accepted', () => {
    expect(buildApprovalReminderState({
      hasAdminTools: true,
      pendingApprovalCount: 2,
      templates,
      subscriptions: [
        { eventType: 'member_join_pending', templateId: 'tmpl-shared', status: 'accept' },
        { eventType: 'community_create_pending', templateId: 'tmpl-shared', status: 'accept' },
      ],
      supportsSubscribeMessage: true,
      backendNeedsAuthorization: false,
    })).toEqual({ kind: 'hidden' })
  })

  test('shows real-device hint instead of a dead button when subscribe API is unavailable', () => {
    expect(buildApprovalReminderState({
      hasAdminTools: true,
      pendingApprovalCount: 1,
      templates,
      subscriptions: [],
      supportsSubscribeMessage: false,
      backendNeedsAuthorization: false,
    })).toEqual({
      kind: 'info',
      title: '审批提醒',
      message: '请在真机微信中开启审批提醒。',
      canRequest: false,
    })
  })

  test('marks transient cloud subscription save failures as retryable', () => {
    expect(isRetryableApprovalSubscriptionSaveError({
      errCode: -504002,
      action: 'saveNotificationSubscription',
    })).toBe(true)

    expect(isRetryableApprovalSubscriptionSaveError({
      errMsg: 'cloud.callFunction:fail Error: errCode: -504002 functions execute fail',
      action: 'saveNotificationSubscription',
    })).toBe(true)

    expect(isRetryableApprovalSubscriptionSaveError({
      errCode: -504002,
      action: 'notificationStatus',
    })).toBe(false)
  })

  test('converts approval reminder failures into user-readable text', () => {
    expect(approvalReminderErrorMessage({
      errCode: -504002,
      action: 'saveNotificationSubscription',
    })).toBe('提醒授权已返回，但保存失败（-504002），请稍后重试')

    expect(approvalReminderErrorMessage({
      errMsg: 'requestSubscribeMessage:fail cancel',
    })).toBe('未开启提醒，可稍后再试')
  })

  test('retries a transient subscription save failure once', async () => {
    const item = { eventType: 'member_join_pending' as const, templateId: 'tmpl-shared', status: 'accept' as const }
    const save = vi.fn()
      .mockRejectedValueOnce({ errCode: -504002, action: 'saveNotificationSubscription' })
      .mockResolvedValueOnce({ success: true })

    await expect(saveApprovalSubscriptionWithRetry(item, save, 0)).resolves.toEqual({ success: true })
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenNthCalledWith(1, item)
    expect(save).toHaveBeenNthCalledWith(2, item)
  })
})
