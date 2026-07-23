import { callCloud } from '../api/cloud'

type TempUrlEntry = {
  fileID: string
  tempFileURL: string
  status?: number
  code?: string | number
  errMsg?: string
  maxAge?: number
}

export interface CloudFileUrlDeps {
  getTempFileURL?: (fileIDs: string[]) => Promise<TempUrlEntry[]>
}

const TEMP_URL_TTL_MS = 50 * 60 * 1000
const TEMP_URL_EXPIRY_SAFETY_MS = 60 * 1000
const MAX_TEMP_URL_BATCH_SIZE = 50
const cache = new Map<string, { url: string; expiresAt: number }>()
const fileIDByTempUrl = new Map<string, string>()

function isCloudFileID(value: string): boolean {
  return value.startsWith('cloud://')
}

async function defaultGetTempFileURL(fileIDs: string[]): Promise<TempUrlEntry[]> {
  const wxRuntime = typeof wx !== 'undefined' ? wx : undefined
  if (wxRuntime?.cloud?.getTempFileURL) {
    const res = await wxRuntime.cloud.getTempFileURL({ fileList: fileIDs })
    return (res.fileList || []).map((item: any) => ({
      fileID: String(item.fileID || ''),
      tempFileURL: String(item.tempFileURL || ''),
      status: item.status,
      code: item.code,
      errMsg: String(item.errMsg || ''),
      maxAge: Number(item.maxAge || 0),
    }))
  }

  return Promise.all(fileIDs.map(async (fileID) => {
    const res = await callCloud<{ url: string }>('post', 'getMediaUrl', { fileID })
    return { fileID, tempFileURL: String(res?.url || '') }
  }))
}

function entrySucceeded(entry: TempUrlEntry | undefined): entry is TempUrlEntry {
  if (!entry) return false
  if (entry.status !== undefined && Number(entry.status) !== 0) return false
  if (
    entry.code !== undefined &&
    entry.code !== 0 &&
    String(entry.code).toUpperCase() !== 'SUCCESS'
  ) return false
  return Boolean(String(entry.fileID || '').trim() && String(entry.tempFileURL || '').trim())
}

function cacheTtl(entry: TempUrlEntry): number {
  const advertisedMaxAge = Number(entry.maxAge || 0)
  if (!Number.isFinite(advertisedMaxAge) || advertisedMaxAge <= 0) return TEMP_URL_TTL_MS
  return Math.max(
    1000,
    Math.min(TEMP_URL_TTL_MS, advertisedMaxAge - TEMP_URL_EXPIRY_SAFETY_MS),
  )
}

function cacheResolvedEntry(entry: TempUrlEntry, result: Record<string, string>): void {
  if (!entrySucceeded(entry)) return
  const fileID = String(entry.fileID).trim()
  const url = String(entry.tempFileURL).trim()
  if (!isCloudFileID(fileID)) return
  const previousUrl = cache.get(fileID)?.url
  if (previousUrl && previousUrl !== url) fileIDByTempUrl.delete(previousUrl)
  cache.set(fileID, { url, expiresAt: Date.now() + cacheTtl(entry) })
  fileIDByTempUrl.set(url, fileID)
  result[fileID] = url
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

async function fetchMissingTempUrls(
  fileIDs: string[],
  fetchTempUrls: NonNullable<CloudFileUrlDeps['getTempFileURL']>,
  result: Record<string, string>,
): Promise<void> {
  for (const batch of chunks(fileIDs, MAX_TEMP_URL_BATCH_SIZE)) {
    let entries: TempUrlEntry[] = []
    try {
      entries = await fetchTempUrls(batch)
    } catch {
      entries = []
    }
    entries.forEach((entry) => cacheResolvedEntry(entry, result))

    const unresolved = batch.filter((fileID) => !result[fileID])
    if (!unresolved.length) continue
    const retries = await Promise.allSettled(
      unresolved.map(async (fileID) => await fetchTempUrls([fileID])),
    )
    retries.forEach((retry) => {
      if (retry.status !== 'fulfilled') return
      retry.value.forEach((entry) => cacheResolvedEntry(entry, result))
    })
  }
}

export async function resolveCloudFileUrl(value: string, deps: CloudFileUrlDeps = {}): Promise<string> {
  const raw = String(value || '').trim()
  if (!raw || !isCloudFileID(raw)) return raw

  const cached = cache.get(raw)
  if (cached && cached.expiresAt > Date.now()) return cached.url

  const fetchTempUrls = deps.getTempFileURL || defaultGetTempFileURL
  const result: Record<string, string> = {}
  await fetchMissingTempUrls([raw], fetchTempUrls, result)
  return result[raw] || raw
}

export async function resolveCloudFileUrls(
  values: string[],
  deps: CloudFileUrlDeps = {},
): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  const now = Date.now()
  const cloudFileIDs: string[] = []
  values.forEach((item) => {
    const fileID = String(item || '').trim()
    if (isCloudFileID(fileID) && !cloudFileIDs.includes(fileID)) {
      cloudFileIDs.push(fileID)
    }
  })
  const missing = cloudFileIDs.filter((fileID) => {
    const cached = cache.get(fileID)
    if (cached && cached.expiresAt > now) {
      result[fileID] = cached.url
      return false
    }
    return true
  })

  for (const value of values) {
    const raw = String(value || '').trim()
    if (!isCloudFileID(raw)) result[raw] = raw
  }

  if (missing.length > 0) {
    const fetchTempUrls = deps.getTempFileURL || defaultGetTempFileURL
    await fetchMissingTempUrls(missing, fetchTempUrls, result)
  }

  for (const fileID of cloudFileIDs) {
    if (result[fileID]) continue
    const cached = cache.get(fileID)
    if (cached && cached.expiresAt > Date.now()) {
      result[fileID] = cached.url
      continue
    }
    if (cached) {
      fileIDByTempUrl.delete(cached.url)
      cache.delete(fileID)
    }
    result[fileID] = fileID
  }

  return result
}

export function invalidateCloudFileUrl(value: string): string {
  const raw = String(value || '').trim()
  const fileID = isCloudFileID(raw) ? raw : fileIDByTempUrl.get(raw) || ''
  if (!fileID) return ''
  const cachedUrl = cache.get(fileID)?.url
  if (cachedUrl) fileIDByTempUrl.delete(cachedUrl)
  cache.delete(fileID)
  return fileID
}

export async function refreshCloudFileUrl(
  value: string,
  deps: CloudFileUrlDeps = {},
): Promise<string> {
  const raw = String(value || '').trim()
  const fileID = invalidateCloudFileUrl(raw)
  if (!fileID) return raw
  return await resolveCloudFileUrl(fileID, deps)
}

export function _clearCloudFileUrlCacheForTesting() {
  cache.clear()
  fileIDByTempUrl.clear()
}
