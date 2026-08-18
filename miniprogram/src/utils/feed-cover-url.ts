export type FeedCover =
  | { kind: 'image'; src: string; source?: string }
  | { kind: 'video'; src: string; source?: string }
  | { kind: 'audio'; src: string; source?: string; fallback: string }
  | { kind: 'text'; theme: string }

export type FeedCoverCard = { cover: FeedCover }

export type FeedCoverResolver = (sources: string[]) => Promise<Record<string, string>>

function canonicalFeedCoverSource(cover: FeedCover): string {
  if (cover.kind === 'text') return ''
  const source = String(cover.source || '').trim()
  if (source) return source
  const src = String(cover.src || '').trim()
  if (cover.kind === 'audio' && src === cover.fallback) return ''
  return src
}

export function collectFeedCoverSources(columns: ReadonlyArray<ReadonlyArray<FeedCoverCard>>): string[] {
  const sources: string[] = []
  columns.flat().forEach((card) => {
    if (card.cover.kind === 'text') return
    const source = canonicalFeedCoverSource(card.cover)
    if (source && !sources.includes(source)) sources.push(source)
  })
  return sources
}

function resolvedVideoCover(source: string, resolved: Record<string, string>): string {
  const candidate = String(resolved[source] || '').trim()
  if (!source.startsWith('cloud://')) return candidate || source
  return candidate && !candidate.startsWith('cloud://') ? candidate : ''
}

function resolvedImageCover(source: string, resolved: Record<string, string>): string {
  const candidate = String(resolved[source] || '').trim()
  if (!source.startsWith('cloud://')) return candidate || source
  return candidate && !candidate.startsWith('cloud://') ? candidate : ''
}

function resolvedAudioCover(source: string, resolved: Record<string, string>, fallback: string): string {
  return resolvedImageCover(source, resolved) || fallback
}

export function applyResolvedFeedCovers(
  columns: ReadonlyArray<ReadonlyArray<FeedCoverCard>>,
  resolved: Record<string, string>,
): void {
  columns.flat().forEach((card) => {
    if (card.cover.kind === 'text') return
    const source = canonicalFeedCoverSource(card.cover)
    if (!source) return
    card.cover.source = source
    if (card.cover.kind === 'audio') {
      card.cover.src = resolvedAudioCover(source, resolved, card.cover.fallback)
      return
    }
    if (card.cover.kind === 'video') {
      card.cover.src = resolvedVideoCover(source, resolved)
      return
    }
    card.cover.src = resolvedImageCover(source, resolved)
  })
}

export async function resolveFeedCovers<T extends ReadonlyArray<ReadonlyArray<FeedCoverCard>>>(
  columns: T,
  resolver: FeedCoverResolver,
): Promise<T> {
  const sources = collectFeedCoverSources(columns)
  // Keep the canonical source on the card, but never expose an unresolved
  // cloud:// identifier to an image element while the signed URL is pending.
  applyResolvedFeedCovers(columns, {})
  let resolved: Record<string, string> = {}
  if (sources.length) {
    try {
      resolved = await resolver(sources)
    } catch {
      resolved = {}
    }
  }
  applyResolvedFeedCovers(columns, resolved)
  return columns
}

export function fallbackFeedCoverAfterError(cover: FeedCover): void {
  if (cover.kind === 'text') return
  cover.src = cover.kind === 'audio' ? cover.fallback : ''
}

export function claimFeedCoverRetry(
  attempts: Map<string, number>,
  key: string,
  maxAttempts = 2,
): number | null {
  const current = attempts.get(key) || 0
  if (current >= maxAttempts) return null
  const next = current + 1
  attempts.set(key, next)
  return next
}

export function recordFeedCoverLoad(
  attempts: Map<string, number>,
  key: string,
  cover: FeedCover,
): void {
  if (cover.kind === 'text') return
  const loadedSource = String(cover.src || '').trim()
  if (!loadedSource) return
  if (cover.kind === 'audio' && loadedSource === cover.fallback) return
  attempts.delete(key)
}
