export const DEFAULT_CAROUSEL_DOT_LIMIT = 9

export interface CarouselPaginationState {
  count: number
  currentIndex: number
  indexes: number[]
}

export function getCarouselPaginationState(
  count: unknown,
  currentIndex: unknown,
  maxVisible = DEFAULT_CAROUSEL_DOT_LIMIT,
): CarouselPaginationState {
  const safeCount = Math.max(0, Math.floor(Number(count) || 0))
  if (safeCount === 0) {
    return { count: 0, currentIndex: 0, indexes: [] }
  }

  const safeCurrentIndex = Math.min(
    safeCount - 1,
    Math.max(0, Math.floor(Number(currentIndex) || 0)),
  )
  const visibleCount = Math.min(
    safeCount,
    Math.max(1, Math.floor(Number(maxVisible) || DEFAULT_CAROUSEL_DOT_LIMIT)),
  )
  const halfWindow = Math.floor(visibleCount / 2)
  const startIndex = Math.min(
    safeCount - visibleCount,
    Math.max(0, safeCurrentIndex - halfWindow),
  )
  const indexes: number[] = []
  for (let offset = 0; offset < visibleCount; offset += 1) {
    indexes.push(startIndex + offset)
  }

  return {
    count: safeCount,
    currentIndex: safeCurrentIndex,
    indexes,
  }
}
