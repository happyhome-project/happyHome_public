import { describe, expect, test } from 'vitest'
import { computeSearchNavMetrics } from '../search-nav'

describe('search navigation metrics', () => {
  test('uses the real iOS status bar and capsule boundary', () => {
    expect(computeSearchNavMetrics({
      windowWidth: 390,
      statusBarHeight: 44,
      menuTop: 51,
      menuHeight: 32,
      menuLeft: 292,
    })).toEqual({ statusBarHeight: 44, navRowHeight: 54, menuSpacerWidth: 98 })
  })

  test('uses the real Android status bar and capsule boundary', () => {
    expect(computeSearchNavMetrics({
      windowWidth: 360,
      statusBarHeight: 24,
      menuTop: 32,
      menuHeight: 32,
      menuLeft: 269,
    })).toEqual({ statusBarHeight: 24, navRowHeight: 54, menuSpacerWidth: 91 })
  })

  test('does not reserve a WeChat capsule on H5', () => {
    expect(computeSearchNavMetrics({ isH5: true, windowWidth: 390 })).toEqual({
      statusBarHeight: 44,
      navRowHeight: 54,
      menuSpacerWidth: 0,
    })
  })
})
