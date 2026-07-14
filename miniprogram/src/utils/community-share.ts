export const COMMUNITY_SHARE_FROM = 'community'
export const DEFAULT_COMMUNITY_SHARE_IMAGE = '/static/logo.png'
export const PENDING_SHARE_COMMUNITY_KEY = 'pending_share_community_v1'
export const PENDING_SHARE_COMMUNITY_TTL_MS = 30 * 60 * 1000
export const COMMUNITY_SHARE_IMAGE_VERSION = 'v1'

export interface CommunityShareImageIdentity {
  id: unknown
  name: unknown
  coverImage: unknown
}

export interface PreparedCommunityShareImage {
  key: string
  imageUrl: string
}

export function buildCommunityShareImageKey(identity: CommunityShareImageIdentity): string {
  return [
    COMMUNITY_SHARE_IMAGE_VERSION,
    String(identity.id || '').trim(),
    String(identity.name || '').trim(),
    String(identity.coverImage || '').trim(),
  ].join('|')
}

export function selectPreparedCommunityShareImage(
  currentKey: string,
  prepared?: PreparedCommunityShareImage | null,
): string {
  return prepared?.key === currentKey ? String(prepared.imageUrl || '').trim() : ''
}

export interface PendingShareCommunityIntent {
  communityId: string
  createdAt: number
}

export interface CommunityShareStorage {
  getStorageSync: (key: string) => unknown
  setStorageSync: (key: string, value: unknown) => unknown
  removeStorageSync: (key: string) => unknown
}

function getRuntimeStorage(): CommunityShareStorage | null {
  const runtime = (globalThis as any).uni || (globalThis as any).wx
  if (!runtime?.getStorageSync || !runtime?.setStorageSync || !runtime?.removeStorageSync) {
    return null
  }
  return runtime
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function normalizeCommunityShareId(value: unknown): string {
  if (Array.isArray(value)) return normalizeCommunityShareId(value[0])
  return safeDecode(String(value || '')).trim()
}

export function isCommunityShareQuery(query?: Record<string, any> | null): boolean {
  return String(query?.fromShare || '') === COMMUNITY_SHARE_FROM &&
    normalizeCommunityShareId(query?.communityId).length > 0
}

export function buildCommunitySharePath(communityId: string): string {
  const id = normalizeCommunityShareId(communityId)
  return `/pages/index/index?communityId=${encodeURIComponent(id)}&fromShare=${COMMUNITY_SHARE_FROM}`
}

export function buildCommunityOnboardingPath(communityId: string): string {
  const id = normalizeCommunityShareId(communityId)
  return `/pages/onboarding/index?mode=discover&communityId=${encodeURIComponent(id)}&fromShare=${COMMUNITY_SHARE_FROM}`
}

export function buildCommunityShareTitle(communityName: string): string {
  const name = String(communityName || '').trim() || '社群助手'
  return `邀请你加入「${name}」`
}

export function savePendingShareCommunity(
  communityId: string,
  now = Date.now(),
  storage: CommunityShareStorage | null = getRuntimeStorage(),
) {
  const id = normalizeCommunityShareId(communityId)
  if (!id || !storage) return
  try {
    storage.setStorageSync(PENDING_SHARE_COMMUNITY_KEY, { communityId: id, createdAt: now })
  } catch {}
}

export function readPendingShareCommunity(
  now = Date.now(),
  storage: CommunityShareStorage | null = getRuntimeStorage(),
): PendingShareCommunityIntent | null {
  if (!storage) return null
  try {
    const raw = storage.getStorageSync(PENDING_SHARE_COMMUNITY_KEY) as Partial<PendingShareCommunityIntent> | null
    const communityId = normalizeCommunityShareId(raw?.communityId)
    const createdAt = Number(raw?.createdAt || 0)
    if (!communityId || !createdAt || now - createdAt > PENDING_SHARE_COMMUNITY_TTL_MS) {
      storage.removeStorageSync(PENDING_SHARE_COMMUNITY_KEY)
      return null
    }
    return { communityId, createdAt }
  } catch {
    return null
  }
}

export function consumePendingShareCommunity(
  now = Date.now(),
  storage: CommunityShareStorage | null = getRuntimeStorage(),
): string {
  const intent = readPendingShareCommunity(now, storage)
  if (!intent || !storage) return ''
  try {
    storage.removeStorageSync(PENDING_SHARE_COMMUNITY_KEY)
  } catch {}
  return intent.communityId
}

export function prioritizeShareTargetCommunities<T extends { _id?: string }>(
  communities: T[],
  targetCommunityId: string,
): T[] {
  const targetId = normalizeCommunityShareId(targetCommunityId)
  if (!targetId) return communities.slice()
  const target = communities.find((item) => String(item?._id || '') === targetId)
  if (!target) return communities.slice()
  return [target].concat(communities.filter((item) => String(item?._id || '') !== targetId))
}
