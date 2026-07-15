import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const page = readFileSync(resolve(__dirname, '../../pages/index/index.vue'), 'utf8')

function ruleBody(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = page.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'))
  expect(match, `missing style rule for ${selector}`).toBeTruthy()
  return match?.[1] || ''
}

describe('home progressive sticky navigation', () => {
  test('stacks search below masthead and tags below search', () => {
    expect(page).toContain('class="home-search-sticky-shell"')
    expect(page).toMatch(/\.home-search-sticky-shell\s*\{[^}]*position:\s*sticky;/s)
    expect(page).toMatch(/\.home-search-sticky-shell\s*\{[^}]*top:\s*calc\(150rpx \+ env\(safe-area-inset-top\)\);/s)
    expect(page).toMatch(/\.section-tabs-sticky-shell\s*\{[^}]*top:\s*calc\(150rpx \+ env\(safe-area-inset-top\) \+ 138rpx\);/s)
    expect(page).toMatch(/<\/view>\r?\n\r?\n    <view class="home-search-sticky-shell"/)
    const search = page.indexOf('class="home-search-sticky-shell"')
    const live = page.indexOf('<!-- Live strip')
    expect(search).toBeLessThan(live)
    expect(page.indexOf('class="home-refresh-hint"')).toBeGreaterThan(search)
  })

  test('keeps sticky wrappers visually transparent', () => {
    for (const selector of ['.home-search-sticky-shell', '.section-tabs-sticky-shell']) {
      const body = ruleBody(selector)
      expect(body).not.toMatch(/(?:^|\s)background\s*:/)
      expect(body).not.toMatch(/box-shadow\s*:/)
      expect(body).not.toMatch(/backdrop-filter\s*:/)
    }
  })

  test('extends the hero gradient beneath the complete search surface', () => {
    const hero = ruleBody('.home-shell')
    const search = ruleBody('.home-search-sticky-shell')
    const searchBox = ruleBody('.home-search-sticky-shell .home-search-box')

    expect(hero).toMatch(/padding:\s*calc\(150rpx \+ env\(safe-area-inset-top\)\)\s+var\(--hh-page-x\)\s+138rpx;/)
    expect(hero).toMatch(/margin-bottom:\s*-138rpx;/)
    expect(search).toMatch(/padding:\s*24rpx\s+var\(--hh-page-x\);/)
    expect(searchBox).toMatch(/min-height:\s*90rpx;/)
  })

  test('keeps the mint gradient visible through the quote and search surface', () => {
    const hero = ruleBody('.home-shell')

    expect(hero).toMatch(
      /linear-gradient\(170deg,\s*#caeee7 0%,\s*#dcefe8 58%,\s*#edf4ed 84%,\s*var\(--hh-color-page\) 100%\)/,
    )
  })
})
