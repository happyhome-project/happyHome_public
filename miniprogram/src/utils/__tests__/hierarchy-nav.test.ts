import { beforeEach, describe, expect, test, vi } from 'vitest'

async function loadNav() {
  vi.resetModules()
  return import('../hierarchy-nav')
}

function installUniMock() {
  const uniMock = {
    navigateBack: vi.fn((opts: any) => opts?.success?.()),
    navigateTo: vi.fn((opts: any) => opts?.success?.()),
    switchTab: vi.fn((opts: any) => opts?.success?.()),
    reLaunch: vi.fn((opts: any) => opts?.success?.()),
  }
  ;(globalThis as any).uni = uniMock
  return uniMock
}

describe('hierarchy navigation helpers', () => {
  beforeEach(() => {
    delete (globalThis as any).uni
    delete (globalThis as any).getCurrentPages
  })

  test('goes back when the current page has a parent in the stack', async () => {
    const uniMock = installUniMock()
    ;(globalThis as any).getCurrentPages = () => [{ route: 'pages/index/index' }, { route: 'pages/detail/index' }]
    const { navigateBackOrHome } = await loadNav()

    navigateBackOrHome()

    expect(uniMock.navigateBack).toHaveBeenCalled()
    expect(uniMock.switchTab).not.toHaveBeenCalled()
  })

  test('falls back to home tab when the current page is the only stack entry', async () => {
    const uniMock = installUniMock()
    ;(globalThis as any).getCurrentPages = () => [{ route: 'pages/detail/index' }]
    const { navigateBackOrHome } = await loadNav()

    navigateBackOrHome()

    expect(uniMock.navigateBack).not.toHaveBeenCalled()
    expect(uniMock.switchTab).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/index/index' }))
  })

  test('returns to a non-tab parent by rebuilding the stack from home', async () => {
    const uniMock = installUniMock()
    const { openHierarchyParent } = await loadNav()

    openHierarchyParent('/pages/section/index?sectionId=s1')

    expect(uniMock.switchTab).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/index/index' }))
    expect(uniMock.navigateTo).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/section/index?sectionId=s1' }))
  })

  test('returns directly to a tab parent with switchTab', async () => {
    const uniMock = installUniMock()
    const { openHierarchyParent } = await loadNav()

    openHierarchyParent('/pages/profile/index')

    expect(uniMock.switchTab).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/profile/index' }))
    expect(uniMock.navigateTo).not.toHaveBeenCalled()
  })
})
