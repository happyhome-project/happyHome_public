import assert from 'node:assert/strict'
import test from 'node:test'

import { createCloudBaseTenantStore } from '../h5-test-tenant.mjs'
import { canonicalFingerprint, planTenant } from './h5-test-tenant.mjs'

function managerWithPages(pages) {
  const calls = []
  return {
    calls,
    user: {
      async getEndUserList(options) { calls.push(options); return pages[options.offset === 0 ? 0 : 1] },
      async createEndUser() { throw new Error('not expected') },
    },
  }
}

function fakeDb({ collision = false, sameOwnerRace = false, queryResults = () => [] } = {}) {
  const queries = []
  const transactionSets = []
  const document = (collection, id, inTransaction = false) => ({
    async get() {
      if (inTransaction && collision) return { data: [{ _id: id, fixtureKey: 'FOREIGN' }] }
      if (inTransaction && sameOwnerRace) return { data: [{ _id: id, fixtureKey: 'HH_WEB_H5_V1', value: 'replacement' }] }
      throw Object.assign(new Error('document.get:fail document not found'), { errCode: -1 })
    },
    async set(data) { transactionSets.push({ collection, id, data, inTransaction }) },
  })
  const client = {
    queries,
    transactionSets,
    collection(collection) {
      return {
        doc: (id) => document(collection, id),
        where(where) {
          queries.push({ collection, where })
          let offset = 0
          return {
            skip(value) { offset = value; return this },
            limit(value) { return { async get() { return { data: queryResults(collection, where).slice(offset, offset + value) } } } },
          }
        },
      }
    },
    async runTransaction(fn) {
      return await fn({ collection: (collection) => ({ doc: (id) => document(collection, id, true) }) })
    },
  }
  return client
}

test('store paginates all database queries and finds cross-page foreign membership and extra community post', async () => {
  const manager = managerWithPages([
    { Total: 2, Users: [{ UUId: 'other', UserName: 'other' }] },
    { Total: 2, Users: [{ UUId: 'target', UserName: 'wanted', IsDisabled: false }] },
  ])
  const fixtureMember = { _id: 'fixture-web', communityId: 'hh-web-h5-v1-community', userId: 'web:target', role: 'member', status: 'active', fixtureKey: 'HH_WEB_H5_V1' }
  const realMember = { _id: 'real-admin', communityId: 'real-community', userId: 'web:target', role: 'admin', status: 'active' }
  const extraPost = { _id: 'extra-community-post', communityId: 'hh-web-h5-v1-community', sectionId: 'other-section', status: 'active', auditStatus: 'pass' }
  const db = fakeDb({ queryResults(collection, where) {
    if (collection === 'posts' && where.communityId) return [{ _id: 'p1' }, { _id: 'p2' }, extraPost]
    if (collection !== 'community_members') return []
    if (where.communityId) return [fixtureMember]
    if (where.userId) return [fixtureMember, fixtureMember, realMember]
    return []
  } })
  const store = await createCloudBaseTenantStore({ config: { envId: 'env-test' }, manager, db, queryPageSize: 2 })
  const result = await store.inspect({ username: 'wanted', wechatOpenid: 'wx' })
  assert.deepEqual(manager.calls, [{ limit: 100, offset: 0 }, { limit: 100, offset: 1 }])
  assert.equal(result.account.disabled, false)
  assert.ok(db.queries.some(({ collection, where }) => collection === 'community_members' && where.communityId === 'hh-web-h5-v1-community'))
  assert.ok(db.queries.some(({ collection, where }) => collection === 'community_members' && where.userId === 'web:target'))
  assert.deepEqual(result.memberships.map(({ _id }) => _id).sort(), ['fixture-web', 'real-admin'])
  assert.ok(result.documents['posts/extra-community-post'])
  await assert.rejects(planTenant({ store, config: { envId: 'env-test', username: 'wanted', wechatOpenid: 'wx' } }), /forbidden admin role|real-community membership/)
  assert.deepEqual(manager.calls.slice(2), [{ limit: 100, offset: 0 }, { limit: 100, offset: 1 }])
})

test('store atomically rejects a foreign replacement made after inspect', async () => {
  const db = fakeDb({ collision: true })
  const store = await createCloudBaseTenantStore({ config: { envId: 'env-test' }, manager: managerWithPages([]), db })
  await assert.rejects(store.setDocument('posts', 'hh-web-h5-v1-post-0-01', { fixtureKey: 'HH_WEB_H5_V1' }, { expectedCurrentHash: canonicalFingerprint(null) }), /ownership changed/)
  assert.deepEqual(db.transactionSets, [])
})

test('store rejects a same-owner content race using the expected canonical hash', async () => {
  const db = fakeDb({ sameOwnerRace: true })
  const store = await createCloudBaseTenantStore({ config: { envId: 'env-test' }, manager: managerWithPages([]), db })
  const previouslyObserved = { _id: 'hh-web-h5-v1-post-0-01', fixtureKey: 'HH_WEB_H5_V1', value: 'old' }
  await assert.rejects(store.setDocument('posts', previouslyObserved._id, { fixtureKey: 'HH_WEB_H5_V1', value: 'desired' }, { expectedCurrentHash: canonicalFingerprint(previouslyObserved) }), /current document changed/)
  assert.deepEqual(db.transactionSets, [])
})
