import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyArchiveLegacyProjectionRepair,
  planArchiveLegacyProjectionRepair,
} from './archive-legacy-projection-node-sdk.mjs'

function fakeDatabase(seed, hooks = {}) {
  const collections = new Map(Object.entries(seed).map(([name, rows]) => [name, new Map(rows.map((row) => [row._id, structuredClone(row)]))]))
  const queryEvents = []
  const database = {
    command: {
      gt(value) { return { __operator: 'gt', value } },
      remove() { return { __operator: 'remove' } },
    },
    async runTransaction(callback) { return callback(database) },
    collection(name) {
      const rows = collections.get(name) || new Map()
      collections.set(name, rows)
      const query = (where = {}, limit = 100, orderField = '') => ({
        where(nextWhere) { return query(nextWhere, limit, orderField) },
        orderBy(nextField, direction) {
          queryEvents.push({ name, field: nextField, direction })
          return query(where, limit, nextField)
        },
        limit(nextLimit) { return query(where, nextLimit, orderField) },
        async get() {
          return {
            data: [...rows.values()]
              .filter((row) => Object.entries(where).every(([key, value]) => (
                value?.__operator === 'gt' ? String(row[key]) > String(value.value) : row[key] === value
              )))
              .sort((left, right) => orderField ? String(left[orderField]).localeCompare(String(right[orderField])) : 0)
              .slice(0, limit)
              .map((row) => structuredClone(row)),
          }
        },
      })
      return {
        ...query(),
        doc(id) {
          return {
            async get() { return { data: rows.has(id) ? [structuredClone(rows.get(id))] : [] } },
            async update(payload) {
              const next = { ...rows.get(id) }
              for (const [key, value] of Object.entries(structuredClone(payload))) {
                if (value?.__operator === 'remove') delete next[key]
                else next[key] = value
              }
              rows.set(id, next)
              await hooks.onUpdate?.({ name, id, payload: structuredClone(payload), collections })
            },
          }
        },
      }
    },
  }
  return { database, collections, queryEvents }
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

test('transaction compare-and-set rejects a section schema changed after dry-run', async () => {
  const { database, collections } = fakeDatabase({ sections: [guideSection], posts: [legacyPost('post-section-race')] })
  const plan = await planArchiveLegacyProjectionRepair(database)
  collections.get('sections').get(guideSection._id).widgets[0].fieldKey = 'renamed-title'

  await assert.rejects(
    () => applyArchiveLegacyProjectionRepair(database, plan),
    /section schema changed after archive legacy projection dry-run/i,
  )
})

test('rolls back earlier posts when a section schema changes midway through the batch', async () => {
  let changed = false
  const first = legacyPost('post-a')
  const second = legacyPost('post-b')
  const { database, collections } = fakeDatabase(
    { sections: [guideSection], posts: [first, second] },
    {
      onUpdate({ name, id, collections: current }) {
        if (!changed && name === 'posts' && id === first._id) {
          changed = true
          current.get('sections').get(guideSection._id).widgets[0].fieldKey = 'renamed-title'
        }
      },
    },
  )
  const plan = await planArchiveLegacyProjectionRepair(database)

  await assert.rejects(
    () => applyArchiveLegacyProjectionRepair(database, plan),
    /section schema changed after archive legacy projection dry-run/i,
  )
  assert.deepEqual(collections.get('posts').get(first._id), first)
  assert.deepEqual(collections.get('posts').get(second._id), second)
})

test('uses ordered id cursor pagination instead of offset pagination', async () => {
  const { database, queryEvents } = fakeDatabase({
    sections: [guideSection],
    posts: Array.from({ length: 101 }, (_, index) => legacyPost(`post-${String(index).padStart(3, '0')}`)),
  })
  const plan = await planArchiveLegacyProjectionRepair(database)

  assert.equal(plan.summary.changedPostCount, 101)
  assert.ok(queryEvents.length >= 3)
  assert.ok(queryEvents.every(({ field, direction }) => field === '_id' && direction === 'asc'))
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
