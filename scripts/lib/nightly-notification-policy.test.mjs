import assert from 'node:assert/strict'
import test from 'node:test'

import {
  REQUIRED_NIGHTLY_ENV,
  deriveNightlyResult,
  formatWorkflowWarning,
  notificationStatusFromStage,
} from './nightly-notification-policy.mjs'

test('nightly execution does not require a WeCom webhook', () => {
  assert.equal(REQUIRED_NIGHTLY_ENV.includes('WECOM_WEBHOOK_URL'), false)
})

test('nightly result passes when stages and cleanup pass', () => {
  assert.deepEqual(deriveNightlyResult({ stages: [], cleanupIssues: [] }), {
    status: 'passed', testStatus: 'passed',
  })
})

test('nightly test status fails when a stage fails', () => {
  assert.equal(deriveNightlyResult({
    stages: [{ status: 'failed' }],
    cleanupIssues: [],
  }).testStatus, 'failed')
})

test('notification status distinguishes skipped, sent, and failed stages', () => {
  assert.equal(notificationStatusFromStage({ status: 'skipped' }), 'skipped')
  assert.equal(notificationStatusFromStage({ status: 'passed' }), 'sent')
  assert.equal(notificationStatusFromStage({ status: 'failed' }), 'failed')
})

test('workflow warning uses a fixed sanitized message', () => {
  assert.equal(
    formatWorkflowWarning('failed', { GITHUB_ACTIONS: 'true' }),
    '::warning::WeCom notification failed',
  )
})
