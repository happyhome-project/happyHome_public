export type FeedCover =
  | { kind: 'image'; src: string }
  | { kind: 'video'; src: string }
  | { kind: 'text'; theme: string }

export type FeedCoverCard = { cover: FeedCover }

export type FeedCoverResolver = (sources: string[]) => Promise<Record<string, string>>

export function collectFeedCoverSources(columns: ReadonlyArray<ReadonlyArray<FeedCoverCard>>): string[] {
  const sources: string[] = []
  columns.flat().forEach((card) => {
    if (card.cover.kind === 'text') return
    const source = String(card.cover.src || '').trim()
    if (source && !sources.includes(source)) sources.push(source)
  })
  return sources
}

function resolvedVideoCover(source: string, resolved: Record<string, string>): string {
  const candidate = String(resolved[source] || '').trim()
  if (!source.startsWith('cloud://')) return candidate || source
  return candidate && !candidate.startsWith('cloud://') ? candidate : ''
}

export function applyResolvedFeedCovers(
  columns: ReadonlyArray<ReadonlyArray<FeedCoverCard>>,
  resolved: Record<string, string>,
): void {
  columns.flat().forEach((card) => {
    if (card.cover.kind === 'text') return
    const source = String(card.cover.src || '').trim()
    if (!source) return
    if (card.cover.kind === 'video') {
      card.cover.src = resolvedVideoCover(source, resolved)
      return
    }
    card.cover.src = String(resolved[source] || source).trim()
  })
}

export async function resolveFeedCovers<T extends ReadonlyArray<ReadonlyArray<FeedCoverCard>>>(
  columns: T,
  resolver: FeedCoverResolver,
): Promise<T> {
  const sources = collectFeedCoverSources(columns)
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
