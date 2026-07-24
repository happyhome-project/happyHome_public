import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/pages/profile/index.vue'), 'utf8')
const nameRules = [...source.matchAll(/\.name\s*\{([^}]*)\}/g)]
const finalNameRule = nameRules.at(-1)?.[1] ?? ''

describe('profile nickname layout', () => {
  test('gives the nickname the remaining row width at the next smaller heading size', () => {
    expect(finalNameRule).toMatch(/flex:\s*1 1 0%;/)
    expect(finalNameRule).toMatch(/max-width:\s*100%;/)
    expect(finalNameRule).toMatch(/font-size:\s*var\(--hh-text-heading-md-size\);/)
    expect(source).not.toContain('max-width: 216rpx')
  })

  test('keeps extreme-length nicknames on one line with an ellipsis', () => {
    expect(source).toMatch(/\.name\s*\{[\s\S]*overflow:\s*hidden;[\s\S]*text-overflow:\s*ellipsis;[\s\S]*white-space:\s*nowrap;/)
  })
})
