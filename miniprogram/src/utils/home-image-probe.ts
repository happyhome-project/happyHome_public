export type HomeImageKind = 'banner' | 'guide'
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
  return {
    ...entries,
    [entry.key]: entry,
  }
}

export function clearFailedHomeImageProbeEntries(
  entries: Record<string, HomeImageProbeEntry>,
  keys: string[],
): Record<string, HomeImageProbeEntry> {
  if (!keys.length) return entries
  let changed = false
  const next: Record<string, HomeImageProbeEntry> = { ...entries }
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
): HomeImageProbeSummary {
  const dedupedKeys = Array.from(new Set(currentKeys.filter(Boolean)))
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
  const loadedCount = loaded.length
  const failedCount = failed.length
  const pendingCount = Math.max(0, currentImageCount - loadedCount - failedCount)
  return {
    currentImageCount,
    loadedCount,
    failedCount,
    pendingCount,
    hasRendered: loadedCount > 0,
    satisfied: currentImageCount === 0 || (pendingCount === 0 && failedCount === 0),
    loaded,
    failed,
  }
}
