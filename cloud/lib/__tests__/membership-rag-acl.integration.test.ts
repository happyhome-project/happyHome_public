import * as db from '../db'
import { approveMembership, kickMembership, leaveMembership } from '../membership-transitions'
import { POST_RAG_OUTBOX, RAG_COMMUNITY_VERSIONS } from '../post-rag-outbox'

const local = db as typeof db & { _resetAll(): void }

beforeEach(() => local._resetAll())

async function seedMember(communityId: string, memberId: string, userId: string, status: 'pending' | 'active') {
  await db.create('communities', { _id: communityId, creatorId: 'owner', memberCount: status === 'active' ? 1 : 0 })
  await db.create('community_members', { _id: memberId, communityId, userId, role: 'member', status })
}

test('approve, kick and leave commit ACL invalidation facts with their membership writes', async () => {
  await seedMember('community-1', 'member-1', 'user-1', 'pending')
  await approveMembership({ communityId: 'community-1', memberId: 'member-1' })
  await expect(db.getById('community_members', 'member-1')).resolves.toMatchObject({ status: 'active' })
  await expect(db.getById(RAG_COMMUNITY_VERSIONS, 'community-1')).resolves.toMatchObject({ aclVersion: 1 })

  await kickMembership({ communityId: 'community-1', memberId: 'member-1' })
  await expect(db.getById(RAG_COMMUNITY_VERSIONS, 'community-1')).resolves.toMatchObject({ aclVersion: 2 })

  await seedMember('community-2', 'member-2', 'user-2', 'active')
  await leaveMembership({ communityId: 'community-2', memberId: 'member-2', userId: 'user-2' })
  await expect(db.getById(RAG_COMMUNITY_VERSIONS, 'community-2')).resolves.toMatchObject({ aclVersion: 1 })
  const events = await db.query(POST_RAG_OUTBOX, {}, { limit: 20 })
  expect(events).toHaveLength(3)
  expect(events.every((event: any) => event.eventType === 'acl.invalidate')).toBe(true)
})

test('outbox/version failure rolls an approval business write back', async () => {
  await seedMember('community-bad', 'member-bad', 'user-bad', 'pending')
  await db.create(RAG_COMMUNITY_VERSIONS, { _id: 'community-bad', communityId: 'community-bad', contentVersion: -1, aclVersion: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
  await expect(approveMembership({ communityId: 'community-bad', memberId: 'member-bad' })).rejects.toThrow('contentVersion')
  await expect(db.getById('community_members', 'member-bad')).resolves.toMatchObject({ status: 'pending' })
})
