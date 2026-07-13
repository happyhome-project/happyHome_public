import assert from 'node:assert/strict'
import test from 'node:test'

import { executeReleaseOperations } from './release-operations.mjs'

const DIGEST = 'a'.repeat(64)

test('release operations run only allowlisted actions and record idempotent migrations', async () => {
  const events = []
  const applied = { 'old-migration': { inputDigest: 'b'.repeat(64) } }
  const guard = {
    async beforeRemoteMutation(stage) { events.push(`fence:${stage}`) },
    async recordMigration(migration) { events.push(`state:${migration.id}`) },
    async recordStage(stage) { events.push(`record:${stage}`) },
  }
  const result = await executeReleaseOperations({
    appliedMigrations: applied,
    guard,
    manifests: [{
      changeId: 'post-index',
      actions: ['ensure-indexes'],
      migrations: [{ id: 'new-migration', inputDigest: DIGEST, module: 'release/migrations/new-migration.mjs' }],
    }],
    runAction: async (action) => events.push(`action:${action}`),
    runMigration: async (migration) => events.push(`migration:${migration.id}`),
  })

  assert.deepEqual(result, {
    actions: ['ensure-indexes'], deferredActions: [], migrations: ['new-migration'],
    operationKinds: { 'desired-state': ['ensure-indexes'], migration: ['new-migration'], verification: [] },
  })
  assert.deepEqual(events, [
    'fence:action:ensure-indexes', 'action:ensure-indexes', 'record:action:ensure-indexes',
    'fence:migration:new-migration', 'migration:new-migration', 'state:new-migration', 'record:migration:new-migration',
  ])
  assert.equal(applied['new-migration'].inputDigest, DIGEST)
})

test('release operations skip an already applied migration and reject unapproved handlers', async () => {
  const events = []
  await assert.rejects(() => executeReleaseOperations({
    appliedMigrations: {},
    guard: { async beforeRemoteMutation() {}, async recordMigration() {}, async recordStage() {} },
    manifests: [{ changeId: 'bad', actions: ['shell-anything'], migrations: [] }],
    runAction: async () => {}, runMigration: async () => {},
  }), /unknown action/i)

  const result = await executeReleaseOperations({
    appliedMigrations: { done: { inputDigest: DIGEST } },
    guard: { async beforeRemoteMutation() { events.push('unexpected') }, async recordMigration() { events.push('unexpected') }, async recordStage() { events.push('unexpected') } },
    manifests: [{ changeId: 'done', actions: [], migrations: [{ id: 'done', inputDigest: DIGEST, module: 'release/migrations/done.mjs' }] }],
    runAction: async () => {}, runMigration: async () => {},
  })
  assert.deepEqual(result, { actions: [], deferredActions: [], migrations: [], operationKinds: { 'desired-state': [], migration: ['done'], verification: [] } })
  assert.deepEqual(events, [])
})

test('migration replay requires the exact recorded input digest and fails closed for legacy records', async () => {
  const base = {
    guard: { async beforeRemoteMutation() {}, async recordMigration() {}, async recordStage() {} },
    manifests: [{ changeId: 'm', actions: [], migrations: [{ id: 'done', inputDigest: DIGEST, module: 'release/migrations/done.mjs' }] }],
    runAction: async () => {}, runMigration: async () => {},
  }
  await assert.rejects(() => executeReleaseOperations({ ...base, appliedMigrations: { done: {} } }), /no inputDigest/i)
  await assert.rejects(() => executeReleaseOperations({ ...base, appliedMigrations: { done: { inputDigest: 'b'.repeat(64) } } }), /inputDigest mismatch/i)
})

test('semantic release actions are allowlisted but deferred until after cloud probes',async()=>{const events=[];const result=await executeReleaseOperations({guard:{beforeRemoteMutation:async()=>events.push('fence'),recordStage:async()=>events.push('record'),recordMigration:async()=>{}},manifests:[{actions:['ensure-indexes','verify-post-rag-timer','backfill-post-rag-v2','eval-post-semantic-search']}],runAction:async action=>events.push(action),runMigration:async()=>{}});assert.deepEqual(events,['fence','ensure-indexes','record']);assert.deepEqual(result.deferredActions,['verify-post-rag-timer','backfill-post-rag-v2','eval-post-semantic-search']);assert.deepEqual(result.operationKinds,{'desired-state':['backfill-post-rag-v2','ensure-indexes'],migration:[],verification:['eval-post-semantic-search','verify-post-rag-timer']})})

test('predeploy semantic prerequisites deterministically end with timer configuration readback',async()=>{const actions=[];await executeReleaseOperations({guard:{beforeRemoteMutation:async()=>{},recordStage:async()=>{},recordMigration:async()=>{}},manifests:[{actions:['configure-rag-workers','update-rag-env','ensure-tencent-rag-index','ensure-indexes','configure-rag-network']}],runAction:async action=>actions.push(action),runMigration:async()=>{}});assert.deepEqual(actions,['ensure-indexes','ensure-tencent-rag-index','configure-rag-network','update-rag-env','configure-rag-workers'])})

test('DAG-owned index prerequisite is not repeated as a manifest action', async () => {
  const events = []
  const result = await executeReleaseOperations({
    completedActions: new Set(['ensure-indexes']),
    guard: {
      beforeRemoteMutation: async (stage) => events.push(`fence:${stage}`),
      recordStage: async (stage) => events.push(`record:${stage}`),
      recordMigration: async () => {},
    },
    manifests: [{ actions: ['ensure-indexes', 'configure-rag-workers'] }],
    runAction: async (action) => events.push(`action:${action}`),
    runMigration: async () => {},
  })
  assert.deepEqual(result.actions, ['configure-rag-workers'])
  assert.deepEqual(result.completedActions, ['ensure-indexes'])
  assert.deepEqual(events, [
    'fence:action:configure-rag-workers',
    'action:configure-rag-workers',
    'record:action:configure-rag-workers',
  ])
})
