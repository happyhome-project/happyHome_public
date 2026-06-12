import type { HomeSnapshot } from '../../../cloud/shared/types'

export const HOME_SNAPSHOT_CACHE_TTL_MS = 6 * 60 * 60 * 1000
export const PERIODIC_HOME_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000
const HOME_SNAPSHOT_SCHEMA_VERSION = 1
const HOME_SNAPSHOT_CACHE_PREFIX = 'home_snapshot_cache_v1'
type BackgroundFetchType = 'pre' | 'periodic'

interface SnapshotReadOptions {
  openId: string
  communityId?: string
  now?: number
  maxAgeMs?: number
}

interface BackgroundFetchSubscription {
  getOptions: () => SnapshotReadOptions
  onSnapshot: (snapshot: HomeSnapshot) => void
}

const backgroundFetchSubscriptions = new Set<BackgroundFetchSubscription>()
let backgroundFetchListenerInstalled = false

function storageKey(openId: string, communityId: string) {
  return `${HOME_SNAPSHOT_CACHE_PREFIX}:${openId}:${communityId}`
}

function getUni() {
  return typeof uni !== 'undefined' ? uni : null
}

function getWx() {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore wx is injected by the mini-program runtime.
  return typeof wx !== 'undefined' ? wx : null
}

function isFresh(snapshot: HomeSnapshot, now: number) {
  const generatedAt = Date.parse(String(snapshot.generatedAt || ''))
  return Number.isFinite(generatedAt)
}

function normalizeSnapshot(raw: any, options: SnapshotReadOptions): HomeSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  if (raw.schemaVersion !== HOME_SNAPSHOT_SCHEMA_VERSION) return null
  if (String(raw.viewerOpenId || '') !== String(options.openId || '')) return null
  if (options.communityId && String(raw.currentCommunityId || '') !== String(options.communityId || '')) return null
  const now = options.now || Date.now()
  const maxAgeMs = options.maxAgeMs ?? HOME_SNAPSHOT_CACHE_TTL_MS
  if (!isFresh(raw as HomeSnapshot, now)) return null
  const generatedAt = Date.parse(String(raw.generatedAt || ''))
  if (now - generatedAt > maxAgeMs) return null
  if (!Array.isArray(raw.communities) || !Array.isArray(raw.sections) || typeof raw.postsBySection !== 'object') return null
  return raw as HomeSnapshot
}

function maxAgeForFetchType(fetchType: BackgroundFetchType) {
  return fetchType === 'periodic' ? PERIODIC_HOME_SNAPSHOT_TTL_MS : HOME_SNAPSHOT_CACHE_TTL_MS
}

export function parseBackgroundFetchSnapshot(raw: string, options: SnapshotReadOptions): HomeSnapshot | null {
  try {
    return normalizeSnapshot(JSON.parse(String(raw || '')), options)
  } catch {
    return null
  }
}

export function writeHomeSnapshotCache(snapshot: HomeSnapshot) {
  const api = getUni()
  if (!api || !snapshot?.viewerOpenId || !snapshot?.currentCommunityId) return
  try {
    api.setStorageSync(storageKey(snapshot.viewerOpenId, snapshot.currentCommunityId), {
      schemaVersion: snapshot.schemaVersion,
      generatedAt: snapshot.generatedAt,
      viewerOpenId: snapshot.viewerOpenId,
      currentCommunityId: snapshot.currentCommunityId,
      communities: snapshot.communities || [],
      sections: snapshot.sections || [],
      postsBySection: snapshot.postsBySection || {},
    })
  } catch {
    // Cache must never affect product behavior.
  }
}

export function clearHomeSnapshotCache(openId: string, communityId: string) {
  const api = getUni()
  if (!api || !openId || !communityId) return
  try {
    api.removeStorageSync(storageKey(openId, communityId))
  } catch {
    // ignore
  }
}

export function readHomeSnapshotCache(options: SnapshotReadOptions): HomeSnapshot | null {
  const api = getUni()
  const openId = String(options.openId || '')
  const communityId = String(options.communityId || '')
  if (!api || !openId || !communityId) return null
  try {
    const raw = api.getStorageSync(storageKey(openId, communityId))
    const snapshot = normalizeSnapshot(raw, options)
    if (!snapshot) clearHomeSnapshotCache(openId, communityId)
    return snapshot
  } catch {
    return null
  }
}

export function getBackgroundFetchSnapshot(
  options: SnapshotReadOptions,
  fetchType: BackgroundFetchType = 'pre',
): Promise<HomeSnapshot | null> {
  const wxRef = getWx()
  if (!wxRef?.getBackgroundFetchData) return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      wxRef.getBackgroundFetchData({
        fetchType,
        success: (res: any) => {
          resolve(parseBackgroundFetchSnapshot(String(res?.fetchedData || ''), {
            ...options,
            maxAgeMs: maxAgeForFetchType(fetchType),
          }))
        },
        fail: () => resolve(null),
      })
    } catch {
      resolve(null)
    }
  })
}

function snapshotTime(snapshot: HomeSnapshot | null) {
  if (!snapshot) return 0
  const time = Date.parse(String(snapshot.generatedAt || ''))
  return Number.isFinite(time) ? time : 0
}

export async function getBestBackgroundFetchSnapshot(options: SnapshotReadOptions): Promise<HomeSnapshot | null> {
  const [pre, periodic] = await Promise.all([
    getBackgroundFetchSnapshot(options, 'pre'),
    getBackgroundFetchSnapshot(options, 'periodic'),
  ])
  return snapshotTime(periodic) > snapshotTime(pre) ? periodic : pre
}

function installBackgroundFetchListener(wxRef: any) {
  if (backgroundFetchListenerInstalled || !wxRef?.onBackgroundFetchData) return
  backgroundFetchListenerInstalled = true
  wxRef.onBackgroundFetchData((res: any) => {
    const raw = String(res?.fetchedData || '')
    if (!raw) return
    for (const subscription of Array.from(backgroundFetchSubscriptions)) {
      const fetchType = res?.fetchType === 'periodic' ? 'periodic' : 'pre'
      const snapshot = parseBackgroundFetchSnapshot(raw, {
        ...subscription.getOptions(),
        maxAgeMs: maxAgeForFetchType(fetchType),
      })
      if (snapshot) subscription.onSnapshot(snapshot)
    }
  })
}

export function subscribeBackgroundFetchSnapshot(
  getOptions: () => SnapshotReadOptions,
  onSnapshot: (snapshot: HomeSnapshot) => void,
) {
  const wxRef = getWx()
  if (!wxRef?.onBackgroundFetchData) return () => {}
  const subscription = { getOptions, onSnapshot }
  backgroundFetchSubscriptions.add(subscription)
  installBackgroundFetchListener(wxRef)
  return () => {
    backgroundFetchSubscriptions.delete(subscription)
  }
}
