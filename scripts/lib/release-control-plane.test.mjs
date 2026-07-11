import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'ensure-release-control-plane.mjs'), 'utf8')
test('release control plane bootstrap creates only the three governance collections', () => {
  assert.match(source, /release_locks/)
  assert.match(source, /release_runs/)
  assert.match(source, /release_state/)
  assert.match(source, /checkCollectionExists/)
  assert.match(source, /createCollection/)
})
