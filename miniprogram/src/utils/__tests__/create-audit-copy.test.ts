import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/pages/create/index.vue'), 'utf8')

describe('create audit feedback', () => {
  test('pending media tells the author it will publish automatically after passing', () => {
    expect(source).toContain('图片或音频正在安全审核，通过后将自动发布。')
    expect(source).toContain('图片或音频正在安全审核，通过后将自动更新。')
  })
})
