import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  buildTcbCommand,
  parseArgs,
  parseFirstJson,
  redactSensitive,
  runCloudReleaseSmoke,
} from '../cloud-release-smoke.mjs'

function payloadFromArgs(args) {
  const index = args.indexOf('-d')
  if (index < 0) return {}
  const value = args[index + 1]
  if (String(value).startsWith('@')) return JSON.parse(readFileSync(String(value).slice(1), 'utf8'))
  return JSON.parse(value)
}

function commandPart(args, offset) {
  const tcbIndex = args.indexOf('tcb')
  return args[tcbIndex + offset]
}

function createMockRunner(options = {}) {
  const calls = []
  const runner = async (command, args) => {
    calls.push({ command, args })
    const kind = commandPart(args, 1)
    const action = commandPart(args, 2)
    const fn = commandPart(args, 3)

    if (kind !== 'fn') return { status: 2, stdout: '', stderr: 'unexpected command' }

    if (action === 'log') {
      if (options.logFailures?.includes(fn)) {
        return { status: 1, stdout: JSON.stringify({ error: { code: 'InternalError', message: 'log failed' } }), stderr: '' }
      }
      const logText = options.missingPostRunId && fn === 'post'
        ? 'recent log without smoke id'
        : `recent log for ${fn} ${options.runId || 'unit-run'}`
      return { status: 0, stdout: JSON.stringify({ logs: [{ fn, log: logText }] }), stderr: '' }
    }

    if (action !== 'invoke') return { status: 2, stdout: '', stderr: 'unexpected action' }
    const payload = payloadFromArgs(args)
    if (fn === 'user' || fn === 'section') {
      return { status: 1, stdout: JSON.stringify({ error: 'Missing OPENID' }), stderr: '' }
    }
    if (fn === 'community') return { status: 0, stdout: JSON.stringify({ communities: [] }), stderr: '' }
    if (fn === 'member') return { status: 0, stdout: JSON.stringify({ communities: [] }), stderr: '' }
    if (fn === 'post') return { status: 0, stdout: JSON.stringify({ success: true, receivedAt: 'now', echo: payload.details?.runId }), stderr: '' }
    if (fn === 'http-gateway') return { status: 0, stdout: JSON.stringify({ statusCode: 200, body: '' }), stderr: '' }

    if (fn === 'admin') {
      if (payload.action === 'community.createAdmin') return { status: 0, stdout: JSON.stringify({ communityId: 'c1' }), stderr: '' }
      if (payload.action === 'section.create') return { status: 0, stdout: JSON.stringify({ sectionId: 's1' }), stderr: '' }
      if (payload.action === 'section.updateWidgets') return { status: 0, stdout: JSON.stringify({ widgets: [{ widgetId: 'w1' }] }), stderr: '' }
      if (payload.action === 'post.createAdmin') return { status: 0, stdout: JSON.stringify({ postId: 'p1' }), stderr: '' }
      if (payload.action === 'post.listAdmin') return { status: 0, stdout: JSON.stringify({ posts: [{ _id: 'p1' }] }), stderr: '' }
      if (payload.action === 'community.disable') return { status: 0, stdout: JSON.stringify({ success: true }), stderr: '' }
      if (payload.action === 'community.hardDelete') {
        return options.cleanupFails
          ? { status: 1, stdout: '', stderr: 'hard delete failed' }
          : { status: 0, stdout: JSON.stringify({ success: true }), stderr: '' }
      }
    }

    return { status: 2, stdout: '', stderr: `unhandled ${fn}/${payload.action}` }
  }
  runner.calls = calls
  return runner
}

async function tempEvidenceDir() {
  return await mkdtemp(join(tmpdir(), 'happyhome-cloud-smoke-'))
}

test('parseArgs supports env, only, log controls, no-fixture, and evidence-dir', () => {
  const args = parseArgs([
    '--env-id', 'env-x',
    '--only=user,post,missing',
    '--log-limit=7',
    '--log-wait-ms=0',
    '--no-fixture',
    '--evidence-dir', 'evidence-x',
    '--run-id', 'run-x',
  ], {})

  assert.equal(args.envId, 'env-x')
  assert.deepEqual(args.only, ['user', 'post'])
  assert.equal(args.logLimit, 7)
  assert.equal(args.logWaitMs, 0)
  assert.equal(args.noFixture, true)
  assert.equal(args.evidenceDir, 'evidence-x')
  assert.equal(args.runId, 'run-x')
})

test('buildTcbCommand and redaction keep command evidence safe', () => {
  const cmd = buildTcbCommand(['fn', 'invoke', 'post', '-d', '{"action":"clientLog"}'])
  assert.equal(cmd.args.slice(0, 3).join(' '), '--yes --package @cloudbase/cli')
  assert.equal(cmd.args[3], 'tcb')

  const redacted = redactSensitive('Authorization: Bearer secret-token --api-key abc123', { ADMIN_TOKEN: 'secret-token' })
  assert.match(redacted, /Bearer \[REDACTED\]/)
  assert.match(redacted, /--api-key \[REDACTED\]/)
  assert.doesNotMatch(redacted, /secret-token|abc123/)
})

test('parseFirstJson skips CLI banners', () => {
  const parsed = parseFirstJson('CloudBase CLI 3.5.6\ntry tcb ai\n{"ok":true,"value":1}\n')
  assert.deepEqual(parsed, { ok: true, value: 1 })
})

test('cloud release smoke passes with generated invoke, log, fixture, and cleanup evidence', async () => {
  const evidenceDir = await tempEvidenceDir()
  try {
    const runId = 'unit-run'
    const summary = await runCloudReleaseSmoke({
      envId: 'env-x',
      only: ['user', 'community', 'member', 'section', 'post', 'admin', 'http-gateway'],
      logLimit: 3,
      logWaitMs: 0,
      noFixture: false,
      evidenceDir,
      runId,
    }, createMockRunner({ runId }))

    assert.equal(summary.status, 'passed')
    assert.equal(summary.missingLabels.length, 0)
    assert(summary.labels.includes('HH_CLOUD_INVOKE_SMOKE_ADMIN_FIXTURE'))
    assert(summary.labels.includes('HH_CLOUD_FIXTURE_CLEANUP_OK'))

    const stored = JSON.parse(await readFile(join(evidenceDir, 'summary.json'), 'utf8'))
    assert.equal(stored.status, 'passed')
  } finally {
    await rm(evidenceDir, { recursive: true, force: true })
  }
})

test('post smoke fails when recent logs do not include the runId', async () => {
  const evidenceDir = await tempEvidenceDir()
  try {
    const summary = await runCloudReleaseSmoke({
      envId: 'env-x',
      only: ['post'],
      logLimit: 3,
      logWaitMs: 0,
      noFixture: true,
      evidenceDir,
      runId: 'unit-run',
    }, createMockRunner({ missingPostRunId: true, runId: 'unit-run' }))

    assert.equal(summary.status, 'failed')
    assert(summary.failures.some((failure) => /runId/.test(failure.message)))
  } finally {
    await rm(evidenceDir, { recursive: true, force: true })
  }
})

test('admin fixture smoke fails when cleanup fails', async () => {
  const evidenceDir = await tempEvidenceDir()
  try {
    const summary = await runCloudReleaseSmoke({
      envId: 'env-x',
      only: ['admin'],
      logLimit: 3,
      logWaitMs: 0,
      noFixture: false,
      evidenceDir,
      runId: 'unit-run',
    }, createMockRunner({ cleanupFails: true, runId: 'unit-run' }))

    assert.equal(summary.status, 'failed')
    assert.equal(summary.cleanup.ok, false)
    assert(summary.failures.some((failure) => /cleanup/.test(failure.message)))
  } finally {
    await rm(evidenceDir, { recursive: true, force: true })
  }
})

test('optional non-post log failures are warnings, not hard blockers', async () => {
  const evidenceDir = await tempEvidenceDir()
  try {
    const summary = await runCloudReleaseSmoke({
      envId: 'env-x',
      only: ['section'],
      logLimit: 3,
      logWaitMs: 0,
      noFixture: true,
      evidenceDir,
      runId: 'unit-run',
    }, createMockRunner({ logFailures: ['section'], runId: 'unit-run' }))

    assert.equal(summary.status, 'passed')
    assert(summary.warnings.some((warning) => /section log capture failed/.test(warning.message)))
  } finally {
    await rm(evidenceDir, { recursive: true, force: true })
  }
})
