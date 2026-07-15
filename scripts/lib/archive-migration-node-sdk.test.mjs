import assert from 'node:assert/strict'
import test from 'node:test'

import { createArchiveMigrationNodeSdkDeps } from './archive-migration-node-sdk.mjs'
import { applyArchiveMigrationRepair, planArchiveMigrationRepair } from './archive-migration-repair.mjs'
import { planArchiveMigration } from './archive-migration.mjs'

function fakeDatabase() {
  const writes = []
  const removeToken = { operator: 'remove' }
  return {
    writes,
    removeToken,
    database: {
      command: { remove: () => removeToken },
      collection(collection) {
        return {
          doc(id) {
            return {
              async set(payload) { writes.push({ operation: 'set', collection, id, payload }) },
              async update(payload) { writes.push({ operation: 'update', collection, id, payload }) },
            }
          },
        }
      },
    },
  }
}

test('Node SDK adapter writes migration payloads without a nested data wrapper', async () => {
  const { database, writes } = fakeDatabase()
  const deps = createArchiveMigrationNodeSdkDeps(database)

  await deps.set('archive_topics', 'topic-1', { communityId: 'community-1' })
  await deps.update('posts', 'post-1', { area: 'archive' })

  assert.deepEqual(writes, [
    { operation: 'set', collection: 'archive_topics', id: 'topic-1', payload: { communityId: 'community-1' } },
    { operation: 'update', collection: 'posts', id: 'post-1', payload: { area: 'archive' } },
  ])
})

test('repair adapter lifts the payload and removes the malformed data wrapper', async () => {
  const { database, writes, removeToken } = fakeDatabase()
  const deps = createArchiveMigrationNodeSdkDeps(database, { removeMalformedWrapper: true })

  await deps.update('posts', 'post-1', { area: 'archive', topics: ['亲子出游'] })

  assert.deepEqual(writes[0].payload, {
    area: 'archive',
    topics: ['亲子出游'],
    data: removeToken,
  })
})

function repairDatabase(seed) {
  const removeToken = { operator: 'remove' }
  const collections = new Map(Object.entries(seed).map(([name, rows]) => [name, new Map(rows.map((row) => [row._id, structuredClone(row)]))]))
  const database = {
    command: { remove: () => removeToken },
    async runTransaction(callback) { return callback(database) },
    collection(name) {
      const rows = collections.get(name) || new Map()
      collections.set(name, rows)
      const query = (where = {}, offset = 0, limit = 100) => ({
        where(nextWhere) { return query(nextWhere, offset, limit) },
        skip(nextOffset) { return query(where, nextOffset, limit) },
        limit(nextLimit) { return query(where, offset, nextLimit) },
        async get() {
          return { data: [...rows.values()].filter((row) => Object.entries(where).every(([key, value]) => row[key] === value)).slice(offset, offset + limit).map((row) => structuredClone(row)) }
        },
      })
      return {
        ...query(),
        doc(id) {
          return {
            async get() { return { data: rows.has(id) ? [structuredClone(rows.get(id))] : [] } },
            async set(payload) { rows.set(id, { _id: id, ...structuredClone(payload) }) },
            async update(payload) {
              const row = { ...(rows.get(id) || { _id: id }) }
              for (const [key, value] of Object.entries(payload)) {
                if (value === removeToken) delete row[key]
                else row[key] = structuredClone(value)
              }
              rows.set(id, row)
            },
          }
        },
      }
    },
  }
  return { database, collections }
}

test('repair plan snapshots only deterministic malformed v1 records before lifting them', async () => {
  const community = { _id: 'community-1' }
  const section = { _id: 'section-1', communityId: community._id, name: '亲子出游', type: 'evergreen', order: 1 }
  const post = { _id: 'post-1', communityId: community._id, sectionId: section._id, createdAt: '2026-07-14T00:00:00.000Z' }
  const expected = planArchiveMigration({ communityId: community._id, sections: [section], posts: [post] })
  const topic = expected.topicUpserts[0]
  const link = expected.topicLinks[0]
  const { database, collections } = repairDatabase({
    communities: [],
    sections: [],
    posts: [{ ...post, status: 'inactive', auditStatus: 'reject', data: expected.postUpdates[0].data }],
    archive_topics: [{ _id: topic._id, data: Object.fromEntries(Object.entries(topic).filter(([key]) => key !== '_id')) }],
    archive_post_topics: [{ _id: link._id, data: Object.fromEntries(Object.entries(link).filter(([key]) => key !== '_id')) }],
  })

  const repair = await planArchiveMigrationRepair(database)

  assert.equal(repair.summary.malformedTopicCount, 1)
  assert.equal(repair.summary.malformedPostCount, 1)
  assert.equal(repair.summary.malformedLinkCount, 1)
  assert.equal(repair.backup.archiveTopics.length, 1)
  assert.equal(repair.backup.posts.length, 1)
  assert.equal(repair.backup.archivePostTopics.length, 1)

  await applyArchiveMigrationRepair(database, repair)

  assert.equal(Object.hasOwn(collections.get('archive_topics').get(topic._id), 'data'), false)
  assert.equal(Object.hasOwn(collections.get('posts').get(post._id), 'data'), false)
  assert.equal(Object.hasOwn(collections.get('archive_post_topics').get(link._id), 'data'), false)
  assert.equal(collections.get('posts').get(post._id).area, 'archive')
  assert.equal(collections.get('posts').get(post._id).status, 'inactive')
  assert.equal(collections.get('posts').get(post._id).auditStatus, 'reject')
  assert.equal(collections.get('archive_post_topics').get(link._id).status, 'inactive')
  assert.equal(collections.get('archive_post_topics').get(link._id).auditStatus, 'reject')

  const second = await planArchiveMigrationRepair(database)
  assert.equal(second.summary.malformedTopicCount, 0)
  assert.equal(second.summary.malformedPostCount, 0)
  assert.equal(second.summary.malformedLinkCount, 0)
})

test('repair lifts administrator topic fields from the authenticated v1 wrapper', async () => {
  const community = { _id: 'community-1' }
  const section = { _id: 'section-1', communityId: community._id, name: '亲子出游', type: 'evergreen', order: 1 }
  const post = { _id: 'post-1', communityId: community._id, sectionId: section._id, createdAt: '2026-07-14T00:00:00.000Z' }
  const expected = planArchiveMigration({ communityId: community._id, sections: [section], posts: [post] })
  const topic = expected.topicUpserts[0]
  const { database, collections } = repairDatabase({
    communities: [community],
    sections: [section],
    posts: [post],
    archive_topics: [{
      _id: topic._id,
      data: {
        ...Object.fromEntries(Object.entries(topic).filter(([key]) => key !== '_id')),
        displayName: '管理员标题',
        origins: ['admin', 'legacy'],
        enabled: false,
        adminOrder: 3,
      },
    }],
    archive_post_topics: [],
  })

  const repair = await planArchiveMigrationRepair(database)
  await applyArchiveMigrationRepair(database, repair)
  const repaired = collections.get('archive_topics').get(topic._id)
  assert.equal(repaired.displayName, '管理员标题')
  assert.deepEqual(repaired.origins, ['admin', 'legacy'])
  assert.equal(repaired.enabled, false)
  assert.equal(repaired.adminOrder, 3)
})

test('transaction CAS rejects a record changed after the reviewed plan', async () => {
  const community = { _id: 'community-1' }
  const section = { _id: 'section-1', communityId: community._id, name: '亲子出游', type: 'evergreen', order: 1 }
  const expected = planArchiveMigration({ communityId: community._id, sections: [section], posts: [] })
  const topic = expected.topicUpserts[0]
  const { database, collections } = repairDatabase({
    communities: [],
    sections: [],
    posts: [],
    archive_topics: [{ _id: topic._id, data: Object.fromEntries(Object.entries(topic).filter(([key]) => key !== '_id')) }],
    archive_post_topics: [],
  })
  const repair = await planArchiveMigrationRepair(database)
  collections.get('archive_topics').get(topic._id).data.displayName = '并发修改'

  await assert.rejects(() => applyArchiveMigrationRepair(database, repair), /changed after archive repair dry-run/i)
})

test('plan digest changes when an equal-count repair targets a different identity', async () => {
  const makeRepair = async (communityId, sectionId, name) => {
    const section = { _id: sectionId, communityId, name, type: 'evergreen', order: 1 }
    const topic = planArchiveMigration({ communityId, sections: [section], posts: [] }).topicUpserts[0]
    const { database } = repairDatabase({
      communities: [],
      sections: [],
      posts: [],
      archive_topics: [{ _id: topic._id, data: Object.fromEntries(Object.entries(topic).filter(([key]) => key !== '_id')) }],
      archive_post_topics: [],
    })
    return planArchiveMigrationRepair(database)
  }
  const first = await makeRepair('community-1', 'section-1', '亲子出游')
  const second = await makeRepair('community-2', 'section-2', '闲置交易')

  assert.equal(first.summary.malformedTopicCount, second.summary.malformedTopicCount)
  assert.notEqual(first.summary.planDigest, second.summary.planDigest)
})

test('repair rejects deterministic wrappers with non-number v1 numeric fields', async () => {
  const communityId = 'community-1'
  const section = { _id: 'section-1', communityId, name: '亲子出游', type: 'evergreen', order: 1 }
  const topic = planArchiveMigration({ communityId, sections: [section], posts: [] }).topicUpserts[0]
  const data = { ...Object.fromEntries(Object.entries(topic).filter(([key]) => key !== '_id')), legacyOrder: null }
  const { database } = repairDatabase({
    communities: [],
    sections: [],
    posts: [],
    archive_topics: [{ _id: topic._id, data }],
    archive_post_topics: [],
  })

  await assert.rejects(() => planArchiveMigrationRepair(database), /drifted malformed archive migration records/i)
})

test('repair resumes after a partial run repaired the post before its links', async () => {
  const community = { _id: 'community-1' }
  const section = { _id: 'section-1', communityId: community._id, name: '亲子出游', type: 'evergreen', order: 1 }
  const post = { _id: 'post-1', communityId: community._id, sectionId: section._id, createdAt: '2026-07-14T00:00:00.000Z' }
  const expected = planArchiveMigration({ communityId: community._id, sections: [section], posts: [post] })
  const topic = expected.topicUpserts[0]
  const link = expected.topicLinks[0]
  const { database, collections } = repairDatabase({
    communities: [],
    sections: [],
    posts: [{ ...post, data: expected.postUpdates[0].data }],
    archive_topics: [{ _id: topic._id, data: Object.fromEntries(Object.entries(topic).filter(([key]) => key !== '_id')) }],
    archive_post_topics: [{ _id: link._id, data: Object.fromEntries(Object.entries(link).filter(([key]) => key !== '_id')) }],
  })
  const originalRunTransaction = database.runTransaction.bind(database)
  let transactionCount = 0
  database.runTransaction = async (callback) => {
    transactionCount += 1
    if (transactionCount === 3) throw new Error('injected link write failure')
    return originalRunTransaction(callback)
  }
  const first = await planArchiveMigrationRepair(database)
  await assert.rejects(() => applyArchiveMigrationRepair(database, first), /injected link write failure/)

  database.runTransaction = originalRunTransaction
  const retry = await planArchiveMigrationRepair(database)
  assert.equal(retry.summary.malformedPostCount, 0)
  assert.equal(retry.summary.malformedLinkCount, 1)
  await applyArchiveMigrationRepair(database, retry)

  assert.equal(Object.hasOwn(collections.get('archive_post_topics').get(link._id), 'data'), false)
})

test('fresh malformed bundle rejects link moderation drift from its wrapped post', async () => {
  const communityId = 'community-1'
  const section = { _id: 'section-1', communityId, name: '亲子出游', type: 'evergreen', order: 1 }
  const post = { _id: 'post-1', communityId, sectionId: section._id, createdAt: '2026-07-14T00:00:00.000Z' }
  const expected = planArchiveMigration({ communityId, sections: [section], posts: [post] })
  const link = expected.topicLinks[0]
  const linkData = Object.fromEntries(Object.entries(link).filter(([key]) => key !== '_id'))
  const { database } = repairDatabase({
    communities: [],
    sections: [],
    posts: [{ ...post, data: expected.postUpdates[0].data }],
    archive_topics: [],
    archive_post_topics: [{ _id: link._id, data: { ...linkData, auditStatus: 'reject' } }],
  })

  await assert.rejects(() => planArchiveMigrationRepair(database), /drifted malformed archive migration records/i)
})
