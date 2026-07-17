import { describe, expect, test } from 'vitest'
import { computeCreateNavMetrics, resolveCreateNavTitle } from '../create-nav'

describe('create custom navigation metrics', () => {
  test('centers the row around the WeChat capsule', () => {
    expect(computeCreateNavMetrics({ statusBarHeight: 24, menuTop: 32, menuHeight: 32 })).toEqual({ statusBarHeight: 24, navRowHeight: 54 })
    expect(computeCreateNavMetrics({ statusBarHeight: 44, menuTop: 51, menuHeight: 32 })).toEqual({ statusBarHeight: 44, navRowHeight: 54 })
  })

  test('keeps an Android fallback when safe area and status bar report zero', () => {
    expect(computeCreateNavMetrics({ statusBarHeight: 0, safeAreaTop: 0 })).toEqual({ statusBarHeight: 20, navRowHeight: 54 })
  })

  test('uses a stable H5 fallback without a native capsule', () => {
    expect(computeCreateNavMetrics({ isH5: true, statusBarHeight: 0 })).toEqual({ statusBarHeight: 44, navRowHeight: 54 })
  })
})

describe('create custom navigation title', () => {
  test('gives edit mode precedence over section and text-cover titles', () => {
    expect(resolveCreateNavTitle({ isEditMode: true, sectionName: '活动', isTextCoverStep: true })).toBe('编辑内容')
    expect(resolveCreateNavTitle({ isEditMode: false, sectionName: '活动', isTextCoverStep: true })).toBe('选择文字封面')
    expect(resolveCreateNavTitle({ isEditMode: false, sectionName: '活动', isTextCoverStep: false })).toBe('活动')
    expect(resolveCreateNavTitle({ isEditMode: false, sectionName: '', isTextCoverStep: false })).toBe('发帖')
  })
})
