import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  createReleaseRunLedger,
  formatReleaseRunStatus,
  inspectReleaseStageReuse,
  runLedgerStage,
} from './release-run-ledger.mjs'

async function tempRoot() {
  return await mkdtemp(join(tmpdir(), 'happyhome-release-ledger-'))
}

async function writeJson(path, value) {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

test('release ledger records stage lifecycle, events, and latest pointer', async () => {
  const root = await tempRoot()
  try {
    const ledger = await createReleaseRunLedger({
      root,
      runId: 'unit-run',
      command: 'deploy:release',
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
      now: () => new Date('2026-06-30T00:00:00.000Z'),
    })

    await ledger.startStage('cloud-smoke', { command: 'npm.cmd run test:cloud:release-smoke' })
    await ledger.passStage('cloud-smoke', {
      evidence: { summaryPath: '.codex-local/release-evidence/unit/cloud-smoke/summary.json' },
      result: { status: 'passed' },
    })
    await ledger.complete('passed')

    const runJson = JSON.parse(await readFile(join(root, '.codex-local', 'release-runs', 'unit-run', 'run.json'), 'utf8'))
    assert.equal(runJson.status, 'passed')
    assert.equal(runJson.stages['cloud-smoke'].status, 'passed')
    assert.equal(runJson.stages['cloud-smoke'].durationMs, 0)
    assert.equal(runJson.stages['cloud-smoke'].evidence.summaryPath, '.codex-local/release-evidence/unit/cloud-smoke/summary.json')

    const latest = JSON.parse(await readFile(join(root, '.codex-local', 'release-runs', 'latest.json'), 'utf8'))
    assert.equal(latest.runId, 'unit-run')

    const events = await readFile(join(root, '.codex-local', 'release-runs', 'unit-run', 'events.jsonl'), 'utf8')
    assert.match(events, /"event":"stage_started"/)
    assert.match(events, /"event":"stage_passed"/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('resume inspection refuses passed stages when the commit or version changed', async () => {
  const root = await tempRoot()
  try {
    const ledger = await createReleaseRunLedger({
      root,
      runId: 'unit-run',
      command: 'deploy:release',
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
    })
    await ledger.passStage('cloud-deploy', { result: { path: 'cloudbase-cli', fns: ['post'] } })

    const runState = JSON.parse(await readFile(join(root, '.codex-local', 'release-runs', 'unit-run', 'run.json'), 'utf8'))
    const changedSha = await inspectReleaseStageReuse(runState, 'cloud-deploy', {
      root,
      gitSha: 'def456',
      version: '1.0.1',
      desc: 'trial-unit',
    })
    assert.equal(changedSha.reusable, false)
    assert.match(changedSha.reason, /gitSha/)

    const changedVersion = await inspectReleaseStageReuse(runState, 'cloud-deploy', {
      root,
      gitSha: 'abc123',
      version: '1.0.2',
      desc: 'trial-unit',
    })
    assert.equal(changedVersion.reusable, false)
    assert.match(changedVersion.reason, /version/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cloud smoke can be reused only with a passed complete summary', async () => {
  const root = await tempRoot()
  try {
    const summaryPath = join(root, '.codex-local', 'release-evidence', 'unit', 'cloud-smoke', 'summary.json')
    await writeJson(summaryPath, {
      status: 'passed',
      missingLabels: [],
      requiredLabels: ['HH_CLOUD_INVOKE_SMOKE_POST'],
      labels: ['HH_CLOUD_INVOKE_SMOKE_POST'],
    })

    const ledger = await createReleaseRunLedger({
      root,
      runId: 'unit-run',
      command: 'deploy:release',
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
    })
    await ledger.passStage('cloud-smoke', {
      evidence: { summaryPath: '.codex-local/release-evidence/unit/cloud-smoke/summary.json' },
      result: { status: 'passed' },
    })

    const runState = JSON.parse(await readFile(join(root, '.codex-local', 'release-runs', 'unit-run', 'run.json'), 'utf8'))
    const reusable = await inspectReleaseStageReuse(runState, 'cloud-smoke', {
      root,
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
    })
    assert.equal(reusable.reusable, true)

    await writeJson(summaryPath, {
      status: 'passed',
      missingLabels: ['HH_CLOUD_LOG_CAPTURE_POST'],
      requiredLabels: ['HH_CLOUD_LOG_CAPTURE_POST'],
      labels: [],
    })
    const incomplete = await inspectReleaseStageReuse(runState, 'cloud-smoke', {
      root,
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
    })
    assert.equal(incomplete.reusable, false)
    assert.match(incomplete.reason, /missing labels/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('miniprogram upload is not reused without upload evidence for the same version', async () => {
  const root = await tempRoot()
  try {
    const ledger = await createReleaseRunLedger({
      root,
      runId: 'unit-run',
      command: 'deploy:release',
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
    })
    await ledger.passStage('miniprogram-upload', {
      evidence: { uploadInfoPath: 'mp-upload-info.json' },
      result: { version: '1.0.1', desc: 'trial-unit' },
    })
    const runState = JSON.parse(await readFile(join(root, '.codex-local', 'release-runs', 'unit-run', 'run.json'), 'utf8'))

    const missing = await inspectReleaseStageReuse(runState, 'miniprogram-upload', {
      root,
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
    })
    assert.equal(missing.reusable, false)
    assert.match(missing.reason, /upload info/)

    await writeJson(join(root, 'mp-upload-info.json'), { size: { total: 1 } })
    const weak = await inspectReleaseStageReuse(runState, 'miniprogram-upload', {
      root,
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
    })
    assert.equal(weak.reusable, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runLedgerStage skips only when the explicit reuse check approves', async () => {
  const root = await tempRoot()
  try {
    const ledger = await createReleaseRunLedger({
      root,
      runId: 'unit-run',
      command: 'deploy:release',
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
    })
    await ledger.passStage('cloud-deploy', { result: { path: 'cloudbase-cli', fns: ['post'] } })

    let called = false
    const result = await runLedgerStage(ledger, 'cloud-deploy', {
      resume: true,
      reuseCheck: async () => ({ reusable: true, reason: 'matched', result: { path: 'cloudbase-cli', fns: ['post'] } }),
      command: 'deploy cloud functions',
    }, async () => {
      called = true
      return { path: 'cloudbase-cli', fns: ['post'] }
    })

    assert.equal(called, false)
    assert.deepEqual(result, { path: 'cloudbase-cli', fns: ['post'] })

    const status = formatReleaseRunStatus(ledger.state)
    assert.match(status, /unit-run/)
    assert.match(status, /cloud-deploy: skipped/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runLedgerStage logs reuse rejection before rerunning a stage', async () => {
  const root = await tempRoot()
  try {
    const ledger = await createReleaseRunLedger({
      root,
      runId: 'unit-run',
      command: 'deploy:release',
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
    })

    const result = await runLedgerStage(ledger, 'cloud-smoke', {
      resume: true,
      reuseCheck: async () => ({ reusable: false, reason: 'cloud smoke summary missing' }),
      command: 'npm.cmd run test:cloud:release-smoke',
    }, async () => ({ status: 'passed' }))

    assert.deepEqual(result, { status: 'passed' })
    const events = await readFile(join(root, '.codex-local', 'release-runs', 'unit-run', 'events.jsonl'), 'utf8')
    assert.match(events, /"event":"stage_reuse_rejected"/)
    assert.match(events, /cloud smoke summary missing/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
