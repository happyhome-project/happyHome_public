import assert from 'node:assert/strict'
import test from 'node:test'

import { createCloudBaseTenantStore } from '../h5-test-tenant.mjs'
import { planTenant } from './h5-test-tenant.mjs'

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

function fakeDb({ collision = false, queryResults = () => [] } = {}) {
  const queries = []
  const transactionSets = []
  const document = (collection, id, inTransaction = false) => ({
    async get() {
      if (inTransaction && collision) return { data: [{ _id: id, fixtureKey: 'FOREIGN' }] }
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
        where(where) { queries.push({ collection, where }); return { limit() { return { async get() { return { data: queryResults(collection, where) } } } } } },
      }
    },
    async runTransaction(fn) {
      return await fn({ collection: (collection) => ({ doc: (id) => document(collection, id, true) }) })
    },
  }
  return client
}

test('store paginates manager users and merges fixture-community and global Web memberships by id', async () => {
  const manager = managerWithPages([
    { Total: 2, Users: [{ UUId: 'other', UserName: 'other' }] },
    { Total: 2, Users: [{ UUId: 'target', UserName: 'wanted', IsDisabled: false }] },
  ])
  const fixtureMember = { _id: 'fixture-web', communityId: 'hh-web-h5-v1-community', userId: 'web:target', role: 'member', status: 'active', fixtureKey: 'HH_WEB_H5_V1' }
  const realMember = { _id: 'real-admin', communityId: 'real-community', userId: 'web:target', role: 'admin', status: 'active' }
  const db = fakeDb({ queryResults(collection, where) {
    if (collection !== 'community_members') return []
    if (where.communityId) return [fixtureMember]
    if (where.userId) return [fixtureMember, realMember]
    return []
  } })
  const store = await createCloudBaseTenantStore({ config: { envId: 'env-test' }, manager, db })
  const result = await store.inspect({ username: 'wanted', wechatOpenid: 'wx' })
  assert.deepEqual(manager.calls, [{ limit: 100, offset: 0 }, { limit: 100, offset: 1 }])
  assert.equal(result.account.disabled, false)
  assert.ok(db.queries.some(({ collection, where }) => collection === 'community_members' && where.communityId === 'hh-web-h5-v1-community'))
  assert.ok(db.queries.some(({ collection, where }) => collection === 'community_members' && where.userId === 'web:target'))
  assert.deepEqual(result.memberships.map(({ _id }) => _id).sort(), ['fixture-web', 'real-admin'])
  await assert.rejects(planTenant({ store, config: { envId: 'env-test', username: 'wanted', wechatOpenid: 'wx' } }), /forbidden admin role|real-community membership/)
  assert.deepEqual(manager.calls.slice(2), [{ limit: 100, offset: 0 }, { limit: 100, offset: 1 }])
})

test('store atomically rejects a foreign replacement made after inspect', async () => {
  const db = fakeDb({ collision: true })
  const store = await createCloudBaseTenantStore({ config: { envId: 'env-test' }, manager: managerWithPages([]), db })
  await assert.rejects(store.setDocument('posts', 'hh-web-h5-v1-post-0-01', { fixtureKey: 'HH_WEB_H5_V1' }), /ownership changed/)
  assert.deepEqual(db.transactionSets, [])
})
