import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

const noticeSource = fs.readFileSync(
  path.resolve(__dirname, '../../pages/notice/index.vue'),
  'utf8',
)

describe('Figma notice detail hierarchy', () => {
  test('renders the notice page title and places author/date metadata before body content', () => {
    const pageTitleIndex = noticeSource.indexOf('公告详情')
    const authorRowIndex = noticeSource.indexOf('class="notice-author-row"')
    const bodyIndex = noticeSource.indexOf('class="notice-body"')

    expect(pageTitleIndex).toBeGreaterThanOrEqual(0)
    expect(authorRowIndex).toBeGreaterThanOrEqual(0)
    expect(bodyIndex).toBeGreaterThan(authorRowIndex)
    expect(noticeSource).toContain('class="notice-author-avatar"')
    expect(noticeSource).toContain('class="notice-author-name"')
    expect(noticeSource).toContain('class="notice-updated-date"')
  })

  test('uses controlled administrator metadata without presenting section identity as the author', () => {
    expect(noticeSource).toContain('社区管理员')
    expect(noticeSource).toContain('/static/ai-avatars/avatar-01.svg')
    expect(fs.existsSync(path.resolve(__dirname, '../../static/ai-avatars/avatar-01.svg'))).toBe(true)
    expect(noticeSource).not.toContain('section.createdAt')
    expect(noticeSource).not.toContain('section.name')
    expect(noticeSource).not.toContain('resolveSectionIconGlyph')
  })

  test('shows the notice configuration update date only when section updatedAt exists', () => {
    expect(noticeSource).toContain('section as any).updatedAt')
    expect(noticeSource).toContain('v-if="notice.updatedAt"')
    expect(noticeSource).toContain('更新于 {{ notice.updatedAt }}')
    expect(noticeSource).not.toContain('publishedAt')
  })

  test('keeps the loaded notice on a plain white page without the decorative card or accent strip', () => {
    expect(noticeSource).not.toContain('notice-detail-card')
    expect(noticeSource).not.toContain('--notice-accent')
    expect(noticeSource).not.toContain('border-left:')
    expect(noticeSource).not.toContain('linear-gradient')
    expect(noticeSource).toMatch(/\.notice-page\s*\{[\s\S]*?background:\s*(?:#fff(?:fff)?|white|\$hh-surface-1);/)
  })

  test('preserves route parameters and the missing-notice recovery path', () => {
    expect(noticeSource).toContain("query?.sectionId")
    expect(noticeSource).toContain("query?.widgetId")
    expect(noticeSource).toContain('class="notice-empty"')
    expect(noticeSource).toContain('@tap="goHome"')
  })
})
