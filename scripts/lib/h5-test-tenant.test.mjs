import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FIXTURE_KEY,
  applyTenant,
  buildManifest,
  createPrepareRecord,
  doctorTenant,
  planTenant,
  serializePrepareRecord,
} from './h5-test-tenant.mjs'

function clone(value) { return structuredClone(value) }

class FakeStore {
  constructor(observation = {}) {
    this.account = observation.account ?? null
    this.documents = new Map(Object.entries(observation.documents || {}))
    this.memberships = clone(observation.memberships || [])
    this.writes = []
    this.createdAccounts = 0
  }
  async inspect() {
    return { account: clone(this.account), documents: Object.fromEntries([...this.documents].map(([key, value]) => [key, clone(value)])), memberships: clone(this.memberships) }
  }
  async createEndUser({ username }) {
    this.createdAccounts += 1
    this.account = { uuid: 'web-uuid-1', username }
    return clone(this.account)
  }
  async setDocument(collection, id, document) {
    this.writes.push(`${collection}/${id}`)
    this.documents.set(`${collection}/${id}`, clone(document))
    if (collection === 'community_members') this.memberships.push(clone(document))
  }
}

const config = {
  envId: 'env-test', username: 'h5@example.test', password: 'super-secret-password',
  accessKey: 'public-access-key', wechatOpenid: 'wechat-openid-secret',
}

test('fixed manifest contains one hidden approval community, three sections, and 31 deterministic posts', () => {
  const manifest = buildManifest({ webUserId: 'web:web-uuid-1', wechatOpenid: config.wechatOpenid })
  assert.equal(manifest.fixtureKey, FIXTURE_KEY)
  assert.equal(manifest.communities.length, 1)
  assert.equal(manifest.communities[0].status, 'active')
  assert.equal(manifest.communities[0].joinType, 'approval')
  assert.equal(manifest.communities[0].discoverable, false)
  assert.equal(manifest.communities[0].fixtureKey, FIXTURE_KEY)
  assert.deepEqual(manifest.sections.map((section) => section.order), [0, 1, 2])
  assert.deepEqual(manifest.sections.map((section) => section.fixturePostCount), [30, 1, 0])
  assert.equal(manifest.posts.length, 31)
  assert.equal(new Set(manifest.posts.map((post) => post._id)).size, 31)
  assert.ok(manifest.posts.every((post) => post.auditStatus === 'pass' && post.fixtureKey === FIXTURE_KEY))
})

test('empty observation plans only deterministic set operations and no deletes', async () => {
  const store = new FakeStore()
  const result = await planTenant({ store, config })
  assert.equal(result.plan.createAccount, true)
  assert.ok(result.plan.sets.length > 31)
  assert.deepEqual(result.plan.deletes, [])
})

test('exact fixture state produces a no-op plan', async () => {
  const seeded = new FakeStore()
  const prepared = createPrepareRecord(await planTenant({ store: seeded, config }))
  await applyTenant({ store: seeded, config, prepare: prepared, env: { HAPPYHOME_FIXTURE_PREFIX: FIXTURE_KEY } })
  seeded.writes.length = 0
  const result = await planTenant({ store: seeded, config })
  assert.equal(result.plan.createAccount, false)
  assert.deepEqual(result.plan.sets, [])
})

test('foreign deterministic document collision is rejected', async () => {
  const manifest = buildManifest({ webUserId: 'web:web-uuid-1', wechatOpenid: config.wechatOpenid })
  const key = `communities/${manifest.communities[0]._id}`
  const store = new FakeStore({ account: { uuid: 'web-uuid-1', username: config.username }, documents: { [key]: { _id: manifest.communities[0]._id, name: 'real community' } } })
  await assert.rejects(planTenant({ store, config }), /foreign deterministic document collision/)
})

test('fixture-owned drift is planned as an exact repair', async () => {
  const manifest = buildManifest({ webUserId: 'web:web-uuid-1', wechatOpenid: config.wechatOpenid })
  const community = { ...manifest.communities[0], name: 'drifted' }
  const store = new FakeStore({ account: { uuid: 'web-uuid-1', username: config.username }, documents: { [`communities/${community._id}`]: community } })
  const { plan } = await planTenant({ store, config })
  assert.ok(plan.sets.some(({ collection, id }) => collection === 'communities' && id === community._id))
})

test('real-community membership and admin role are forbidden for the Web account', async () => {
  for (const membership of [
    { communityId: 'real-community', userId: 'web:web-uuid-1', role: 'member', status: 'active' },
    { communityId: 'fixture-community', userId: 'web:web-uuid-1', role: 'admin', status: 'active', fixtureKey: FIXTURE_KEY },
  ]) {
    const store = new FakeStore({ account: { uuid: 'web-uuid-1', username: config.username }, memberships: [membership] })
    await assert.rejects(planTenant({ store, config }), /Web account.*(?:real-community membership|admin role)/)
  }
})

test('apply is idempotent and does not rewrite an exact second application', async () => {
  const store = new FakeStore()
  const prepare = createPrepareRecord(await planTenant({ store, config }))
  await applyTenant({ store, config, prepare, env: { HAPPYHOME_FIXTURE_PREFIX: FIXTURE_KEY } })
  store.writes.length = 0
  const secondPrepare = createPrepareRecord(await planTenant({ store, config }))
  await applyTenant({ store, config, prepare: secondPrepare, env: { HAPPYHOME_FIXTURE_PREFIX: FIXTURE_KEY } })
  assert.deepEqual(store.writes, [])
  assert.equal(store.createdAccounts, 1)
})

test('apply rejects changed observation and wrong fixture prefix', async () => {
  const store = new FakeStore()
  const prepare = createPrepareRecord(await planTenant({ store, config }))
  const manifest = buildManifest({ webUserId: null, wechatOpenid: config.wechatOpenid })
  store.documents.set(`communities/${manifest.communities[0]._id}`, manifest.communities[0])
  await assert.rejects(applyTenant({ store, config, prepare, env: { HAPPYHOME_FIXTURE_PREFIX: FIXTURE_KEY } }), /observed state changed/)
  await assert.rejects(applyTenant({ store: new FakeStore(), config, prepare, env: {} }), /HAPPYHOME_FIXTURE_PREFIX/)
})

test('prepare serialization contains no password, access key, or openid', async () => {
  const serialized = serializePrepareRecord(createPrepareRecord(await planTenant({ store: new FakeStore(), config })))
  for (const secret of [config.password, config.accessKey, config.wechatOpenid]) assert.equal(serialized.includes(secret), false)
  assert.match(serialized, /"envId": "env-test"/)
})

test('doctor reports sanitized counts and rejects wrong section post counts', async () => {
  const store = new FakeStore()
  const prepare = createPrepareRecord(await planTenant({ store, config }))
  await applyTenant({ store, config, prepare, env: { HAPPYHOME_FIXTURE_PREFIX: FIXTURE_KEY } })
  const healthy = await doctorTenant({ store, config })
  assert.deepEqual(healthy.counts, { communities: 1, sections: 3, posts: 31, memberships: 2, activePostsBySection: [30, 1, 0] })
  assert.equal(JSON.stringify(healthy).includes(config.wechatOpenid), false)
  const post = [...store.documents.entries()].find(([key]) => key.startsWith('posts/'))
  store.documents.delete(post[0])
  await assert.rejects(doctorTenant({ store, config }), /active post counts/)
})
