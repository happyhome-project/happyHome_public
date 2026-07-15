import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const page = readFileSync(resolve(__dirname, '../../pages/index/index.vue'), 'utf8')
const template = page.slice(0, page.indexOf('<script'))
const repositoryRoot = resolve(__dirname, '../../../..')
const rootPackage = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'))
const h5Smoke = readFileSync(resolve(repositoryRoot, 'scripts/test-h5-home-sticky-smoke.mjs'), 'utf8')

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

  test('attaches the second sticky stage to the single visible archive topic tabs', () => {
    expect(template).toMatch(
      /<view class="archive-topic-shell">\s*<view class="section-tabs-sticky-shell section-tabs-sticky-shell--archive">\s*<ArchiveTopicTabs/,
    )
    expect(template).not.toMatch(/v-show="false"[^>]*class="section-tabs-sticky-shell"/)
    expect(template.match(/class="section-tabs-sticky-shell(?: [^"]*)?"/g) || []).toHaveLength(1)
  })

  test('builds the current H5 source before running the sticky smoke', () => {
    expect(rootPackage.scripts['test:h5:home-sticky']).toBe('node scripts/test-h5-home-sticky-smoke.mjs')
    expect(h5Smoke).toMatch(/import \{ spawnSync \} from 'node:child_process'/)
    expect(h5Smoke).toContain("['--workspace', 'miniprogram', 'run', 'build:h5']")
    expect(h5Smoke).toMatch(/const build = spawnSync\(buildCommand, buildArgs,/)
    expect(h5Smoke.indexOf('const build = spawnSync(buildCommand, buildArgs,')).toBeLessThan(
      h5Smoke.indexOf("const root = join(process.cwd(), 'miniprogram', 'dist', 'build', 'h5')"),
    )
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
