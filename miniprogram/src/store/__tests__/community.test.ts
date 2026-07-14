import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const myCommunities = vi.fn()
const myStatus = vi.fn()
const sectionList = vi.fn()

vi.mock('../../api/cloud', () => ({
  memberApi: { myCommunities, myStatus },
  sectionApi: { list: sectionList },
}))

function makeDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: any) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

describe('community store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    vi.stubGlobal('wx', {
      getStorageSync: vi.fn(() => null),
      setStorageSync: vi.fn(),
    })
  })

  test('loadMyCommunities deduplicates concurrent refreshes', async () => {
    const deferred = makeDeferred<{ communities: any[] }>()
    myCommunities.mockReturnValueOnce(deferred.promise)
    sectionList.mockResolvedValue({ sections: [] })
    const { useCommunityStore } = await import('../community')
    const store = useCommunityStore()

    const first = store.loadMyCommunities({ loadSections: false })
    const second = store.loadMyCommunities({ loadSections: false })

    deferred.resolve({
      communities: [{ _id: 'community-1', name: '青山村', status: 'active' }],
    })
    await Promise.all([first, second])

    expect(myCommunities).toHaveBeenCalledTimes(1)
    expect(sectionList).not.toHaveBeenCalled()
    expect(store.currentCommunityId).toBe('community-1')
  })

  test('currentCommunity can come from a public browsing community without joining myCommunities', async () => {
    const { useCommunityStore } = await import('../community')
    const store = useCommunityStore()

    store.currentCommunityId = 'public-community'
    store.browsingCommunity = { _id: 'public-community', name: '阳光花园小区', status: 'active' } as any

    expect(store.myCommunities).toEqual([])
    expect(store.currentCommunity?.name).toBe('阳光花园小区')
  })

  test('loadMyCommunities ignores pending communities even if an older backend returns them', async () => {
    myCommunities.mockResolvedValueOnce({
      communities: [
        { _id: 'active-community', name: '明士班', status: 'active' },
        { _id: 'pending-community', name: 'test', status: 'pending' },
      ],
    })
    const { useCommunityStore } = await import('../community')
    const store = useCommunityStore()

    await store.loadMyCommunities({ loadSections: false })

    expect(store.myCommunities.map((community) => community._id)).toEqual(['active-community'])
    expect(store.currentCommunityId).toBe('active-community')
  })

  test('switchCommunity keeps the previous state when loading the new community fails', async () => {
    sectionList.mockRejectedValueOnce(new Error('network failed'))
    const { useCommunityStore } = await import('../community')
    const store = useCommunityStore()
    store.currentCommunityId = 'old-community'
    store.currentSections = [{ _id: 'old-section', communityId: 'old-community' }] as any[]
    store.currentSectionIndex = 1

    await expect(store.switchCommunity('new-community')).rejects.toThrow('network failed')

    expect(store.currentCommunityId).toBe('old-community')
    expect(store.currentSections.map((section) => section._id)).toEqual(['old-section'])
    expect(store.currentSectionIndex).toBe(1)
  })

  test('selectCommunityShell commits the target synchronously without loading sections or membership', async () => {
    const { useCommunityStore } = await import('../community')
    const store = useCommunityStore()
    store.myCommunities = [
      { _id: 'old-community', name: '旧社区', status: 'active' },
      { _id: 'new-community', name: '新社区', status: 'active' },
    ] as any[]
    store.currentCommunityId = 'old-community'
    store.currentSections = [{ _id: 'old-section', communityId: 'old-community' }] as any[]
    store.currentSectionIndex = 1

    const selection = store.selectCommunityShell('new-community')

    expect(selection).toMatchObject({
      targetCommunityId: 'new-community',
      previousCommunityId: 'old-community',
    })
    expect(store.currentCommunityId).toBe('new-community')
    expect(store.currentSections).toEqual([])
    expect(store.browsingCommunity?._id).toBe('new-community')
    expect(sectionList).not.toHaveBeenCalled()
    expect(myStatus).not.toHaveBeenCalled()
  })

  test('selectCommunityShell can render a directory-only joined community before hydration finishes', async () => {
    const { useCommunityStore } = await import('../community')
    const store = useCommunityStore()
    store.currentCommunityId = 'old-community'

    store.selectCommunityShell('directory-community', {
      _id: 'directory-community',
      name: '目录里的新社区',
      status: 'active',
    } as any, 'switch-trace-1')

    expect(store.currentCommunity?.name).toBe('目录里的新社区')
    expect(store.pendingCommunitySelection?.traceRequestId).toBe('switch-trace-1')
    expect(sectionList).not.toHaveBeenCalled()
    expect(myStatus).not.toHaveBeenCalled()
  })

  test('handleCommunityAccessLost removes the rejected target and restores a still-active previous shell', async () => {
    const { useCommunityStore } = await import('../community')
    const store = useCommunityStore()
    store.myCommunities = [
      { _id: 'old-community', name: '旧社区', status: 'active' },
      { _id: 'new-community', name: '新社区', status: 'active' },
    ] as any[]
    store.currentCommunityId = 'old-community'
    store.currentSections = [{ _id: 'old-section', communityId: 'old-community' }] as any[]
    store.currentSectionIndex = 1
    store.selectCommunityShell('new-community')

    const restored = store.handleCommunityAccessLost('new-community')

    expect(restored).toBe('old-community')
    expect(store.myCommunities.map((community) => community._id)).toEqual(['old-community'])
    expect(store.currentCommunityId).toBe('old-community')
    expect(store.currentSections.map((section) => section._id)).toEqual(['old-section'])
    expect(store.currentSectionIndex).toBe(1)
  })

  test('a second unverified target keeps the original verified rollback shell', async () => {
    const { useCommunityStore } = await import('../community')
    const store = useCommunityStore()
    store.myCommunities = [
      { _id: 'verified-community', status: 'active' },
      { _id: 'first-target', status: 'active' },
      { _id: 'second-target', status: 'active' },
    ] as any[]
    store.currentCommunityId = 'verified-community'
    store.currentSections = [{ _id: 'verified-section' }] as any[]
    store.currentSectionIndex = 1

    store.selectCommunityShell('first-target', undefined, 'trace-first')
    store.selectCommunityShell('second-target', undefined, 'trace-second')

    expect(store.pendingCommunitySelection).toMatchObject({
      targetCommunityId: 'second-target',
      traceRequestId: 'trace-second',
      previousCommunityId: 'verified-community',
      previousSectionIndex: 1,
      previousSections: [{ _id: 'verified-section' }],
    })
  })

  test('reselecting the current pending target does not discard its rollback proof', async () => {
    const { useCommunityStore } = await import('../community')
    const store = useCommunityStore()
    store.myCommunities = [
      { _id: 'verified-community', status: 'active' },
      { _id: 'pending-target', status: 'active' },
    ] as any[]
    store.currentCommunityId = 'verified-community'
    store.currentSections = [{ _id: 'verified-section' }] as any[]
    store.selectCommunityShell('pending-target', undefined, 'trace-first')

    store.selectCommunityShell('pending-target', undefined, 'trace-second')

    expect(store.pendingCommunitySelection).toMatchObject({
      targetCommunityId: 'pending-target',
      traceRequestId: 'trace-first',
      previousCommunityId: 'verified-community',
    })
  })

  test('a target chain without a verified previous community keeps an empty rollback anchor', async () => {
    const { useCommunityStore } = await import('../community')
    const store = useCommunityStore()

    store.selectCommunityShell('first-target')
    store.selectCommunityShell('second-target')

    expect(store.pendingCommunitySelection?.previousCommunityId).toBe('')
  })

  test('clearCommunityState fences an in-flight myCommunities response', async () => {
    const pending = makeDeferred<{ communities: any[] }>()
    myCommunities.mockReturnValueOnce(pending.promise)
    const { useCommunityStore } = await import('../community')
    const store = useCommunityStore()

    const loading = store.loadMyCommunities({ loadSections: false })
    store.clearCommunityState()
    pending.resolve({ communities: [{ _id: 'stale-community', status: 'active' }] })
    await loading

    expect(store.myCommunities).toEqual([])
    expect(store.currentCommunityId).toBe('')
  })

  test('clearCommunityState fences an in-flight section response', async () => {
    const pending = makeDeferred<{ sections: any[] }>()
    sectionList.mockReturnValueOnce(pending.promise)
    const { useCommunityStore } = await import('../community')
    const store = useCommunityStore()

    const loading = store.switchCommunity('stale-community')
    store.clearCommunityState()
    pending.resolve({ sections: [{ _id: 'stale-section' }] })
    await loading

    expect(store.currentCommunityId).toBe('')
    expect(store.currentSections).toEqual([])
  })

  test.each(['success', 'failure'])('clearCommunityState fences an in-flight membership %s', async (outcome) => {
    const pending = makeDeferred<{ isMember: boolean; status: string | null }>()
    myStatus.mockReturnValueOnce(pending.promise)
    const { useCommunityStore } = await import('../community')
    const store = useCommunityStore()

    const loading = store.refreshMembershipStatus('stale-community')
    store.clearCommunityState()
    if (outcome === 'success') pending.resolve({ isMember: true, status: 'approved' })
    else pending.reject(new Error('stale failure'))
    await loading

    expect(store.membershipByCommunity).toEqual({})
  })

  test('a stale coalesced load does not block a new epoch fresh load', async () => {
    const stale = makeDeferred<{ communities: any[] }>()
    myCommunities
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce({ communities: [{ _id: 'fresh-community', status: 'active' }] })
    const { useCommunityStore } = await import('../community')
    const store = useCommunityStore()

    const oldLoad = store.loadMyCommunities({ loadSections: false })
    store.clearCommunityState()
    const freshLoad = store.loadMyCommunities({ loadSections: false })
    await freshLoad

    expect(myCommunities).toHaveBeenCalledTimes(2)
    expect(store.currentCommunityId).toBe('fresh-community')
    stale.resolve({ communities: [{ _id: 'stale-community', status: 'active' }] })
    await oldLoad
    expect(store.currentCommunityId).toBe('fresh-community')
  })
})
