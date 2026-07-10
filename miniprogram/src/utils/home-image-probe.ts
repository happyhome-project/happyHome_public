export type HomeImageKind = 'hero' | 'banner' | 'guide'
export type HomeImageStatus = 'loaded' | 'failed'

export interface HomeImageProbeEntry {
  key: string
  kind: HomeImageKind
  src: string
  label: string
  status: HomeImageStatus
  updatedAt: string
}

export interface HomeImageProbeItem {
  kind: HomeImageKind
  key: string
  src: string
  label: string
  updatedAt: string
}

export interface HomeImageProbeSummary {
  currentImageCount: number
  expectedImageCount: number
  loadedCount: number
  failedCount: number
  pendingCount: number
  hasRendered: boolean
  satisfied: boolean
  loaded: HomeImageProbeItem[]
  failed: HomeImageProbeItem[]
}

export function buildHomeImageKey(kind: HomeImageKind, raw: string): string {
  return `${kind}:${String(raw || '').trim()}`
}

export function upsertHomeImageProbeEntry(
  entries: Record<string, HomeImageProbeEntry>,
  entry: HomeImageProbeEntry,
): Record<string, HomeImageProbeEntry> {
  const next = Object.assign({}, entries)
  next[entry.key] = entry
  return next
}

export function clearFailedHomeImageProbeEntries(
  entries: Record<string, HomeImageProbeEntry>,
  keys: string[],
): Record<string, HomeImageProbeEntry> {
  if (!keys.length) return entries
  let changed = false
  const next: Record<string, HomeImageProbeEntry> = Object.assign({}, entries)
  for (const key of keys) {
    if (next[key]?.status !== 'failed') continue
    delete next[key]
    changed = true
  }
  return changed ? next : entries
}

export function summarizeHomeImageProbe(
  currentKeys: string[],
  entries: Record<string, HomeImageProbeEntry>,
  expectedImageCount?: number,
): HomeImageProbeSummary {
  const dedupedKeys: string[] = []
  const seen: Record<string, true> = {}
  for (const key of currentKeys) {
    if (!key || seen[key]) continue
    seen[key] = true
    dedupedKeys.push(key)
  }
  const currentEntries = dedupedKeys
    .map((key) => entries[key])
    .filter((entry): entry is HomeImageProbeEntry => Boolean(entry))
  const loaded = currentEntries
    .filter((entry) => entry.status === 'loaded')
    .map(({ kind, key, src, label, updatedAt }) => ({ kind, key, src, label, updatedAt }))
  const failed = currentEntries
    .filter((entry) => entry.status === 'failed')
    .map(({ kind, key, src, label, updatedAt }) => ({ kind, key, src, label, updatedAt }))
  const currentImageCount = dedupedKeys.length
  const normalizedExpectedImageCount = expectedImageCount === undefined
    ? currentImageCount
    : Math.max(currentImageCount, Math.floor(Number(expectedImageCount) || 0))
  const loadedCount = loaded.length
  const failedCount = failed.length
  const pendingCount = Math.max(0, normalizedExpectedImageCount - loadedCount - failedCount)
  return {
    currentImageCount,
    expectedImageCount: normalizedExpectedImageCount,
    loadedCount,
    failedCount,
    pendingCount,
    hasRendered: loadedCount > 0,
    satisfied: normalizedExpectedImageCount > 0 && loadedCount === normalizedExpectedImageCount && pendingCount === 0 && failedCount === 0,
    loaded,
    failed,
  }
}
