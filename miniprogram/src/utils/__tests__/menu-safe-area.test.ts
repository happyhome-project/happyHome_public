import { describe, expect, test } from 'vitest'
import { resolveMenuSafeRightInset } from '../menu-safe-area'

describe('resolveMenuSafeRightInset', () => {
  test('reserves the space between the capsule and the page content edge', () => {
    expect(
      resolveMenuSafeRightInset({
        windowWidth: 390,
        menuLeft: 296,
        pageRightPadding: 12,
        gap: 8,
      }),
    ).toBe(90)

    expect(
      resolveMenuSafeRightInset({
        windowWidth: 430,
        menuLeft: 334,
        pageRightPadding: 16,
        gap: 10,
      }),
    ).toBe(90)
  })

  test('returns zero for missing or invalid capsule geometry', () => {
    expect(
      resolveMenuSafeRightInset({
        windowWidth: 390,
        menuLeft: 0,
        pageRightPadding: 12,
        gap: 8,
      }),
    ).toBe(0)
    expect(
      resolveMenuSafeRightInset({
        windowWidth: Number.NaN,
        menuLeft: 296,
        pageRightPadding: 12,
        gap: 8,
      }),
    ).toBe(0)
  })

  test('never returns a negative inset', () => {
    expect(
      resolveMenuSafeRightInset({
        windowWidth: 390,
        menuLeft: 389,
        pageRightPadding: 20,
        gap: 0,
      }),
    ).toBe(0)

    expect(
      resolveMenuSafeRightInset({
        windowWidth: 390,
        menuLeft: 410,
        pageRightPadding: 12,
        gap: 8,
      }),
    ).toBe(0)
  })
})
