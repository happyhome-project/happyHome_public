import { describe, expect, test } from 'vitest'
import {
  buildApprovalReminderState,
  buildSubscriptionSaves,
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
})
