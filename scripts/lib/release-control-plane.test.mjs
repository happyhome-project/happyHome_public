import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  ensureReleaseControlPlane,
  RELEASE_CONTROL_PLANE_COLLECTIONS,
  verifyReleaseControlPlane,
} from './release-control-plane.mjs'

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'ensure-release-control-plane.mjs'), 'utf8')
test('release control plane bootstrap creates only the three governance collections', () => {
  assert.deepEqual(RELEASE_CONTROL_PLANE_COLLECTIONS, ['release_locks', 'release_runs', 'release_state'])
  assert.match(source, /ensureReleaseControlPlane/)
  assert.match(source, /verifyReleaseControlPlane/)
})

function createDb(existing = []) {
  const collections = new Set(existing)
  const created = []
  return {
    created,
    async checkCollectionExists(collection) {
      return { Exists: collections.has(collection) }
    },
    async createCollection(collection) {
      created.push(collection)
      collections.add(collection)
    },
  }
}

test('verify mode accepts an existing control plane without creating collections', async () => {
  const db = createDb(['release_locks', 'release_runs', 'release_state'])

  await verifyReleaseControlPlane(db)

  assert.deepEqual(db.created, [])
})

test('verify mode blocks on a missing collection without creating it', async () => {
  const db = createDb(['release_locks', 'release_runs'])

  await assert.rejects(() => verifyReleaseControlPlane(db), /release control plane.*release_state.*missing/i)
  assert.deepEqual(db.created, [])
})

test('ensure mode creates only missing collections', async () => {
  const db = createDb(['release_locks'])

  await ensureReleaseControlPlane(db)

  assert.deepEqual(db.created, ['release_runs', 'release_state'])
})

test('ensure mode tolerates an already-exists creation race', async () => {
  const db = createDb(['release_locks', 'release_runs'])
  db.createCollection = async (collection) => {
    db.created.push(collection)
    throw new Error(`${collection} already exists`)
  }

  await ensureReleaseControlPlane(db)

  assert.deepEqual(db.created, ['release_state'])
})
