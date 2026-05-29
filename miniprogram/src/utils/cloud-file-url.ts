import { callCloud } from '../api/cloud'

type TempUrlEntry = { fileID: string; tempFileURL: string }

export interface CloudFileUrlDeps {
  getTempFileURL?: (fileIDs: string[]) => Promise<TempUrlEntry[]>
}

const TEMP_URL_TTL_MS = 50 * 60 * 1000
const cache = new Map<string, { url: string; expiresAt: number }>()

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
    }))
  }

  return Promise.all(fileIDs.map(async (fileID) => {
    const res = await callCloud<{ url: string }>('post', 'getMediaUrl', { fileID })
    return { fileID, tempFileURL: String(res?.url || '') }
  }))
}

export async function resolveCloudFileUrl(value: string, deps: CloudFileUrlDeps = {}): Promise<string> {
  const raw = String(value || '').trim()
  if (!raw || !isCloudFileID(raw)) return raw

  const cached = cache.get(raw)
  if (cached && cached.expiresAt > Date.now()) return cached.url

  const fetchTempUrls = deps.getTempFileURL || defaultGetTempFileURL
  const [entry] = await fetchTempUrls([raw])
  const url = String(entry?.tempFileURL || '')
  if (!url) return raw

  cache.set(raw, { url, expiresAt: Date.now() + TEMP_URL_TTL_MS })
  return url
}

export async function resolveCloudFileUrls(
  values: string[],
  deps: CloudFileUrlDeps = {},
): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  const now = Date.now()
  const cloudFileIDs = Array.from(new Set(values.map((item) => String(item || '').trim()).filter(isCloudFileID)))
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
    const entries = await fetchTempUrls(missing)
    for (const entry of entries) {
      const fileID = String(entry?.fileID || '').trim()
      const url = String(entry?.tempFileURL || '').trim()
      if (!fileID || !url) continue
      cache.set(fileID, { url, expiresAt: Date.now() + TEMP_URL_TTL_MS })
      result[fileID] = url
    }
  }

  for (const fileID of cloudFileIDs) {
    if (!result[fileID]) result[fileID] = cache.get(fileID)?.url || fileID
  }

  return result
}

export function _clearCloudFileUrlCacheForTesting() {
  cache.clear()
}
