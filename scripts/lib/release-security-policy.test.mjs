import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertReleaseCapabilitySeparation,
  assertReleaseFunctionSecurityConfig,
} from './release-security-policy.mjs'

const STRONG_ADMIN_TOKEN = '0123456789abcdef'.repeat(3)
const STRONG_GATEWAY_TOKEN = 'fedcba9876543210'.repeat(3)

test('production identity functions reject test OPENID injection', () => {
  assert.throws(() => assertReleaseFunctionSecurityConfig('user', [
    { Key: 'ALLOW_TEST_OPENID', Value: 'true' },
  ]), /ALLOW_TEST_OPENID/)
  assert.doesNotThrow(() => assertReleaseFunctionSecurityConfig('user', [
    { Key: 'ALLOW_TEST_OPENID', Value: 'false' },
  ]))
})

test('admin requires internal capability and disables legacy shared-token fallback', () => {
  assert.throws(() => assertReleaseFunctionSecurityConfig('admin', [
    { Key: 'ADMIN_INTERNAL_CALL_TOKEN', Value: STRONG_ADMIN_TOKEN },
    { Key: 'ADMIN_LEGACY_TOKEN_FALLBACK', Value: '1' },
  ]), /LEGACY/)
  assert.throws(() => assertReleaseFunctionSecurityConfig('admin', [
    { Key: 'ADMIN_LEGACY_TOKEN_FALLBACK', Value: '0' },
  ]), /INTERNAL_CALL_TOKEN/)
  assert.throws(() => assertReleaseFunctionSecurityConfig('admin', [
    { Key: 'ADMIN_INTERNAL_CALL_TOKEN', Value: 'short' },
  ]), /strong ADMIN_INTERNAL_CALL_TOKEN/)
  assert.throws(() => assertReleaseFunctionSecurityConfig('admin', [
    { Key: 'ADMIN_INTERNAL_CALL_TOKEN', Value: 'a'.repeat(48) },
  ]), /strong ADMIN_INTERNAL_CALL_TOKEN/)
  assert.doesNotThrow(() => assertReleaseFunctionSecurityConfig('admin', [
    { Key: 'ADMIN_INTERNAL_CALL_TOKEN', Value: STRONG_ADMIN_TOKEN },
    { Key: 'ADMIN_LEGACY_TOKEN_FALLBACK', Value: '0' },
  ]))
  assert.throws(() => assertReleaseFunctionSecurityConfig('admin', [
    { Key: 'ADMIN_INTERNAL_CALL_TOKEN', Value: STRONG_ADMIN_TOKEN },
    { Key: 'ADMIN_LEGACY_TOKEN_FALLBACK', Value: '0' },
    { Key: 'BOOTSTRAP_ADMIN_ENABLED', Value: 'true' },
  ]), /BOOTSTRAP_ADMIN_ENABLED/)
})

test('admin and enabled gateway require separate capabilities', () => {
  assert.throws(() => assertReleaseCapabilitySeparation({
    admin: [{ Key: 'ADMIN_INTERNAL_CALL_TOKEN', Value: STRONG_ADMIN_TOKEN }],
    'http-gateway': [
      { Key: 'GATEWAY_ENABLED', Value: 'true' },
      { Key: 'GATEWAY_TOKEN', Value: STRONG_ADMIN_TOKEN },
    ],
  }), /must not share/)
  assert.doesNotThrow(() => assertReleaseCapabilitySeparation({
    admin: [{ Key: 'ADMIN_INTERNAL_CALL_TOKEN', Value: STRONG_ADMIN_TOKEN }],
    'http-gateway': [
      { Key: 'GATEWAY_ENABLED', Value: 'true' },
      { Key: 'GATEWAY_TOKEN', Value: STRONG_GATEWAY_TOKEN },
    ],
  }))
})

test('enabled gateway requires a dedicated token while disabled gateway is fail-closed', () => {
  assert.throws(() => assertReleaseFunctionSecurityConfig('http-gateway', [
    { Key: 'GATEWAY_ENABLED', Value: 'true' },
  ]), /GATEWAY_TOKEN/)
  assert.throws(() => assertReleaseFunctionSecurityConfig('http-gateway', [
    { Key: 'GATEWAY_ENABLED', Value: 'true' },
    { Key: 'GATEWAY_TOKEN', Value: 'short' },
  ]), /strong GATEWAY_TOKEN/)
  assert.doesNotThrow(() => assertReleaseFunctionSecurityConfig('http-gateway', [
    { Key: 'GATEWAY_ENABLED', Value: 'false' },
  ]))
})
