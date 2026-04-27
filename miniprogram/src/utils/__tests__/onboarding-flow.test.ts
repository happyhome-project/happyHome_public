import { describe, expect, test } from 'vitest'
import {
  resolveOnboardingEntryMode,
  shouldRedirectJoinedUserFromOnboarding,
} from '../onboarding-flow'

describe('onboarding flow', () => {
  test('auto entry redirects joined users back home', () => {
    expect(shouldRedirectJoinedUserFromOnboarding('auto', 1)).toBe(true)
  })

  test('discover entry keeps joined users on discoverable community list', () => {
    expect(shouldRedirectJoinedUserFromOnboarding('discover', 1)).toBe(false)
  })

  test('users without joined communities stay on onboarding in auto mode', () => {
    expect(shouldRedirectJoinedUserFromOnboarding('auto', 0)).toBe(false)
  })

  test('query mode wins over default auto mode', () => {
    expect(resolveOnboardingEntryMode({ queryMode: 'discover' })).toBe('discover')
  })

  test('current page options and one-shot storage can preserve discover mode on true device', () => {
    expect(resolveOnboardingEntryMode({ currentPageMode: 'discover' })).toBe('discover')
    expect(resolveOnboardingEntryMode({ storedMode: 'discover' })).toBe('discover')
  })

  test('current discover mode survives later refresh calls without query params', () => {
    expect(resolveOnboardingEntryMode({ currentMode: 'discover' })).toBe('discover')
  })
})
