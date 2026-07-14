import { describe, expect, test } from 'vitest'
import {
  buildDateTimeValue,
  isPlaceholderWidgetLabel,
  resolveAttendanceWidgetLabel,
  resolveWidgetLabel,
  splitDateTimeValue,
} from '../widget-form'

describe('widget-form label helpers', () => {
  test('recognizes placeholder labels', () => {
    expect(isPlaceholderWidgetLabel('新控件')).toBe(true)
    expect(isPlaceholderWidgetLabel('new widget')).toBe(true)
    expect(isPlaceholderWidgetLabel('')).toBe(true)
    expect(isPlaceholderWidgetLabel('出发时间')).toBe(false)
  })

  test('resolves widget label with type fallback', () => {
    expect(resolveWidgetLabel({ type: 'datetime', label: '新控件' })).toBe('日期时间')
    expect(resolveWidgetLabel({ type: 'location', label: '' })).toBe('位置')
    expect(resolveWidgetLabel({ type: 'topic', label: '新控件' })).toBe('话题')
    expect(resolveWidgetLabel({ type: 'short_text', label: '目的地' })).toBe('目的地')
  })

  test('resolves attendance label without leaking generic widget type names', () => {
    expect(resolveAttendanceWidgetLabel({ type: 'attendance', label: '短文字' })).toBe('')
    expect(resolveAttendanceWidgetLabel({ type: 'attendance', label: '活动参与' })).toBe('')
    expect(resolveAttendanceWidgetLabel({ type: 'attendance', label: '新控件' })).toBe('')
    expect(resolveAttendanceWidgetLabel({ type: 'attendance', label: '' })).toBe('')
    expect(resolveAttendanceWidgetLabel({ type: 'attendance', label: '拼车报名' })).toBe('拼车报名')
  })
})

describe('widget-form datetime helpers', () => {
  test('splitDateTimeValue parses local datetime string', () => {
    expect(splitDateTimeValue('2026-04-23T08:30:00')).toEqual({ date: '2026-04-23', time: '08:30' })
  })

  test('buildDateTimeValue builds storable datetime string', () => {
    expect(buildDateTimeValue('2026-04-23', '08:30')).toBe('2026-04-23T08:30:00')
    expect(buildDateTimeValue('', '08:30')).toBe('')
  })
})
