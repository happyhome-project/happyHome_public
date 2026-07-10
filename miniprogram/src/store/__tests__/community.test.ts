import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const myCommunities = vi.fn()
const sectionList = vi.fn()

vi.mock('../../api/cloud', () => ({
  memberApi: { myCommunities },
  sectionApi: { list: sectionList },
}))

function makeDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
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
})
