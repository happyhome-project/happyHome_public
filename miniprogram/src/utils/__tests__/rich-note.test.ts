import { describe, expect, test } from 'vitest'
import {
  applyMarkdownToolbarAction,
  buildRichNoteContentFromMarkdown,
  extractRichNoteImageFileIDs,
  htmlToMarkdown,
  markdownToHtml,
  markdownToText,
} from '../rich-note'

describe('rich_note markdown contract', () => {
  test('builds stored rich note content directly from markdown', () => {
    const markdown = '## 出行说明\n\n**准时** 上车\n\n- 带伞\n\n![图片](cloud://env/posts/ride.jpg)'

    const content = buildRichNoteContentFromMarkdown(markdown)

    expect(content).toEqual({
      format: 'markdown',
      markdown,
      html: expect.stringContaining('<strong>准时</strong>'),
      text: '出行说明 准时 上车 带伞',
      imageFileIDs: ['cloud://env/posts/ride.jpg'],
      schemaVersion: 1,
    })
  })

  test('renders markdown into safe html and text', () => {
    const markdown = '## 标题\n\n**加粗** 和 *斜体*\n\n- 第一项\n- 第二项\n\n![图](cloud://env/posts/a.jpg)'

    expect(markdownToHtml(markdown)).toContain('<h2>标题</h2>')
    expect(markdownToHtml(markdown)).toContain('<strong>加粗</strong>')
    expect(markdownToHtml(markdown)).toContain('<img src="cloud://env/posts/a.jpg" alt="图">')
    expect(markdownToHtml('第一行\n第二行')).toBe('<p>第一行<br>第二行</p>')
    expect(markdownToText(markdown)).toBe('标题 加粗 和 斜体 第一项 第二项')
    expect(extractRichNoteImageFileIDs(markdown)).toEqual(['cloud://env/posts/a.jpg'])
  })

  test('escapes raw html in markdown output', () => {
    const content = buildRichNoteContentFromMarkdown('<script>alert(1)</script>\n\n**safe**')

    expect(content.html).toContain('&lt;script&gt;')
    expect(content.html).not.toContain('<script>')
  })

  test('toolbar wraps selection without requiring users to type markdown markers manually', () => {
    expect(applyMarkdownToolbarAction('准时上车', 'bold', 0, 2).markdown).toBe('**准时**上车')
    expect(applyMarkdownToolbarAction('第一项', 'unordered-list', 0, 3).markdown).toBe('- 第一项')
    expect(applyMarkdownToolbarAction('注意安全', 'quote', 0, 4).markdown).toBe('> 注意安全')
    expect(applyMarkdownToolbarAction('第一段第二段', 'line-break', 3, 3).markdown).toBe('第一段\n第二段')
    expect(buildRichNoteContentFromMarkdown('第一段\n').markdown).toBe('第一段\n')
  })

  test('toolbar inserts image markdown in place for later upload replacement', () => {
    const result = applyMarkdownToolbarAction('第一段\n\n第二段', 'image', 4, 4, {
      alt: '图片',
      src: 'wxfile://tmp/photo.jpg',
    })

    expect(result.markdown).toBe('第一段\n\n![图片](wxfile://tmp/photo.jpg)\n\n第二段')
  })

  test('converts legacy controlled html into markdown when normalizing old drafts', () => {
    expect(htmlToMarkdown('<blockquote>注意安全</blockquote><p><a href="https://example.com">查看</a></p>'))
      .toBe('> 注意安全\n\n[查看](https://example.com)')
  })
})
