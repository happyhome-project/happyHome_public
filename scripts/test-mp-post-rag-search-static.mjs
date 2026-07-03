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

const homePage = readProjectFile('miniprogram', 'src', 'pages', 'index', 'index.vue')
const searchPage = readProjectFile('miniprogram', 'src', 'pages', 'search', 'index.vue')
const cloudApi = readProjectFile('miniprogram', 'src', 'api', 'cloud.ts')

assertIncludes(homePage, 'class="home-search"', 'home search entry')
assertIncludes(homePage, 'placeholder="搜索帖子、正文、视频"', 'home search placeholder')
assertIncludes(homePage, '@confirm="submitHomeSearch"', 'home search confirm')
assertIncludes(homePage, '/pages/search/index', 'home search navigation')

assertIncludes(searchPage, 'class="search-box"', 'search page box')
assertIncludes(searchPage, 'postApi.search', 'search page cloud API')
assertIncludes(searchPage, "mode.value = usedBootstrapFallback ? '' : (result.mode || '')", 'search RAG mode assignment')
assertIncludes(searchPage, "answer.value = usedBootstrapFallback ? '' : String(result.answer || '')", 'search AI answer assignment')
assertIncludes(searchPage, 'citations.value = usedBootstrapFallback ? [] : (result.citations || [])', 'search citation assignment')
assertIncludes(searchPage, "mode === 'no_answer' ? '没有找到足够相关的帖子'", 'search no-answer copy')
assertIncludes(searchPage, 'class="citation-card"', 'search citation cards')
assertIncludes(searchPage, '@tap="openPost(citation.postId)"', 'search citation navigation')
assertIncludes(searchPage, '@tap="openPost(item.postId)"', 'search result navigation')

assertIncludes(cloudApi, 'answer: string', 'post.search answer type')
assertIncludes(cloudApi, "mode: 'rag' | 'fallback' | 'no_answer'", 'post.search mode type')
assertIncludes(cloudApi, 'citations: Array<', 'post.search citations type')

console.log('[mp-post-rag-search-static] PASS')
