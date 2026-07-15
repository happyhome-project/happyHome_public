import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  COMMUNITY_DIRECTORY_FRESH_MS,
  COMMUNITY_DIRECTORY_MAX_STALE_MS,
  clearCommunityDirectoryCache,
  loadCommunityDirectory,
  readCommunityDirectoryCache,
} from '../community-directory-cache'

const storage = new Map<string, any>()

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function community(id: string, overrides: Record<string, any> = {}) {
  return {
    _id: id,
    name: `社区 ${id}`,
    status: 'active',
    viewerStatus: null,
    viewerRole: null,
    ...overrides,
  }
}

describe('community directory cache', () => {
  beforeEach(() => {
    storage.clear()
    vi.stubGlobal('uni', {
      getStorageSync: vi.fn((key: string) => storage.get(key)),
      setStorageSync: vi.fn((key: string, value: any) => storage.set(key, value)),
      removeStorageSync: vi.fn((key: string) => storage.delete(key)),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('persists a user directory with fresh, stale, and hard-expired windows', async () => {
    const openId = 'cache-window-user'
    const fetchedAt = 1_000
    const fetcher = vi.fn(async () => ({
      communities: [
        community('c1', { viewerStatus: 'active', viewerRole: 'admin' }),
        community('inactive', { status: 'disabled' }),
      ],
    }))

    const first = await loadCommunityDirectory({ openId, now: () => fetchedAt, fetcher })

    expect(first.communities.map((item) => item._id)).toEqual(['c1'])
    expect(first.communities[0]).toMatchObject({ viewerStatus: 'active', viewerRole: 'admin' })
    expect(readCommunityDirectoryCache(openId, fetchedAt + COMMUNITY_DIRECTORY_FRESH_MS - 1)?.freshness).toBe('fresh')
    expect(readCommunityDirectoryCache(openId, fetchedAt + COMMUNITY_DIRECTORY_FRESH_MS + 1)?.freshness).toBe('stale')
    expect(readCommunityDirectoryCache(openId, fetchedAt + COMMUNITY_DIRECTORY_MAX_STALE_MS + 1)).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)

    clearCommunityDirectoryCache(openId)
  })

  test('never exposes one user directory through another user cache key', async () => {
    const openId = 'identity-user-a'
    await loadCommunityDirectory({
      openId,
      now: () => 2_000,
      fetcher: async () => ({ communities: [community('private-status', { viewerStatus: 'pending' })] }),
    })

    expect(readCommunityDirectoryCache(openId, 2_000)?.communities).toHaveLength(1)
    expect(readCommunityDirectoryCache('identity-user-b', 2_000)).toBeNull()

    clearCommunityDirectoryCache(openId)
  })

  test('deduplicates concurrent loads for the same user', async () => {
    const openId = 'dedupe-user'
    const response = deferred<{ communities: any[] }>()
    const fetcher = vi.fn(() => response.promise)

    const first = loadCommunityDirectory({ openId, now: () => 3_000, fetcher })
    const second = loadCommunityDirectory({ openId, now: () => 3_000, force: true, fetcher })

    expect(fetcher).toHaveBeenCalledTimes(1)
    response.resolve({ communities: [community('deduped')] })

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult.communities.map((item) => item._id)).toEqual(['deduped'])
    expect(secondResult.communities.map((item) => item._id)).toEqual(['deduped'])

    clearCommunityDirectoryCache(openId)
  })

  test('does not persist a response that arrives after the user cache is cleared', async () => {
    const openId = 'cleared-user'
    const response = deferred<{ communities: any[] }>()
    const fetcher = vi.fn(() => response.promise)

    const loading = loadCommunityDirectory({ openId, now: () => 4_000, fetcher })
    expect(fetcher).toHaveBeenCalledTimes(1)

    clearCommunityDirectoryCache(openId)
    response.resolve({ communities: [community('late')] })
    await loading

    expect(readCommunityDirectoryCache(openId, 4_000)).toBeNull()
  })
})
