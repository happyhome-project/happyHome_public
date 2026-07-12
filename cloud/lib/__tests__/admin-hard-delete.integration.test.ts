import * as db from '../db'
import { POST_RAG_JOBS } from '../post-rag'
import { POST_RAG_OUTBOX } from '../post-rag-outbox'
import { MEMBER_STATE_COLLECTION } from '../membership-state'

const local = db as typeof db & { _resetAll(): void }
const TOKEN = 'hard-delete-integration-token'
const CHILD_COLLECTIONS = [
  'posts',
  'post_attendance_members',
  'sections',
  'community_members',
  MEMBER_STATE_COLLECTION,
  'community_create_requests',
] as const

beforeEach(() => {
  local._resetAll()
  process.env.ADMIN_INTERNAL_CALL_TOKEN = TOKEN
})

async function seedCommunity(childCount: number) {
  await db.setById('communities', 'community-1', { status: 'disabled' })
  for (const collectionName of CHILD_COLLECTIONS) {
    for (let index = 0; index < childCount; index += 1) {
      const id = `${collectionName}-${String(index).padStart(3, '0')}`
      await db.setById(collectionName, id, {
        communityId: 'community-1',
        ...(collectionName === 'posts' ? { sectionId: 'section-000', content: {} } : {}),
      })
    }
  }
}

function adminEvent() {
  return {
    action: 'community.hardDelete',
    communityId: 'community-1',
    _actAs: { accountId: 'admin-1', role: 'superAdmin', userId: 'admin-user', username: 'admin' },
    _internalToken: TOKEN,
  }
}

test('hard delete drains more than 100 rows from every child collection before deleting the community', async () => {
  await seedCommunity(101)
  const originalQuery = db.query
  jest.spyOn(db, 'query').mockImplementation(async (...args: Parameters<typeof db.query>) => {
    const rows = await originalQuery(...args)
    return rows.slice(0, 100)
  })
  const originalQueryAfterId = db.queryAfterId
  let insertedBehindCursor = false
  jest.spyOn(db, 'queryAfterId').mockImplementation(async (...args: Parameters<typeof db.queryAfterId>) => {
    const rows = await originalQueryAfterId(...args)
    if (!insertedBehindCursor && args[0] === 'sections' && args[2] === null) {
      insertedBehindCursor = true
      await db.setById('sections', 'aaa-late-section', { communityId: 'community-1' })
    }
    return rows
  })
  const { main } = await import('../../functions/admin/index')

  await main(adminEvent())

  for (const collectionName of CHILD_COLLECTIONS) {
    await expect(originalQuery(collectionName, { communityId: 'community-1' })).resolves.toHaveLength(0)
  }
  await expect(db.getById('communities', 'community-1')).rejects.toThrow('not found')
  await expect(originalQuery(POST_RAG_OUTBOX, { communityId: 'community-1' })).resolves.toHaveLength(101)
  await expect(originalQuery(POST_RAG_JOBS, { communityId: 'community-1', action: 'delete' })).resolves.toHaveLength(101)
})

test('hard delete keeps the community on an intermediate failure and retry completes without duplicate post facts', async () => {
  await seedCommunity(3)
  const originalRemove = db.removeById
  let failed = false
  jest.spyOn(db, 'removeById').mockImplementation(async (collectionName, id) => {
    if (!failed && collectionName === 'sections') {
      failed = true
      throw new Error('injected section delete failure')
    }
    return originalRemove(collectionName, id)
  })
  const { main } = await import('../../functions/admin/index')

  await expect(main(adminEvent())).rejects.toThrow('injected section delete failure')
  await expect(db.getById('communities', 'community-1')).resolves.toMatchObject({ status: 'disabled' })
  await expect(main(adminEvent())).resolves.toEqual({ success: true })

  await expect(db.getById('communities', 'community-1')).rejects.toThrow('not found')
  await expect(db.query(POST_RAG_OUTBOX, { communityId: 'community-1' })).resolves.toHaveLength(3)
  await expect(db.query(POST_RAG_JOBS, { communityId: 'community-1', action: 'delete' })).resolves.toHaveLength(3)
})
