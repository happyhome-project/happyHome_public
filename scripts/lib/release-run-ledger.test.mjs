import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import {
  confirmReleaseLedgerAgainstProductionInspection,
  computeDirectoryDigest,
  createReleasePlanAfterResumeIdentityCheck,
  createReleaseRunLedger,
  formatReleaseRunStatus,
  inspectReleaseStageReuse,
  loadReleaseRun,
  runLedgerStage,
  summarizeReleaseRun,
} from './release-run-ledger.mjs'
import { completeProductionReleaseWithRemoteConfirmation } from './production-release-guard.mjs'
import { DEFAULT_FUNCTIONS, REQUIRED_SMOKE_LABELS } from '../cloud-release-smoke.mjs'
import { createMiniprogramReceiptIdentity, normalizeMiniprogramUploadReceipt } from './miniprogram-receipt-identity.mjs'
import { writeReleaseUiQualification } from './release-ui-qualification.mjs'

async function tempRoot() {
  return await mkdtemp(join(tmpdir(), 'happyhome-release-ledger-'))
}

async function writeJson(path, value) {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function directoryDigest(root) {
  const entries = []
  async function walk(dir, prefix = '') {
    const children = await readdir(dir, { withFileTypes: true })
    children.sort((a, b) => a.name.localeCompare(b.name))
    for (const child of children) {
      const relativePath = prefix ? `${prefix}/${child.name}` : child.name
      const absolutePath = join(dir, child.name)
      if (child.isDirectory()) await walk(absolutePath, relativePath)
      else if (child.isFile()) {
        const contents = await readFile(absolutePath)
        const fileStat = await stat(absolutePath)
        entries.push(`${relativePath}\0${fileStat.size}\0${createHash('sha256').update(contents).digest('hex')}`)
      }
    }
  }
  await walk(root)
  return createHash('sha256').update(entries.join('\n')).digest('hex')
}

const execFileAsync = promisify(execFile)

async function windowsShortPath(path) {
  if (process.platform !== 'win32') return ''
  const { stdout } = await execFileAsync('cmd.exe', ['/d', '/c', `for %I in ("${path}") do @echo %~sI`], { windowsVerbatimArguments: true })
  return stdout.trim().replace(/^"|"$/g, '')
}

test('prepare pins the formal plan and immutable artifact manifest without probe token plaintext', async () => {
  const root = await tempRoot()
  try {
    const ledger = await createReleaseRunLedger({ root, runId: 'pin-run', gitSha: 'abc', version: '1', desc: 'd', envId: 'env' })
    const formalPlan = { headSha: 'abc', targets: { cloud: { functions: ['admin'] }, adminWeb: false, miniprogram: false } }
    const probeToken = 'known-plaintext-probe-token'
    const artifactManifest = { schemaVersion: 1, runId: 'pin-run', gitSha: 'abc', artifacts: { cloud: { admin: { probeTokenHash: 'hash' } } } }
    await ledger.pinReleaseArtifacts({ formalPlan, artifactManifest })
    const saved = await loadReleaseRun(root, 'pin-run')
    assert.equal(saved.schemaVersion, 3)
    assert.deepEqual(saved.formalPlan, formalPlan)
    assert.deepEqual(saved.artifactManifest, artifactManifest)
    assert.doesNotMatch(JSON.stringify(saved), new RegExp(probeToken))
    await assert.rejects(() => ledger.recordRemoteAttestations('cloud', [{ probeToken }]), /must not persist plaintext probeToken/)
    await assert.rejects(
      () => ledger.pinReleaseArtifacts({ formalPlan: { ...formalPlan, headSha: 'other' }, artifactManifest }),
      /already pinned/i,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('legacy schema one release ledgers remain readable and gain additive defaults', async () => {
  const root = await tempRoot()
  try {
    await writeJson(join(root, '.codex-local', 'release-runs', 'legacy', 'run.json'), {
      schemaVersion: 1, runId: 'legacy', status: 'passed', context: { gitSha: 'abc' }, stages: {},
    })
    const run = await loadReleaseRun(root, 'legacy')
    assert.equal(run.schemaVersion, 1)
    assert.equal(run.formalPlan, null)
    assert.equal(run.artifactManifest, null)
    assert.deepEqual(run.remoteAttestations, {})
    assert.deepEqual(run.components, {})
    assert.equal(run.context.forceRedeployCurrent, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('force-redeploy-current is resume-bound and legacy schema two defaults it off', async () => {
  const root = await tempRoot()
  try {
    const ledger = await createReleaseRunLedger({ root, runId: 'force-run', gitSha: 'abc', releaseStrategy: 'full-current', forceRedeployCurrent: true })
    assert.equal(ledger.state.context.forceRedeployCurrent, true)
    await assert.rejects(() => createReleaseRunLedger({ root, runId: 'force-run', gitSha: 'abc', releaseStrategy: 'full-current', forceRedeployCurrent: false }), /forceRedeployCurrent/i)
    await writeJson(join(root, '.codex-local', 'release-runs', 'legacy-two', 'run.json'), {
      schemaVersion: 2, runId: 'legacy-two', status: 'passed', context: { gitSha: 'abc', releaseStrategy: 'main' }, stages: {},
    })
    const legacy = await loadReleaseRun(root, 'legacy-two')
    assert.equal(legacy.schemaVersion, 2)
    assert.equal(legacy.context.forceRedeployCurrent, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('release summary exposes structured component deployment and skip counts', () => {
  const summary = summarizeReleaseRun({
    runId: 'run', status: 'passed', context: {}, stages: {},
    components: {
      'cloud:admin': { status: 'attested', skipReason: 'fresh exact match' },
      'cloud:post': { status: 'verified', skipReason: '', evidence: { deployed: true } },
      'admin-web': { status: 'deployed', skipReason: 'remote mismatch' },
      miniprogram: { status: 'uploaded', skipReason: 'receipt exact match' },
    },
  })
  assert.deepEqual(summary.componentSummary.counts, { deployed: 2, skipped: 2, total: 4 })
  assert.equal(summary.componentSummary.components['cloud:admin'].status, 'attested')
})

test('ledger sanitizes registered probe token values from stages events errors and summaries', async () => {
  const root = await tempRoot()
  const probeToken = 'secret-probe-token-value'
  try {
    const ledger = await createReleaseRunLedger({ root, runId: 'secret-run', gitSha: 'abc', version: '1', desc: 'd', envId: 'env' })
    ledger.registerSecrets([probeToken])
    await ledger.startStage('cloud-deploy', { evidence: { note: `evidence ${probeToken}` } })
    await ledger.failStage('cloud-deploy', new Error(`failure ${probeToken}`), { reason: `reason ${probeToken}` })
    await ledger.recordRemoteAttestations('cloud', [{ skipReason: `remote ${probeToken}` }])
    const runText = await readFile(join(root, '.codex-local', 'release-runs', 'secret-run', 'run.json'), 'utf8')
    const eventsText = await readFile(join(root, '.codex-local', 'release-runs', 'secret-run', 'events.jsonl'), 'utf8')
    assert.doesNotMatch(runText, new RegExp(probeToken))
    assert.doesNotMatch(eventsText, new RegExp(probeToken))
    assert.doesNotMatch(JSON.stringify(summarizeReleaseRun(ledger.state)), new RegExp(probeToken))
    assert.match(runText, /REDACTED_PROBE_TOKEN/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

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

test('release ledger binds release strategy and git SHA across reopen, latest, status, and summary', async () => {
  const root = await tempRoot()
  try {
    const ledger = await createReleaseRunLedger({
      root,
      runId: 'full-current-run',
      command: 'deploy:release --full-current',
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
      envId: 'env-a',
      releaseStrategy: 'full-current',
    })

    assert.equal(ledger.state.context.releaseStrategy, 'full-current')
    await assert.rejects(
      () => createReleaseRunLedger({ root, runId: 'full-current-run', gitSha: 'abc123', releaseStrategy: 'main' }),
      /releaseStrategy/,
    )
    await assert.rejects(
      () => createReleaseRunLedger({ root, runId: 'full-current-run', gitSha: 'def456', releaseStrategy: 'full-current' }),
      /gitSha/,
    )

    const latest = JSON.parse(await readFile(join(root, '.codex-local', 'release-runs', 'latest.json'), 'utf8'))
    assert.equal(latest.releaseStrategy, 'full-current')
    assert.match(formatReleaseRunStatus(ledger.state), /Strategy: full-current/)
    assert.equal(summarizeReleaseRun(ledger.state).context.releaseStrategy, 'full-current')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('release ledger defaults omitted strategy to main and treats legacy context as main', async () => {
  const root = await tempRoot()
  try {
    const ledger = await createReleaseRunLedger({ root, runId: 'main-run', gitSha: 'abc123' })
    assert.equal(ledger.state.context.releaseStrategy, 'main')

    const runPath = join(root, '.codex-local', 'release-runs', 'main-run', 'run.json')
    const legacy = JSON.parse(await readFile(runPath, 'utf8'))
    delete legacy.context.releaseStrategy
    await writeFile(runPath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8')

    await assert.rejects(
      () => createReleaseRunLedger({ root, runId: 'main-run', gitSha: 'abc123', releaseStrategy: 'full-current' }),
      /releaseStrategy/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('release ledger binds DAG mode across resume and rejects a rollback mode switch in the same run', async () => {
  const root = await tempRoot()
  try {
    await createReleaseRunLedger({ root, runId: 'dag-mode', gitSha: 'abc', version: '1', desc: 'd', envId: 'env', dagMode: 'v2' })
    await assert.rejects(() => createReleaseRunLedger({
      root, runId: 'dag-mode', gitSha: 'abc', version: '1', desc: 'd', envId: 'env', dagMode: 'legacy',
    }), /mismatch.*dagMode|dagMode.*mismatch/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('concurrent DAG stage writes are serialized inside one release ledger', async () => {
  const root = await tempRoot()
  try {
    const ledger = await createReleaseRunLedger({ root, runId: 'parallel-stages', gitSha: 'abc', version: '1', desc: 'd', envId: 'env', dagMode: 'v2' })
    let activeSaves = 0
    let maxActiveSaves = 0
    ledger.appendEventUnsafe = async () => {}
    ledger.saveUnsafe = async () => {
      activeSaves += 1
      maxActiveSaves = Math.max(maxActiveSaves, activeSaves)
      await new Promise((resolve) => setImmediate(resolve))
      activeSaves -= 1
    }
    await Promise.all([
      ledger.passStage('cloud-deploy', { result: { status: 'passed' } }),
      ledger.passStage('post-rag-timer-probe', { result: { status: 'passed' } }),
    ])
    assert.equal(maxActiveSaves, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('concurrent stage component and attestation mutations preserve one parseable ledger and event stream', async () => {
  const root = await tempRoot()
  try {
    const ledger = await createReleaseRunLedger({ root, runId: 'parallel-ledger-writes', gitSha: 'abc', version: '1', desc: 'd', envId: 'env', dagMode: 'v2' })
    await Promise.all([
      ledger.passStage('post-rag-timer-probe', { result: { complete: true } }),
      ledger.recordComponent('cloud:admin', { status: 'verified', componentDigest: 'a'.repeat(64), artifactRunId: 'prior-run' }),
      ledger.recordRemoteAttestations('cloud', [{ component: 'cloud:admin', status: 'verified' }]),
    ])
    const persisted = JSON.parse(await readFile(ledger.runPath, 'utf8'))
    const events = (await readFile(ledger.eventsPath, 'utf8')).trim().split(/\r?\n/).map(JSON.parse)
    assert.equal(persisted.stages['post-rag-timer-probe'].status, 'passed')
    assert.equal(persisted.components['cloud:admin'].status, 'verified')
    assert.equal(persisted.components['cloud:admin'].componentDigest, 'a'.repeat(64))
    assert.equal(persisted.components['cloud:admin'].artifactRunId, 'prior-run')
    assert.equal(persisted.remoteAttestations.cloud[0].status, 'verified')
    assert(events.some((event) => event.event === 'stage_passed'))
    assert(events.some((event) => event.event === 'remote_attestation_recorded'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('resume identity mismatch rejects before the formal release planner is invoked', () => {
  let plannerCalls = 0
  const createPlan = () => {
    plannerCalls += 1
    return { releaseRequired: true }
  }

  assert.throws(
    () => createReleasePlanAfterResumeIdentityCheck({
      resumeRunState: { context: { gitSha: 'abc123', releaseStrategy: 'full-current' } },
      gitSha: 'def456',
      releaseStrategy: 'full-current',
      createPlan,
    }),
    /resume context mismatch for gitSha: existing abc123, requested def456/,
  )
  assert.equal(plannerCalls, 0)

  assert.throws(
    () => createReleasePlanAfterResumeIdentityCheck({
      resumeRunState: { context: { gitSha: 'abc123' } },
      gitSha: 'abc123',
      releaseStrategy: 'full-current',
      createPlan,
    }),
    /resume context mismatch for releaseStrategy: existing main, requested full-current/,
  )
  assert.equal(plannerCalls, 0)

  const plan = createReleasePlanAfterResumeIdentityCheck({
    resumeRunState: { context: { gitSha: 'abc123', releaseStrategy: 'full-current' } },
    gitSha: 'abc123',
    releaseStrategy: 'full-current',
    createPlan,
  })
  assert.equal(plan.releaseRequired, true)
  assert.equal(plannerCalls, 1)
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

test('force full-current prepared stages reuse only with the same force identity', async () => {
  const root = await tempRoot()
  try {
    const ledger = await createReleaseRunLedger({
      root, runId: 'force-reuse', gitSha: 'abc', version: '1', desc: 'd', envId: 'env',
      releaseStrategy: 'full-current', forceRedeployCurrent: true,
    })
    await ledger.passStage('release-operations', { result: { status: 'passed' } })
    const matching = await inspectReleaseStageReuse(ledger.state, 'release-operations', {
      root, gitSha: 'abc', version: '1', desc: 'd', envId: 'env', releaseStrategy: 'full-current', forceRedeployCurrent: true,
    })
    assert.equal(matching.reusable, true)
    const mismatch = await inspectReleaseStageReuse(ledger.state, 'release-operations', {
      root, gitSha: 'abc', version: '1', desc: 'd', envId: 'env', releaseStrategy: 'full-current', forceRedeployCurrent: false,
    })
    assert.equal(mismatch.reusable, false)
    assert.match(mismatch.reason, /forceRedeployCurrent/)
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
      labels: REQUIRED_SMOKE_LABELS.filter((label) => label !== 'HH_CLOUD_FIXTURE_CLEANUP_OK'),
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
    const missingCleanup = await inspectReleaseStageReuse(runState, 'cloud-smoke', {
      root,
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
      envId: 'env-a',
      runId: 'unit-run',
    })
    assert.equal(missingCleanup.reusable, false)
    assert.match(missingCleanup.reason, /HH_CLOUD_FIXTURE_CLEANUP_OK/)

    await writeJson(summaryPath, {
      status: 'passed',
      runId: 'unit-run',
      envId: 'env-a',
      functions: DEFAULT_FUNCTIONS,
      missingLabels: [],
      requiredLabels: [],
      labels: REQUIRED_SMOKE_LABELS,
    })
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
    const pagePath = join(root, 'miniprogram', 'dist', 'build', 'mp-weixin', 'pages', 'index', 'index.js')
    await mkdir(join(pagePath, '..'), { recursive: true })
    await writeFile(pagePath, 'module.exports = { version: 1 }\n', 'utf8')
    const packageDigest = await directoryDigest(join(root, 'miniprogram', 'dist', 'build', 'mp-weixin'))
    const coldStartEvidence = {
      passed: true,
      path: 'pages/index/index',
      layout: {
        phoneInner: { width: 375, height: 700 },
        homeShell: { width: 375, height: 600 },
      },
      appTabBarCount: 1,
    }
    const packageRoot = join(root, 'miniprogram', 'dist', 'build', 'mp-weixin')
    const evidenceProjectPath = await windowsShortPath(packageRoot) || packageRoot
    await writeJson(uiEvidencePath, {
      releaseRunId: 'unit-run',
      packageDigest,
      projectPath: evidenceProjectPath,
      markers: [
        'HH_RELEASE_HOME_COLD_START_NONEMPTY',
        'HH_RELEASE_HOME_IMAGES_RENDERED',
        'HH_RELEASE_HOME_DETAIL_NONEMPTY',
        'HH_RELEASE_LOGIN_VERSION',
        'HH_RELEASE_PROFILE_LOGIN_CLEAN',
      ],
      homeColdStart: {
        passed: true,
        path: 'pages/index/index',
        layout: {
          phoneInner: { width: 375, height: 700 },
          homeShell: { width: 375, height: 600 },
        },
        appTabBarCount: 1,
      },
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
        packageRoot: 'miniprogram/dist/build/mp-weixin',
        packageDigest,
      },
      result: { version: '1.0.1', desc: 'trial-unit' },
    })

    const runState = JSON.parse(await readFile(join(root, '.codex-local', 'release-runs', 'unit-run', 'run.json'), 'utf8'))
    const reusable = await inspectReleaseStageReuse(runState, 'miniprogram-build-gate', {
      root,
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
      runId: 'unit-run',
    })
    assert.equal(reusable.reusable, true)

    await writeJson(uiEvidencePath, {
      releaseRunId: 'unit-run',
      packageDigest,
      projectPath: join(root, 'missing-project-path'),
      markers: [
        'HH_RELEASE_HOME_COLD_START_NONEMPTY',
        'HH_RELEASE_HOME_IMAGES_RENDERED',
        'HH_RELEASE_HOME_DETAIL_NONEMPTY',
        'HH_RELEASE_LOGIN_VERSION',
        'HH_RELEASE_PROFILE_LOGIN_CLEAN',
      ],
      homeColdStart: coldStartEvidence,
      profileLoginClean: { expectedVersion: '1.0.1' },
    })
    const missingProjectPath = await inspectReleaseStageReuse(runState, 'miniprogram-build-gate', {
      root,
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
      runId: 'unit-run',
    })
    assert.equal(missingProjectPath.reusable, false)
    assert.match(missingProjectPath.reason, /project path/i)

    await writeJson(uiEvidencePath, {
      releaseRunId: 'unit-run',
      packageDigest,
      projectPath: join(root, 'miniprogram', 'dist', 'build', 'mp-weixin'),
      markers: [
        'HH_RELEASE_HOME_COLD_START_NONEMPTY',
        'HH_RELEASE_HOME_IMAGES_RENDERED',
        'HH_RELEASE_HOME_DETAIL_NONEMPTY',
        'HH_RELEASE_LOGIN_VERSION',
        'HH_RELEASE_PROFILE_LOGIN_CLEAN',
      ],
      profileLoginClean: { expectedVersion: '1.0.1' },
    })
    const missingColdStartResult = await inspectReleaseStageReuse(runState, 'miniprogram-build-gate', {
      root,
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
      runId: 'unit-run',
    })
    assert.equal(missingColdStartResult.reusable, false)
    assert.match(missingColdStartResult.reason, /cold-start/i)

    await writeJson(uiEvidencePath, {
      releaseRunId: 'unit-run',
      packageDigest,
      projectPath: join(root, 'miniprogram', 'dist', 'build', 'mp-weixin'),
      markers: [
        'HH_RELEASE_HOME_COLD_START_NONEMPTY',
        'HH_RELEASE_HOME_IMAGES_RENDERED',
        'HH_RELEASE_HOME_DETAIL_NONEMPTY',
        'HH_RELEASE_LOGIN_VERSION',
        'HH_RELEASE_PROFILE_LOGIN_CLEAN',
      ],
      homeColdStart: {
        passed: true,
        path: 'pages/index/index',
        layout: {
          phoneInner: { width: 375, height: 700 },
          homeShell: { width: 375, height: 600 },
        },
        appTabBarCount: 1,
      },
      profileLoginClean: { expectedVersion: '1.0.1' },
    })

    await writeFile(pagePath, 'module.exports = { version: 2 }\n', 'utf8')
    const changedPackage = await inspectReleaseStageReuse(runState, 'miniprogram-build-gate', {
      root,
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
    })
    assert.equal(changedPackage.reusable, false)
    assert.match(changedPackage.reason, /package digest/i)
    await writeFile(pagePath, 'module.exports = { version: 1 }\n', 'utf8')

    await writeJson(uiEvidencePath, {
      releaseRunId: 'unit-run',
      packageDigest,
      projectPath: join(root, 'miniprogram', 'dist', 'build', 'mp-weixin'),
      markers: [
        'HH_RELEASE_HOME_COLD_START_NONEMPTY',
        'HH_RELEASE_HOME_IMAGES_RENDERED',
        'HH_RELEASE_HOME_DETAIL_NONEMPTY',
        'HH_RELEASE_LOGIN_VERSION',
        'HH_RELEASE_PROFILE_LOGIN_CLEAN',
      ],
      homeColdStart: coldStartEvidence,
    })
    const missingUiVersion = await inspectReleaseStageReuse(runState, 'miniprogram-build-gate', {
      root,
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
      runId: 'unit-run',
    })
    assert.equal(missingUiVersion.reusable, false)
    assert.match(missingUiVersion.reason, /version.*missing/i)

    await writeJson(uiEvidencePath, {
      releaseRunId: 'unit-run',
      packageDigest,
      projectPath: join(root, 'miniprogram', 'dist', 'build', 'mp-weixin'),
      markers: [
        'HH_RELEASE_HOME_COLD_START_NONEMPTY',
        'HH_RELEASE_HOME_IMAGES_RENDERED',
        'HH_RELEASE_HOME_DETAIL_NONEMPTY',
        'HH_RELEASE_LOGIN_VERSION',
      ],
      homeColdStart: coldStartEvidence,
      profileLoginClean: { expectedVersion: '1.0.1' },
    })
    const missingCleanProfileMarker = await inspectReleaseStageReuse(runState, 'miniprogram-build-gate', {
      root,
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
      runId: 'unit-run',
    })
    assert.equal(missingCleanProfileMarker.reusable, false)
    assert.match(missingCleanProfileMarker.reason, /HH_RELEASE_PROFILE_LOGIN_CLEAN/)

    await writeJson(uiEvidencePath, {
      releaseRunId: 'unit-run',
      packageDigest,
      projectPath: join(root, 'miniprogram', 'dist', 'build', 'mp-weixin'),
      markers: [
        'HH_RELEASE_HOME_COLD_START_NONEMPTY',
        'HH_RELEASE_HOME_IMAGES_RENDERED',
        'HH_RELEASE_HOME_DETAIL_NONEMPTY',
        'HH_RELEASE_LOGIN_VERSION',
        'HH_RELEASE_PROFILE_LOGIN_CLEAN',
      ],
      homeColdStart: coldStartEvidence,
      profileLoginClean: { expectedVersion: '1.0.2' },
    })
    const wrongUiVersion = await inspectReleaseStageReuse(runState, 'miniprogram-build-gate', {
      root,
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
      runId: 'unit-run',
    })
    assert.equal(wrongUiVersion.reusable, false)
    assert.match(wrongUiVersion.reason, /version mismatch/)

    await writeJson(uiEvidencePath, {
      markers: [
        'HH_RELEASE_HOME_COLD_START_NONEMPTY',
        'HH_RELEASE_HOME_IMAGES_RENDERED',
        'HH_RELEASE_HOME_DETAIL_NONEMPTY',
        'HH_RELEASE_LOGIN_VERSION',
        'HH_RELEASE_PROFILE_LOGIN_CLEAN',
      ],
      homeColdStart: coldStartEvidence,
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

test('qualification-backed prepare reuse freshly validates the wrapper and artifacts', async () => {
  const root = await tempRoot()
  try {
    const gitSha = 'a'.repeat(40)
    const version = '1.0.1'
    const desc = 'trial-unit'
    const devToolsVersion = '2.01.2510290'
    const packageRoot = join(root, 'miniprogram', 'dist', 'build', 'mp-weixin')
    const sourceBuildInfoPath = join(root, 'miniprogram', 'src', 'generated', 'build-info.ts')
    const distBuildInfoPath = join(packageRoot, 'generated', 'build-info.js')
    const uiEvidencePath = join(root, '.codex-local', 'release-ui-evidence.json')
    const qualificationPath = join(root, '.codex-local', 'ui-qualification.json')
    await mkdir(join(packageRoot, 'generated'), { recursive: true })
    await mkdir(join(root, 'miniprogram', 'src', 'generated'), { recursive: true })
    const sourceBuildInfo = `export const BUILD_INFO = { version: "${version}", desc: "${desc}", buildId: "mp-${version}" }\n`
    const distBuildInfo = `"use strict";exports.BUILD_INFO={version:"${version}",desc:"${desc}",buildId:"mp-${version}"};\n`
    await writeFile(sourceBuildInfoPath, sourceBuildInfo)
    await writeFile(distBuildInfoPath, distBuildInfo)
    await writeFile(join(packageRoot, 'app.js'), 'App({})\n')
    const packageDigest = await computeDirectoryDigest(packageRoot)
    const markers = [
      'HH_RELEASE_HOME_COLD_START_NONEMPTY',
      'HH_RELEASE_HOME_IMAGES_RENDERED',
      'HH_RELEASE_HOME_ARCHIVE_TABS_STICKY',
      'HH_RELEASE_HOME_DETAIL_NONEMPTY',
      'HH_RELEASE_LOGIN_VERSION',
      'HH_RELEASE_PROFILE_LOGIN_CLEAN',
    ]
    await writeJson(uiEvidencePath, {
      gitSha,
      devToolsVersion,
      projectPath: packageRoot,
      packageDigest,
      markers,
      homeColdStart: { passed: true },
      homeArchiveTabs: { passed: true },
      homeDetail: { passed: true, homeImagesRendered: true },
      profileLoginClean: { expectedVersion: version, buildIdentityPassed: true, cleanPassed: true },
    })
    const qualification = await writeReleaseUiQualification({
      root, outputPath: qualificationPath, gitSha, version, desc, packageRoot,
      devToolsVersion, sourceBuildInfoPath, distBuildInfoPath, uiEvidencePath,
    })
    const qualificationDigest = createHash('sha256').update(await readFile(qualificationPath)).digest('hex')
    const ledger = await createReleaseRunLedger({ root, runId: 'qualified-run', command: 'prepare', gitSha, version, desc })
    await ledger.passStage('miniprogram-build-gate', {
      evidence: {
        qualificationPath,
        qualificationDigest,
        devToolsVersion,
        buildInfoPath: sourceBuildInfoPath,
        distBuildInfoPath,
        releaseUiEvidencePath: uiEvidencePath,
        packageRoot,
        packageDigest: qualification.packageDigest,
      },
      result: { version, desc },
    })
    const context = { root, runId: 'qualified-run', gitSha, version, desc, devToolsVersion }
    const reusable = await inspectReleaseStageReuse(ledger.state, 'miniprogram-build-gate', context)
    assert.equal(reusable.reusable, true)

    await writeFile(qualificationPath, `${await readFile(qualificationPath, 'utf8')} `)
    const changed = await inspectReleaseStageReuse(ledger.state, 'miniprogram-build-gate', context)
    assert.equal(changed.reusable, false)
    assert.match(changed.reason, /qualification digest mismatch/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('miniprogram upload is reused only with normalized release-owned evidence', async () => {
  const root = await tempRoot()
  try {
    const uploadEvidencePath = join(root, '.codex-local', 'release-evidence', 'unit-run', 'miniprogram-upload', 'upload-evidence.json')
    const uploadInfoPath = join(root, 'mp-upload-info.json')
    const packageDigest = 'prepared-package-digest'
    const ledger = await createReleaseRunLedger({
      root,
      runId: 'unit-run',
      command: 'deploy:release',
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
      packageDigest,
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
      packageDigest,
    })
    assert.equal(missing.reusable, false)
    assert.match(missing.reason, /upload evidence/)

    await writeJson(uploadInfoPath, { size: { total: 1 } })
    const weak = await inspectReleaseStageReuse(runState, 'miniprogram-upload', {
      root,
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
      packageDigest,
    })
    assert.equal(weak.reusable, false)
    assert.match(weak.reason, /upload evidence/)

    const uploadInfoStat = await stat(uploadInfoPath)
    const normalizedReceipt = normalizeMiniprogramUploadReceipt({ method: 'devtools-cli', uploadInfoText: await readFile(uploadInfoPath, 'utf8') })
    const receiptId = createMiniprogramReceiptIdentity({ receipt: normalizedReceipt, runId: 'unit-run', packageDigest, version: '1.0.1', desc: 'trial-unit' })
    await writeJson(uploadEvidencePath, {
      success: true,
      releaseRunId: 'wrong-run',
      receiptId,
      normalizedReceipt,
      appid: 'wx-unit',
      version: '1.0.1',
      desc: 'trial-unit',
      method: 'devtools-cli',
      packageDigest,
      uploadInfoPath: 'mp-upload-info.json',
      uploadInfoSize: uploadInfoStat.size,
      uploadInfoMtimeMs: uploadInfoStat.mtimeMs,
      uploadStartedAtMs: uploadInfoStat.mtimeMs,
      uploadedAt: '2026-06-30T00:00:00.000Z',
    })
    const reusable = await inspectReleaseStageReuse(runState, 'miniprogram-upload', {
      root,
      runId: 'unit-run',
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
      packageDigest,
    })
    assert.equal(reusable.reusable, false)
    assert.match(reusable.reason, /runId/i)

    const devtoolsEvidence = JSON.parse(await readFile(uploadEvidencePath, 'utf8'))
    await writeJson(uploadEvidencePath, { ...devtoolsEvidence, releaseRunId: 'unit-run' })
    const exactReusable = await inspectReleaseStageReuse(runState, 'miniprogram-upload', {
      root, runId: 'unit-run', gitSha: 'abc123', version: '1.0.1', desc: 'trial-unit', packageDigest,
    })
    assert.equal(exactReusable.reusable, true)

    await writeJson(uploadInfoPath, { size: { total: 2 } })
    const changedReceipt = await inspectReleaseStageReuse(runState, 'miniprogram-upload', {
      root, runId: 'unit-run', gitSha: 'abc123', version: '1.0.1', desc: 'trial-unit', packageDigest,
    })
    assert.equal(changedReceipt.reusable, false)
    assert.match(changedReceipt.reason, /receipt identity/i)

    await rm(uploadInfoPath)
    await writeJson(uploadEvidencePath, {
      success: true,
      releaseRunId: 'unit-run',
      receiptId: 'receipt-2',
      appid: 'wx-unit',
      version: '1.0.1',
      desc: 'trial-unit',
      method: 'miniprogram-ci',
      packageDigest,
      uploadInfoPath: '',
      uploadedAt: '2026-06-30T00:00:00.000Z',
    })
    const reusableCi = await inspectReleaseStageReuse(runState, 'miniprogram-upload', {
      root,
      gitSha: 'abc123',
      version: '1.0.1',
      desc: 'trial-unit',
      packageDigest,
    })
    assert.equal(reusableCi.reusable, false)
    assert.match(reusableCi.reason, /fresh-attestable/i)
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
    assert.match(status, /cloud-deploy: passed/)
    assert.equal(ledger.state.stages['cloud-deploy'].reused, true)
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

test('remote release inspection can complete a local ledger only for the exact passed release identity', async () => {
  const events = []
  const ledger = {
    runId: 'run-123',
    state: { context: { gitSha: 'abc123', releaseStrategy: 'full-current' } },
    async appendEvent(event, payload) { events.push({ event, payload }) },
    async complete(status) { this.status = status },
  }

  const confirmation = await confirmReleaseLedgerAgainstProductionInspection({
    ledger,
    productionInspection: {
      lock: null,
      run: { gitSha: 'abc123', runId: 'run-123', status: 'passed' },
      state: {
        gitSha: 'abc123',
        lastSuccessfulRunId: 'run-123',
        releasedAt: 123,
      },
    },
  })

  assert.equal(confirmation.gitSha, 'abc123')
  assert.equal(ledger.status, 'passed')
  assert.equal(events[0].event, 'remote_release_completion_confirmed')

  const mismatchedShaLedger = { ...ledger, status: undefined }
  await assert.rejects(
    () => confirmReleaseLedgerAgainstProductionInspection({
      ledger: mismatchedShaLedger,
      productionInspection: {
        lock: null,
        run: { gitSha: 'different', runId: 'run-123', status: 'passed' },
        state: { gitSha: 'different', lastSuccessfulRunId: 'run-123' },
      },
    }),
    /does not prove completion/,
  )
  assert.equal(mismatchedShaLedger.status, undefined)

  await assert.rejects(
    () => confirmReleaseLedgerAgainstProductionInspection({
      ledger,
      productionInspection: {
        lock: { runId: 'run-124', status: 'active' },
        run: { gitSha: 'abc123', runId: 'run-123', status: 'passed' },
        state: { gitSha: 'abc123', lastSuccessfulRunId: 'run-123' },
      },
    }),
    /does not prove completion/,
  )

  await assert.rejects(
    () => confirmReleaseLedgerAgainstProductionInspection({
      ledger,
      productionInspection: {
        lock: null,
        run: { gitSha: 'abc123', status: 'passed' },
        state: { gitSha: 'abc123', lastSuccessfulRunId: 'run-123' },
      },
    }),
    /does not prove completion/,
  )
})

test('production release completes the local ledger after a timed-out completion only when remote state proves success', async () => {
  const events = []
  const ledger = {
    runId: 'run-123',
    state: { context: { gitSha: 'abc123', releaseStrategy: 'full-current' } },
    async appendEvent(event, payload) { events.push({ event, payload }) },
    async complete(status) { this.status = status },
  }
  let remotelyMarked = false
  const guard = {
    context: { gitSha: 'abc123', runId: 'run-123', releaseStrategy: 'full-current' },
    complete: () => new Promise(() => {}),
    async getReleaseInspection() {
      return {
        lock: null,
        run: { gitSha: 'abc123', runId: 'run-123', status: 'passed' },
        state: { gitSha: 'abc123', lastSuccessfulRunId: 'run-123', releasedAt: 123 },
      }
    },
    markRemotelyCompleted() { remotelyMarked = true },
  }

  const result = await completeProductionReleaseWithRemoteConfirmation({
    guard,
    ledger,
    timeoutMs: 0,
  })

  assert.equal(result.mode, 'remote-state-confirmed')
  assert.equal(ledger.status, 'passed')
  assert.equal(remotelyMarked, true)
  assert.equal(events[0].event, 'remote_release_completion_confirmed')
})

test('production release leaves the ledger incomplete when timed-out completion lacks remote proof', async () => {
  const ledger = {
    runId: 'run-123',
    state: { context: { gitSha: 'abc123', releaseStrategy: 'full-current' } },
    async appendEvent() {},
    async complete(status) { this.status = status },
  }
  const guard = {
    context: { gitSha: 'abc123', runId: 'run-123', releaseStrategy: 'full-current' },
    complete: () => new Promise(() => {}),
    async getReleaseInspection() {
      return {
        lock: null,
        run: { gitSha: 'different', runId: 'run-123', status: 'passed' },
        state: { gitSha: 'different', lastSuccessfulRunId: 'run-123' },
      }
    },
    markRemotelyCompleted() { throw new Error('must not mark unproven completion') },
  }

  await assert.rejects(
    () => completeProductionReleaseWithRemoteConfirmation({ guard, ledger, timeoutMs: 0 }),
    /does not prove completion/,
  )
  assert.equal(ledger.status, undefined)
})

test('remote-confirmed release does not become failed when the local ledger write fails', async () => {
  let remotelyMarked = false
  const guard = {
    context: { gitSha: 'abc123', runId: 'run-123' },
    complete: () => new Promise(() => {}),
    async getReleaseInspection() {
      return {
        lock: null,
        run: { gitSha: 'abc123', runId: 'run-123', status: 'passed' },
        state: { gitSha: 'abc123', lastSuccessfulRunId: 'run-123' },
      }
    },
    markRemotelyCompleted() { remotelyMarked = true },
  }
  const ledger = {
    runId: 'run-123',
    state: { context: { gitSha: 'abc123' } },
    async appendEvent() { throw new Error('local disk unavailable') },
    async complete() { throw new Error('must not complete after append failure') },
  }

  await assert.rejects(
    () => completeProductionReleaseWithRemoteConfirmation({ guard, ledger, timeoutMs: 0 }),
    (error) => error?.releaseRemotelyCompleted === true && /local disk unavailable/.test(error.message),
  )
  assert.equal(remotelyMarked, true)
})

test('remote-confirmed release preserves its recovery marker for non-Error local failures', async () => {
  const guard = {
    context: { gitSha: 'abc123', runId: 'run-123' },
    complete: () => new Promise(() => {}),
    async getReleaseInspection() {
      return {
        lock: null,
        run: { gitSha: 'abc123', runId: 'run-123', status: 'passed' },
        state: { gitSha: 'abc123', lastSuccessfulRunId: 'run-123' },
      }
    },
    markRemotelyCompleted() {},
  }
  const ledger = {
    runId: 'run-123',
    state: { context: { gitSha: 'abc123' } },
    async appendEvent() { throw 'local disk unavailable' },
    async complete() {},
  }

  await assert.rejects(
    () => completeProductionReleaseWithRemoteConfirmation({ guard, ledger, timeoutMs: 0 }),
    (error) => error?.releaseRemotelyCompleted === true && /local disk unavailable/.test(error.message),
  )
})
