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
  async setDocument(collection, id, document, options) {
    this.writes.push(`${collection}/${id}`)
    this.lastWriteOptions = options
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
  assert.equal(manifest.communities[0].ragIndexPolicy, 'excluded')
  assert.deepEqual(manifest.sections.map((section) => section.order), [0, 1, 2])
  assert.deepEqual(manifest.sections.map((section) => section.fixturePostCount), [30, 1, 0])
  assert.equal(manifest.posts.length, 31)
  assert.deepEqual(manifest.sections[1].widgets.map((widget) => [widget.type, widget.required]), [
    ['short_text', true],
    ['image_group', false],
  ])
  assert.ok(manifest.posts.every((post) => !Object.hasOwn(post.content, 'hh-web-h5-v1-widget-short-image')))
  assert.equal(new Set(manifest.posts.map((post) => post._id)).size, 31)
  assert.ok(manifest.posts.every((post) => post.auditStatus === 'pass' && post.fixtureKey === FIXTURE_KEY && post.ragIndexPolicy === 'excluded'))
})

test('empty observation plans only deterministic set operations and no deletes', async () => {
  const store = new FakeStore()
  const result = await planTenant({ store, config })
  assert.equal(result.plan.createAccount, true)
  assert.ok(result.plan.sets.length > 31)
  assert.ok(result.plan.sets.every((operation) => typeof operation.expectedCurrentHash === 'string'))
  assert.deepEqual(result.plan.deletes, [])
})

test('existing real WeChat user stays outside fixture ownership', async () => {
  const realUser = { _id: config.wechatOpenid, nickName: 'Real User', role: 'superAdmin' }
  const store = new FakeStore({ documents: { [`users/${config.wechatOpenid}`]: realUser } })
  const result = await planTenant({ store, config })
  assert.deepEqual(store.documents.get(`users/${config.wechatOpenid}`), realUser)
  assert.equal(result.plan.sets.some((operation) => operation.collection === 'users' && operation.id === config.wechatOpenid), false)
})

test('apply can converge after a partial write failure by preparing again', async () => {
  const store = new FakeStore()
  const originalSet = store.setDocument.bind(store)
  let remaining = 3
  store.setDocument = async (...args) => {
    if (remaining-- === 0) throw new Error('injected partial write failure')
    return await originalSet(...args)
  }
  await assert.rejects(applyTenant({ store, config, prepare: createPrepareRecord(await planTenant({ store, config })), env: { HAPPYHOME_FIXTURE_PREFIX: FIXTURE_KEY } }), /partial write failure/)
  store.setDocument = originalSet
  const retry = createPrepareRecord(await planTenant({ store, config }))
  await assert.doesNotReject(applyTenant({ store, config, prepare: retry, env: { HAPPYHOME_FIXTURE_PREFIX: FIXTURE_KEY } }))
})

test('apply reuses an account created before an injected failure', async () => {
  const store = new FakeStore()
  const originalCreate = store.createEndUser.bind(store)
  store.createEndUser = async (input) => {
    await originalCreate(input)
    throw new Error('injected post-create failure')
  }
  const prepare = createPrepareRecord(await planTenant({ store, config }))
  await assert.rejects(applyTenant({ store, config, prepare, env: { HAPPYHOME_FIXTURE_PREFIX: FIXTURE_KEY } }), /post-create failure/)
  store.createEndUser = originalCreate
  await assert.doesNotReject(applyTenant({ store, config, prepare: createPrepareRecord(await planTenant({ store, config })), env: { HAPPYHOME_FIXTURE_PREFIX: FIXTURE_KEY } }))
  assert.equal(store.createdAccounts, 1)
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

test('apply rejects tampered prepare env, record fingerprint, and plan fingerprint', async () => {
  const store = new FakeStore()
  const prepare = createPrepareRecord(await planTenant({ store, config }))
  await assert.rejects(applyTenant({ store, config, prepare: { ...prepare, envId: 'other' }, env: { HAPPYHOME_FIXTURE_PREFIX: FIXTURE_KEY } }), /envId/)
  await assert.rejects(applyTenant({ store, config, prepare: { ...prepare, fingerprint: '0'.repeat(64) }, env: { HAPPYHOME_FIXTURE_PREFIX: FIXTURE_KEY } }), /prepare fingerprint/)
  const changedPlan = { ...prepare, planFingerprint: '1'.repeat(64) }
  const body = { ...changedPlan }; delete body.fingerprint
  const crypto = await import('node:crypto')
  const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value
  changedPlan.fingerprint = crypto.createHash('sha256').update(JSON.stringify(stable(body))).digest('hex')
  await assert.rejects(applyTenant({ store, config, prepare: changedPlan, env: { HAPPYHOME_FIXTURE_PREFIX: FIXTURE_KEY } }), /plan fingerprint/)
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
  await assert.rejects(doctorTenant({ store, config }), /post counts/)
})

test('doctor rejects disabled account, extra membership, and extra inactive or non-pass posts', async () => {
  const seed = async () => {
    const store = new FakeStore()
    await applyTenant({ store, config, prepare: createPrepareRecord(await planTenant({ store, config })), env: { HAPPYHOME_FIXTURE_PREFIX: FIXTURE_KEY } })
    return store
  }
  const disabled = await seed(); disabled.account.disabled = true
  await assert.rejects(doctorTenant({ store: disabled, config }), /disabled/)
  const extraMember = await seed(); extraMember.memberships.push({ _id: 'extra', communityId: 'hh-web-h5-v1-community', userId: 'someone', role: 'member', status: 'active' })
  await assert.rejects(doctorTenant({ store: extraMember, config }), /membership set/)
  for (const patch of [{ status: 'deleted', auditStatus: 'pass' }, { status: 'active', auditStatus: 'review' }]) {
    const extraPost = await seed()
    extraPost.documents.set('posts/extra-post', { _id: 'extra-post', communityId: 'hh-web-h5-v1-community', sectionId: 'hh-web-h5-v1-section-long', fixtureKey: FIXTURE_KEY, ...patch })
    await assert.rejects(doctorTenant({ store: extraPost, config }), /total post counts/)
  }
  const foreignSection = await seed()
  foreignSection.documents.set('posts/foreign-section-post', { _id: 'foreign-section-post', communityId: 'hh-web-h5-v1-community', sectionId: 'other-section', status: 'active', auditStatus: 'pass', fixtureKey: FIXTURE_KEY })
  await assert.rejects(doctorTenant({ store: foreignSection, config }), /unexpected section|total post count/)
})
