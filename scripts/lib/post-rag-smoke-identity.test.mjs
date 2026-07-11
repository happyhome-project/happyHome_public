import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const {
  signPostRagSmokeIdentity,
  verifyPostRagSmokeIdentity,
} = require('../../cloud/shared/post-rag-smoke-identity.cjs')

const secret = 's'.repeat(48)
const now = 1_784_000_000_000

function claims(overrides = {}) {
  return {
    version: 1,
    action: 'search',
    communityId: 'fixture-community',
    runId: 'fixture-run',
    userId: 'fixture-user',
    expiresAt: now + 60_000,
    ...overrides,
  }
}

test('signed smoke identity is accepted only for the signed search community', () => {
  const identity = signPostRagSmokeIdentity(claims(), secret)
  assert.deepEqual(verifyPostRagSmokeIdentity(identity, {
    secret,
    action: 'search',
    communityId: 'fixture-community',
    now,
  }), claims())

  assert.equal(verifyPostRagSmokeIdentity(identity, {
    secret,
    action: 'search',
    communityId: 'other-community',
    now,
  }), null)
})

test('signed five-minute smoke identity tolerates one minute of verifier clock skew', () => {
  const identity = signPostRagSmokeIdentity(claims({ expiresAt: now + 5 * 60_000 }), secret)

  assert.deepEqual(verifyPostRagSmokeIdentity(identity, {
    secret,
    action: 'search',
    communityId: 'fixture-community',
    now: now - 30_000,
  }), claims({ expiresAt: now + 5 * 60_000 }))
})

test('signed smoke identity rejects tampering, expiration, and non-search use', () => {
  const identity = signPostRagSmokeIdentity(claims(), secret)
  assert.equal(verifyPostRagSmokeIdentity({ ...identity, userId: 'attacker' }, {
    secret,
    action: 'search',
    communityId: 'fixture-community',
    now,
  }), null)
  assert.equal(verifyPostRagSmokeIdentity(signPostRagSmokeIdentity(claims({ expiresAt: now - 1 }), secret), {
    secret,
    action: 'search',
    communityId: 'fixture-community',
    now,
  }), null)
  assert.equal(verifyPostRagSmokeIdentity(identity, {
    secret,
    action: 'delete',
    communityId: 'fixture-community',
    now,
  }), null)
})
