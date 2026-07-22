import { normalizeTopics } from './topics'

export type ArchiveTopicOrigin = 'legacy' | 'admin' | 'organic'

export type ArchiveTopicRecord = {
  communityId: string
  topicKey: string
  displayName: string
  origins: ArchiveTopicOrigin[]
  enabled: boolean
  status?: 'active' | 'deleted'
  deletedAt?: string
  deletedByAccountId?: string
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

export function resolveArchiveTopicReferences(
  values: unknown[],
  records: ArchiveTopicRecord[],
  explicitOrder: string[] = [],
): Array<{ topicKey: string; displayName: string }> {
  const orderIndex = new Map(explicitOrder.map((key, index) => [key, index]))
  const active = records.filter((record) => record.status !== 'deleted')
  const rank = (record: ArchiveTopicRecord) => [
    record.origins.includes('admin') ? 0 : record.origins.includes('legacy') ? 1 : 2,
    record.createdAt || '',
    orderIndex.get(record.topicKey) ?? Number.MAX_SAFE_INTEGER,
    record.topicKey,
  ] as const
  const compare = (left: ArchiveTopicRecord, right: ArchiveTopicRecord) => {
    const a = rank(left)
    const b = rank(right)
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] < b[index]) return -1
      if (a[index] > b[index]) return 1
    }
    return 0
  }
  const byDisplayKey = new Map<string, ArchiveTopicRecord[]>()
  for (const record of active) {
    const displayKey = normalizeArchiveTopic(record.displayName || record.topicKey).topicKey
    const candidates = byDisplayKey.get(displayKey) || []
    candidates.push(record)
    byDisplayKey.set(displayKey, candidates)
  }

  const selected: Array<{ topicKey: string; displayName: string }> = []
  const seen = new Set<string>()
  for (const value of values || []) {
    const normalized = normalizeArchiveTopic(value)
    const existing = (byDisplayKey.get(normalized.topicKey) || []).slice().sort(compare)[0]
    const reference = existing
      ? { topicKey: existing.topicKey, displayName: existing.displayName }
      : normalized
    if (seen.has(reference.topicKey)) continue
    seen.add(reference.topicKey)
    selected.push(reference)
  }
  return selected
}

function finiteOrder(value: unknown): number {
  return Number.isFinite(Number(value)) ? Number(value) : Number.MAX_SAFE_INTEGER
}

export function selectArchiveTabs(records: ArchiveTopicRecord[], limit = 7, explicitOrder?: string[]): ArchiveTopicRecord[] {
  const enabled = records.filter((record) => record.enabled && record.status !== 'deleted')
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

  if (explicitOrder) {
    const byKey = new Map(enabled.map((record) => [record.topicKey, record]))
    append(explicitOrder.map((key) => byKey.get(key)).filter((record): record is ArchiveTopicRecord => Boolean(record)))
    append(enabled.filter((record) => !seen.has(record.topicKey)))
    return selected
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
