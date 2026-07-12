import assert from 'node:assert/strict'
import test from 'node:test'

import {
  REQUIRED_NIGHTLY_ENV,
  completeNightlyFailure,
  createNotificationPlan,
  deriveNightlyResult,
  finalizeNightlyRun,
  formatWorkflowWarning,
  notificationStatusFromStage,
  writeNightlyOutcome,
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

const failureInput = (overrides = {}) => ({
  error: new Error('original nightly failure'),
  stages: [{ key: 'tests', name: 'tests', status: 'failed', durationMs: 1 }],
  cleanupIssues: [],
  webhook: 'https://example.invalid/webhook',
  summary: baseSummary('failed'),
  warn: () => {},
  writeOutcome: async () => {},
  ...overrides,
})

function assertCompleteNotificationStage(result, expectedStatus) {
  const stage = result.summary.stages.find(({ key }) => key === 'notify-wecom')
  assert.deepEqual(Object.keys(stage).sort(), [
    'command', 'durationMs', 'finishedAt', 'key', 'logPath', 'name', 'notes', 'startedAt', 'status',
  ])
  assert.equal(stage.name, 'WeCom notification')
  assert.equal(stage.status, expectedStatus)
  assert.equal(typeof stage.startedAt, 'string')
  assert.equal(typeof stage.finishedAt, 'string')
  assert.equal(typeof stage.durationMs, 'number')
  assert.doesNotMatch(result.markdown, /undefined/)
}

test('configured failure completion calls sender and records a sent notification', async () => {
  let calls = 0
  let written
  const result = await completeNightlyFailure(failureInput({
    sendNotification: async (summary) => {
      calls += 1
      assert.equal(summary.testStatus, 'failed')
      assert.match(summary.error, /original nightly failure/)
      return { status: 'sent' }
    },
    writeOutcome: async (outcome) => { written = outcome },
  }))

  assert.equal(calls, 1)
  assert.equal(result.summary.testStatus, 'failed')
  assert.equal(result.summary.notificationStatus, 'sent')
  assert.equal(result.exitCode, 1)
  assert.equal(written, result)
  assertCompleteNotificationStage(result, 'passed')
})

test('configured failure completion maps sender rejection to failed notification and fixed warning', async () => {
  const warnings = []
  const result = await completeNightlyFailure(failureInput({
    sendNotification: async () => { throw new Error('sensitive transport detail') },
    warn: (warning) => warnings.push(warning),
    env: { GITHUB_ACTIONS: 'true' },
  }))

  assert.equal(result.summary.status, 'failed')
  assert.equal(result.summary.notificationStatus, 'failed')
  assert.equal(result.exitCode, 1)
  assert.deepEqual(warnings, ['::warning::WeCom notification failed'])
  assertCompleteNotificationStage(result, 'failed')
})

test('missing webhook skips sender while preserving failed test outcome', async () => {
  let called = false
  const result = await completeNightlyFailure(failureInput({
    webhook: '',
    sendNotification: async () => { called = true },
  }))

  assert.equal(called, false)
  assert.equal(result.summary.notificationStatus, 'skipped')
  assert.equal(result.summary.testStatus, 'failed')
  assert.equal(result.exitCode, 1)
  assertCompleteNotificationStage(result, 'skipped')
})

test('outcome writer sends identical summary and Markdown data to every destination', async () => {
  const writes = []
  const outcome = finalizeNightlyRun({
    summary: baseSummary('failed'),
    notificationStage: { status: 'failed' },
  })
  await writeNightlyOutcome({
    outcome,
    writeJson: async (summary) => writes.push(['json', summary]),
    writeMarkdown: async (markdown) => writes.push(['markdown', markdown]),
    writeStepSummary: async (markdown) => writes.push(['github', markdown]),
  })

  assert.equal(writes[0][1], outcome.summary)
  assert.equal(writes[1][1], outcome.markdown)
  assert.equal(writes[2][1], outcome.markdown)
})

test('failure completion preserves the original error when outcome writing also fails', async () => {
  const original = new Error('original nightly failure')
  const writeError = new Error('summary disk full')
  await assert.rejects(
    completeNightlyFailure(failureInput({
      error: original,
      sendNotification: async () => ({ status: 'passed' }),
      writeOutcome: async () => { throw writeError },
    })),
    (error) => {
      assert.equal(error.cause, original)
      assert.deepEqual(error.errors, [original, writeError])
      return true
    },
  )
})
