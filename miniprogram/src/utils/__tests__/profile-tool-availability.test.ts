import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const profileSource = readFileSync(resolve(process.cwd(), 'src/pages/profile/index.vue'), 'utf8')

describe('profile tool availability contract', () => {
  test('groups four unavailable tools above the three working tools', () => {
    const itemsSource = profileSource.match(/const profileToolItems: ProfileToolItem\[\] = \[([\s\S]*?)\n\]/)?.[1] ?? ''
    const items = [...itemsSource.matchAll(/\{ key: '([^']+)'[^\n]+\}/g)].map((match) => ({
      key: match[1],
      disabled: /disabled: true/.test(match[0]),
    }))

    expect(items.map((item) => item.key)).toEqual([
      'favorite',
      'like',
      'archive',
      'checkin',
      'posts',
      'activity',
      'service',
    ])
    expect(items.filter((item) => item.disabled).map((item) => item.key)).toEqual([
      'favorite',
      'like',
      'archive',
      'checkin',
    ])
  })

  test('binds unavailable tools to the disabled visual and event guard', () => {
    expect(profileSource).toContain("'profile-tool--disabled': item.disabled")
    expect(profileSource).toContain(":aria-disabled=\"item.disabled ? 'true' : undefined\"")
    expect(profileSource).toContain('@tap="item.disabled ? undefined : handleProfileTool(item)"')
    expect(profileSource).toMatch(/\.profile-tool--disabled \.profile-tool-icon-image\s*\{[\s\S]*filter:\s*grayscale\(1\);[\s\S]*opacity:\s*0\.38;/)
    expect(profileSource).toMatch(/\.profile-tool--disabled \.profile-tool-label\s*\{[\s\S]*color:\s*#a8a8a8;/)
  })
})
