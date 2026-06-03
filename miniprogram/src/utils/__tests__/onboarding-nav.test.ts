import { beforeEach, describe, expect, test, vi } from 'vitest'

async function loadNav() {
  vi.resetModules()
  return import('../onboarding-nav')
}

function installUniMock() {
  const uniMock = {
    setStorageSync: vi.fn(),
    navigateTo: vi.fn((opts: any) => opts?.success?.()),
    redirectTo: vi.fn((opts: any) => opts?.success?.()),
    reLaunch: vi.fn((opts: any) => opts?.success?.()),
  }
  ;(globalThis as any).uni = uniMock
  return uniMock
}

describe('openOnboardingPreservingStack', () => {
  beforeEach(() => {
    delete (globalThis as any).uni
    delete (globalThis as any).getCurrentPages
  })

  test('push mode uses navigateTo so side-swipe has a previous page', async () => {
    const uniMock = installUniMock()
    const { openOnboardingPreservingStack } = await loadNav()

    openOnboardingPreservingStack({ mode: 'discover' })

    expect(uniMock.setStorageSync).toHaveBeenCalledWith('onboarding_entry_mode', 'discover')
    expect(uniMock.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: '/pages/onboarding/index?mode=discover',
    }))
    expect(uniMock.reLaunch).not.toHaveBeenCalled()
  })

  test('replace mode uses redirectTo so invalid current detail page is removed but lower stack remains', async () => {
    const uniMock = installUniMock()
    const { openOnboardingPreservingStack } = await loadNav()

    openOnboardingPreservingStack({ replaceCurrent: true })

    expect(uniMock.redirectTo).toHaveBeenCalledWith(expect.objectContaining({
      url: '/pages/onboarding/index',
    }))
    expect(uniMock.navigateTo).not.toHaveBeenCalled()
    expect(uniMock.reLaunch).not.toHaveBeenCalled()
  })

  test('near page-stack limit prefers redirectTo over reLaunch', async () => {
    const uniMock = installUniMock()
    ;(globalThis as any).getCurrentPages = () => new Array(9).fill(0).map((_, index) => ({ route: `pages/x${index}/index` }))
    const { openOnboardingPreservingStack } = await loadNav()

    openOnboardingPreservingStack({ mode: 'discover' })

    expect(uniMock.redirectTo).toHaveBeenCalledWith(expect.objectContaining({
      url: '/pages/onboarding/index?mode=discover',
    }))
    expect(uniMock.navigateTo).not.toHaveBeenCalled()
    expect(uniMock.reLaunch).not.toHaveBeenCalled()
  })

  test('falls back to reLaunch only after stack-preserving navigation fails', async () => {
    const uniMock = installUniMock()
    uniMock.navigateTo.mockImplementation((opts: any) => opts?.fail?.({ errMsg: 'navigateTo:fail' }))
    uniMock.redirectTo.mockImplementation((opts: any) => opts?.fail?.({ errMsg: 'redirectTo:fail' }))
    const { openOnboardingPreservingStack } = await loadNav()

    openOnboardingPreservingStack({ mode: 'discover' })

    expect(uniMock.navigateTo).toHaveBeenCalled()
    expect(uniMock.redirectTo).toHaveBeenCalled()
    expect(uniMock.reLaunch).toHaveBeenCalledWith(expect.objectContaining({
      url: '/pages/onboarding/index?mode=discover',
    }))
  })
})
