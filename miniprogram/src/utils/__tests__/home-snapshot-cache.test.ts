import { beforeEach, describe, expect, test, vi } from 'vitest'

const storage = new Map<string, any>()

vi.mock('../../api/cloud', () => ({}))

describe('home snapshot cache', () => {
  beforeEach(() => {
    storage.clear()
    vi.resetModules()
    vi.useRealTimers()
    vi.stubGlobal('uni', {
      getStorageSync: vi.fn((key: string) => storage.get(key) || null),
      setStorageSync: vi.fn((key: string, value: any) => { storage.set(key, value) }),
      removeStorageSync: vi.fn((key: string) => { storage.delete(key) }),
    })
    vi.stubGlobal('wx', {})
  })

  test('writes and reads a same-user same-community snapshot within ttl', async () => {
    const {
      readHomeSnapshotCache,
      writeHomeSnapshotCache,
    } = await import('../home-snapshot-cache')
    const snapshot = {
      schemaVersion: 1,
      generatedAt: '2026-06-12T00:00:00.000Z',
      viewerOpenId: 'user-1',
      currentCommunityId: 'community-1',
      communities: [{ _id: 'community-1', name: '青山村' }],
      sections: [],
      postsBySection: {},
    }

    writeHomeSnapshotCache(snapshot as any)
    const cached = readHomeSnapshotCache({
      openId: 'user-1',
      communityId: 'community-1',
      now: Date.parse('2026-06-12T01:00:00.000Z'),
    })

    expect(cached?.currentCommunityId).toBe('community-1')
  })

  test('rejects expired or wrong-user snapshots and clears stale cache', async () => {
    const {
      readHomeSnapshotCache,
      writeHomeSnapshotCache,
    } = await import('../home-snapshot-cache')
    const snapshot = {
      schemaVersion: 1,
      generatedAt: '2026-06-12T00:00:00.000Z',
      viewerOpenId: 'user-1',
      currentCommunityId: 'community-1',
      communities: [],
      sections: [],
      postsBySection: {},
    }

    writeHomeSnapshotCache(snapshot as any)

    expect(readHomeSnapshotCache({
      openId: 'user-2',
      communityId: 'community-1',
      now: Date.parse('2026-06-12T01:00:00.000Z'),
    })).toBeNull()

    writeHomeSnapshotCache(snapshot as any)
    expect(readHomeSnapshotCache({
      openId: 'user-1',
      communityId: 'community-1',
      now: Date.parse('2026-06-12T07:01:00.000Z'),
    })).toBeNull()
  })

  test('normalizes wx pre-fetch data only when it belongs to the current user', async () => {
    const { parseBackgroundFetchSnapshot } = await import('../home-snapshot-cache')
    const snapshot = {
      schemaVersion: 1,
      generatedAt: '2026-06-12T00:00:00.000Z',
      viewerOpenId: 'user-1',
      currentCommunityId: 'community-1',
      communities: [],
      sections: [],
      postsBySection: {},
    }

    expect(parseBackgroundFetchSnapshot(JSON.stringify(snapshot), {
      openId: 'user-1',
      now: Date.parse('2026-06-12T00:10:00.000Z'),
    })?.viewerOpenId).toBe('user-1')
    expect(parseBackgroundFetchSnapshot(JSON.stringify(snapshot), {
      openId: 'user-2',
      now: Date.parse('2026-06-12T00:10:00.000Z'),
    })).toBeNull()
  })

  test('listens for late wx pre-fetch data and supports unsubscribe', async () => {
    let callback: ((res: any) => void) | null = null
    vi.stubGlobal('wx', {
      onBackgroundFetchData: vi.fn((cb: (res: any) => void) => {
        callback = cb
      }),
    })
    const { subscribeBackgroundFetchSnapshot } = await import('../home-snapshot-cache')
    const onSnapshot = vi.fn()
    const snapshot = {
      schemaVersion: 1,
      generatedAt: '2026-06-12T00:00:00.000Z',
      viewerOpenId: 'user-1',
      currentCommunityId: 'community-1',
      communities: [],
      sections: [],
      postsBySection: {},
    }

    const unsubscribe = subscribeBackgroundFetchSnapshot(
      () => ({
        openId: 'user-1',
        now: Date.parse('2026-06-12T00:10:00.000Z'),
      }),
      onSnapshot,
    )

    expect(callback).toBeTypeOf('function')
    callback?.({ fetchedData: JSON.stringify(snapshot) })
    expect(onSnapshot).toHaveBeenCalledTimes(1)
    expect(onSnapshot.mock.calls[0][0].currentCommunityId).toBe('community-1')

    unsubscribe()
    callback?.({ fetchedData: JSON.stringify(snapshot) })
    expect(onSnapshot).toHaveBeenCalledTimes(1)
  })
})
