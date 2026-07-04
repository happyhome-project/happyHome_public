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
  summarizeReleaseRun,
} from './release-run-ledger.mjs'
import { DEFAULT_FUNCTIONS, REQUIRED_SMOKE_LABELS } from '../cloud-release-smoke.mjs'

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

test('summarizeReleaseRun returns machine-readable stage durations and evidence', async () => {
  const summary = summarizeReleaseRun({
    runId: 'unit-run',
    status: 'prepared',
    context: { gitSha: 'abc123', version: '1.0.1', desc: 'trial-unit' },
    stages: {
      'miniprogram-build-gate': {
        status: 'passed',
        durationMs: 123,
        evidence: { releaseUiEvidencePath: 'evidence.json' },
        result: { version: '1.0.1' },
      },
    },
  })

  assert.equal(summary.runId, 'unit-run')
  assert.equal(summary.status, 'prepared')
  assert.equal(summary.context.version, '1.0.1')
  assert.equal(summary.stages['miniprogram-build-gate'].durationMs, 123)
  assert.equal(summary.stages['miniprogram-build-gate'].evidence.releaseUiEvidencePath, 'evidence.json')
})

test('existing release ledger context rejects mismatched reopen metadata', async () => {
  const root = await tempRoot()
  try {
    await createReleaseRunLedger({
      root,
      runId: 'unit-run',
      command: 'deploy:release',
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
    })

    await assert.rejects(
      () => createReleaseRunLedger({
        root,
        runId: 'unit-run',
        command: 'deploy:release',
        gitSha: 'abc123',
        version: '1.0.2',
        desc: 'trial-different',
      }),
      /release run context mismatch/,
    )

    const runJson = JSON.parse(await readFile(join(root, '.codex-local', 'release-runs', 'unit-run', 'run.json'), 'utf8'))
    assert.equal(runJson.context.version, '1.0.1')
    assert.equal(runJson.context.desc, 'trial-unit')
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
      envId: 'env-a',
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
      envId: 'env-a',
    })
    assert.equal(changedVersion.reusable, false)
    assert.match(changedVersion.reason, /version/)

    const changedEnv = await inspectReleaseStageReuse(runState, 'cloud-deploy', {
      root,
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
      envId: 'env-b',
    })
    assert.equal(changedEnv.reusable, false)
    assert.match(changedEnv.reason, /envId/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cloud smoke can be reused only with formal labels, env, runId, and function set', async () => {
  const root = await tempRoot()
  try {
    const summaryPath = join(root, '.codex-local', 'release-evidence', 'unit', 'cloud-smoke', 'summary.json')
    await writeJson(summaryPath, {
      status: 'passed',
      runId: 'unit-run',
      envId: 'env-a',
      functions: DEFAULT_FUNCTIONS,
      missingLabels: [],
      requiredLabels: [],
      labels: REQUIRED_SMOKE_LABELS,
    })

    const ledger = await createReleaseRunLedger({
      root,
      runId: 'unit-run',
      command: 'deploy:release',
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
      envId: 'env-a',
    })
    await ledger.passStage('cloud-deploy', {
      result: { path: 'cloudbase-cli', fns: DEFAULT_FUNCTIONS },
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
      envId: 'env-a',
      runId: 'unit-run',
    })
    assert.equal(reusable.reusable, true)

    await writeJson(summaryPath, {
      status: 'passed',
      runId: 'unit-run',
      envId: 'env-a',
      functions: DEFAULT_FUNCTIONS,
      missingLabels: [],
      requiredLabels: ['HH_CLOUD_INVOKE_SMOKE_POST'],
      labels: ['HH_CLOUD_INVOKE_SMOKE_POST'],
    })
    const incompleteLabels = await inspectReleaseStageReuse(runState, 'cloud-smoke', {
      root,
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
      envId: 'env-a',
      runId: 'unit-run',
    })
    assert.equal(incompleteLabels.reusable, false)
    assert.match(incompleteLabels.reason, /required labels/)

    await writeJson(summaryPath, {
      status: 'passed',
      runId: 'unit-run',
      envId: 'env-b',
      functions: DEFAULT_FUNCTIONS,
      missingLabels: [],
      requiredLabels: REQUIRED_SMOKE_LABELS,
      labels: REQUIRED_SMOKE_LABELS,
    })
    const wrongEnv = await inspectReleaseStageReuse(runState, 'cloud-smoke', {
      root,
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
      envId: 'env-a',
      runId: 'unit-run',
    })
    assert.equal(wrongEnv.reusable, false)
    assert.match(wrongEnv.reason, /envId/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('miniprogram prepare evidence is reused only when build-info and UI version match', async () => {
  const root = await tempRoot()
  try {
    const sourceBuildInfoPath = join(root, 'miniprogram', 'src', 'generated', 'build-info.ts')
    const distBuildInfoPath = join(root, 'miniprogram', 'dist', 'build', 'mp-weixin', 'generated', 'build-info.js')
    const uiEvidencePath = join(root, '.codex-local', 'release-evidence', 'unit', 'release-ui-evidence.json')
    const buildInfoText = [
      'export const BUILD_INFO = {',
      '  version: "1.0.1",',
      '  desc: "trial-unit",',
      '  buildId: "mp-1.0.1",',
      '}',
      '',
    ].join('\n')
    await mkdir(join(sourceBuildInfoPath, '..'), { recursive: true })
    await mkdir(join(distBuildInfoPath, '..'), { recursive: true })
    await writeFile(sourceBuildInfoPath, buildInfoText, 'utf8')
    await writeFile(distBuildInfoPath, buildInfoText, 'utf8')
    await writeJson(uiEvidencePath, {
      markers: ['HH_RELEASE_HOME_DETAIL_NONEMPTY', 'HH_RELEASE_LOGIN_VERSION'],
      profileLoginClean: { expectedVersion: '1.0.1' },
    })

    const ledger = await createReleaseRunLedger({
      root,
      runId: 'unit-run',
      command: 'deploy:release',
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
    })
    await ledger.passStage('miniprogram-build-gate', {
      evidence: {
        buildInfoPath: 'miniprogram/src/generated/build-info.ts',
        distBuildInfoPath: 'miniprogram/dist/build/mp-weixin/generated/build-info.js',
        releaseUiEvidencePath: '.codex-local/release-evidence/unit/release-ui-evidence.json',
      },
      result: { version: '1.0.1', desc: 'trial-unit' },
    })

    const runState = JSON.parse(await readFile(join(root, '.codex-local', 'release-runs', 'unit-run', 'run.json'), 'utf8'))
    const reusable = await inspectReleaseStageReuse(runState, 'miniprogram-build-gate', {
      root,
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
    })
    assert.equal(reusable.reusable, true)

    await writeJson(uiEvidencePath, {
      markers: ['HH_RELEASE_HOME_DETAIL_NONEMPTY', 'HH_RELEASE_LOGIN_VERSION'],
      profileLoginClean: { expectedVersion: '1.0.2' },
    })
    const wrongUiVersion = await inspectReleaseStageReuse(runState, 'miniprogram-build-gate', {
      root,
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
    })
    assert.equal(wrongUiVersion.reusable, false)
    assert.match(wrongUiVersion.reason, /version mismatch/)

    await writeJson(uiEvidencePath, {
      markers: ['HH_RELEASE_HOME_DETAIL_NONEMPTY', 'HH_RELEASE_LOGIN_VERSION'],
      profileLoginClean: { expectedVersion: '1.0.1' },
    })
    await writeFile(distBuildInfoPath, buildInfoText.replace('trial-unit', 'trial-other'), 'utf8')
    const wrongBuildInfo = await inspectReleaseStageReuse(runState, 'miniprogram-build-gate', {
      root,
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
    })
    assert.equal(wrongBuildInfo.reusable, false)
    assert.match(wrongBuildInfo.reason, /dist build info/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('miniprogram upload is reused only with normalized release-owned evidence', async () => {
  const root = await tempRoot()
  try {
    const uploadEvidencePath = join(root, '.codex-local', 'release-evidence', 'unit-run', 'miniprogram-upload', 'upload-evidence.json')
    const uploadInfoPath = join(root, 'mp-upload-info.json')
    const ledger = await createReleaseRunLedger({
      root,
      runId: 'unit-run',
      command: 'deploy:release',
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
    })
    await ledger.passStage('miniprogram-upload', {
      evidence: {
        uploadEvidencePath: '.codex-local/release-evidence/unit-run/miniprogram-upload/upload-evidence.json',
        uploadInfoPath: 'mp-upload-info.json',
      },
      result: { version: '1.0.1', desc: 'trial-unit', method: 'devtools-cli' },
    })
    const runState = JSON.parse(await readFile(join(root, '.codex-local', 'release-runs', 'unit-run', 'run.json'), 'utf8'))

    const missing = await inspectReleaseStageReuse(runState, 'miniprogram-upload', {
      root,
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
    })
    assert.equal(missing.reusable, false)
    assert.match(missing.reason, /upload evidence/)

    await writeJson(uploadInfoPath, { size: { total: 1 } })
    const weak = await inspectReleaseStageReuse(runState, 'miniprogram-upload', {
      root,
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
    })
    assert.equal(weak.reusable, false)
    assert.match(weak.reason, /upload evidence/)

    await writeJson(uploadEvidencePath, {
      success: true,
      appid: 'wx-unit',
      version: '1.0.1',
      desc: 'trial-unit',
      method: 'devtools-cli',
      uploadInfoPath: 'mp-upload-info.json',
      uploadedAt: '2026-06-30T00:00:00.000Z',
    })
    const reusable = await inspectReleaseStageReuse(runState, 'miniprogram-upload', {
      root,
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
    })
    assert.equal(reusable.reusable, true)

    await rm(uploadInfoPath)
    await writeJson(uploadEvidencePath, {
      success: true,
      appid: 'wx-unit',
      version: '1.0.1',
      desc: 'trial-unit',
      method: 'miniprogram-ci',
      uploadInfoPath: '',
      uploadedAt: '2026-06-30T00:00:00.000Z',
    })
    const reusableCi = await inspectReleaseStageReuse(runState, 'miniprogram-upload', {
      root,
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
    })
    assert.equal(reusableCi.reusable, true)
    assert.equal(reusableCi.evidence.uploadInfoPath, '')
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

test('runLedgerStage can require reuse without running the action', async () => {
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
    let executed = false

    await assert.rejects(() => runLedgerStage(ledger, 'miniprogram-build-gate', {
      resume: true,
      mustReuse: true,
      reuseCheck: async () => ({ reusable: false, reason: 'prepared evidence missing' }),
      command: 'build gate',
    }, async () => {
      executed = true
    }), /prepared evidence missing/)

    assert.equal(executed, false)
    const events = await readFile(join(root, '.codex-local', 'release-runs', 'unit-run', 'events.jsonl'), 'utf8')
    assert.match(events, /"event":"stage_reuse_rejected"/)
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

test('runLedgerStage stores structured failure result evidence from errors', async () => {
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

    await assert.rejects(() => runLedgerStage(ledger, 'cloud-deploy', {
      command: 'CloudBase CLI/COS fn deploy',
    }, async () => {
      const error = new Error('CloudBase failed')
      error.result = {
        status: 'failed',
        functionResults: [{ fn: 'admin', status: 'failed' }],
      }
      throw error
    }), /CloudBase failed/)

    const runJson = JSON.parse(await readFile(join(root, '.codex-local', 'release-runs', 'unit-run', 'run.json'), 'utf8'))
    assert.equal(runJson.stages['cloud-deploy'].status, 'failed')
    assert.deepEqual(runJson.stages['cloud-deploy'].result.functionResults, [{ fn: 'admin', status: 'failed' }])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
