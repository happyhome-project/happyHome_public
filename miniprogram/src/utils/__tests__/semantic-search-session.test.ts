import { describe, expect, test } from 'vitest'
import { createSemanticSearchSession } from '../semantic-search-session'

describe('semantic search submitted-query session', () => {
  test('editing B invalidates an inflight A response', () => {
    const session = createSemanticSearchSession()
    const requestA = session.submit('A')

    expect(session.editDraft('B')).toMatchObject({ invalidated: true })
    expect(session.isCurrent(requestA.requestSeq)).toBe(false)
  })

  test('editing B after A results prevents B with A pagination and submits B from zero', () => {
    const session = createSemanticSearchSession()
    session.submit('A')
    session.editDraft('B')

    expect(session.nextPage('B', 10)).toEqual({ kind: 'restart' })
    expect(session.submit('B')).toMatchObject({ kind: 'request', query: 'B', skip: 0 })
  })

  test('pagination always uses the normalized submitted query', () => {
    const session = createSemanticSearchSession()
    session.submit('  A  ')

    expect(session.nextPage('A', 10)).toMatchObject({ kind: 'request', query: 'A', skip: 10 })
  })
})
