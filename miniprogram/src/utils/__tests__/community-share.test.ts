import { describe, expect, test } from 'vitest'
import {
  buildCommunityOnboardingPath,
  buildCommunitySharePath,
  buildCommunityShareImageKey,
  buildCommunityShareTitle,
  consumePendingShareCommunity,
  PENDING_SHARE_COMMUNITY_TTL_MS,
  prioritizeShareTargetCommunities,
  readPendingShareCommunity,
  savePendingShareCommunity,
  selectPreparedCommunityShareImage,
} from '../community-share'

function createStorage() {
  const values = new Map<string, unknown>()
  return {
    getStorageSync: (key: string) => values.get(key),
    setStorageSync: (key: string, value: unknown) => values.set(key, value),
    removeStorageSync: (key: string) => values.delete(key),
    has: (key: string) => values.has(key),
  }
}

describe('community share helpers', () => {
  test('builds encoded share and onboarding paths', () => {
    expect(buildCommunitySharePath('community/明士班')).toBe(
      '/pages/index/index?communityId=community%2F%E6%98%8E%E5%A3%AB%E7%8F%AD&fromShare=community',
    )
    expect(buildCommunityOnboardingPath('community/明士班')).toBe(
      '/pages/onboarding/index?mode=discover&communityId=community%2F%E6%98%8E%E5%A3%AB%E7%8F%AD&fromShare=community',
    )
  })

  test('formats the native share title from current community name', () => {
    expect(buildCommunityShareTitle('明士班')).toBe('邀请你加入「明士班」')
    expect(buildCommunityShareTitle('')).toBe('邀请你加入「社群助手」')
  })

  test('keys prepared share images by the complete community identity', () => {
    expect(buildCommunityShareImageKey({ id: ' c1 ', name: ' 明士班 ', coverImage: ' cloud://cover ' }))
      .toBe('v1|c1|明士班|cloud://cover')
  })

  test('never reuses a prepared image from another community state', () => {
    expect(selectPreparedCommunityShareImage('v1|c1|明士班|', {
      key: 'v1|c2|青山|',
      imageUrl: '/tmp/old.png',
    })).toBe('')
    expect(selectPreparedCommunityShareImage('v1|c1|明士班|', {
      key: 'v1|c1|明士班|',
      imageUrl: '/tmp/current.png',
    })).toBe('/tmp/current.png')
  })

  test('stores a pending share intent for 30 minutes and consumes it once', () => {
    const storage = createStorage()
    savePendingShareCommunity('c1', 1000, storage)

    expect(readPendingShareCommunity(1000 + PENDING_SHARE_COMMUNITY_TTL_MS - 1, storage)).toEqual({
      communityId: 'c1',
      createdAt: 1000,
    })
    expect(consumePendingShareCommunity(1000 + PENDING_SHARE_COMMUNITY_TTL_MS - 1, storage)).toBe('c1')
    expect(readPendingShareCommunity(1000 + PENDING_SHARE_COMMUNITY_TTL_MS - 1, storage)).toBeNull()
  })

  test('drops expired or invalid pending share intents', () => {
    const storage = createStorage()
    savePendingShareCommunity('c2', 1000, storage)

    expect(readPendingShareCommunity(1000 + PENDING_SHARE_COMMUNITY_TTL_MS + 1, storage)).toBeNull()
    expect(storage.has('pending_share_community_v1')).toBe(false)

    storage.setStorageSync('pending_share_community_v1', { communityId: '', createdAt: 2000 })
    expect(readPendingShareCommunity(2000, storage)).toBeNull()
  })

  test('places the target community first without mutating the original list', () => {
    const communities = [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }]
    const prioritized = prioritizeShareTargetCommunities(communities, 'b')

    expect(prioritized.map((item) => item._id)).toEqual(['b', 'a', 'c'])
    expect(communities.map((item) => item._id)).toEqual(['a', 'b', 'c'])
  })
})
