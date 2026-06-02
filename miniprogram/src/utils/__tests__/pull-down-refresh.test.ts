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
})
