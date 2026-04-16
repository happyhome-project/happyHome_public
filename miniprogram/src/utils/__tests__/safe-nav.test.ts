import { describe, test, expect, vi, beforeEach } from 'vitest'

// Fresh module per test to reset internal debounce state
async function loadSafeNav() {
  vi.resetModules()
  return import('../safe-nav')
}

describe('installSafeNav', () => {
  let uniMock: any
  beforeEach(() => {
    uniMock = {
      navigateTo: vi.fn(),
      switchTab: vi.fn(),
      reLaunch: vi.fn(),
      redirectTo: vi.fn(),
      navigateBack: vi.fn(),
    }
    ;(globalThis as any).uni = uniMock
  })

  test('duplicate call within debounce window is suppressed', async () => {
    // Save ref to the ORIGINAL mock before install (install will replace uni.navigateTo)
    const originalNav = uniMock.navigateTo
    originalNav.mockReturnValue(Promise.resolve('ok'))
    const { installSafeNav } = await loadSafeNav()
    installSafeNav()

    ;(globalThis as any).uni.navigateTo({ url: '/foo' })
    ;(globalThis as any).uni.navigateTo({ url: '/foo' })
    ;(globalThis as any).uni.navigateTo({ url: '/foo' })

    expect(originalNav).toHaveBeenCalledTimes(1)
  })

  test('different urls are not debounced against each other', async () => {
    const originalNav = uniMock.navigateTo
    originalNav.mockReturnValue(Promise.resolve('ok'))
    const { installSafeNav } = await loadSafeNav()
    installSafeNav()
    ;(globalThis as any).uni.navigateTo({ url: '/a' })
    ;(globalThis as any).uni.navigateTo({ url: '/b' })
    expect(originalNav).toHaveBeenCalledTimes(2)
  })

  test('rejection from underlying API is caught (no unhandledRejection)', async () => {
    uniMock.navigateTo.mockReturnValue(Promise.reject({ errMsg: 'navigateTo:fail already in progress' }))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { installSafeNav } = await loadSafeNav()
    installSafeNav()
    // Should not throw / reject
    await (globalThis as any).uni.navigateTo({ url: '/x' })
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  test('thrown sync error is caught', async () => {
    uniMock.switchTab.mockImplementation(() => { throw new Error('boom') })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { installSafeNav } = await loadSafeNav()
    installSafeNav()
    // Must not throw
    await (globalThis as any).uni.switchTab({ url: '/y' })
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  test('is no-op if uni global is missing', async () => {
    delete (globalThis as any).uni
    const { installSafeNav } = await loadSafeNav()
    expect(() => installSafeNav()).not.toThrow()
  })
})
