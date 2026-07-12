#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

function readProjectFile(...parts) {
  return readFileSync(join(ROOT, ...parts), 'utf8')
}

function assertIncludes(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error(`${label} missing: ${needle}`)
  }
}

function assertNotIncludes(source, needle, label) {
  if (source.includes(needle)) {
    throw new Error(`${label} should not include: ${needle}`)
  }
}

const homePage = readProjectFile('miniprogram', 'src', 'pages', 'index', 'index.vue')
const searchPage = readProjectFile('miniprogram', 'src', 'pages', 'search', 'index.vue')
const cloudApi = readProjectFile('miniprogram', 'src', 'api', 'cloud.ts')
const searchApi = cloudApi.slice(cloudApi.indexOf('search: (params:'), cloudApi.indexOf('get: (postId:', cloudApi.indexOf('search: (params:')))

assertIncludes(homePage, 'class="home-search home-search--primary"', 'home primary search entry')
assertIncludes(homePage, 'class="home-search home-search--fixed"', 'home fixed search entry')
assertIncludes(homePage, 'placeholder="试试搜周边亲子游路线"', 'home search placeholder')
assertIncludes(homePage, '@confirm="submitHomeSearch"', 'home search confirm')
assertIncludes(homePage, '/pages/search/index', 'home search navigation')

assertIncludes(searchPage, 'class="search-box"', 'search page box')
assertIncludes(searchPage, 'postApi.search', 'search page cloud API')
assertIncludes(searchPage, 'let searchRequestSeq = 0', 'search page request sequence guard')
assertIncludes(searchPage, 'const requestSeq = ++searchRequestSeq', 'search page request sequence increment')
assertIncludes(searchPage, 'if (requestSeq !== searchRequestSeq) return', 'search page stale response drop')
assertNotIncludes(searchPage, 'usedBootstrapFallback', 'search no-answer must not mix bootstrap fallback results into RAG results')
assertNotIncludes(searchPage, 'searchVisibleBootstrapPosts', 'search no-answer must not run local bootstrap search')
assertNotIncludes(searchPage, 'bootstrap_fallback', 'search results must come from post.search instead of local bootstrap fallback')
assertIncludes(searchPage, '语义搜索会按相关度返回社区中的真实帖子', 'truthful semantic search intro')
assertIncludes(searchPage, '{{ item.matchedSnippet }}', 'semantic matched snippet')
assertIncludes(searchPage, '{{ item.matchedField }}', 'semantic matched field')
assertIncludes(searchPage, 'const PAGE_SIZE = 10', 'search page size')
assertIncludes(searchPage, 'const MAX_PAGE_SIZE = 20', 'search hard page size cap')
assertIncludes(searchPage, 'queryLength > 80', 'search Unicode input max')
assertIncludes(searchPage, 'limit: Math.min(PAGE_SIZE, MAX_PAGE_SIZE)', 'search bounded request limit')
assertIncludes(searchPage, '/pages/detail/index?postId=${encodeURIComponent(postId)}', 'search detail navigation encoding')
assertIncludes(searchPage, '@tap="openPost(item.postId)"', 'search result navigation')
for (const forbidden of ['AI 回答', 'citations', 'citation-card', 'historyTerms', 'guessTerms', '猜你可能在找', '历史搜索', '智能检索暂不可用']) {
  assertNotIncludes(searchPage, forbidden, 'search page generated or fake discovery content')
}

assertIncludes(searchApi, 'protocolVersion: 2', 'post.search v2 protocol type')
assertIncludes(searchApi, 'tookMs: number', 'post.search timing type')
assertIncludes(searchApi, 'sectionId?: string', 'post.search optional section type')
assertIncludes(searchApi, "mode?: 'rag' | 'no_answer'", 'post.search compatibility mode type')
assertIncludes(searchApi, "answer?: ''", 'post.search deprecated empty answer type')
assertIncludes(searchApi, 'citations?: []', 'post.search deprecated empty citations type')
assertIncludes(searchApi, 'matchedSnippet: string', 'post.search matched snippet type')
assertIncludes(searchApi, 'matchedField: string', 'post.search matched field type')
for (const forbidden of ['fallback', 'score: number', 'matchedFields']) {
  assertNotIncludes(searchApi, forbidden, 'post.search legacy result type')
}
for (const forbidden of ['interface SearchField', 'score: number', 'matchedFields']) {
  assertNotIncludes(searchPage, forbidden, 'search page unused legacy item symbols')
}

console.log('[mp-post-rag-search-static] PASS')
