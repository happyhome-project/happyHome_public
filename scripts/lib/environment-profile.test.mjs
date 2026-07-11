import assert from 'node:assert/strict'
import test from 'node:test'

import { assertEnvironmentProfile } from './environment-profile.mjs'

const canonical = 'C:\\Project\\Claude\\happyHome'

test('release profile rejects noncanonical, dirty, and stale worktrees', () => {
  assert.doesNotThrow(() => assertEnvironmentProfile('release', {
    canonicalPath: canonical,
    cwd: canonical,
    branch: 'main',
    dirty: false,
    head: 'a',
    originMain: 'a',
  }))
  assert.throws(() => assertEnvironmentProfile('release', { canonicalPath: canonical, cwd: 'X:\\worktrees\\feature', branch: 'main', dirty: false, head: 'a', originMain: 'a' }), /canonical/i)
  assert.throws(() => assertEnvironmentProfile('release', { canonicalPath: canonical, cwd: canonical, branch: 'main', dirty: true, head: 'a', originMain: 'a' }), /clean/i)
  assert.throws(() => assertEnvironmentProfile('release', { canonicalPath: canonical, cwd: canonical, branch: 'main', dirty: false, head: 'a', originMain: 'b' }), /origin\/main/i)
})

test('read and fixture-write profiles do not grant production access', () => {
  assert.doesNotThrow(() => assertEnvironmentProfile('read', {}))
  assert.doesNotThrow(() => assertEnvironmentProfile('fixture-write', {}))
  assert.throws(() => assertEnvironmentProfile('unknown', {}), /Unknown environment profile/)
})
