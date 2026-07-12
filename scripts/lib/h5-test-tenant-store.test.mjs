import assert from 'node:assert/strict'
import test from 'node:test'

import { createCloudBaseTenantStore } from '../h5-test-tenant.mjs'

function managerWithPages(pages) {
  const calls = []
  return {
    calls,
    user: {
      async getEndUserList(options) { calls.push(options); return pages.shift() },
      async createEndUser() { throw new Error('not expected') },
    },
  }
}

function fakeDb({ collision = false } = {}) {
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
        where(where) { queries.push({ collection, where }); return { limit() { return { async get() { return { data: [] } } } } } },
      }
    },
    async runTransaction(fn) {
      return await fn({ collection: (collection) => ({ doc: (id) => document(collection, id, true) }) })
    },
  }
  return client
}

test('store paginates manager users and inspects all fixture-community memberships', async () => {
  const manager = managerWithPages([
    { Total: 2, Users: [{ UUId: 'other', UserName: 'other' }] },
    { Total: 2, Users: [{ UUId: 'target', UserName: 'wanted', IsDisabled: true }] },
  ])
  const db = fakeDb()
  const store = await createCloudBaseTenantStore({ config: { envId: 'env-test' }, manager, db })
  const result = await store.inspect({ username: 'wanted', wechatOpenid: 'wx' })
  assert.deepEqual(manager.calls, [{ limit: 100, offset: 0 }, { limit: 100, offset: 1 }])
  assert.equal(result.account.disabled, true)
  assert.ok(db.queries.some(({ collection, where }) => collection === 'community_members' && where.communityId === 'hh-web-h5-v1-community'))
})

test('store atomically rejects a foreign replacement made after inspect', async () => {
  const db = fakeDb({ collision: true })
  const store = await createCloudBaseTenantStore({ config: { envId: 'env-test' }, manager: managerWithPages([]), db })
  await assert.rejects(store.setDocument('posts', 'hh-web-h5-v1-post-0-01', { fixtureKey: 'HH_WEB_H5_V1' }), /ownership changed/)
  assert.deepEqual(db.transactionSets, [])
})
