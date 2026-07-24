import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const page = readFileSync(resolve(__dirname, '../../pages/index/index.vue'), 'utf8')
const archiveTopicTabs = readFileSync(resolve(__dirname, '../../components/ArchiveTopicTabs.vue'), 'utf8')
const template = page.slice(0, page.indexOf('<script'))
const repositoryRoot = resolve(__dirname, '../../../..')
const rootPackage = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'))
const miniprogramPackage = JSON.parse(readFileSync(resolve(repositoryRoot, 'miniprogram/package.json'), 'utf8'))
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
    expect(page).toMatch(/\.section-tabs-sticky-shell\s*\{[^}]*top:\s*calc\(150rpx \+ env\(safe-area-inset-top\) \+ 98rpx - 1px\);/s)
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
    expect(rootPackage.scripts['test:h5:home-sticky']).toBeUndefined()
    expect(miniprogramPackage.scripts['test:unit']).toContain('node scripts/test-h5-home-sticky-smoke.mjs')
    expect(h5Smoke).toMatch(/import \{ spawnSync \} from 'node:child_process'/)
    expect(h5Smoke).toContain("['--workspace', 'miniprogram', 'run', 'build:h5']")
    expect(h5Smoke).toMatch(/const build = spawnSync\(buildCommand, buildArgs,/)
    expect(h5Smoke.indexOf('const build = spawnSync(buildCommand, buildArgs,')).toBeLessThan(
      h5Smoke.indexOf("const root = join(process.cwd(), 'miniprogram', 'dist', 'build', 'h5')"),
    )
  })

  test('runs sticky runtime and release policy checks in the existing miniprogram CI lane', () => {
    const command = miniprogramPackage.scripts['test:unit']
    expect(command).toContain('node --test scripts/lib/mp-replay-policy.test.mjs')
    expect(command).toContain('scripts/lib/release-ui-fixture-membership.test.mjs')
    expect(command).toContain('node scripts/test-home-tabs-scroll-static.mjs')
    expect(command).toContain('node scripts/test-h5-home-sticky-smoke.mjs')
  })

  test('fades the quote-colored search surface into the white archive surface', () => {
    const search = ruleBody('.home-search-sticky-shell')
    const tabs = ruleBody('.section-tabs-sticky-shell')
    const archiveTabs = ruleBody('.section-tabs-sticky-shell--archive')

    expect(search).toMatch(/background:\s*var\(--home-sticky-surface\);/)
    expect(tabs).toMatch(/background:\s*var\(--home-tabs-surface\);/)
    expect(archiveTabs).toMatch(
      /background:\s*linear-gradient\(\s*180deg,\s*var\(--home-sticky-surface\) 0%,\s*#edf7f8 30%,\s*#f7fbfb 68%,\s*var\(--home-tabs-surface\) 100%\s*\);/,
    )
    for (const body of [search, tabs]) {
      expect(body).not.toMatch(/box-shadow\s*:/)
      expect(body).not.toMatch(/backdrop-filter\s*:/)
    }
    expect(page).toMatch(/--home-sticky-surface:\s*#e6f4f6;/)
    expect(page).toMatch(/--home-tabs-surface:\s*var\(--hh-color-card\);/)
  })

  test('keeps a 16px visual gap from the search box to tabs without changing sticky offsets', () => {
    const archiveTabsShell = ruleBody('.section-tabs-sticky-shell--archive')

    expect(archiveTabsShell).toMatch(/padding:\s*calc\(24rpx \+ 1px\)\s+0\s+0;/)
    expect(page).toMatch(/\.home-search-sticky-shell\s*\{[^}]*top:\s*calc\(150rpx \+ env\(safe-area-inset-top\)\);/s)
    expect(page).toMatch(/\.section-tabs-sticky-shell\s*\{[^}]*top:\s*calc\(150rpx \+ env\(safe-area-inset-top\) \+ 98rpx - 1px\);/s)
  })

  test('uses the Figma tab text and selected green fade without changing text geometry', () => {
    expect(archiveTopicTabs).toMatch(/\.archive-topic-tab\s*\{[^}]*color:\s*#292116;/s)
    expect(archiveTopicTabs).toMatch(/\.archive-topic-tab--active\s*\{[^}]*color:\s*#292116;[^}]*font-weight:\s*650;/s)
    expect(archiveTopicTabs).toMatch(
      /\.archive-topic-tab--active::after\s*\{[^}]*width:\s*102rpx;[^}]*height:\s*28rpx;[^}]*background:\s*linear-gradient\(90deg,\s*rgba\(61, 173, 125, 0\.3\) 0%,\s*rgba\(61, 173, 125, 0\) 100%\);/s,
    )
    expect(archiveTopicTabs).not.toContain('#ff2442')
  })

  test('extends the hero gradient beneath the complete search surface', () => {
    const hero = ruleBody('.home-shell')
    const search = ruleBody('.home-search-sticky-shell')
    const searchBox = ruleBody('.home-search-sticky-shell .home-search-box')

    expect(hero).toMatch(/padding:\s*calc\(150rpx \+ env\(safe-area-inset-top\)\)\s+var\(--hh-page-x\)\s+98rpx;/)
    expect(hero).toMatch(/margin-bottom:\s*-98rpx;/)
    expect(search).toMatch(/padding:\s*4rpx\s+var\(--hh-page-x\);/)
    expect(searchBox).toMatch(/min-height:\s*90rpx;/)
  })

  test('uses one continuous color field from masthead through the quote and search surface', () => {
    const hero = ruleBody('.home-shell')
    const topbar = ruleBody('.home-topbar')

    expect(page).toMatch(/--home-hero-title-top:\s*#cff5f2;/)
    expect(page).toMatch(/--home-hero-title-edge:\s*#ddf4f4;/)
    expect(page).toMatch(/--home-hero-quote:\s*#def4f4;/)
    expect(page).toMatch(
      /--home-hero-highlight:\s*radial-gradient\(ellipse 270rpx 244rpx at 79% 59rpx,\s*rgba\(84, 211, 160, 0\.212\) 0%,\s*rgba\(84, 211, 160, 0\.212\) 20%,\s*rgba\(84, 211, 160, 0\.16\) 40%,\s*rgba\(84, 211, 160, 0\.056\) 68%,\s*rgba\(84, 211, 160, 0\) 100%\);/,
    )
    expect(page.match(/var\(--home-hero-highlight\)/g) || []).toHaveLength(2)
    expect(hero).toMatch(
      /linear-gradient\(180deg,\s*var\(--home-hero-title-top\) 0,\s*var\(--home-hero-title-edge\) calc\(150rpx \+ env\(safe-area-inset-top\)\),\s*var\(--home-hero-quote\) calc\(280rpx \+ env\(safe-area-inset-top\)\),\s*var\(--home-sticky-surface\) 84%,\s*var\(--hh-color-page\) 100%\)/,
    )
    expect(topbar).toMatch(
      /linear-gradient\(180deg,\s*var\(--home-hero-title-top\) 0,\s*var\(--home-hero-title-edge\) 100%\)/,
    )
  })

  test('reduces only the tabs top inset while preserving text geometry', () => {
    expect(archiveTopicTabs).toMatch(/padding:\s*4rpx\s+var\(--hh-page-x\)\s+18rpx;/)
    expect(archiveTopicTabs).toMatch(/font-size:\s*28rpx;/)
    expect(archiveTopicTabs).toMatch(/line-height:\s*40rpx;/)
  })

  test('bridges the search surface into a denser activity heading without changing sticky offsets', () => {
    const activity = ruleBody('.group-section')
    const title = ruleBody('.group-section-title')

    expect(activity).toMatch(/margin:\s*0\s+0\s+34rpx;/)
    expect(activity).toMatch(/padding:\s*20rpx\s+24rpx\s+0;/)
    expect(activity).toMatch(
      /background:\s*linear-gradient\(180deg,\s*var\(--home-sticky-surface\) 0,\s*var\(--hh-color-page\) 96rpx\);/,
    )
    expect(title).toMatch(/margin-bottom:\s*12rpx;/)
    expect(title).toMatch(/font-size:\s*var\(--hh-text-heading-sm-size\);/)
    expect(title).toMatch(/line-height:\s*var\(--hh-text-heading-sm-line\);/)

    expect(page).toMatch(/\.home-search-sticky-shell\s*\{[^}]*top:\s*calc\(150rpx \+ env\(safe-area-inset-top\)\);/s)
    expect(page).toMatch(/\.section-tabs-sticky-shell\s*\{[^}]*top:\s*calc\(150rpx \+ env\(safe-area-inset-top\) \+ 98rpx - 1px\);/s)
  })
})
