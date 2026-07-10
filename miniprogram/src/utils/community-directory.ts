import type { Community } from '../../../cloud/shared/types'

export type DirectoryCommunity = Community & { viewerStatus?: string | null }

export function singleLineCommunityText(value: unknown, fallback = ''): string {
  return String(value || '').replace(/\s+/g, ' ').trim() || fallback
}

export function resolvedCommunityCoverUrl(
  value: unknown,
  resolvedUrls: Record<string, string>,
  failed = false,
): string {
  if (failed) return ''
  const raw = String(value || '').trim()
  if (!raw) return ''
  const resolved = String(resolvedUrls?.[raw] || '').trim()
  if (raw.startsWith('cloud://')) {
    return resolved && !resolved.startsWith('cloud://') ? resolved : ''
  }
  return resolved || raw
}

export function mergeCommunityDirectory(
  joinedCommunities: Community[],
  directoryCommunities: DirectoryCommunity[],
): DirectoryCommunity[] {
  const result: DirectoryCommunity[] = []
  const joinedIds = new Set<string>()

  for (const community of joinedCommunities || []) {
    if (!community?._id || community.status !== 'active') continue
    joinedIds.add(community._id)
    result.push({ ...community, viewerStatus: 'active' })
  }

  for (const community of directoryCommunities || []) {
    if (!community?._id || community.status !== 'active' || joinedIds.has(community._id)) continue
    result.push({ ...community })
  }

  return result
}
