import { beforeEach, describe, expect, test, vi } from 'vitest'
import { DEFAULT_GUEST_INTRO_CONFIG } from '../../../../cloud/shared/guest-intro-config'

const storage = new Map<string, any>()

async function loadGuestIntro() {
  vi.resetModules()
  return import('../guest-intro')
}

describe('guest intro popup visibility', () => {
  beforeEach(() => {
    storage.clear()
    vi.stubGlobal('uni', {
      getStorageSync: vi.fn((key: string) => storage.get(key) || ''),
      setStorageSync: vi.fn((key: string, value: any) => { storage.set(key, value) }),
    })
  })

  test('shows only for unauthenticated users browsing a public sample community', async () => {
    const { shouldShowGuestIntro } = await loadGuestIntro()

    expect(shouldShowGuestIntro(DEFAULT_GUEST_INTRO_CONFIG, {
      isLoggedIn: false,
      hasPublicCommunity: true,
    })).toBe(true)
    expect(shouldShowGuestIntro(DEFAULT_GUEST_INTRO_CONFIG, {
      isLoggedIn: true,
      hasPublicCommunity: true,
    })).toBe(false)
    expect(shouldShowGuestIntro(DEFAULT_GUEST_INTRO_CONFIG, {
      isLoggedIn: false,
      hasPublicCommunity: false,
    })).toBe(false)
  })

  test('does not show disabled or already-seen versions, but a new version can show again', async () => {
    const { markGuestIntroSeen, shouldShowGuestIntro } = await loadGuestIntro()
    const v1 = { ...DEFAULT_GUEST_INTRO_CONFIG, version: 'intro-v1' }
    const v2 = { ...DEFAULT_GUEST_INTRO_CONFIG, version: 'intro-v2' }

    markGuestIntroSeen(v1.version)

    expect(shouldShowGuestIntro(v1, {
      isLoggedIn: false,
      hasPublicCommunity: true,
    })).toBe(false)
    expect(shouldShowGuestIntro(v2, {
      isLoggedIn: false,
      hasPublicCommunity: true,
    })).toBe(true)
    expect(shouldShowGuestIntro({ ...v2, enabled: false }, {
      isLoggedIn: false,
      hasPublicCommunity: true,
    })).toBe(false)
  })
})
