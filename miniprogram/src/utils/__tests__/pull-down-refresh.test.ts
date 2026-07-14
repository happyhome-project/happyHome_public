import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const currentDir = dirname(fileURLToPath(import.meta.url))
const srcRoot = resolve(currentDir, '../..')

function readProjectFile(relativePath: string) {
  return readFileSync(resolve(srcRoot, relativePath), 'utf-8')
}

describe('mini-program pull-down refresh contract', () => {
  const refreshPages = [
    { path: 'pages/index/index', source: 'pages/index/index.vue' },
    { path: 'pages/profile/index', source: 'pages/profile/index.vue' },
    { path: 'pages/onboarding/index', source: 'pages/onboarding/index.vue' },
  ]

  test.each(refreshPages)('$path enables native pull-down refresh', ({ path }) => {
    const pagesJson = JSON.parse(readProjectFile('pages.json'))
    const page = pagesJson.pages.find((item: any) => item.path === path)

    expect(page?.style?.enablePullDownRefresh).toBe(true)
  })

  test.each(refreshPages)('$path wires pull-down to refresh work and stops the native spinner', ({ source }) => {
    const code = readProjectFile(source)

    expect(code).toContain('onPullDownRefresh')
    expect(code).toContain('uni.stopPullDownRefresh()')
  })

  test('home page shows the Figma refresh hint only during pull-down refresh', () => {
    const code = readProjectFile('pages/index/index.vue')

    expect(code).toContain('showHomePullRefreshHint')
    expect(code).toContain('用力加载中...')
    expect(code).toContain('HOME_PULL_REFRESH_HINT_MIN_MS')
    expect(code).toContain('activeHomeRefreshPromise')
    expect(code).toMatch(/onPullDownRefresh[\s\S]*showHomePullRefreshHint\.value = true/)
    expect(code).toMatch(/finally[\s\S]*showHomePullRefreshHint\.value = false[\s\S]*uni\.stopPullDownRefresh\(\)/)
    expect(code).toMatch(/if \(activeHomeRefreshPromise\)[\s\S]*await activeHomeRefreshPromise/)
  })

  test('home refresh hint keeps the compact Figma loading rhythm', () => {
    const code = readProjectFile('pages/index/index.vue')

    expect(code).toContain('height: 164rpx;')
    expect(code).toContain('gap: 15rpx;')
    expect(code).toContain('width: 38rpx;')
    expect(code).toContain('height: 38rpx;')
    expect(code).toContain('font-size: 30rpx;')
    expect(code).toContain('line-height: 45rpx;')
  })

  test('home page normalizes server guest intro config before rendering', () => {
    const code = readProjectFile('pages/index/index.vue')

    expect(code).toContain('normalizeGuestIntroConfig')
    expect(code).toMatch(/guestIntroConfig\.value = userStore\.isLoggedIn[\s\S]*normalizeGuestIntroConfig\(safeSnapshot\.guestIntroConfig \|\| null\)/)
  })
})
