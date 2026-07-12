import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const userStoreSource = readFileSync(resolve(process.cwd(), 'src/store/user.ts'), 'utf8')

describe('Web SDK bundle policy', () => {
  test('keeps the web-cloudbase import inside an H5-only conditional', () => {
    const loadWebAuth = userStoreSource.match(/function loadWebAuth\(\)[\s\S]*?\n}/)?.[0] || ''

    expect(loadWebAuth).toMatch(/#ifdef H5[\s\S]*import\('\.\.\/api\/web-cloudbase'\)[\s\S]*#endif/)
    expect(loadWebAuth).toMatch(/#ifndef H5[\s\S]*throw new Error\([\s\S]*#endif/)
  })
})
