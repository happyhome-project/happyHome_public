import { describe, expect, test } from 'vitest'
import { computeCreateNavMetrics } from '../create-nav'

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
