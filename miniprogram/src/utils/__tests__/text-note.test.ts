import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildRichNoteContentFromMarkdown } from '../rich-note'
import {
  createTextNoteDeck,
  extractTextNoteContent,
  extractTextNoteFullBody,
  getTextNoteBodyLayout,
  getTextNoteCard,
  getTextNoteThemePresentation,
  needsTextNoteFullBody,
  normalizeTextNoteBody,
  normalizeTextNoteTitle,
  normalizeTextNoteTheme,
  paginateTextNoteBody,
  resolveTextNoteDisplayBody,
  resolveTextNoteBodySize,
  selectTextNoteCoverExcerpt,
  TEXT_NOTE_THEMES,
  truncateTextNoteBody,
} from '../text-note'

describe('text note presentation', () => {
  test('avoids runtime APIs forbidden in critical mini-program chunks', () => {
    const source = readFileSync(new URL('../text-note.ts', import.meta.url), 'utf8')

    expect(source).not.toContain('Array.from')
    expect(source).not.toContain('...extractTextNoteContent')
  })

  test('bounds a continuous long title for a stable two-line cover', () => {
    expect(Array.from(normalizeTextNoteTitle('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'))).toHaveLength(48)
  })
  test('exposes all six themes and falls back to paper', () => {
    expect(TEXT_NOTE_THEMES).toEqual(['paper', 'mint', 'slate', 'headline', 'quote', 'notice'])
    expect(normalizeTextNoteTheme('quote')).toBe('quote')
    expect(normalizeTextNoteTheme('unknown')).toBe('paper')
    expect(normalizeTextNoteTheme(undefined)).toBe('paper')
  })

  test('gives every theme a distinct typographic presentation, not only a color', () => {
    const presentations = TEXT_NOTE_THEMES.map((theme) => getTextNoteThemePresentation(theme))

    expect(new Set(presentations.map((item) => item.kicker)).size).toBe(TEXT_NOTE_THEMES.length)
    expect(new Set(presentations.map((item) => `${item.layout}:${item.titleTone}:${item.ornament}`)).size)
      .toBe(TEXT_NOTE_THEMES.length)
  })

  test('exposes the approved safe body layout and capacity for every theme', () => {
    expect(Object.fromEntries(TEXT_NOTE_THEMES.map((theme) => {
      const layout = getTextNoteBodyLayout(theme)
      return [theme, {
        safeRect: layout.safeRect,
        unitsPerLine: layout.unitsPerLine,
        maxLines: layout.maxLines,
        referenceCapacity: layout.referenceCapacity,
        safeCapacity: layout.safeCapacity,
      }]
    }))).toEqual({
      paper: {
        safeRect: { x: 32, y: 48, width: 306, height: 384 },
        unitsPerLine: 19,
        maxLines: 16,
        referenceCapacity: 304,
        safeCapacity: 303,
      },
      mint: {
        safeRect: { x: 32, y: 52, width: 306, height: 384 },
        unitsPerLine: 19,
        maxLines: 16,
        referenceCapacity: 304,
        safeCapacity: 303,
      },
      slate: {
        safeRect: { x: 36, y: 58, width: 298, height: 384 },
        unitsPerLine: 18,
        maxLines: 16,
        referenceCapacity: 288,
        safeCapacity: 287,
      },
      headline: {
        safeRect: { x: 36, y: 94, width: 298, height: 360 },
        unitsPerLine: 18,
        maxLines: 15,
        referenceCapacity: 270,
        safeCapacity: 269,
      },
      quote: {
        safeRect: { x: 40, y: 92, width: 290, height: 360 },
        unitsPerLine: 18,
        maxLines: 15,
        referenceCapacity: 270,
        safeCapacity: 269,
      },
      notice: {
        safeRect: { x: 36, y: 54, width: 298, height: 384 },
        unitsPerLine: 18,
        maxLines: 16,
        referenceCapacity: 288,
        safeCapacity: 287,
      },
    })
    expect(getTextNoteBodyLayout('unknown')).toEqual(getTextNoteBodyLayout('paper'))
  })

  test('builds a card from content and presentation with paper fallback', () => {
    expect(getTextNoteCard({ content: { text_title: '标题', text_body: { text: '正文' } }, presentation: { textNoteTheme: 'notice' } })).toEqual({ title: '标题', body: '正文', theme: 'notice' })
    expect(getTextNoteCard({ content: { text_title: '标题', text_body: { text: '正文' } } }).theme).toBe('paper')
  })

  test('builds native archive text cards from the persisted title and body keys', () => {
    expect(getTextNoteCard({
      content: {
        title: '手机端文字测试',
        body: buildRichNoteContentFromMarkdown('正文必须进入文字封面'),
      },
      presentation: { textNoteTheme: 'mint' },
    })).toEqual({
      title: '手机端文字测试',
      body: '正文必须进入文字封面',
      theme: 'mint',
    })
  })

  test('extracts the fixed title and rich-note text first paragraph', () => {
    expect(extractTextNoteContent({
      text_title: '  周末邻里读书会  ',
      text_body: {
        text: '第一行\n第二行\n\n第二段不应进入封面',
      },
    })).toEqual({
      title: '周末邻里读书会',
      body: '第一行 第二行',
    })
  })

  test('uses rich-note markdown structure because stored text flattens paragraph boundaries', () => {
    const body = buildRichNoteContentFromMarkdown('第一段\n继续第一段\n\n第二段')
    expect(body.text).toBe('第一段 继续第一段 第二段')

    expect(extractTextNoteContent({ text_title: '标题', text_body: body })).toEqual({
      title: '标题',
      body: '第一段 继续第一段',
    })
  })

  test('turns common markdown into visible plain text without leaking markers', () => {
    const cases = [
      ['## 小标题\n\n第二段', '小标题'],
      ['- 第一项\n- 第二项\n\n后文', '第一项 第二项'],
      ['查看[邻里公约](https://example.com/rules)\n\n后文', '查看邻里公约'],
      ['![图片](cloud://env/a.jpg)\n\n**真正首段**', '真正首段'],
    ]

    for (const [markdown, expected] of cases) {
      expect(extractTextNoteContent({
        text_title: '标题',
        text_body: buildRichNoteContentFromMarkdown(markdown),
      }).body).toBe(expected)
    }
  })

  test('falls back through structured html before flattened text', () => {
    expect(extractTextNoteContent({
      text_title: '标题',
      text_body: {
        html: '<p><strong>HTML 首段</strong></p><p>HTML 第二段</p>',
        text: 'HTML 首段 HTML 第二段',
      },
    }).body).toBe('HTML 首段')
  })

  test('supports plain body values and normalizes whitespace inside the first paragraph', () => {
    expect(extractTextNoteContent({
      text_title: 42,
      text_body: '  Visit https://example.com/a/really-long-path\r\n today \r\n\r\n later ',
    })).toEqual({
      title: '42',
      body: 'Visit https://example.com/a/really-long-path today',
    })
  })

  test('truncates to 64 Unicode code points including the ellipsis', () => {
    const source = `${'邻'.repeat(62)}😀英文`
    const result = truncateTextNoteBody(source)

    expect(Array.from(result)).toHaveLength(64)
    expect(result).toBe(`${'邻'.repeat(62)}😀…`)
  })

  test('keeps arbitrary-length detail documents complete while covers remain bounded', () => {
    const longBody = `${'早晚高峰通勤路线与接驳信息'.repeat(42)}\n\nVisit https://example.com/transit/very-long-path 😀`

    expect(resolveTextNoteDisplayBody(longBody, 'document')).toBe(longBody)
    expect(resolveTextNoteDisplayBody(longBody, 'document')).toContain('\n\n')
    expect(Array.from(resolveTextNoteDisplayBody(longBody, 'cover'))).toHaveLength(64)
    expect(resolveTextNoteDisplayBody(longBody, 'cover')).toMatch(/…$/)
  })

  test('keeps short text and assigns inclusive size bands', () => {
    expect(truncateTextNoteBody('😀邻里')).toBe('😀邻里')
    expect(resolveTextNoteBodySize('字'.repeat(20))).toBe('large')
    expect(resolveTextNoteBodySize('字'.repeat(21))).toBe('medium')
    expect(resolveTextNoteBodySize('字'.repeat(40))).toBe('medium')
    expect(resolveTextNoteBodySize('字'.repeat(41))).toBe('small')
  })

  test('keeps the visual cover as the detail body and only adds full text when cover truncates', () => {
    const shortBody = buildRichNoteContentFromMarkdown('短正文')
    const longBody = buildRichNoteContentFromMarkdown(`${'完整正文'.repeat(20)}\n\n第二段也要保留`)

    expect(extractTextNoteFullBody(shortBody)).toBe('短正文')
    expect(needsTextNoteFullBody(shortBody)).toBe(false)
    expect(extractTextNoteFullBody(longBody)).toContain('第二段也要保留')
    expect(extractTextNoteFullBody(longBody)).toContain('\n\n第二段也要保留')
    expect(needsTextNoteFullBody(longBody)).toBe(true)
  })

  test('normalizes accidental whitespace while preserving paragraph and manual line structure', () => {
    expect(normalizeTextNoteBody('  第一段  \r\n\r\n\r\n第二段  \r\n第三行  '))
      .toBe('第一段\n\n第二段\n第三行')
  })

  test('skips a short salutation when selecting the cover excerpt', () => {
    expect(selectTextNoteCoverExcerpt('各位邻居：\n\n本周六上午八点检修供水设备，请提前储水。'))
      .toBe('本周六上午八点检修供水设备，请提前储水。')
    expect(selectTextNoteCoverExcerpt('各位邻居：')).toBe('各位邻居：')
  })

  test('paginates Chinese, English, URL, Emoji and manual lines without loss or duplication', () => {
    const body = [
      '第一段包含中文、English words 和 Emoji 🏡。',
      '第二段包含长网址 https://example.com/community/notices/2026/water-maintenance?from=happyhome。',
      '第三段保留手动换行。\n下一行仍然属于第三段。',
    ].join('\n\n')
    const normalized = normalizeTextNoteBody(body)
    const pages = paginateTextNoteBody(body, { unitsPerLine: 10, maxLines: 3 })

    expect(pages.length).toBeGreaterThan(2)
    expect(pages.join('')).toBe(normalized)
    for (const page of pages) {
      const first = page.charCodeAt(0)
      const last = page.charCodeAt(page.length - 1)
      expect(first >= 0xdc00 && first <= 0xdfff).toBe(false)
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false)
      expect(page.startsWith('\u200d')).toBe(false)
      expect(page.endsWith('\u200d')).toBe(false)
    }
  })

  test('does not cut joined Emoji or combining marks at page boundaries', () => {
    const family = '👨‍👩‍👧‍👦'
    const accented = 'e\u0301'
    const pages = paginateTextNoteBody(`${family}${accented}`.repeat(8), { unitsPerLine: 3, maxLines: 1 })

    expect(pages.join('')).toBe(`${family}${accented}`.repeat(8))
    expect(pages.every((page) => !page.startsWith('\u200d') && !page.endsWith('\u200d'))).toBe(true)
    expect(pages.every((page) => !/^[\u0300-\u036f]/.test(page))).toBe(true)
  })

  test('does not split complex Unicode clusters at page boundaries', () => {
    const subdivisionFlag = `🏴${String.fromCodePoint(
      0xe0067,
      0xe0062,
      0xe0065,
      0xe006e,
      0xe0067,
      0xe007f,
    )}`
    const cases = [
      {
        body: 'نَ'.repeat(400),
        theme: 'paper' as const,
        invalidStart: (page: string) => /^[\u064b-\u065f]/.test(page),
      },
      {
        body: 'क्'.repeat(400),
        theme: 'paper' as const,
        invalidStart: (page: string) => page.startsWith('\u094d'),
      },
      {
        body: 'क्ष'.repeat(400),
        theme: 'paper' as const,
        invalidStart: (page: string) => page.startsWith('ष'),
      },
      {
        body: 'क\u1cd0'.repeat(400),
        theme: 'paper' as const,
        invalidStart: (page: string) => page.startsWith('\u1cd0'),
      },
      {
        body: '\u1100\u1161\u11a8'.repeat(400),
        theme: 'headline' as const,
        invalidStart: (page: string) => /^[\u1160-\u11ff]/.test(page),
      },
      {
        body: subdivisionFlag.repeat(400),
        theme: 'slate' as const,
        invalidStart: (page: string) => {
          const first = page.codePointAt(0) || 0
          return first >= 0xe0020 && first <= 0xe007f
        },
      },
    ]

    for (const { body, theme, invalidStart } of cases) {
      const pages = paginateTextNoteBody(body, { theme })
      expect(pages.length).toBeGreaterThan(1)
      expect(pages.join('')).toBe(body)
      expect(pages.slice(1).every((page) => !invalidStart(page)), theme).toBe(true)
    }
  })

  test('keeps common complex clusters intact when Intl.Segmenter is unavailable', () => {
    const segmenterDescriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')
    const subdivisionFlag = `🏴${String.fromCodePoint(
      0xe0067,
      0xe0062,
      0xe0065,
      0xe006e,
      0xe0067,
      0xe007f,
    )}`
    const cases = [
      { body: 'نَ'.repeat(20), invalidStart: (page: string) => /^[\u064b-\u065f]/.test(page) },
      { body: 'क्'.repeat(20), invalidStart: (page: string) => page.startsWith('\u094d') },
      { body: 'क्ष'.repeat(20), invalidStart: (page: string) => page.startsWith('ष') },
      { body: 'क\u1cd0'.repeat(20), invalidStart: (page: string) => page.startsWith('\u1cd0') },
      {
        body: '\u1100\u1161\u11a8'.repeat(20),
        invalidStart: (page: string) => /^[\u1160-\u11ff]/.test(page),
      },
      {
        body: subdivisionFlag.repeat(20),
        invalidStart: (page: string) => {
          const first = page.codePointAt(0) || 0
          return first >= 0xe0020 && first <= 0xe007f
        },
      },
    ]

    Object.defineProperty(Intl, 'Segmenter', {
      configurable: true,
      value: undefined,
    })
    try {
      for (const { body, invalidStart } of cases) {
        const pages = paginateTextNoteBody(body, { unitsPerLine: 5, maxLines: 2 })
        expect(pages.length).toBeGreaterThan(1)
        expect(pages.join('')).toBe(body)
        expect(pages.slice(1).every((page) => !invalidStart(page))).toBe(true)
      }
    } finally {
      if (segmenterDescriptor) {
        Object.defineProperty(Intl, 'Segmenter', segmenterDescriptor)
      } else {
        delete (Intl as unknown as { Segmenter?: unknown }).Segmenter
      }
    }
  })

  test('keeps Prepend characters from swallowing line boundaries without Intl.Segmenter', () => {
    const segmenterDescriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')
    const body = `${`${String.fromCodePoint(0x0600)}\n`.repeat(10)}A`
    const normalized = normalizeTextNoteBody(body)
    const assertLineBudget = () => {
      const pages = paginateTextNoteBody(body, { unitsPerLine: 10, maxLines: 2 })
      expect(pages.join('')).toBe(normalized)
      expect(pages.length).toBeGreaterThan(5)
      expect(pages.every((page) =>
        page.replace(/\n$/, '').split('\n').length <= 2,
      )).toBe(true)
    }

    assertLineBudget()
    Object.defineProperty(Intl, 'Segmenter', {
      configurable: true,
      value: undefined,
    })
    try {
      assertLineBudget()
    } finally {
      if (segmenterDescriptor) {
        Object.defineProperty(Intl, 'Segmenter', segmenterDescriptor)
      } else {
        delete (Intl as unknown as { Segmenter?: unknown }).Segmenter
      }
    }
  })

  test('bounds pathological overlong clusters with and without Intl.Segmenter', () => {
    const segmenterDescriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')
    const longZwjCluster = Array.from({ length: 21 }, () => '😀').join('\u200d')
    const longTagCluster = String.fromCodePoint(
      0x1f3f4,
      ...Array.from({ length: 20 }, () => 0xe0067),
      0xe007f,
    )
    const longPrependCluster = `${String.fromCodePoint(0x0600).repeat(20)}A`
    const assertBounded = () => {
      for (const body of [longZwjCluster, longTagCluster, longPrependCluster]) {
        const constrainedPages = paginateTextNoteBody(body, {
          unitsPerLine: 2,
          maxLines: 1,
          maxVisualUnits: 2,
        })
        const productionPages = paginateTextNoteBody(body, { theme: 'paper' })
        for (const pages of [constrainedPages, productionPages]) {
          expect(pages.length).toBeGreaterThan(1)
          expect(pages.join('')).toBe(body)
          expect(pages.every((page) => Array.from(page).length <= 16)).toBe(true)
        }
      }
    }

    assertBounded()
    Object.defineProperty(Intl, 'Segmenter', {
      configurable: true,
      value: undefined,
    })
    try {
      assertBounded()
    } finally {
      if (segmenterDescriptor) {
        Object.defineProperty(Intl, 'Segmenter', segmenterDescriptor)
      } else {
        delete (Intl as unknown as { Segmenter?: unknown }).Segmenter
      }
    }
  })

  test('segments long bodies once before incrementally packing pages', () => {
    const segmenterDescriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')
    let segmentCalls = 0
    class CountingSegmenter {
      segment(value: string) {
        segmentCalls += 1
        return Array.from(value, (segment) => ({ segment }))
      }
    }

    Object.defineProperty(Intl, 'Segmenter', {
      configurable: true,
      value: CountingSegmenter,
    })
    try {
      const body = '字'.repeat(10_000)
      const pages = paginateTextNoteBody(body, { theme: 'paper' })
      expect(pages.join('')).toBe(body)
      expect(pages.length).toBeGreaterThan(30)
      expect(segmentCalls).toBeLessThanOrEqual(2)
    } finally {
      if (segmenterDescriptor) {
        Object.defineProperty(Intl, 'Segmenter', segmenterDescriptor)
      } else {
        delete (Intl as unknown as { Segmenter?: unknown }).Segmenter
      }
    }
  })

  test('treats manual line breaks as real vertical space instead of cheap characters', () => {
    const body = Array.from({ length: 24 }, (_, index) => `第${index + 1}行`).join('\n')
    const pages = paginateTextNoteBody(body, { unitsPerLine: 20, maxLines: 4 })

    expect(pages.length).toBeGreaterThan(4)
    expect(pages.join('')).toBe(normalizeTextNoteBody(body))
    expect(pages.every((page) => page.replace(/\n$/, '').split('\n').length <= 4)).toBe(true)
  })

  test('uses every theme safe capacity and creates another page instead of shrinking text', () => {
    for (const theme of TEXT_NOTE_THEMES) {
      const layout = getTextNoteBodyLayout(theme)
      const exactPage = '字'.repeat(layout.safeCapacity)
      const overflow = `${exactPage}字`

      expect(paginateTextNoteBody(exactPage, { theme }), theme).toHaveLength(1)
      expect(paginateTextNoteBody(overflow, { theme }), theme).toHaveLength(2)
      expect(paginateTextNoteBody(overflow, { theme }).join(''), theme).toBe(overflow)
    }
  })

  test('budgets wide ASCII conservatively across the six larger theme layouts', () => {
    const wideAsciiCases = [
      { body: 'W'.repeat(400), minimumUnitWeight: 1 },
      { body: 'mw'.repeat(250), minimumUnitWeight: 1 },
      {
        body: `https://www.${'minimum-width-'.repeat(40)}example.com`,
        minimumUnitWeight: 0.65,
      },
    ]

    for (const theme of TEXT_NOTE_THEMES) {
      const layout = getTextNoteBodyLayout(theme)
      for (const { body, minimumUnitWeight } of wideAsciiCases) {
        const pages = paginateTextNoteBody(body, { theme })
        expect(pages.length, theme).toBeGreaterThanOrEqual(2)
        expect(pages.join(''), theme).toBe(body)
        const maxCodePoints = Math.floor(layout.safeCapacity / minimumUnitWeight)
        expect(pages.every((page) => Array.from(page).length <= maxCodePoints), theme).toBe(true)
      }
    }
  })

  test('preserves the legacy counterpart when only one custom layout option is supplied', () => {
    expect(paginateTextNoteBody('字'.repeat(155), { unitsPerLine: 10 })).toHaveLength(2)
    expect(paginateTextNoteBody('字'.repeat(55), { maxLines: 3 })).toHaveLength(2)
  })

  test('counts blank lines as layout rows and preserves them across page boundaries', () => {
    const body = '第一行\n\n第二行'
    const pages = paginateTextNoteBody(body, { unitsPerLine: 20, maxLines: 2 })

    expect(pages).toHaveLength(2)
    expect(pages.join('')).toBe(body)
  })

  test('always creates a title-only cover followed by source-complete body-only pages', () => {
    const shortDeck = createTextNoteDeck({
      title: '今晚记得关窗',
      body: '今晚有大风，大家睡前记得关好门窗。',
      theme: 'mint',
    })
    expect(shortDeck.theme).toBe('mint')
    expect(shortDeck.pages).toHaveLength(2)
    expect(shortDeck.pages[0]).toMatchObject({
      kind: 'cover',
      title: '今晚记得关窗',
      body: '',
      sourceBody: '',
      pageNumber: 1,
      totalPages: 2,
    })
    expect(shortDeck.pages[1]).toMatchObject({
      kind: 'body',
      title: '',
      body: '今晚有大风，大家睡前记得关好门窗。',
      sourceBody: '今晚有大风，大家睡前记得关好门窗。',
      pageNumber: 2,
      totalPages: 2,
    })

    const body = Array.from({ length: 9 }, (_, index) =>
      `第${index + 1}段：这是用于验证动态分页的社区通知内容，文字应保持原始顺序并进入后续正文卡片。`,
    ).join('\n\n')
    const longDeck = createTextNoteDeck({ title: '周六社区停水通知', body, theme: 'notice' })
    expect(longDeck.pages.length).toBeGreaterThanOrEqual(3)
    expect(longDeck.pages[0].kind).toBe('cover')
    expect(longDeck.pages[0].body).toBe('')
    expect(longDeck.pages.slice(1).every((page) => page.kind === 'body')).toBe(true)
    expect(longDeck.pages.slice(1).every((page) => page.title === '')).toBe(true)
    expect(longDeck.pages.slice(1).every((page) => page.body === page.body.trim())).toBe(true)
    expect(longDeck.pages.slice(1).map((page) => page.sourceBody).join('')).toBe(normalizeTextNoteBody(body))
    expect(longDeck.pages.every((page, index) =>
      page.pageNumber === index + 1 && page.totalPages === longDeck.pages.length,
    )).toBe(true)
  })

  test('repaginates the same body against the selected theme capacity and falls back to paper', () => {
    const body = '字'.repeat(280)
    const pageCounts = Object.fromEntries(TEXT_NOTE_THEMES.map((theme) => [
      theme,
      createTextNoteDeck({ title: '标题', body, theme }).pages.length,
    ]))

    expect(pageCounts).toEqual({
      paper: 2,
      mint: 2,
      slate: 2,
      headline: 3,
      quote: 3,
      notice: 2,
    })
    expect(createTextNoteDeck({ title: '标题', body: '正文', theme: 'unknown' }).theme).toBe('paper')
  })
})
