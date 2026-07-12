import * as db from '../db'
import { handleApprove, handleReject } from '../../functions/community/index'
import { POST_RAG_OUTBOX, RAG_COMMUNITY_VERSIONS } from '../post-rag-outbox'

const local = db as typeof db & { _resetAll(): void }
beforeEach(() => local._resetAll())

test('reachable community approve and reject handlers atomically emit status projection facts', async () => {
  await db.create('users', { _id: 'super', role: 'superAdmin' })
  await db.create('communities', { _id: 'approve-me', status: 'pending' })
  await handleApprove({ communityId: 'approve-me' }, 'super')
  await expect(db.getById('communities', 'approve-me')).resolves.toMatchObject({ status: 'active' })
  await db.create('communities', { _id: 'reject-me', status: 'pending' })
  await handleReject({ communityId: 'reject-me' }, 'super')
  await expect(db.getById('communities', 'reject-me')).resolves.toMatchObject({ status: 'rejected' })
  const events = await db.query(POST_RAG_OUTBOX, {}, { limit: 10 })
  expect(events.map((event: any) => event.reasonCode)).toEqual(['community.status_changed', 'community.status_changed'])
})

test('community handler rolls status back when version/outbox append fails', async () => {
  await db.create('users', { _id: 'super', role: 'superAdmin' })
  await db.create('communities', { _id: 'rollback-community', status: 'pending' })
  const now = new Date().toISOString()
  await db.create(RAG_COMMUNITY_VERSIONS, { _id: 'rollback-community', communityId: 'rollback-community', contentVersion: -1, aclVersion: 0, createdAt: now, updatedAt: now })
  await expect(handleApprove({ communityId: 'rollback-community' }, 'super')).rejects.toThrow('contentVersion')
  await expect(db.getById('communities', 'rollback-community')).resolves.toMatchObject({ status: 'pending' })
})
