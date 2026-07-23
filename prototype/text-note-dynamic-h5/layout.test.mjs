import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createTextNoteDeck,
  normalizeBody,
  paginateBody,
  selectCoverExcerpt,
} from './layout.mjs'

test('normalizeBody preserves manual structure while removing accidental whitespace', () => {
  assert.equal(
    normalizeBody('  第一段  \r\n\r\n\r\n第二段  \r\n第三行  '),
    '第一段\n\n第二段\n第三行',
  )
})

test('selectCoverExcerpt skips a short salutation when a substantive paragraph follows', () => {
  const body = '各位邻居：\n\n本周六上午八点开始检修二次供水设备，请提前储水。'
  assert.equal(
    selectCoverExcerpt(body),
    '本周六上午八点开始检修二次供水设备，请提前储水。',
  )
})

test('selectCoverExcerpt keeps the only available paragraph', () => {
  assert.equal(selectCoverExcerpt('各位邻居：'), '各位邻居：')
})

test('paginateBody never drops or duplicates normalized source text', () => {
  const body = [
    '第一段包含中文、English words 和 Emoji 🏡。',
    '第二段包含一个很长的网址 https://example.com/community/notices/2026/water-maintenance?from=happyhome。',
    '第三段保留手动换行。\n下一行仍然属于第三段。',
  ].join('\n\n')
  const normalized = normalizeBody(body)
  const pages = paginateBody(body, { capacity: 36 })

  assert.ok(pages.length > 2)
  assert.equal(pages.join(''), normalized)
  for (const page of pages) {
    const last = page.charCodeAt(page.length - 1)
    assert.ok(!(last >= 0xd800 && last <= 0xdbff), 'page must not end with a dangling high surrogate')
  }
})

test('createTextNoteDeck keeps short content on a single cover', () => {
  const deck = createTextNoteDeck({
    title: '今晚记得关窗',
    body: '今晚有大风，大家睡前记得关好门窗。',
    theme: 'mint',
  })

  assert.equal(deck.theme, 'mint')
  assert.equal(deck.pages.length, 1)
  assert.equal(deck.pages[0].kind, 'cover')
  assert.equal(deck.pages[0].body, '今晚有大风，大家睡前记得关好门窗。')
  assert.equal(deck.pages[0].pageNumber, 1)
  assert.equal(deck.pages[0].totalPages, 1)
})

test('createTextNoteDeck turns long content into a cover and multiple body cards', () => {
  const body = Array.from({ length: 9 }, (_, index) =>
    `第${index + 1}段：这是用于验证动态分页的社区通知内容，文字应当保持原始顺序并进入后续正文卡片。`,
  ).join('\n\n')
  const deck = createTextNoteDeck({
    title: '周六社区停水通知',
    body,
    theme: 'notice',
  })

  assert.ok(deck.pages.length >= 4)
  assert.equal(deck.pages[0].kind, 'cover')
  assert.ok(deck.pages.slice(1).every((page) => page.kind === 'body'))
  assert.ok(deck.pages.every((page, index) =>
    page.pageNumber === index + 1 && page.totalPages === deck.pages.length,
  ))
})

test('all six production themes are accepted and unknown themes fall back to paper', () => {
  const themes = ['paper', 'mint', 'slate', 'headline', 'quote', 'notice']
  for (const theme of themes) {
    assert.equal(createTextNoteDeck({ title: '标题', body: '正文', theme }).theme, theme)
  }
  assert.equal(createTextNoteDeck({ title: '标题', body: '正文', theme: 'unknown' }).theme, 'paper')
})
