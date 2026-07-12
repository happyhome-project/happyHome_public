import assert from 'node:assert/strict'
import test from 'node:test'

import {
  REQUIRED_NIGHTLY_ENV,
  createNotificationPlan,
  deriveNightlyResult,
  finalizeNightlyRun,
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

test('nightly result fails when a stage recovered from flakiness', () => {
  assert.deepEqual(deriveNightlyResult({
    stages: [{ status: 'recovered_flaky' }],
    cleanupIssues: [],
  }), { status: 'failed', testStatus: 'failed' })
})

test('nightly result fails when cleanup has issues', () => {
  assert.deepEqual(deriveNightlyResult({
    stages: [],
    cleanupIssues: ['temporary fixture remains'],
  }), { status: 'failed', testStatus: 'failed' })
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

const baseSummary = (testStatus = 'passed') => ({
  status: testStatus,
  testStatus,
  branch: 'codex/test',
  startedAt: '2026-07-12T00:00:00.000Z',
  finishedAt: '2026-07-12T00:01:00.000Z',
  artifactRoot: 'artifacts/nightly/test',
  cleanupIssues: [],
  stages: [],
})

test('missing webhook plans a skipped stage and preserves a passing exit', () => {
  const plan = createNotificationPlan({
    webhook: '',
    timestamp: '2026-07-12T00:01:00.000Z',
    env: { GITHUB_ACTIONS: 'true' },
  })
  assert.equal(plan.shouldRun, false)
  assert.equal(plan.stage.status, 'skipped')
  assert.equal(plan.warning, '::warning::WeCom notification skipped because no webhook is configured')

  const result = finalizeNightlyRun({ summary: baseSummary(), notificationStage: plan.stage })
  assert.equal(result.summary.status, 'passed')
  assert.equal(result.summary.notificationStatus, 'skipped')
  assert.equal(result.exitCode, 0)
})

test('failed notification does not overwrite a passing nightly result', () => {
  const result = finalizeNightlyRun({
    summary: baseSummary(),
    notificationStage: { status: 'failed' },
    env: { GITHUB_ACTIONS: 'true' },
  })

  assert.equal(result.summary.status, 'passed')
  assert.equal(result.summary.testStatus, 'passed')
  assert.equal(result.summary.notificationStatus, 'failed')
  assert.equal(result.warning, '::warning::WeCom notification failed')
  assert.equal(result.exitCode, 0)
})

test('failed tests exit nonzero for every notification outcome', () => {
  for (const [stageStatus, notificationStatus] of [
    ['skipped', 'skipped'],
    ['passed', 'sent'],
    ['failed', 'failed'],
  ]) {
    const result = finalizeNightlyRun({
      summary: baseSummary('failed'),
      notificationStage: { status: stageStatus },
    })
    assert.equal(result.summary.status, 'failed', stageStatus)
    assert.equal(result.summary.notificationStatus, notificationStatus, stageStatus)
    assert.equal(result.exitCode, 1, stageStatus)
  }
})

test('JSON summary fields and Markdown report expose the same three statuses', () => {
  const result = finalizeNightlyRun({
    summary: baseSummary(),
    notificationStage: { status: 'passed' },
  })
  const json = JSON.parse(JSON.stringify(result.summary))

  assert.deepEqual(
    { status: json.status, testStatus: json.testStatus, notificationStatus: json.notificationStatus },
    { status: 'passed', testStatus: 'passed', notificationStatus: 'sent' },
  )
  assert.match(result.markdown, /- Status: passed/)
  assert.match(result.markdown, /- Test status: passed/)
  assert.match(result.markdown, /- Notification status: sent/)
})
