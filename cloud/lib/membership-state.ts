import crypto from 'crypto'

export const MEMBER_STATE_COLLECTION = 'community_member_states'

export type MembershipStateStatus = 'active' | 'pending' | 'rejected' | 'none'

/**
 * A stable, opaque document id is the serialization point for one user in one
 * community. It keeps OpenID out of a database document id while allowing a
 * transaction to address the state with `doc()` instead of a non-transactional
 * `where()` query.
 */
export function membershipStateId(communityId: string, userId: string) {
  return crypto.createHash('sha256')
    .update(`${communityId}\n${userId}`)
    .digest('hex')
}
