import {
  appendArchivePage,
  type ArchiveFeedColumns,
} from './archive-feed'

export type SemanticSearchFeed = {
  columns: ArchiveFeedColumns
  total: number
  nextSkip: number
  hasMore: boolean
}

export type SemanticSearchPage = {
  items?: Record<string, any>[]
  total?: number
  skip?: number
  limit?: number
}

export function emptySemanticSearchFeed(): SemanticSearchFeed {
  return {
    columns: [[], []],
    total: 0,
    nextSkip: 0,
    hasMore: false,
  }
}

export function appendSemanticSearchPage(
  current: SemanticSearchFeed,
  page: SemanticSearchPage,
): SemanticSearchFeed {
  const items = Array.isArray(page.items) ? page.items : []
  const beforeCount = current.columns[0].length + current.columns[1].length
  const columns = appendArchivePage(current.columns, items)
  const displayedCount = columns[0].length + columns[1].length
  const uniqueAdded = displayedCount - beforeCount
  const skip = Math.max(0, Math.floor(Number(page.skip || 0)))
  const limit = Math.max(1, Math.floor(Number(page.limit || items.length || 1)))
  const total = Math.max(displayedCount, Math.floor(Number(page.total || displayedCount)))

  return {
    columns,
    total,
    nextSkip: skip + items.length,
    hasMore: items.length >= limit && uniqueAdded > 0 && displayedCount < total,
  }
}
