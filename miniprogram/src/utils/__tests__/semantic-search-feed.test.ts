import { describe, expect, test } from 'vitest'
import { appendSemanticSearchPage, emptySemanticSearchFeed } from '../semantic-search-feed'

const item = (postId: string) => ({
  postId,
  format: 'image_text',
  content: {
    title: `标题${postId}`,
    images: [`cloud://env/posts/${postId}.jpg`],
  },
  topics: [],
  authorName: '邻居',
  createdAt: '2026-07-28T00:00:00.000Z',
})

describe('semantic search waterfall paging', () => {
  test('does not advertise another page when a short result page only inflated chunk total', () => {
    const state = appendSemanticSearchPage(emptySemanticSearchFeed(), {
      items: [item('same-post')],
      total: 3,
      skip: 0,
      limit: 10,
    })

    expect(state.columns.flat().map(card => card.postId)).toEqual(['same-post'])
    expect(state.nextSkip).toBe(1)
    expect(state.hasMore).toBe(false)
  })

  test('deduplicates a repeated page and stops pagination', () => {
    const first = appendSemanticSearchPage(emptySemanticSearchFeed(), {
      items: Array.from({ length: 10 }, (_, index) => item(`post-${index}`)),
      total: 20,
      skip: 0,
      limit: 10,
    })
    const repeated = appendSemanticSearchPage(first, {
      items: Array.from({ length: 10 }, (_, index) => item(`post-${index}`)),
      total: 20,
      skip: 10,
      limit: 10,
    })

    expect(first.hasMore).toBe(true)
    expect(repeated.columns.flat()).toHaveLength(10)
    expect(repeated.nextSkip).toBe(20)
    expect(repeated.hasMore).toBe(false)
  })
})
