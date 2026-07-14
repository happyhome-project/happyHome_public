import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildRichNoteContentFromMarkdown } from '../rich-note'
import {
  extractTextNoteContent,
  extractTextNoteFullBody,
  getTextNoteCard,
  getTextNoteThemePresentation,
  needsTextNoteFullBody,
  normalizeTextNoteTitle,
  normalizeTextNoteTheme,
  resolveTextNoteBodySize,
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

  test('builds a card from content and presentation with paper fallback', () => {
    expect(getTextNoteCard({ content: { text_title: '标题', text_body: { text: '正文' } }, presentation: { textNoteTheme: 'notice' } })).toEqual({ title: '标题', body: '正文', theme: 'notice' })
    expect(getTextNoteCard({ content: { text_title: '标题', text_body: { text: '正文' } } }).theme).toBe('paper')
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
})
