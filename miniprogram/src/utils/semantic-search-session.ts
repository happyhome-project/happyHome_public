export type SemanticSearchRequest = {
  kind: 'request'
  query: string
  skip: number
  requestSeq: number
}

export function normalizeSemanticQuery(value: unknown): string {
  return String(value || '').normalize('NFKC').trim()
}

export function createSemanticSearchSession() {
  let requestSeq = 0
  let submittedQuery = ''

  return {
    editDraft(value: unknown) {
      const normalized = normalizeSemanticQuery(value)
      if (normalized === submittedQuery) return { invalidated: false, requestSeq }
      requestSeq += 1
      return { invalidated: true, requestSeq }
    },
    submit(value: unknown): SemanticSearchRequest {
      submittedQuery = normalizeSemanticQuery(value)
      requestSeq += 1
      return { kind: 'request', query: submittedQuery, skip: 0, requestSeq }
    },
    nextPage(value: unknown, skip: number): SemanticSearchRequest | { kind: 'restart' } {
      const normalized = normalizeSemanticQuery(value)
      if (!submittedQuery || normalized !== submittedQuery) return { kind: 'restart' }
      requestSeq += 1
      return { kind: 'request', query: submittedQuery, skip, requestSeq }
    },
    clear() {
      submittedQuery = ''
      requestSeq += 1
      return { requestSeq }
    },
    isCurrent(candidate: number) {
      return candidate === requestSeq
    },
  }
}
