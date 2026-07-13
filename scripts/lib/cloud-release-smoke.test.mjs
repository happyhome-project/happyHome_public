import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  buildLogsSearchArgs,
  buildTcbCommand,
  DEFAULT_FUNCTIONS,
  REQUIRED_SMOKE_LABELS,
  defaultRunner,
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

function logSearchFunction(args) {
  const query = args[args.indexOf('--query') + 1] || ''
  const match = query.match(/function_name:"([^"]+)"/)
  return match?.[1] || ''
}

function createMockRunner(options = {}) {
  const calls = []
  const runner = async (command, args, runnerOptions = {}) => {
    calls.push({ command, args, options: runnerOptions })
    const kind = commandPart(args, 1)
    const action = commandPart(args, 2)
    const fn = commandPart(args, 3)

    if (kind === 'logs' && action === 'search') {
      const searchFn = logSearchFunction(args)
      const sequence = options.logSearchResponses?.[searchFn] || options.logResponses?.[searchFn]
      if (sequence?.length) return sequence.shift()
      if (options.logSearchFailures?.includes(searchFn) || options.logFailures?.includes(searchFn)) {
        return { status: 1, stdout: JSON.stringify({ error: { code: 'InternalError', message: 'logs search failed' } }), stderr: '' }
      }
      const logText = options.missingPostRunId && searchFn === 'post'
        ? 'recent log without smoke id'
        : `recent log for ${searchFn} ${options.runId || 'unit-run'}`
      return { status: 0, stdout: JSON.stringify({ records: [{ function_name: searchFn, log: logText }] }), stderr: '' }
    }

    if (kind !== 'fn') return { status: 2, stdout: '', stderr: 'unexpected command' }

    if (action === 'log') {
      const sequence = options.legacyLogResponses?.[fn]
      if (sequence?.length) return sequence.shift()
      if (options.legacyLogFailures?.includes(fn) || options.logFailures?.includes(fn)) {
        return { status: 1, stdout: JSON.stringify({ error: { code: 'InternalError', message: 'log failed' } }), stderr: '' }
      }
      const logText = options.missingPostRunId && fn === 'post'
        ? 'recent log without smoke id'
        : `recent log for ${fn} ${options.runId || 'unit-run'}`
      return { status: 0, stdout: JSON.stringify({ logs: [{ fn, log: logText }] }), stderr: '' }
    }

    if (action !== 'invoke') return { status: 2, stdout: '', stderr: 'unexpected action' }
    const payload = payloadFromArgs(args)
    const invokeSequence = options.invokeResponses?.[fn]
    if (invokeSequence?.length) return invokeSequence.shift()
    if (fn === 'user' || fn === 'section') {
      return { status: 1, stdout: JSON.stringify({ error: 'Missing OPENID' }), stderr: '' }
    }
    if (fn === 'community') return { status: 0, stdout: JSON.stringify({ communities: [] }), stderr: '' }
    if (fn === 'member') return { status: 0, stdout: JSON.stringify({ communities: [] }), stderr: '' }
    if (fn === 'post') {
      return options.missingPostInvokeRunId
        ? { status: 0, stdout: JSON.stringify({ success: true, receivedAt: 'now' }), stderr: '' }
        : { status: 0, stdout: JSON.stringify({ success: true, receivedAt: 'now', echo: payload.details?.runId }), stderr: '' }
    }
    if (fn === 'post-rag-worker' || fn === 'post-video-rag-worker') {
      return payload.workerToken === 'unit-worker-token' && payload.postId === '__release_smoke_missing__'
        ? { status: 0, stdout: JSON.stringify({ scannedCount: 0, results: [] }), stderr: '' }
        : { status: 1, stdout: JSON.stringify({ errorMessage: 'Unauthorized' }), stderr: '' }
    }
    if (fn === 'http-gateway') return { status: 0, stdout: JSON.stringify({ statusCode: 200, body: '' }), stderr: '' }
    if (fn === 'home-prefetch') return { status: 0, stdout: JSON.stringify({ statusCode: 200, body: '' }), stderr: '' }

    if (fn === 'admin') {
      if (payload.action === 'community.createAdmin') return { status: 0, stdout: JSON.stringify({ communityId: 'c1' }), stderr: '' }
      if (payload.action === 'section.create') return { status: 0, stdout: JSON.stringify({ sectionId: 's1' }), stderr: '' }
      if (payload.action === 'section.updateWidgets') return { status: 0, stdout: JSON.stringify({ widgets: [{ widgetId: 'w1' }] }), stderr: '' }
      if (payload.action === 'post.createAdmin') return { status: 0, stdout: JSON.stringify({ postId: 'p1' }), stderr: '' }
      if (payload.action === 'post.listAdmin') return { status: 0, stdout: JSON.stringify({ posts: [{ _id: 'p1' }] }), stderr: '' }
      if (payload.action === 'community.disable') {
        return options.disableFails
          ? { status: 1, stdout: '', stderr: 'disable failed' }
          : { status: 0, stdout: JSON.stringify({ success: true }), stderr: '' }
      }
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
    '--command-timeout-ms=1234',
    '--concurrency=4',
    '--no-fixture',
    '--evidence-dir', 'evidence-x',
    '--run-id', 'run-x',
  ], { POST_RAG_WORKER_TOKEN: 'unit-worker-token', ADMIN_INTERNAL_CALL_TOKEN: 'unit-admin-token' })

  assert.equal(args.envId, 'env-x')
  assert.deepEqual(args.only, ['user', 'post'])
  assert.equal(args.logLimit, 7)
  assert.equal(args.logWaitMs, 0)
  assert.equal(args.commandTimeoutMs, 1234)
  assert.equal(args.concurrency, 4)
  assert.equal(args.noFixture, true)
  assert.equal(args.workerToken, 'unit-worker-token')
  assert.equal(args.adminInternalToken, 'unit-admin-token')
  assert.equal(args.evidenceDir, 'evidence-x')
  assert.equal(args.runId, 'run-x')
})

test('release smoke requires home-prefetch invoke evidence', async () => {
  assert(DEFAULT_FUNCTIONS.includes('home-prefetch'))
  assert(REQUIRED_SMOKE_LABELS.includes('HH_CLOUD_INVOKE_SMOKE_HOME_PREFETCH'))

  const evidenceDir = await tempEvidenceDir()
  try {
    const summary = await runCloudReleaseSmoke({
      envId: 'env-x',
      only: ['home-prefetch'],
      logLimit: 3,
      logWaitMs: 0,
      noFixture: true,
      evidenceDir,
      runId: 'unit-run',
    }, createMockRunner({
      invokeResponses: {
        'home-prefetch': [{ status: 1, stdout: '', stderr: 'prefetch failed' }],
      },
    }))

    assert.equal(summary.status, 'failed')
    assert(summary.missingLabels.includes('HH_CLOUD_INVOKE_SMOKE_HOME_PREFETCH'))
  } finally {
    await rm(evidenceDir, { recursive: true, force: true })
  }
})

test('release smoke revalidates immediately before every remote command', async () => {
  const evidenceDir = await tempEvidenceDir()
  let remoteCommandRan = false
  try {
    await assert.rejects(() => runCloudReleaseSmoke({
      envId: 'env-x',
      only: ['community'],
      logLimit: 1,
      logWaitMs: 0,
      noFixture: true,
      evidenceDir,
      runId: 'unit-run',
      beforeCommand: () => { throw new Error('workspace drift') },
    }, async () => {
      remoteCommandRan = true
      return { status: 0, stdout: '{}', stderr: '' }
    }), /workspace drift/i)
    assert.equal(remoteCommandRan, false)
  } finally {
    await rm(evidenceDir, { recursive: true, force: true })
  }
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

test('buildLogsSearchArgs uses CLS function and runId filters', () => {
  const args = buildLogsSearchArgs('post', { contains: 'unit-run', errorOnly: true }, 7)
  assert.equal(args[0], 'logs')
  assert.equal(args[1], 'search')
  assert.equal(args[args.indexOf('--limit') + 1], '7')
  assert.equal(args[args.indexOf('--sort') + 1], 'desc')
  const query = args[args.indexOf('--query') + 1]
  assert.match(query, /function_name:"post"/)
  assert.match(query, /log:"unit-run"/)
  assert.match(query, /status_code>200/)
})

test('parseFirstJson skips CLI banners', () => {
  const parsed = parseFirstJson('CloudBase CLI 3.5.6\ntry tcb ai\n{"ok":true,"value":1}\n')
  assert.deepEqual(parsed, { ok: true, value: 1 })
})

test('default runner stops commands that exceed the smoke command timeout', async () => {
  const result = await defaultRunner(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], {
    timeoutMs: 10,
  })

  assert.equal(result.status, 1)
  assert.match(result.error, /timed out/)
})

test('cloud release smoke passes with generated invoke, log, fixture, and cleanup evidence', async () => {
  const evidenceDir = await tempEvidenceDir()
  try {
    const runId = 'unit-run'
    const summary = await runCloudReleaseSmoke({
      envId: 'env-x',
      only: ['user', 'community', 'member', 'section', 'post', 'post-rag-worker', 'post-video-rag-worker', 'admin', 'http-gateway'],
      logLimit: 3,
      logWaitMs: 0,
      noFixture: false,
      workerToken: 'unit-worker-token',
      adminInternalToken: 'unit-admin-token',
      evidenceDir,
      runId,
    }, createMockRunner({ runId }))

    assert.equal(summary.status, 'passed')
    assert.equal(summary.missingLabels.length, 0)
    assert(summary.labels.includes('HH_CLOUD_INVOKE_SMOKE_POST_RAG_WORKER'))
    assert(summary.labels.includes('HH_CLOUD_INVOKE_SMOKE_POST_VIDEO_RAG_WORKER'))
    assert(summary.labels.includes('HH_CLOUD_INVOKE_SMOKE_ADMIN_FIXTURE'))
    assert(summary.labels.includes('HH_CLOUD_FIXTURE_CLEANUP_OK'))

    const stored = JSON.parse(await readFile(join(evidenceDir, 'summary.json'), 'utf8'))
    assert.equal(stored.status, 'passed')
  } finally {
    await rm(evidenceDir, { recursive: true, force: true })
  }
})

test('fixture cleanup uses its dedicated fence even when ordinary mutation revalidation would report main drift', async () => {
  const evidenceDir = await tempEvidenceDir()
  try {
    const cleanupStages = []
    const summary = await runCloudReleaseSmoke({
      envId: 'env-x', only: ['admin'], logLimit: 1, logWaitMs: 0, noFixture: false,
      evidenceDir, runId: 'unit-run', adminInternalToken: 'unit-token',
      beforeCommand: ({ stage }) => {
        if (/community\.(disable|hardDelete)/.test(stage)) throw new Error('main drift must not block cleanup')
      },
      beforeCleanupCommand: ({ stage }) => cleanupStages.push(stage),
    }, createMockRunner({ runId: 'unit-run' }))
    assert.equal(summary.cleanup.ok, true)
    assert.equal(cleanupStages.length, 2)
  } finally {
    await rm(evidenceDir, { recursive: true, force: true })
  }
})

test('cloud release smoke runs independent basic invokes with bounded concurrency', async () => {
  const evidenceDir = await tempEvidenceDir()
  try {
    let activeInvokes = 0
    let maxActiveInvokes = 0
    const baseRunner = createMockRunner({ runId: 'unit-run' })
    const runner = async (command, args, options) => {
      if (commandPart(args, 2) === 'invoke') {
        activeInvokes += 1
        maxActiveInvokes = Math.max(maxActiveInvokes, activeInvokes)
        await new Promise((resolve) => setTimeout(resolve, 20))
        const result = await baseRunner(command, args, options)
        activeInvokes -= 1
        return result
      }
      return await baseRunner(command, args, options)
    }

    const summary = await runCloudReleaseSmoke({
      envId: 'env-x',
      only: ['community', 'member', 'post'],
      logLimit: 3,
      logWaitMs: 0,
      commandTimeoutMs: 1234,
      concurrency: 3,
      noFixture: true,
      evidenceDir,
      runId: 'unit-run',
    }, runner)

    assert.equal(summary.status, 'passed')
    assert.equal(maxActiveInvokes, 3)
  } finally {
    await rm(evidenceDir, { recursive: true, force: true })
  }
})

test('post smoke fails when neither logs nor inline invoke output include the runId', async () => {
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
    }, createMockRunner({ missingPostRunId: true, missingPostInvokeRunId: true, runId: 'unit-run' }))

    assert.equal(summary.status, 'failed')
    assert(summary.failures.some((failure) => /runId/.test(failure.message)))
  } finally {
    await rm(evidenceDir, { recursive: true, force: true })
  }
})

test('post log capture can use inline invoke output when log listing is noisy', async () => {
  const evidenceDir = await tempEvidenceDir()
  try {
    const runId = 'unit-run'
    const summary = await runCloudReleaseSmoke({
      envId: 'env-x',
      only: ['post'],
      logLimit: 3,
      logWaitMs: 0,
      noFixture: true,
      evidenceDir,
      runId,
    }, createMockRunner({ missingPostRunId: true, runId }))

    assert.equal(summary.status, 'passed')
    assert(summary.labels.includes('HH_CLOUD_LOG_CAPTURE_POST'))
    const stored = JSON.parse(await readFile(join(evidenceDir, 'log-post.json'), 'utf8'))
    assert.equal(stored.method, 'inline-invoke-output')
    assert.equal(stored.inlineLogFallbackStage, 'invoke-post-clientLog')
  } finally {
    await rm(evidenceDir, { recursive: true, force: true })
  }
})

test('required post log capture uses logs search and retries with a smaller limit after transient CLS timeout', async () => {
  const evidenceDir = await tempEvidenceDir()
  try {
    const runId = 'unit-run'
    const runner = createMockRunner({
      runId,
      logResponses: {
        post: [
          {
            status: 1,
            stdout: JSON.stringify({
              error: {
                code: 'ResourceUnavailable',
                message: 'ClientError.NetworkError context deadline exceeded',
              },
            }),
            stderr: '',
          },
          { status: 0, stdout: JSON.stringify({ logs: [{ fn: 'post', log: `recent log for post ${runId}` }] }), stderr: '' },
        ],
      },
    })
    const summary = await runCloudReleaseSmoke({
      envId: 'env-x',
      only: ['post'],
      logLimit: 30,
      logWaitMs: 0,
      noFixture: true,
      evidenceDir,
      runId,
    }, runner)

    assert.equal(summary.status, 'passed')
    assert(summary.labels.includes('HH_CLOUD_LOG_CAPTURE_POST'))
    const logCalls = runner.calls.filter((call) => commandPart(call.args, 1) === 'logs' && commandPart(call.args, 2) === 'search' && logSearchFunction(call.args) === 'post')
    assert.equal(logCalls.length, 2)
    assert.deepEqual(logCalls.map((call) => call.args[call.args.indexOf('--limit') + 1]), ['30', '5'])
    assert(logCalls.every((call) => call.args.includes('--json')))

    const finalRecord = JSON.parse(await readFile(join(evidenceDir, 'log-post.json'), 'utf8'))
    assert.equal(finalRecord.ok, true)
    assert.equal(finalRecord.method, 'logs-search')
    assert.equal(finalRecord.attempts.length, 2)
    assert.equal(finalRecord.searchAttempts.length, 2)
    assert.equal(finalRecord.legacyAttempts.length, 0)
    assert.match(finalRecord.attempts[0].parsed.error.message, /context deadline exceeded/)
  } finally {
    await rm(evidenceDir, { recursive: true, force: true })
  }
})

test('required post log capture falls back to legacy fn log when logs search is unavailable', async () => {
  const evidenceDir = await tempEvidenceDir()
  try {
    const runId = 'unit-run'
    const runner = createMockRunner({
      runId,
      logSearchFailures: ['post'],
    })
    const summary = await runCloudReleaseSmoke({
      envId: 'env-x',
      only: ['post'],
      logLimit: 3,
      logWaitMs: 0,
      noFixture: true,
      evidenceDir,
      runId,
    }, runner)

    assert.equal(summary.status, 'passed')
    assert(summary.labels.includes('HH_CLOUD_LOG_CAPTURE_POST'))
    const stored = JSON.parse(await readFile(join(evidenceDir, 'log-post.json'), 'utf8'))
    assert.equal(stored.method, 'fn-log')
    assert.equal(stored.searchAttempts.length, 2)
    assert.equal(stored.legacyAttempts.length, 1)
    assert(runner.calls.some((call) => commandPart(call.args, 1) === 'fn' && commandPart(call.args, 2) === 'log'))
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
      adminInternalToken: 'unit-admin-token',
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

test('admin fixture cleanup passes when hard delete succeeds after disable failure', async () => {
  const evidenceDir = await tempEvidenceDir()
  try {
    const summary = await runCloudReleaseSmoke({
      envId: 'env-x',
      only: ['admin'],
      logLimit: 3,
      logWaitMs: 0,
      noFixture: false,
      adminInternalToken: 'unit-admin-token',
      evidenceDir,
      runId: 'unit-run',
    }, createMockRunner({ disableFails: true, runId: 'unit-run' }))

    assert.equal(summary.status, 'passed')
    assert.equal(summary.cleanup.ok, true)
    assert(summary.labels.includes('HH_CLOUD_FIXTURE_CLEANUP_OK'))
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

test('optional non-post log capture uses a small limit and command timeout', async () => {
  const evidenceDir = await tempEvidenceDir()
  try {
    const runner = createMockRunner({ runId: 'unit-run' })
    const summary = await runCloudReleaseSmoke({
      envId: 'env-x',
      only: ['admin'],
      logLimit: 30,
      logWaitMs: 0,
      commandTimeoutMs: 6789,
      noFixture: true,
      evidenceDir,
      runId: 'unit-run',
    }, runner)

    assert.equal(summary.status, 'passed')
    const logCall = runner.calls.find((call) => commandPart(call.args, 1) === 'logs' && commandPart(call.args, 2) === 'search' && logSearchFunction(call.args) === 'admin')
    assert.equal(logCall.args[logCall.args.indexOf('--limit') + 1], '5')
    assert.equal(logCall.options.timeoutMs, 6789)
  } finally {
    await rm(evidenceDir, { recursive: true, force: true })
  }
})

test('worker smoke fails clearly when the worker token is missing', async () => {
  const evidenceDir = await tempEvidenceDir()
  try {
    const runner = createMockRunner({ runId: 'unit-run' })
    const summary = await runCloudReleaseSmoke({
      envId: 'env-x',
      only: ['post-rag-worker'],
      logLimit: 3,
      logWaitMs: 0,
      commandTimeoutMs: 1234,
      noFixture: true,
      workerToken: '',
      evidenceDir,
      runId: 'unit-run',
    }, runner)

    assert.equal(summary.status, 'failed')
    assert(summary.failures.some((failure) => /missing POST_RAG_WORKER_TOKEN/.test(failure.message)))
    assert(!runner.calls.some((call) => commandPart(call.args, 2) === 'invoke'))
  } finally {
    await rm(evidenceDir, { recursive: true, force: true })
  }
})

test('required invoke retries transient CloudBase network failures', async () => {
  const evidenceDir = await tempEvidenceDir()
  try {
    const runner = createMockRunner({
      runId: 'unit-run',
      invokeResponses: {
        'post-rag-worker': [
          { status: 1, stdout: JSON.stringify({ error: { code: 'ECONNRESET', message: 'socket disconnected before secure TLS connection' } }), stderr: '' },
        ],
      },
    })
    const summary = await runCloudReleaseSmoke({
      envId: 'env-x',
      only: ['post-rag-worker'],
      logLimit: 3,
      logWaitMs: 0,
      commandTimeoutMs: 1234,
      noFixture: true,
      workerToken: 'unit-worker-token',
      evidenceDir,
      runId: 'unit-run',
    }, runner)

    assert.equal(summary.status, 'passed')
    assert(summary.labels.includes('HH_CLOUD_INVOKE_SMOKE_POST_RAG_WORKER'))
    const invokeCalls = runner.calls.filter((call) => commandPart(call.args, 2) === 'invoke')
    assert.equal(invokeCalls.length, 2)
  } finally {
    await rm(evidenceDir, { recursive: true, force: true })
  }
})

test('required invoke retries transient command timeouts', async () => {
  const evidenceDir = await tempEvidenceDir()
  try {
    const runner = createMockRunner({
      runId: 'unit-run',
      invokeResponses: {
        'post-video-rag-worker': [
          { status: 1, stdout: '', stderr: '', error: 'command timed out after 60000ms' },
        ],
      },
    })
    const summary = await runCloudReleaseSmoke({
      envId: 'env-x',
      only: ['post-video-rag-worker'],
      logLimit: 3,
      logWaitMs: 0,
      commandTimeoutMs: 1234,
      noFixture: true,
      workerToken: 'unit-worker-token',
      evidenceDir,
      runId: 'unit-run',
    }, runner)

    assert.equal(summary.status, 'passed')
    assert(summary.labels.includes('HH_CLOUD_INVOKE_SMOKE_POST_VIDEO_RAG_WORKER'))
    const invokeCalls = runner.calls.filter((call) => commandPart(call.args, 2) === 'invoke')
    assert.equal(invokeCalls.length, 2)
  } finally {
    await rm(evidenceDir, { recursive: true, force: true })
  }
})
