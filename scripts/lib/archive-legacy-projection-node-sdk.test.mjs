import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyArchiveLegacyProjectionRepair,
  planArchiveLegacyProjectionRepair,
} from './archive-legacy-projection-node-sdk.mjs'

function fakeDatabase(seed) {
  const collections = new Map(Object.entries(seed).map(([name, rows]) => [name, new Map(rows.map((row) => [row._id, structuredClone(row)]))]))
  const database = {
    async runTransaction(callback) { return callback(database) },
    collection(name) {
      const rows = collections.get(name) || new Map()
      collections.set(name, rows)
      const query = (where = {}, offset = 0, limit = 100) => ({
        where(nextWhere) { return query(nextWhere, offset, limit) },
        skip(nextOffset) { return query(where, nextOffset, limit) },
        limit(nextLimit) { return query(where, offset, nextLimit) },
        async get() {
          return {
            data: [...rows.values()]
              .filter((row) => Object.entries(where).every(([key, value]) => row[key] === value))
              .slice(offset, offset + limit)
              .map((row) => structuredClone(row)),
          }
        },
      })
      return {
        ...query(),
        doc(id) {
          return {
            async get() { return { data: rows.has(id) ? [structuredClone(rows.get(id))] : [] } },
            async update(payload) { rows.set(id, { ...rows.get(id), ...structuredClone(payload) }) },
          }
        },
      }
    },
  }
  return { database, collections }
}

const guideSection = {
  _id: 'section-guide',
  communityId: 'community-1',
  type: 'evergreen',
  widgets: [
    { widgetId: 'guide_title', fieldKey: 'title' },
    { widgetId: 'guide_images', fieldKey: 'images' },
    { widgetId: 'guide_body', fieldKey: 'body' },
  ],
}

function legacyPost(id, overrides = {}) {
  return {
    _id: id,
    communityId: 'community-1',
    sectionId: guideSection._id,
    area: 'archive',
    origin: 'legacy_section',
    content: { guide_title: `标题${id}`, guide_images: [`cloud://${id}`], guide_body: { text: id } },
    ...overrides,
  }
}

test('plans every paginated legacy post and applies an idempotent display projection', async () => {
  const posts = Array.from({ length: 101 }, (_, index) => legacyPost(`post-${String(index).padStart(3, '0')}`))
  const { database, collections } = fakeDatabase({ sections: [guideSection], posts })

  const plan = await planArchiveLegacyProjectionRepair(database)

  assert.equal(plan.summary.candidatePostCount, 101)
  assert.equal(plan.summary.changedPostCount, 101)
  assert.equal(plan.summary.emptyTitleCount, 0)
  assert.match(plan.summary.planDigest, /^[a-f0-9]{64}$/)
  assert.equal(plan.backup.posts.length, 101)

  const result = await applyArchiveLegacyProjectionRepair(database, plan)
  const repaired = collections.get('posts').get('post-000')

  assert.equal(result.verifiedPostCount, 101)
  assert.equal(repaired.format, 'image_text')
  assert.equal(repaired.content.title, '标题post-000')
  assert.equal(repaired.content.guide_title, '标题post-000')
  assert.equal((await planArchiveLegacyProjectionRepair(database)).summary.changedPostCount, 0)
})

test('plan digest binds document identity even when counts are equal', async () => {
  const first = fakeDatabase({ sections: [guideSection], posts: [legacyPost('post-a')] })
  const second = fakeDatabase({ sections: [guideSection], posts: [legacyPost('post-b')] })

  const firstPlan = await planArchiveLegacyProjectionRepair(first.database)
  const secondPlan = await planArchiveLegacyProjectionRepair(second.database)

  assert.notEqual(firstPlan.summary.planDigest, secondPlan.summary.planDigest)
})

test('transaction compare-and-set rejects a post changed after dry-run', async () => {
  const { database, collections } = fakeDatabase({ sections: [guideSection], posts: [legacyPost('post-race')] })
  const plan = await planArchiveLegacyProjectionRepair(database)
  collections.get('posts').get('post-race').content.guide_title = '并发修改'

  await assert.rejects(
    () => applyArchiveLegacyProjectionRepair(database, plan),
    /changed after archive legacy projection dry-run/i,
  )
})

test('skips realtime, native archive, and missing-section records', async () => {
  const { database } = fakeDatabase({
    sections: [{ ...guideSection, type: 'realtime' }],
    posts: [legacyPost('post-live'), legacyPost('post-native', { origin: 'native' }), legacyPost('post-missing', { sectionId: 'missing' })],
  })

  const plan = await planArchiveLegacyProjectionRepair(database)

  assert.equal(plan.summary.candidatePostCount, 3)
  assert.equal(plan.summary.changedPostCount, 0)
  assert.equal(plan.summary.skippedPostCount, 3)
})
