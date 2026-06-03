import { describe, expect, test } from 'vitest'
import {
  areAllNotificationTemplatesAccepted,
  getApplicationNotificationStatusText,
  getNotificationSubscribeButtonText,
  mergeNotificationSubscribeResult,
  subscriptionStatusLabel,
} from '../profile-notifications'

const templates = [
  { eventType: 'member_join_pending' as const, templateId: 'tmpl-member' },
  { eventType: 'community_create_pending' as const, templateId: 'tmpl-community' },
]

describe('profile notification helpers', () => {
  test('optimistically marks accepted template results after subscribe request', () => {
    const merged = mergeNotificationSubscribeResult([], templates, {
      'tmpl-member': 'accept',
      'tmpl-community': 'reject',
    })

    expect(subscriptionStatusLabel(merged, 'member_join_pending', 'tmpl-member')).toBe('已开启')
    expect(subscriptionStatusLabel(merged, 'community_create_pending', 'tmpl-community')).toBe('未授权')
  })

  test('updates existing subscription status for the same event and template', () => {
    const merged = mergeNotificationSubscribeResult([
      { eventType: 'member_join_pending', templateId: 'tmpl-member', status: 'reject' },
    ], [templates[0]], { 'tmpl-member': 'accept' })

    expect(merged).toEqual([
      { eventType: 'member_join_pending', templateId: 'tmpl-member', status: 'accept' },
    ])
  })

  test('shows one application notification status without exposing individual template names', () => {
    const accepted = mergeNotificationSubscribeResult([], templates, {
      'tmpl-member': 'accept',
      'tmpl-community': 'reject',
    })

    expect(getApplicationNotificationStatusText(templates, accepted)).toBe('已开启')
  })

  test('changes button text once any configured application notification template is accepted', () => {
    const accepted = mergeNotificationSubscribeResult([], templates, {
      'tmpl-member': 'accept',
      'tmpl-community': 'reject',
    })

    expect(areAllNotificationTemplatesAccepted(templates, accepted)).toBe(false)
    expect(getNotificationSubscribeButtonText(false, templates, accepted)).toBe('申请通知已开启')
  })

  test('keeps pending button text while any template is missing or rejected', () => {
    const partial = mergeNotificationSubscribeResult([], templates, {
      'tmpl-member': 'reject',
      'tmpl-community': 'reject',
    })

    expect(areAllNotificationTemplatesAccepted(templates, partial)).toBe(false)
    expect(getNotificationSubscribeButtonText(false, templates, partial)).toBe('接收申请通知')
    expect(getNotificationSubscribeButtonText(true, templates, partial)).toBe('开启中...')
  })
})
