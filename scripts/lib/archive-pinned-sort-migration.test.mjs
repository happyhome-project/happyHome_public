import test from 'node:test'
import assert from 'node:assert/strict'

import { planArchivePinnedSortRepair } from './archive-pinned-sort-migration.mjs'
import { applyArchivePinnedSortRepair } from '../../release/migrations/20260825-archive-pinned-sort-v1.mjs'

test('planner repairs only stale active pinned archive posts', () => {
  const plan = planArchivePinnedSortRepair({
    posts: [
      {
        _id: 'stale-pinned',
        area: 'archive',
        status: 'active',
        isPinned: true,
        pinnedAt: '2026-08-25T14:44:06.283Z',
        createdAt: '2026-07-23T02:03:56.501Z',
        sortKey: '2026-07-23T02:03:56.501Z_stale-pinned',
      },
      {
        _id: 'correct-pinned',
        area: 'archive',
        status: 'active',
        isPinned: true,
        pinnedAt: '2026-08-24T10:00:00.000Z',
        createdAt: '2026-07-24T10:00:00.000Z',
        sortKey: 'PINNED_2026-08-24T10:00:00.000Z_correct-pinned',
      },
      {
        _id: 'normal',
        area: 'archive',
        status: 'active',
        isPinned: false,
        createdAt: '2026-07-25T10:00:00.000Z',
        sortKey: '2026-07-25T10:00:00.000Z_normal',
      },
      {
        _id: 'deleted-pinned',
        area: 'archive',
        status: 'deleted',
        isPinned: true,
        pinnedAt: '2026-08-25T11:00:00.000Z',
        createdAt: '2026-07-25T11:00:00.000Z',
        sortKey: '2026-07-25T11:00:00.000Z_deleted-pinned',
      },
      {
        _id: 'section-pinned',
        sectionId: 'section-1',
        status: 'active',
        isPinned: true,
        pinnedAt: '2026-08-25T12:00:00.000Z',
        createdAt: '2026-07-25T12:00:00.000Z',
      },
    ],
  })

  assert.deepEqual(plan.updates, [{
    postId: 'stale-pinned',
    expectedPinnedAt: '2026-08-25T14:44:06.283Z',
    sortKey: 'PINNED_2026-08-25T14:44:06.283Z_stale-pinned',
  }])
  assert.deepEqual(plan.summary, { scanned: 5, eligible: 2, updates: 1, skippedInvalid: 0 })
})

test('planner is idempotent after its updates are applied', () => {
  const post = {
    _id: 'post-1',
    area: 'archive',
    status: 'active',
    isPinned: true,
    pinnedAt: '2026-08-25T14:44:06.283Z',
    createdAt: '2026-07-23T02:03:56.501Z',
    sortKey: '2026-07-23T02:03:56.501Z_post-1',
  }
  const first = planArchivePinnedSortRepair({ posts: [post] })
  const repaired = { ...post, sortKey: first.updates[0].sortKey }

  const residual = planArchivePinnedSortRepair({ posts: [repaired] })

  assert.deepEqual(residual.updates, [])
  assert.deepEqual(residual.summary, { scanned: 1, eligible: 1, updates: 0, skippedInvalid: 0 })
})

test('planner reports malformed pinned archive rows without inventing an ordering key', () => {
  const plan = planArchivePinnedSortRepair({
    posts: [
      { _id: '', area: 'archive', status: 'active', isPinned: true, pinnedAt: '2026-08-25T14:44:06.283Z' },
      { _id: 'missing-time', area: 'archive', status: 'active', isPinned: true, pinnedAt: '' },
    ],
  })

  assert.deepEqual(plan.updates, [])
  assert.deepEqual(plan.summary, { scanned: 2, eligible: 2, updates: 0, skippedInvalid: 2 })
})

function createDatabase(posts, { beforeTransaction } = {}) {
  const collection = (name) => {
    assert.equal(name, 'posts')
    let afterId = ''
    let pageLimit = 100
    const query = {
      where(condition) {
        afterId = String(condition?._id?.$gt || '')
        return query
      },
      orderBy(field, direction) {
        assert.equal(field, '_id')
        assert.equal(direction, 'asc')
        return query
      },
      limit(value) {
        pageLimit = value
        return query
      },
      async get() {
        return { data: posts.filter((post) => post._id > afterId).slice(0, pageLimit).map((post) => ({ ...post })) }
      },
      doc(id) {
        return {
          async get() {
            const post = posts.find((item) => item._id === id)
            return { data: post ? { ...post } : null }
          },
          async update(payload) {
            const post = posts.find((item) => item._id === id)
            assert.ok(post)
            Object.assign(post, payload?.data || payload)
          },
        }
      },
    }
    return query
  }
  return {
    command: { gt: (value) => ({ $gt: value }) },
    collection,
    async runTransaction(callback) {
      await beforeTransaction?.(posts)
      return callback({ collection })
    },
  }
}

test('release migration applies the repair and verifies an empty residual plan', async () => {
  const posts = [{
    _id: 'post-1',
    area: 'archive',
    status: 'active',
    isPinned: true,
    pinnedAt: '2026-08-25T14:44:06.283Z',
    createdAt: '2026-07-23T02:03:56.501Z',
    sortKey: '2026-07-23T02:03:56.501Z_post-1',
  }]
  const database = createDatabase(posts)

  const result = await applyArchivePinnedSortRepair(database)

  assert.equal(posts[0].sortKey, 'PINNED_2026-08-25T14:44:06.283Z_post-1')
  assert.deepEqual(result, {
    scanned: 1,
    eligible: 1,
    updates: 1,
    skippedInvalid: 0,
    applied: 1,
    residual: { scanned: 1, eligible: 1, updates: 0, skippedInvalid: 0 },
  })
})

test('release migration does not restore a pinned key after a concurrent unpin', async () => {
  const posts = [{
    _id: 'post-1',
    area: 'archive',
    status: 'active',
    isPinned: true,
    pinnedAt: '2026-08-25T14:44:06.283Z',
    createdAt: '2026-07-23T02:03:56.501Z',
    sortKey: '2026-07-23T02:03:56.501Z_post-1',
  }]
  let changed = false
  const database = createDatabase(posts, {
    beforeTransaction: (rows) => {
      if (changed) return
      changed = true
      Object.assign(rows[0], {
        isPinned: false,
        pinnedAt: '',
        sortKey: '2026-07-23T02:03:56.501Z_post-1',
      })
    },
  })

  const result = await applyArchivePinnedSortRepair(database)

  assert.equal(posts[0].isPinned, false)
  assert.equal(posts[0].sortKey, '2026-07-23T02:03:56.501Z_post-1')
  assert.equal(result.applied, 0)
  assert.equal(result.residual.updates, 0)
})
