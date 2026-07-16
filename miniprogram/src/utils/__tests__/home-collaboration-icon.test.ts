import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const homeSource = readFileSync(resolve(process.cwd(), 'src/pages/index/index.vue'), 'utf8')
const carIconSource = readFileSync(resolve(process.cwd(), 'src/static/publish-icons/car.svg'), 'utf8')

describe('home collaboration icons', () => {
  test('renders carpool cards with the bundled vehicle asset and preserves the glyph fallback', () => {
    expect(homeSource).toContain("section.systemKey === 'carpool' ? '/static/publish-icons/car.svg' : ''")
    expect(homeSource).toContain('iconSrc?: string')
    expect(homeSource).toContain(':src="item.iconSrc"')
    expect(homeSource).toMatch(/<image\s+v-if="item\.iconSrc"[\s\S]*?<text v-else>\{\{ item\.ic \}\}<\/text>/)
    expect(carIconSource).toContain('<svg')
    expect(carIconSource).toContain('viewBox="0 0 35 29"')
  })
})
