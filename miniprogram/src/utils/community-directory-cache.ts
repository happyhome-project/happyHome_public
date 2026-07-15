import { communityApi } from '../api/cloud'
import type { PerformanceTrace } from './performance-trace'
import { createPerformanceRequestId } from './performance-trace'
import type { DirectoryCommunity } from './community-directory'

export const COMMUNITY_DIRECTORY_FRESH_MS = 5 * 60 * 1000
export const COMMUNITY_DIRECTORY_MAX_STALE_MS = 6 * 60 * 60 * 1000

const CACHE_SCHEMA_VERSION = 1
const CACHE_KEY_PREFIX = 'community_directory_cache_v1'

type PersistedCommunityDirectory = {
  schemaVersion: 1
  viewerOpenId: string
  fetchedAt: number
  communities: DirectoryCommunity[]
}

export type CommunityDirectoryCacheRead = {
  communities: DirectoryCommunity[]
  fetchedAt: number
  freshness: 'fresh' | 'stale'
}

export type CommunityDirectoryFetcher = (
  trace: PerformanceTrace,
) => Promise<{ communities: DirectoryCommunity[] }>

type LoadCommunityDirectoryOptions = {
  openId: string
  force?: boolean
  now?: () => number
  traceStage?: string
  fetcher?: CommunityDirectoryFetcher
}

const memoryCache = new Map<string, PersistedCommunityDirectory>()
const inFlightLoads = new Map<string, Promise<CommunityDirectoryCacheRead>>()
const identityEpochs = new Map<string, number>()

function normalizedOpenId(value: unknown) {
  return String(value || '').trim()
}

function storageKey(openId: string) {
  return `${CACHE_KEY_PREFIX}:${openId}`
}

function storageApi() {
  return typeof uni !== 'undefined' ? uni : null
}

function normalizeCommunities(value: unknown): DirectoryCommunity[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((community) => (
      community &&
      typeof community === 'object' &&
      normalizedOpenId((community as any)._id) &&
      (community as any).status === 'active'
    ))
    .map((community) => Object.assign({}, community)) as DirectoryCommunity[]
}

function normalizeSnapshot(
  raw: unknown,
  openId: string,
): PersistedCommunityDirectory | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, any>
  const fetchedAt = Number(value.fetchedAt)
  if (
    value.schemaVersion !== CACHE_SCHEMA_VERSION ||
    normalizedOpenId(value.viewerOpenId) !== openId ||
    !Number.isFinite(fetchedAt)
  ) return null
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    viewerOpenId: openId,
    fetchedAt,
    communities: normalizeCommunities(value.communities),
  }
}

function removePersisted(openId: string) {
  try {
    storageApi()?.removeStorageSync(storageKey(openId))
  } catch (_error) {}
}

function writeSnapshot(snapshot: PersistedCommunityDirectory) {
  memoryCache.set(snapshot.viewerOpenId, snapshot)
  try {
    storageApi()?.setStorageSync(storageKey(snapshot.viewerOpenId), snapshot)
  } catch (_error) {
    // Directory cache is an optional performance layer.
  }
}

function currentEpoch(openId: string) {
  return identityEpochs.get(openId) || 0
}

export function readCommunityDirectoryCache(
  openIdValue: string,
  now = Date.now(),
): CommunityDirectoryCacheRead | null {
  const openId = normalizedOpenId(openIdValue)
  if (!openId) return null

  let snapshot = normalizeSnapshot(memoryCache.get(openId), openId)
  if (!snapshot) {
    try {
      snapshot = normalizeSnapshot(storageApi()?.getStorageSync(storageKey(openId)), openId)
    } catch (_error) {
      snapshot = null
    }
    if (snapshot) memoryCache.set(openId, snapshot)
  }
  if (!snapshot) return null

  const age = Math.max(0, Number(now) - snapshot.fetchedAt)
  if (age > COMMUNITY_DIRECTORY_MAX_STALE_MS) {
    memoryCache.delete(openId)
    removePersisted(openId)
    return null
  }
  return {
    communities: snapshot.communities.map((community) => Object.assign({}, community)),
    fetchedAt: snapshot.fetchedAt,
    freshness: age <= COMMUNITY_DIRECTORY_FRESH_MS ? 'fresh' : 'stale',
  }
}

export function clearCommunityDirectoryCache(openIdValue: string) {
  const openId = normalizedOpenId(openIdValue)
  if (!openId) return
  identityEpochs.set(openId, currentEpoch(openId) + 1)
  memoryCache.delete(openId)
  inFlightLoads.delete(openId)
  removePersisted(openId)
}

export function loadCommunityDirectory(
  options: LoadCommunityDirectoryOptions,
): Promise<CommunityDirectoryCacheRead> {
  const openId = normalizedOpenId(options.openId)
  if (!openId) return Promise.reject(new Error('openId 不能为空'))

  const existingLoad = inFlightLoads.get(openId)
  if (existingLoad) return existingLoad

  const now = options.now || Date.now
  const cached = readCommunityDirectoryCache(openId, now())
  if (!options.force && cached?.freshness === 'fresh') return Promise.resolve(cached)

  const fetcher: CommunityDirectoryFetcher = options.fetcher || ((trace) => (
    communityApi.listDiscoverable(trace) as Promise<{ communities: DirectoryCommunity[] }>
  ))
  const requestEpoch = currentEpoch(openId)
  const trace: PerformanceTrace = {
    requestId: createPerformanceRequestId('community-directory'),
    stage: options.traceStage || 'community.directory',
    sample: cached ? 'warm' : 'cold',
    counts: { cachedCommunityCount: cached?.communities.length || 0 },
  }

  let pending: Promise<CommunityDirectoryCacheRead>
  pending = (async () => {
    const response = await fetcher(trace)
    const result: CommunityDirectoryCacheRead = {
      communities: normalizeCommunities(response?.communities),
      fetchedAt: now(),
      freshness: 'fresh',
    }
    if (currentEpoch(openId) === requestEpoch) {
      writeSnapshot({
        schemaVersion: CACHE_SCHEMA_VERSION,
        viewerOpenId: openId,
        fetchedAt: result.fetchedAt,
        communities: result.communities,
      })
    }
    return result
  })().finally(() => {
    if (inFlightLoads.get(openId) === pending) inFlightLoads.delete(openId)
  })
  inFlightLoads.set(openId, pending)
  return pending
}

export function primeCommunityDirectory(openId: string, traceStage?: string) {
  return loadCommunityDirectory({ openId, traceStage })
}
