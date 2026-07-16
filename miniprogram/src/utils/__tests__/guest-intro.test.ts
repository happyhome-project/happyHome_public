import { beforeEach, describe, expect, test, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_GUEST_INTRO_CONFIG, normalizeGuestIntroConfig } from '../../../../cloud/shared/guest-intro-config'

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

  test('shows the compiled intro on the first signed-out paint without waiting for community data', async () => {
    const { markGuestIntroSeen, shouldShowGuestIntroOnFirstPaint } = await loadGuestIntro()

    expect(shouldShowGuestIntroOnFirstPaint(DEFAULT_GUEST_INTRO_CONFIG, {
      isLoggedIn: false,
    })).toBe(true)
    expect(shouldShowGuestIntroOnFirstPaint(DEFAULT_GUEST_INTRO_CONFIG, {
      isLoggedIn: true,
    })).toBe(false)

    markGuestIntroSeen('a-server-version-that-is-not-the-compiled-default')
    expect(shouldShowGuestIntroOnFirstPaint(DEFAULT_GUEST_INTRO_CONFIG, {
      isLoggedIn: false,
    })).toBe(false)
  })

  test('starts login on home without routing through profile and uses the new create copy', () => {
    const homeSource = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/index/index.vue'), 'utf8')
    const primaryStart = homeSource.indexOf('function handleGuestIntroPrimary')
    const secondaryStart = homeSource.indexOf('function handleGuestIntroSecondary')
    const primaryHandler = homeSource.slice(primaryStart, secondaryStart)

    expect(primaryStart).toBeGreaterThan(-1)
    expect(primaryHandler).not.toContain('/pages/profile/index')
    expect(primaryHandler).not.toContain('switchTab')
    expect(primaryHandler).not.toContain('reLaunch')
    expect(homeSource).toContain('data-testid="guest-intro-login-trigger"')
    expect(homeSource).toContain('open-type="chooseAvatar"')
    expect(homeSource).toContain('data-testid="guest-intro-login-submit"')
    expect(homeSource).toContain(':focus="guestIntroNicknameFocused"')
    expect(homeSource).toMatch(/handleGuestIntroChooseAvatar[\s\S]*guestIntroLoginMode\.value = 'nickname'[\s\S]*nextTick[\s\S]*guestIntroNicknameFocused\.value = true/)
    expect(homeSource).not.toContain('showKeyboard')
    expect(DEFAULT_GUEST_INTRO_CONFIG.secondaryActionText).toBe('创建我自己的社群')
  })

  test('upgrades the previous default create copy without overwriting custom copy', () => {
    expect(normalizeGuestIntroConfig({
      ...DEFAULT_GUEST_INTRO_CONFIG,
      secondaryActionText: '免费创建我的社群',
    }).secondaryActionText).toBe('创建我自己的社群')
    expect(normalizeGuestIntroConfig({
      ...DEFAULT_GUEST_INTRO_CONFIG,
      secondaryActionText: '加入社区',
    }).secondaryActionText).toBe('加入社区')
  })
})
