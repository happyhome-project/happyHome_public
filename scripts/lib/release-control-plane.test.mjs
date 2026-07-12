import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  ensureReleaseControlPlane,
  parseReleaseControlPlaneMode,
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
      return collections.has(collection)
        ? { Exists: true }
        : { Exists: false, Msg: 'ResourceNotFound: Table not exist' }
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

test('verify mode treats auth, network, service, and empty probe failures as indeterminate', async () => {
  for (const Msg of ['AuthFailure: invalid credential', 'network timeout', 'InternalError: service unavailable', '']) {
    const db = createDb()
    db.checkCollectionExists = async () => ({ Exists: false, Msg })

    await assert.rejects(() => verifyReleaseControlPlane(db), /indeterminate verification/i)
    assert.deepEqual(db.created, [])
  }
})

test('ensure mode creates only missing collections', async () => {
  const db = createDb(['release_locks'])

  await ensureReleaseControlPlane(db)

  assert.deepEqual(db.created, ['release_runs', 'release_state'])
})

test('ensure mode never creates when collection verification is indeterminate', async () => {
  const db = createDb()
  db.checkCollectionExists = async () => ({ Exists: false, Msg: 'RequestError: socket hang up' })

  await assert.rejects(() => ensureReleaseControlPlane(db), /indeterminate verification/i)
  assert.deepEqual(db.created, [])
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

test('ensure mode rethrows negative and ambiguous creation errors', async () => {
  for (const message of ['Table does not exist', 'CollectionNotExists', 'permission denied']) {
    const db = createDb(['release_locks', 'release_runs'])
    db.createCollection = async (collection) => {
      db.created.push(collection)
      throw new Error(message)
    }

    await assert.rejects(() => ensureReleaseControlPlane(db), new RegExp(message, 'i'))
    assert.deepEqual(db.created, ['release_state'])
  }
})

test('CLI accepts exactly one explicit control-plane mode', () => {
  assert.equal(parseReleaseControlPlaneMode(['--verify-only']), 'verify')
  assert.equal(parseReleaseControlPlaneMode(['--provision']), 'provision')
  for (const args of [[], ['--verify'], ['--unknown'], ['--verify-only', '--provision'], ['--verify-only', '--verify-only']]) {
    assert.throws(() => parseReleaseControlPlaneMode(args), /exactly one.*--verify-only.*--provision/i)
  }
})

test('CLI parses its mode before reading credentials or initializing CloudBase', () => {
  const parseIndex = source.indexOf('parseReleaseControlPlaneMode(process.argv.slice(2))')
  const credentialsIndex = source.indexOf('const fileEnv =')
  const initIndex = source.indexOf('CloudBase.init(')

  assert(parseIndex >= 0)
  assert(parseIndex < credentialsIndex)
  assert(parseIndex < initIndex)
})
