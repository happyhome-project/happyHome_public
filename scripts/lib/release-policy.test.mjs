import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { isDevtoolsLoginSigningFailure, shouldFallbackAfterDevtoolsFailure } from './release-policy.mjs'

test('blocks fallback when DevTools login or signing state is bad', () => {
  assert.equal(isDevtoolsLoginSigningFailure('Cloud API signed-header failure'), true)
  assert.equal(isDevtoolsLoginSigningFailure('getCloudAPISignedHeader failed ret=41002'), true)
  assert.equal(shouldFallbackAfterDevtoolsFailure({
    target: 'cloud',
    reason: 'Cloud API signed-header failure',
  }), false)
})

test('blocks miniprogram upload fallback unless explicitly forced', () => {
  assert.equal(shouldFallbackAfterDevtoolsFailure({
    target: 'miniprogram-upload',
    reason: 'DevTools CLI unavailable',
  }), false)
  assert.equal(shouldFallbackAfterDevtoolsFailure({
    target: 'miniprogram-upload',
    reason: 'DevTools CLI unavailable',
    forceCi: true,
  }), true)
})

test('allows non-upload fallback for non-login DevTools failures', () => {
  assert.equal(shouldFallbackAfterDevtoolsFailure({
    target: 'cloud',
    reason: 'DevTools CLI not found',
  }), true)
})

test('release cloud smoke ensures required database collections before invoking fixtures', () => {
  const deployScript = readFileSync(new URL('../deploy.mjs', import.meta.url), 'utf8')
  const ensureIndexesScript = readFileSync(new URL('../ensure-indexes.mjs', import.meta.url), 'utf8')
  const runCloudSmokeBody = deployScript.match(/async function runCloudSmoke[\s\S]+?\n}/)?.[0] || ''

  assert.match(ensureIndexesScript, /content_audit_tasks/)
  assert.match(ensureIndexesScript, /admin_notification_subscriptions/)
  assert.match(ensureIndexesScript, /admin_notifications/)
  assert.match(runCloudSmokeBody, /ensure:indexes/)
  assert(runCloudSmokeBody.indexOf('ensure:indexes') < runCloudSmokeBody.indexOf('runCloudReleaseSmoke'))
})
