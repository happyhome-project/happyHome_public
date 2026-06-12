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
})
