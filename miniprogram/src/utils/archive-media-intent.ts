import type { PublishMediaType } from './video-publish'

export const ARCHIVE_MEDIA_INTENT_VERSION = 1 as const
export const ARCHIVE_MEDIA_INTENT_STORAGE_PREFIX = 'archive_media_intent_v1:'
export const ARCHIVE_MEDIA_INTENT_INDEX_KEY = 'archive_media_intent_v1:index'
export const ARCHIVE_MEDIA_INTENT_TTL_MS = 10 * 60 * 1000

export type ArchiveMediaIntentFile = {
  source: string | Blob
  name: string
  type: string
  size: number
  duration?: number
  thumbTempFilePath?: string
  objectUrl?: string
}

export type ArchiveMediaIntent = {
  version: typeof ARCHIVE_MEDIA_INTENT_VERSION
  token: string
  mediaType: PublishMediaType
  files: ArchiveMediaIntentFile[]
  createdAt: number
}

const volatileIntents = new Map<string, ArchiveMediaIntent>()
type StoredIntentIndexEntry = { token: string; expiresAt: number }

function readIntentIndex(): StoredIntentIndexEntry[] {
  try {
    const value = uni.getStorageSync(ARCHIVE_MEDIA_INTENT_INDEX_KEY)
    if (!Array.isArray(value)) return []
    return value.filter((entry): entry is StoredIntentIndexEntry => (
      Boolean(entry) && typeof entry.token === 'string' && Number.isFinite(Number(entry.expiresAt))
    )).map((entry) => ({ token: entry.token, expiresAt: Number(entry.expiresAt) }))
  } catch {
    return []
  }
}

function writeIntentIndex(entries: StoredIntentIndexEntry[]) {
  try { uni.setStorageSync(ARCHIVE_MEDIA_INTENT_INDEX_KEY, entries) } catch {}
}

function upsertIntentIndex(token: string, expiresAt: number) {
  const entries = readIntentIndex().filter((entry) => entry.token !== token)
  entries.push({ token, expiresAt })
  writeIntentIndex(entries)
}

function removeIntentIndexToken(token: string) {
  writeIntentIndex(readIntentIndex().filter((entry) => entry.token !== token))
}

function revokeIntentUrls(intent: ArchiveMediaIntent | null) {
  for (const file of intent?.files || []) {
    if (!file.objectUrl) continue
    try { URL.revokeObjectURL(file.objectUrl) } catch {}
    file.objectUrl = undefined
  }
}

function createToken() {
  return `media-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function storageKey(token: string) {
  return `${ARCHIVE_MEDIA_INTENT_STORAGE_PREFIX}${token}`
}

export function storeArchiveMediaIntent(
  mediaType: PublishMediaType,
  files: ArchiveMediaIntentFile[],
  now = Date.now(),
): string {
  sweepArchiveMediaIntents(now)
  const token = createToken()
  const intent: ArchiveMediaIntent = {
    version: ARCHIVE_MEDIA_INTENT_VERSION,
    token,
    mediaType,
    files: mediaType === 'video' ? files.slice(0, 1) : files.slice(),
    createdAt: now,
  }
  volatileIntents.set(token, intent)
  const persistable = intent.files.every((file) => (
    typeof file.source === 'string' && !file.source.startsWith('blob:') && !file.objectUrl
  ))
  if (persistable) {
    try { uni.setStorageSync(storageKey(token), intent) } catch {}
  }
  upsertIntentIndex(token, now + ARCHIVE_MEDIA_INTENT_TTL_MS)
  return token
}

export function consumeArchiveMediaIntent(tokenValue: unknown): ArchiveMediaIntent | null {
  const token = String(tokenValue || '').trim()
  if (!token) return null
  const intent = peekArchiveMediaIntent(token)
  volatileIntents.delete(token)
  try { uni.removeStorageSync(storageKey(token)) } catch {}
  removeIntentIndexToken(token)
  revokeIntentUrls(intent)
  return intent
}

export function discardArchiveMediaIntent(tokenValue: unknown): boolean {
  const token = String(tokenValue || '').trim()
  if (!token) return false
  const intent = volatileIntents.get(token) || null
  volatileIntents.delete(token)
  try { uni.removeStorageSync(storageKey(token)) } catch {}
  const indexed = readIntentIndex().some((entry) => entry.token === token)
  removeIntentIndexToken(token)
  revokeIntentUrls(intent)
  return Boolean(intent) || indexed
}

export function sweepArchiveMediaIntents(now = Date.now()): number {
  const removedTokens = new Set<string>()
  const retainedVolatile: StoredIntentIndexEntry[] = []
  for (const [token, intent] of volatileIntents) {
    if (now - intent.createdAt <= ARCHIVE_MEDIA_INTENT_TTL_MS) {
      retainedVolatile.push({ token, expiresAt: intent.createdAt + ARCHIVE_MEDIA_INTENT_TTL_MS })
      continue
    }
    volatileIntents.delete(token)
    try { uni.removeStorageSync(storageKey(token)) } catch {}
    revokeIntentUrls(intent)
    removedTokens.add(token)
  }
  const retainedIndex: StoredIntentIndexEntry[] = []
  for (const entry of readIntentIndex()) {
    if (entry.expiresAt >= now) {
      retainedIndex.push(entry)
      continue
    }
    const intent = volatileIntents.get(entry.token) || null
    volatileIntents.delete(entry.token)
    try { uni.removeStorageSync(storageKey(entry.token)) } catch {}
    revokeIntentUrls(intent)
    removedTokens.add(entry.token)
  }
  for (const entry of retainedVolatile) {
    if (!retainedIndex.some((indexed) => indexed.token === entry.token)) retainedIndex.push(entry)
  }
  writeIntentIndex(retainedIndex)
  return removedTokens.size
}

export function peekArchiveMediaIntent(tokenValue: unknown, now = Date.now()): ArchiveMediaIntent | null {
  const token = String(tokenValue || '').trim()
  if (!token) return null
  let intent = volatileIntents.get(token) || null
  if (!intent) {
    try { intent = uni.getStorageSync(storageKey(token)) || null } catch {}
  }
  if (!intent || intent.version !== ARCHIVE_MEDIA_INTENT_VERSION || intent.token !== token) return null
  if (now - Number(intent.createdAt || 0) > ARCHIVE_MEDIA_INTENT_TTL_MS) {
    volatileIntents.delete(token)
    try { uni.removeStorageSync(storageKey(token)) } catch {}
    removeIntentIndexToken(token)
    revokeIntentUrls(intent)
    return null
  }
  if (intent.mediaType !== 'image' && intent.mediaType !== 'video') return null
  if (!Array.isArray(intent.files) || intent.files.length === 0) return null
  return intent
}

export function createDraftStorageKey(communityId: unknown, format: unknown): string {
  const community = encodeURIComponent(String(communityId || '').trim() || 'none')
  const scope = encodeURIComponent(String(format || '').trim() || 'section')
  return `create_draft_v2:${community}:${scope}`
}
