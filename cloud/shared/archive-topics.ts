import { normalizeTopics } from './topics'

export type ArchiveTopicOrigin = 'legacy' | 'admin' | 'organic'

export type ArchiveTopicRecord = {
  communityId: string
  topicKey: string
  displayName: string
  origins: ArchiveTopicOrigin[]
  enabled: boolean
  legacyOrder?: number
  adminOrder?: number
  recentScore: number
  recentPostCount: number
  legacySectionId?: string
  createdAt: string
  updatedAt: string
}

export function normalizeArchiveTopic(value: unknown): { topicKey: string; displayName: string } {
  const displayName = normalizeTopics([value])[0] || ''
  if (!displayName) throw new Error('话题不能为空')
  return { topicKey: displayName.toLowerCase(), displayName }
}

function finiteOrder(value: unknown): number {
  return Number.isFinite(Number(value)) ? Number(value) : Number.MAX_SAFE_INTEGER
}

export function selectArchiveTabs(records: ArchiveTopicRecord[], limit = 7): ArchiveTopicRecord[] {
  const enabled = records.filter((record) => record.enabled)
  const selected: ArchiveTopicRecord[] = []
  const seen = new Set<string>()
  const append = (items: ArchiveTopicRecord[]) => {
    for (const item of items) {
      const key = normalizeArchiveTopic(item.displayName || item.topicKey).topicKey
      if (seen.has(key) || selected.length >= limit) continue
      seen.add(key)
      selected.push(item)
    }
  }

  append(enabled
    .filter((record) => record.origins.includes('legacy'))
    .sort((left, right) => finiteOrder(left.legacyOrder) - finiteOrder(right.legacyOrder) || left.topicKey.localeCompare(right.topicKey)))
  append(enabled
    .filter((record) => record.origins.includes('admin'))
    .sort((left, right) => finiteOrder(left.adminOrder) - finiteOrder(right.adminOrder) || left.topicKey.localeCompare(right.topicKey)))
  append(enabled.slice().sort((left, right) => (
    Number(right.recentScore || 0) - Number(left.recentScore || 0)
      || Number(right.recentPostCount || 0) - Number(left.recentPostCount || 0)
      || left.topicKey.localeCompare(right.topicKey)
  )))
  return selected
}

export function encodeArchiveCursor(value: { sortKey: string; postId: string }): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

export function decodeArchiveCursor(value?: string): { sortKey: string; postId: string } | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!parsed || typeof parsed.sortKey !== 'string' || !parsed.sortKey || typeof parsed.postId !== 'string' || !parsed.postId) return null
    return { sortKey: parsed.sortKey, postId: parsed.postId }
  } catch {
    return null
  }
}
