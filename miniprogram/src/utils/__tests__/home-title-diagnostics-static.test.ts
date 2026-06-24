import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const root = resolve(__dirname, '../..')

describe('home title diagnostics', () => {
  test('home and section list pages report posts missing a display title', () => {
    const home = readFileSync(resolve(root, 'pages/index/index.vue'), 'utf8')
    const section = readFileSync(resolve(root, 'pages/section/index.vue'), 'utf8')

    for (const source of [home, section]) {
      expect(source).toContain('getPostHomeTitleIssue')
      expect(source).toContain('post.missingHomeTitle')
      expect(source).toContain("clientLog('warn'")
    }
  })
})
