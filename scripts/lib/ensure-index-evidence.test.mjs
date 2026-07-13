import assert from 'node:assert/strict'
import test from 'node:test'

import { createEnsureIndexEvidence, readEnsureIndexState } from './ensure-index-evidence.mjs'

test('ensure-index evidence is structured and proves one complete readback', () => {
  const evidence = createEnsureIndexEvidence({ collectionsChecked: 3, indexesChecked: 7, failures: 0 })
  assert.deepEqual(evidence, {
    schemaVersion: 1,
    action: 'ensure-indexes',
    invocationCount: 1,
    collectionsChecked: 3,
    indexesChecked: 7,
    failures: 0,
    status: 'passed',
  })
})

test('ensure-index evidence fails closed when any readback failed', () => {
  assert.throws(() => createEnsureIndexEvidence({ collectionsChecked: 1, indexesChecked: 2, failures: 1 }), /failures=1/)
})

test('final readback catches collections and indexes that creation only appeared to establish', async () => {
  const state = await readEnsureIndexState({
    db: {
      async checkCollectionExists(name) { return { Exists: name !== 'missing' } },
      async checkIndexExists(_collection, name) { return { Exists: name !== 'missing-index' } },
    },
    collections: ['present', 'missing'],
    indexes: [{ coll: 'present', name: 'present-index' }, { coll: 'present', name: 'missing-index' }],
  })
  assert.equal(state.failures, 2)
  assert.deepEqual(state.missing, ['collection:missing', 'index:present.missing-index'])
  assert.throws(() => createEnsureIndexEvidence(state), /failures=2/)
})
