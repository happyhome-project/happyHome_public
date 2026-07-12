import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const root = resolve(__dirname, '../..')
const page = readFileSync(resolve(root, 'pages/search/index.vue'), 'utf8')
const api = readFileSync(resolve(root, 'api/cloud.ts'), 'utf8')

describe('public semantic post search page', () => {
  test('renders only truthful post matches without generated answer or fake discovery content', () => {
    expect(page).toContain('语义搜索会按相关度返回社区中的真实帖子')
    expect(page).toContain('{{ item.matchedSnippet }}')
    expect(page).toContain('{{ item.matchedField }}')
    for (const forbidden of ['AI 回答', 'citations', 'citation-card', 'historyTerms', 'guessTerms', '猜你可能在找', '历史搜索', '智能检索暂不可用']) {
      expect(page).not.toContain(forbidden)
    }
  })

  test('keeps bounded input, paging, navigation, and stale-response safety explicit', () => {
    expect(page).toContain('const PAGE_SIZE = 10')
    expect(page).toContain('const MAX_PAGE_SIZE = 20')
    expect(page).toContain('splitUnicodeCharacters(normalizedQuery).length')
    expect(page).toContain('queryLength > 80')
    expect(page).toContain('limit: Math.min(PAGE_SIZE, MAX_PAGE_SIZE)')
    expect(page).toContain('if (!searchSession.isCurrent(request.requestSeq)) return')
    expect(page).toContain('@tap="clearQuery"')
    expect(page).toContain('搜索中...')
    expect(page).toContain('搜索失败')
    expect(page).toContain('暂无相关帖子')
    expect(page).toContain('@tap="loadMore"')
    expect(page).toContain('@tap="openPost(item.postId)"')
    expect(page).toContain('/pages/detail/index?postId=${encodeURIComponent(postId)}')
    expect(page).toContain("from '../../utils/semantic-search-session'")
    expect(page).toContain('const searchSession = createSemanticSearchSession()')
    expect(page).toContain('watch(query, (nextDraft) => {')
    expect(page).toContain('searchSession.editDraft(nextDraft)')
    expect(page).toContain('searchSession.submit(normalizedQuery)')
    expect(page).toContain('searchSession.nextPage(query.value, items.value.length)')
    expect(page).toContain('query: request.query')
    expect(page).toContain('skip: request.skip')
  })

  test('keeps legacy response fields optional while typing semantic result evidence', () => {
    const searchApi = api.slice(api.indexOf('search: (params:'), api.indexOf("get: (postId:", api.indexOf('search: (params:')))
    expect(searchApi).toContain('protocolVersion: 2')
    expect(searchApi).toContain('tookMs: number')
    expect(searchApi).toContain('sectionId?: string')
    expect(searchApi).toContain("mode?: 'rag' | 'no_answer'")
    expect(searchApi).toContain('@deprecated Semantic search never generates an answer; always empty when present.')
    expect(searchApi).toContain("answer?: ''")
    expect(searchApi).toContain('@deprecated Semantic search returns items directly; always empty when present.')
    expect(searchApi).toContain('citations?: []')
    expect(api).toContain('matchedSnippet: string')
    expect(api).toContain('matchedField: string')
    expect(searchApi).not.toContain('fallback')
    expect(searchApi).not.toContain('score: number')
    expect(searchApi).not.toContain('matchedFields')
    expect(page).not.toContain('interface SearchField')
    expect(page).not.toContain('score: number')
    expect(page).not.toContain('matchedFields')
  })
})
