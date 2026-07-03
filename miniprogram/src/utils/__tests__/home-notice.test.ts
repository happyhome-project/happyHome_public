import { describe, expect, test } from 'vitest'

import { normalizeHomeNoticeKind } from '../home-notice'

describe('home notice display helpers', () => {
  test('keeps notice kind short even when source text is a long section name', () => {
    expect(normalizeHomeNoticeKind('修身之外无事，明伦之外无学')).toBe('公告')
  })

  test('preserves short controlled notice labels', () => {
    expect(normalizeHomeNoticeKind('通知')).toBe('通知')
    expect(normalizeHomeNoticeKind('公告')).toBe('公告')
  })

  test('falls back to a safe short label for empty or overlong text', () => {
    expect(normalizeHomeNoticeKind('')).toBe('公告')
    expect(normalizeHomeNoticeKind('信息传达不到位')).toBe('公告')
  })
})
