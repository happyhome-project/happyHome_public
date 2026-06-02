import { describe, expect, test } from 'vitest'
import { loadAdminPendingState } from '../profile-admin-tools'

describe('profile admin tools state loading', () => {
  test('returns next admin state atomically instead of requiring callers to clear current state first', async () => {
    const state = await loadAdminPendingState(
      [{ _id: 'c1' }, { _id: 'c2' }, { _id: 'c3' }],
      async (communityId) => {
        if (communityId === 'c2') throw new Error('not admin')
        return {
          members: communityId === 'c1'
            ? [{ _id: 'm1', userId: 'u1' }]
            : [],
        }
      },
    )

    expect(state.adminCommunityIds).toEqual(['c1', 'c3'])
    expect(state.pendingMembers).toEqual([{ _id: 'm1', userId: 'u1', communityId: 'c1' }])
  })
})
