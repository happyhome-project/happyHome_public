import assert from 'node:assert/strict'
import test from 'node:test'

import { CloudBaseReleaseStore } from './cloudbase-release-store.mjs'
import { ReleaseGovernance } from './release-governance.mjs'

function missingError() {
  return Object.assign(new Error('document.get:fail document not found'), { errCode: -1 })
}

function createFakeDatabase() {
  const documents = new Map()
  const writes = []
  const makeDocument = (key) => ({
    async get() {
      if (!documents.has(key)) throw missingError()
      return { data: structuredClone(documents.get(key)) }
    },
    async set(data) {
      writes.push({ key, op: 'set' })
      documents.set(key, structuredClone(data))
    },
    async remove() {
      writes.push({ key, op: 'remove' })
      documents.delete(key)
    },
  })
  return {
    documents,
    writes,
    collection(name) {
      return { doc: (id) => makeDocument(`${name}/${id}`) }
    },
    async runTransaction(callback) {
      return await callback(this)
    },
  }
}

test('CloudBaseReleaseStore atomically persists the production lock, run, and state documents', async () => {
  const db = createFakeDatabase()
  const store = new CloudBaseReleaseStore({ db })

  await store.transact({ runId: 'run-1' }, async (model) => {
    assert.equal(model.lock, null)
    assert.equal(model.run, null)
    assert.equal(model.state.nextFencingToken, 1)
    model.lock = { runId: 'run-1', fencingToken: 1, status: 'active' }
    model.run = { runId: 'run-1', status: 'active' }
    model.state = { ...model.state, nextFencingToken: 2, gitSha: 'abc' }
  })

  assert.deepEqual(db.documents.get('release_locks/production'), { runId: 'run-1', fencingToken: 1, status: 'active' })
  assert.deepEqual(db.documents.get('release_runs/run-1'), { runId: 'run-1', status: 'active' })
  assert.deepEqual(db.documents.get('release_state/production'), { nextFencingToken: 2, gitSha: 'abc' })
})

test('CloudBaseReleaseStore removes only an existing lock and preserves persisted production state', async () => {
  const db = createFakeDatabase()
  db.documents.set('release_locks/production', { runId: 'run-1', fencingToken: 1, status: 'active' })
  db.documents.set('release_runs/run-1', { runId: 'run-1', status: 'active' })
  db.documents.set('release_state/production', { nextFencingToken: 2, gitSha: 'abc' })
  const store = new CloudBaseReleaseStore({ db })

  await store.transact({ runId: 'run-1' }, async (model) => {
    model.lock = null
    model.run = { ...model.run, status: 'recovered' }
  })

  assert.equal(db.documents.has('release_locks/production'), false)
  assert.deepEqual(db.documents.get('release_runs/run-1'), { runId: 'run-1', status: 'recovered' })
  assert.deepEqual(db.documents.get('release_state/production'), { nextFencingToken: 2, gitSha: 'abc' })
  assert.deepEqual(db.writes.map(({ key, op }) => `${op}:${key}`), [
    'remove:release_locks/production',
    'set:release_runs/run-1',
  ])
})

test('CloudBaseReleaseStore unwraps and repairs an old nested data document', async () => {
  const db = createFakeDatabase()
  db.documents.set('release_state/production', { data: { nextFencingToken: 2, gitSha: 'abc' } })
  const store = new CloudBaseReleaseStore({ db })
  assert.deepEqual(await store.readProductionState(), { nextFencingToken: 2, gitSha: 'abc' })
  await store.transact({ runId: 'run-1' }, async (model) => { model.state = { ...model.state, nextFencingToken: 3 } })
  assert.deepEqual(db.documents.get('release_state/production'), { nextFencingToken: 3, gitSha: 'abc' })
})

test('CloudBaseReleaseStore can read release state without creating state documents', async () => {
  const db = createFakeDatabase()
  const store = new CloudBaseReleaseStore({ db })
  assert.equal(await store.readProductionState(), null)
  assert.equal(db.documents.size, 0)
})

test('CloudBaseReleaseStore retries transient CloudBase transaction busy failures', async () => {
  const db = createFakeDatabase()
  const original = db.runTransaction.bind(db)
  let attempts = 0
  db.runTransaction = async (callback) => {
    attempts += 1
    if (attempts === 1) throw new Error('[ResourceUnavailable.TransactionBusy] Transaction is busy')
    return await original(callback)
  }
  const store = new CloudBaseReleaseStore({ db, sleep: async () => {}, transactionAttempts: 2 })
  await store.transact({ runId: 'run-1' }, async (model) => { model.run = { runId: 'run-1' } })
  assert.equal(attempts, 2)
})

test('CloudBaseReleaseStore treats an absent release_state collection as initial bootstrap state', async () => {
  const db = createFakeDatabase()
  db.collection = () => ({ doc: () => ({
    async get() { throw new Error('[ResourceNotFound] Db or Table not exist: release_state') },
  }) })
  const store = new CloudBaseReleaseStore({ db })
  assert.equal(await store.readProductionState(), null)
})

test('ReleaseGovernance uses the CloudBase store as the durable fencing and production-version source', async () => {
  const db = createFakeDatabase()
  const governance = new ReleaseGovernance({ store: new CloudBaseReleaseStore({ db }), now: () => 1000 })
  const lock = await governance.acquire({ gitSha: 'abc', owner: 'release-host', runId: 'run-1' })
  await governance.markMutationStarted(lock, 'cloud-deploy')
  await governance.complete(lock, {
    components: { cloud: { functions: { post: { buildId: 'build-1', sourceSha: 'abc' } } } },
    evidence: { smoke: 'passed' },
  })

  assert.equal(db.documents.has('release_locks/production'), false)
  assert.equal(db.documents.get('release_runs/run-1').status, 'passed')
  const production = db.documents.get('release_state/production')
  assert.equal(production.gitSha, 'abc')
  assert.equal(production.lastSuccessfulRunId, 'run-1')
  assert.equal(production.nextFencingToken, 2)
})
