import type { PublishMediaType } from './video-publish'

export const ARCHIVE_MEDIA_INTENT_VERSION = 1 as const
export const ARCHIVE_MEDIA_INTENT_STORAGE_PREFIX = 'archive_media_intent_v1:'

export type ArchiveMediaIntentFile = {
  source: string | Blob
  name: string
  type: string
  size: number
  duration?: number
  thumbTempFilePath?: string
}

export type ArchiveMediaIntent = {
  version: typeof ARCHIVE_MEDIA_INTENT_VERSION
  token: string
  mediaType: PublishMediaType
  files: ArchiveMediaIntentFile[]
  createdAt: number
}

const volatileIntents = new Map<string, ArchiveMediaIntent>()

function createToken() {
  return `media-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function storageKey(token: string) {
  return `${ARCHIVE_MEDIA_INTENT_STORAGE_PREFIX}${token}`
}

export function storeArchiveMediaIntent(
  mediaType: PublishMediaType,
  files: ArchiveMediaIntentFile[],
): string {
  const token = createToken()
  const intent: ArchiveMediaIntent = {
    version: ARCHIVE_MEDIA_INTENT_VERSION,
    token,
    mediaType,
    files: mediaType === 'video' ? files.slice(0, 1) : files.slice(),
    createdAt: Date.now(),
  }
  volatileIntents.set(token, intent)
  const persistable = intent.files.every((file) => typeof file.source === 'string')
  if (persistable) {
    try { uni.setStorageSync(storageKey(token), intent) } catch {}
  }
  return token
}

export function consumeArchiveMediaIntent(tokenValue: unknown): ArchiveMediaIntent | null {
  const token = String(tokenValue || '').trim()
  if (!token) return null
  const intent = peekArchiveMediaIntent(token)
  volatileIntents.delete(token)
  try { uni.removeStorageSync(storageKey(token)) } catch {}
  return intent
}

export function peekArchiveMediaIntent(tokenValue: unknown): ArchiveMediaIntent | null {
  const token = String(tokenValue || '').trim()
  if (!token) return null
  let intent = volatileIntents.get(token) || null
  if (!intent) {
    try { intent = uni.getStorageSync(storageKey(token)) || null } catch {}
  }
  if (!intent || intent.version !== ARCHIVE_MEDIA_INTENT_VERSION || intent.token !== token) return null
  if (intent.mediaType !== 'image' && intent.mediaType !== 'video') return null
  if (!Array.isArray(intent.files) || intent.files.length === 0) return null
  return intent
}

export function createDraftStorageKey(communityId: unknown, format: unknown): string {
  const community = encodeURIComponent(String(communityId || '').trim() || 'none')
  const scope = encodeURIComponent(String(format || '').trim() || 'section')
  return `create_draft_v2:${community}:${scope}`
}
