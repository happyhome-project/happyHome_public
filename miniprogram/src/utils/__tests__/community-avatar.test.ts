import { describe, expect, it } from 'vitest'

import {
  COMMUNITY_AVATAR_BACKGROUND,
  COMMUNITY_AVATAR_FONT_WEIGHT,
  COMMUNITY_AVATAR_FOREGROUND,
  communityInitial,
} from '../community-avatar'

describe('community avatar', () => {
  it('exports the shared avatar presentation constants', () => {
    expect(COMMUNITY_AVATAR_BACKGROUND).toBe('#E8F8F0')
    expect(COMMUNITY_AVATAR_FOREGROUND).toBe('#1F7A50')
    expect(COMMUNITY_AVATAR_FONT_WEIGHT).toBe(600)
  })

  it.each([
    ['明士班', '明'],
    ['  Alpha', 'A'],
    ['', '群'],
    ['   ', '群'],
  ])('returns the first grapheme from %j', (value, expected) => {
    expect(communityInitial(value)).toBe(expected)
  })

  it.each([
    ['👨‍👩‍👧‍👦家庭', '👨‍👩‍👧‍👦'],
    ['👍🏽认可', '👍🏽'],
    ['e\u0301lan', 'e\u0301'],
  ])('keeps %j intact with the fallback segmenter', (value, expected) => {
    expect(communityInitial(value, { segmenter: null })).toBe(expected)
  })
})
