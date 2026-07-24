import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const read = (...parts: string[]) => readFileSync(join(process.cwd(), 'src', ...parts), 'utf8')

function relativeLuminance(hex: string): number {
  const channels = hex
    .replace('#', '')
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (
      channel <= 0.03928
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4
    )) || []

  return (channels[0] || 0) * 0.2126
    + (channels[1] || 0) * 0.7152
    + (channels[2] || 0) * 0.0722
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first)
  const secondLuminance = relativeLuminance(second)
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05)
}

describe('text-note detail readability', () => {
  test('uses readable slate body text on the light botanical paper', () => {
    const cover = read('components', 'TextNoteCover.vue')
    const slateBodyColor = cover.match(
      /\.text-note-cover-frame--body\.text-note-cover--slate\s*\{\s*color:\s*(#[0-9a-f]{6});/i,
    )?.[1]

    expect(slateBodyColor).toBeTruthy()
    expect(contrastRatio(slateBodyColor || '#ffffff', '#f8f7ee')).toBeGreaterThanOrEqual(4.5)
  })
})
