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
    expect(page).toContain('skip = options.reset ? 0 : items.value.length')
    expect(page).toContain('if (requestSeq !== searchRequestSeq) return')
    expect(page).toContain('@tap="clearQuery"')
    expect(page).toContain('搜索中...')
    expect(page).toContain('搜索失败')
    expect(page).toContain('暂无相关帖子')
    expect(page).toContain('@tap="loadMore"')
    expect(page).toContain('@tap="openPost(item.postId)"')
    expect(page).toContain('/pages/detail/index?postId=${encodeURIComponent(postId)}')
  })

  test('keeps legacy response fields optional while typing semantic result evidence', () => {
    expect(api).toContain('answer?: string')
    expect(api).toContain('citations?: Array<')
    expect(api).toContain('matchedSnippet: string')
    expect(api).toContain('matchedField: string')
  })
})
