import * as db from './db'
import type { Community } from '../shared/types'

const DEFAULT_PUBLIC_COMMUNITY_ID = '56ba808e69df985c046e3d4407e8c672'

function parseIdList(raw: string): string[] {
  return String(raw || '')
    .split(/[,\s;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function getDefaultPublicCommunityId(): string {
  return String(process.env.DEFAULT_PUBLIC_COMMUNITY_ID || DEFAULT_PUBLIC_COMMUNITY_ID).trim()
}

export function getPublicReadCommunityIds(): string[] {
  const ids = new Set(parseIdList(process.env.PUBLIC_READ_COMMUNITY_IDS || ''))
  const defaultId = getDefaultPublicCommunityId()
  if (defaultId) ids.add(defaultId)
  return Array.from(ids)
}

export async function getActivePublicCommunity(communityId: string): Promise<Community | null> {
  const normalized = String(communityId || '').trim()
  if (!normalized || !getPublicReadCommunityIds().includes(normalized)) return null
  const community = await db.getById('communities', normalized).catch(() => null) as Community | null
  return community && community.status === 'active' ? community : null
}

export async function isPublicReadableCommunity(communityId: string): Promise<boolean> {
  return !!(await getActivePublicCommunity(communityId))
}

export async function ensureCommunityReadable(
  communityId: string,
  userId: string,
  readErrorMessage: string,
) {
  const normalized = String(communityId || '').trim()
  const community = await Promise.resolve()
    .then(() => db.getById('communities', normalized))
    .catch(() => null) as Community | null
  if (!community || community.status !== 'active') throw new Error(readErrorMessage)
  if (getPublicReadCommunityIds().includes(normalized)) return
  if (!userId) throw new Error(readErrorMessage)
  const members = await db.query('community_members', {
    communityId: normalized,
    userId,
    status: 'active',
  }, { limit: 1 })
  if (!members || members.length === 0) throw new Error(readErrorMessage)
}
