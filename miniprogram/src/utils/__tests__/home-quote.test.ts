import { describe, expect, test } from 'vitest'

import { formatHomeQuoteCite } from '../home-quote'

describe('home quote display helpers', () => {
  test('wraps a plain source title with Chinese book marks', () => {
    expect(formatHomeQuoteCite('菜根谭')).toBe('《菜根谭》')
  })

  test('does not double wrap a source that already contains book marks', () => {
    expect(formatHomeQuoteCite('《竹石》-郑板桥(清)')).toBe('《竹石》-郑板桥(清)')
  })

  test('returns empty string for missing source', () => {
    expect(formatHomeQuoteCite('')).toBe('')
  })
})
