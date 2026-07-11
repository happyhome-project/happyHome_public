import assert from 'node:assert/strict'
import test from 'node:test'

import { executeReleaseOperations } from './release-operations.mjs'

test('release operations run only allowlisted actions and record idempotent migrations', async () => {
  const events = []
  const applied = new Set(['old-migration'])
  const guard = {
    async beforeRemoteMutation(stage) { events.push(`fence:${stage}`) },
    async recordMigration(id) { events.push(`state:${id}`) },
    async recordStage(stage) { events.push(`record:${stage}`) },
  }
  const result = await executeReleaseOperations({
    appliedMigrations: applied,
    guard,
    manifests: [{
      changeId: 'post-index',
      actions: ['ensure-indexes'],
      migrations: [{ id: 'new-migration', module: 'release/migrations/new-migration.mjs' }],
    }],
    runAction: async (action) => events.push(`action:${action}`),
    runMigration: async (migration) => events.push(`migration:${migration.id}`),
  })

  assert.deepEqual(result, { actions: ['ensure-indexes'], migrations: ['new-migration'] })
  assert.deepEqual(events, [
    'fence:action:ensure-indexes', 'action:ensure-indexes', 'record:action:ensure-indexes',
    'fence:migration:new-migration', 'migration:new-migration', 'state:new-migration', 'record:migration:new-migration',
  ])
  assert(applied.has('new-migration'))
})

test('release operations skip an already applied migration and reject unapproved handlers', async () => {
  const events = []
  await assert.rejects(() => executeReleaseOperations({
    appliedMigrations: new Set(),
    guard: { async beforeRemoteMutation() {}, async recordMigration() {}, async recordStage() {} },
    manifests: [{ changeId: 'bad', actions: ['shell-anything'], migrations: [] }],
    runAction: async () => {}, runMigration: async () => {},
  }), /unknown action/i)

  const result = await executeReleaseOperations({
    appliedMigrations: new Set(['done']),
    guard: { async beforeRemoteMutation() { events.push('unexpected') }, async recordMigration() { events.push('unexpected') }, async recordStage() { events.push('unexpected') } },
    manifests: [{ changeId: 'done', actions: [], migrations: [{ id: 'done', module: 'release/migrations/done.mjs' }] }],
    runAction: async () => {}, runMigration: async () => {},
  })
  assert.deepEqual(result, { actions: [], migrations: [] })
  assert.deepEqual(events, [])
})
