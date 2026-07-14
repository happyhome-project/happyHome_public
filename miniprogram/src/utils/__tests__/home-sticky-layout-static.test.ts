import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const page = readFileSync(resolve(__dirname, '../../pages/index/index.vue'), 'utf8')

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
})
