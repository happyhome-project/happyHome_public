import { describe, expect, test } from 'vitest'
import {
  DEFAULT_CAROUSEL_DOT_LIMIT,
  getCarouselPaginationState,
} from '../carousel-pagination'

describe('carousel pagination window', () => {
  test('keeps every dot for ordinary image and short text carousels', () => {
    expect(getCarouselPaginationState(4, 2)).toEqual({
      count: 4,
      currentIndex: 2,
      indexes: [0, 1, 2, 3],
    })
  })

  test('keeps a bounded active window for very long text notes', () => {
    const first = getCarouselPaginationState(30, 0)
    const middle = getCarouselPaginationState(30, 15)
    const last = getCarouselPaginationState(30, 29)

    expect(first.indexes).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(middle.indexes).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19])
    expect(last.indexes).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29])
    expect(first.indexes).toHaveLength(DEFAULT_CAROUSEL_DOT_LIMIT)
    expect(middle.indexes).toContain(middle.currentIndex)
    expect(last.indexes).toContain(last.currentIndex)
  })

  test('normalizes invalid counts and current indexes', () => {
    expect(getCarouselPaginationState(-3, 10)).toEqual({
      count: 0,
      currentIndex: 0,
      indexes: [],
    })
    expect(getCarouselPaginationState(3, 99).currentIndex).toBe(2)
    expect(getCarouselPaginationState(3, -99).currentIndex).toBe(0)
  })
})
