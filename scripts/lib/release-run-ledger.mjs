import { access, appendFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { REQUIRED_SMOKE_LABELS } from '../cloud-release-smoke.mjs'

export const RELEASE_RUNS_DIR = '.codex-local/release-runs'

export const RELEASE_STAGE_ORDER = [
  'miniprogram-build-gate',
  'cloud-deploy',
  'cloud-smoke',
  'admin-web-deploy',
  'miniprogram-upload',
  'verify-upload',
]

const REQUIRED_RELEASE_UI_MARKERS = [
  'HH_RELEASE_HOME_COLD_START_NONEMPTY',
  'HH_RELEASE_HOME_IMAGES_RENDERED',
  'HH_RELEASE_HOME_DETAIL_NONEMPTY',
  'HH_RELEASE_LOGIN_VERSION',
  'HH_RELEASE_PROFILE_LOGIN_CLEAN',
]

const RELEASE_CONTEXT_KEYS = ['gitSha', 'version', 'desc', 'envId', 'releaseStrategy']

function hasReusableColdStartEvidence(evidence = {}) {
  const coldStart = evidence.homeColdStart
  const visible = (rect) => Number(rect?.width || 0) > 1 && Number(rect?.height || 0) > 1
  return coldStart?.passed === true &&
    String(coldStart.path || '').includes('pages/index/index') &&
    visible(coldStart.layout?.phoneInner) &&
    visible(coldStart.layout?.homeShell) &&
    Number(coldStart.appTabBarCount || 0) > 0
}

function pad(value) {
  return String(value).padStart(2, '0')
}

export function makeReleaseRunId(date = new Date(), random = Math.random) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    '-',
    random().toString(36).slice(2, 8),
  ].join('')
}

function isoNow(now) {
  return (now ? now() : new Date()).toISOString()
}

function safeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function oneLineJson(value) {
  return `${JSON.stringify(value)}\n`
}

function pathFromRoot(root, value) {
  if (!value) return ''
  return isAbsolute(value) ? value : resolve(root, value)
}

function relativeToRoot(root, value) {
  if (!value) return ''
  return isAbsolute(value) ? relative(root, value).replace(/\\/g, '/') : String(value).replace(/\\/g, '/')
}

async function pathExists(path) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

export async function computeDirectoryDigest(inputRoot) {
  const root = resolve(inputRoot)
  const entries = []
  async function walk(directory, prefix = '') {
    const children = await readdir(directory, { withFileTypes: true })
    children.sort((left, right) => left.name.localeCompare(right.name))
    for (const child of children) {
      const relativePath = prefix ? `${prefix}/${child.name}` : child.name
      const absolutePath = join(directory, child.name)
      if (child.isDirectory()) {
        await walk(absolutePath, relativePath)
      } else if (child.isFile()) {
        const contents = await readFile(absolutePath)
        const fileStat = await stat(absolutePath)
        entries.push(`${relativePath}\0${fileStat.size}\0${createHash('sha256').update(contents).digest('hex')}`)
      }
    }
  }
  await walk(root)
  return createHash('sha256').update(entries.join('\n')).digest('hex')
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, safeJson(value), 'utf8')
}

function durationMs(startedAt, finishedAt) {
  const start = Date.parse(startedAt)
  const finish = Date.parse(finishedAt)
  if (!Number.isFinite(start) || !Number.isFinite(finish)) return null
  return Math.max(0, finish - start)
}

function contextMismatch(stageContext = {}, expected = {}) {
  for (const key of RELEASE_CONTEXT_KEYS) {
    if (expected[key] && !stageContext[key]) {
      return `${key} missing from reusable stage context`
    }
    if (expected[key] && stageContext[key] && expected[key] !== stageContext[key]) {
      return `${key} mismatch: expected ${expected[key]}, got ${stageContext[key]}`
    }
  }
  return ''
}

function mergeExistingRunContext(existing = {}, next = {}) {
  const merged = { ...existing, releaseStrategy: existing.releaseStrategy || 'main' }
  const requested = { ...next, releaseStrategy: next.releaseStrategy || 'main' }
  for (const key of RELEASE_CONTEXT_KEYS) {
    if (merged[key] && requested[key] && merged[key] !== requested[key]) {
      throw new Error(`release run context mismatch for ${key}: existing ${merged[key]}, requested ${requested[key]}`)
    }
    merged[key] = merged[key] || requested[key] || ''
  }
  return merged
}

function textHasBuildInfo(text, version, desc) {
  return text.includes(version) && text.includes(desc) && text.includes(`mp-${version}`)
}

async function inspectBuildInfoEvidence(stage, context) {
  const root = context.root
  const sourcePath = pathFromRoot(root, stage.evidence?.buildInfoPath || 'miniprogram/src/generated/build-info.ts')
  const distPath = pathFromRoot(root, stage.evidence?.distBuildInfoPath || 'miniprogram/dist/build/mp-weixin/generated/build-info.js')
  if (!(await pathExists(sourcePath))) return { reusable: false, reason: `build info missing: ${relativeToRoot(root, sourcePath)}` }
  if (!(await pathExists(distPath))) return { reusable: false, reason: `dist build info missing: ${relativeToRoot(root, distPath)}` }

  const source = await readFile(sourcePath, 'utf8')
  const dist = await readFile(distPath, 'utf8')
  if (!textHasBuildInfo(source, context.version, context.desc)) return { reusable: false, reason: 'source build info does not match version/desc' }
  if (!textHasBuildInfo(dist, context.version, context.desc)) return { reusable: false, reason: 'dist build info does not match version/desc' }

  const packageRoot = pathFromRoot(root, stage.evidence?.packageRoot)
  const expectedPackageDigest = String(stage.evidence?.packageDigest || '')
  if (!packageRoot || !expectedPackageDigest) return { reusable: false, reason: 'package digest evidence is missing' }
  if (!(await pathExists(packageRoot))) return { reusable: false, reason: `package root missing: ${relativeToRoot(root, packageRoot)}` }
  const actualPackageDigest = await computeDirectoryDigest(packageRoot)
  if (actualPackageDigest !== expectedPackageDigest) {
    return { reusable: false, reason: `package digest mismatch: expected ${expectedPackageDigest}, got ${actualPackageDigest}` }
  }

  const uiEvidencePath = stage.evidence?.releaseUiEvidencePath
  if (!uiEvidencePath) return { reusable: false, reason: 'release UI evidence path missing' }
  const absoluteUiEvidencePath = pathFromRoot(root, uiEvidencePath)
  if (!(await pathExists(absoluteUiEvidencePath))) return { reusable: false, reason: `release UI evidence missing: ${relativeToRoot(root, absoluteUiEvidencePath)}` }
  const evidence = await readJson(absoluteUiEvidencePath)
  const evidenceProjectPath = pathFromRoot(root, evidence.projectPath)
  if (!evidenceProjectPath || resolve(evidenceProjectPath) !== resolve(packageRoot)) {
    return { reusable: false, reason: 'release UI evidence project path does not match prepared package root' }
  }
  if (context.runId && evidence.releaseRunId !== context.runId) {
    return { reusable: false, reason: `release UI evidence runId mismatch: expected ${context.runId}, got ${evidence.releaseRunId || 'missing'}` }
  }
  if (evidence.packageDigest !== expectedPackageDigest) {
    return { reusable: false, reason: 'release UI evidence package digest does not match prepared package' }
  }
  const markers = new Set(evidence.markers || [])
  const missingMarker = REQUIRED_RELEASE_UI_MARKERS.find((marker) => !markers.has(marker))
  if (missingMarker) return { reusable: false, reason: `release UI evidence missing marker ${missingMarker}` }
  if (!hasReusableColdStartEvidence(evidence)) {
    return { reusable: false, reason: 'release UI evidence cold-start result is missing or invalid' }
  }
  const expectedVersion = evidence.profileLoginClean?.expectedVersion || evidence.expectedVersion
  if (!expectedVersion) return { reusable: false, reason: 'release UI evidence version is missing' }
  if (expectedVersion !== context.version) {
    return { reusable: false, reason: `release UI evidence version mismatch: expected ${context.version}, got ${expectedVersion}` }
  }
  return { reusable: true, reason: 'build and release UI evidence match' }
}

async function inspectCloudSmokeEvidence(stage, context) {
  const root = context.root
  const summaryPath = pathFromRoot(root, stage.evidence?.summaryPath)
  if (!summaryPath) return { reusable: false, reason: 'cloud smoke summary path missing' }
  if (!(await pathExists(summaryPath))) return { reusable: false, reason: `cloud smoke summary missing: ${relativeToRoot(root, summaryPath)}` }

  const summary = await readJson(summaryPath)
  if (summary.status !== 'passed') return { reusable: false, reason: `cloud smoke status is ${summary.status || 'unknown'}` }
  if (context.envId && summary.envId !== context.envId) {
    return { reusable: false, reason: `cloud smoke envId mismatch: expected ${context.envId}, got ${summary.envId || 'unknown'}` }
  }
  if (context.runId && summary.runId !== context.runId) {
    return { reusable: false, reason: `cloud smoke runId mismatch: expected ${context.runId}, got ${summary.runId || 'unknown'}` }
  }
  const expectedFunctions = Array.isArray(context.cloudFunctions) ? [...context.cloudFunctions].sort() : []
  if (expectedFunctions.length > 0) {
    const actualFunctions = Array.isArray(summary.functions) ? [...summary.functions].sort() : []
    if (JSON.stringify(actualFunctions) !== JSON.stringify(expectedFunctions)) {
      return { reusable: false, reason: `cloud smoke functions mismatch: expected ${expectedFunctions.join(',')}, got ${actualFunctions.join(',') || 'none'}` }
    }
  }
  if (Array.isArray(summary.missingLabels) && summary.missingLabels.length > 0) {
    return { reusable: false, reason: `cloud smoke missing labels: ${summary.missingLabels.join(', ')}` }
  }
  const labels = new Set(summary.labels || [])
  const fixedRequiredLabels = REQUIRED_SMOKE_LABELS.filter((label) => {
    if (label === 'HH_CLOUD_INVOKE_SMOKE_ADMIN_FIXTURE' || label === 'HH_CLOUD_FIXTURE_CLEANUP_OK') {
      return expectedFunctions.length === 0 || expectedFunctions.includes('admin')
    }
    if (label === 'HH_CLOUD_LOG_CAPTURE_POST') {
      return expectedFunctions.length === 0 || expectedFunctions.includes('post')
    }
    return true
  })
  const missingRequired = fixedRequiredLabels.filter((label) => !labels.has(label))
  if (missingRequired.length > 0) {
    return { reusable: false, reason: `cloud smoke required labels absent: ${missingRequired.join(', ')}` }
  }
  return { reusable: true, reason: 'cloud smoke summary passed with required labels', evidence: { summaryPath: relativeToRoot(root, summaryPath) } }
}

async function inspectUploadEvidence(stage, context) {
  const root = context.root
  if (stage.result?.version !== context.version) {
    return { reusable: false, reason: `upload version mismatch: expected ${context.version}, got ${stage.result?.version || 'unknown'}` }
  }
  if (stage.result?.desc !== context.desc) {
    return { reusable: false, reason: `upload desc mismatch: expected ${context.desc}, got ${stage.result?.desc || 'unknown'}` }
  }

  const uploadEvidencePath = pathFromRoot(root, stage.evidence?.uploadEvidencePath)
  if (!uploadEvidencePath) return { reusable: false, reason: 'upload evidence path missing' }
  if (!(await pathExists(uploadEvidencePath))) return { reusable: false, reason: `upload evidence missing: ${relativeToRoot(root, uploadEvidencePath)}` }
  const evidence = await readJson(uploadEvidencePath)
  if (evidence.success !== true) return { reusable: false, reason: 'upload evidence is not successful' }
  if (evidence.version !== context.version) {
    return { reusable: false, reason: `upload evidence version mismatch: expected ${context.version}, got ${evidence.version || 'unknown'}` }
  }
  if (evidence.desc !== context.desc) {
    return { reusable: false, reason: `upload evidence desc mismatch: expected ${context.desc}, got ${evidence.desc || 'unknown'}` }
  }
  if (context.appid && evidence.appid !== context.appid) {
    return { reusable: false, reason: `upload evidence appid mismatch: expected ${context.appid}, got ${evidence.appid || 'unknown'}` }
  }
  if (!['devtools-cli', 'miniprogram-ci'].includes(evidence.method)) {
    return { reusable: false, reason: `upload evidence method is ${evidence.method || 'unknown'}` }
  }
  if (!context.packageDigest) return { reusable: false, reason: 'prepared package digest is missing for upload reuse' }
  if (evidence.packageDigest !== context.packageDigest) {
    return { reusable: false, reason: 'upload evidence package digest does not match prepared package' }
  }

  const uploadInfoPathValue = Object.prototype.hasOwnProperty.call(evidence, 'uploadInfoPath')
    ? evidence.uploadInfoPath
    : stage.evidence?.uploadInfoPath || ''
  const uploadInfoPath = pathFromRoot(root, uploadInfoPathValue)
  if (evidence.method === 'devtools-cli') {
    if (!uploadInfoPath) return { reusable: false, reason: 'upload info path missing from normalized evidence' }
    if (!(await pathExists(uploadInfoPath))) return { reusable: false, reason: `upload info missing: ${relativeToRoot(root, uploadInfoPath)}` }
    const fileStat = await stat(uploadInfoPath)
    if (!fileStat.isFile() || fileStat.size <= 0) return { reusable: false, reason: 'upload info is empty or not a file' }
    if (Number(evidence.uploadInfoSize || 0) !== fileStat.size) {
      return { reusable: false, reason: 'upload info size does not match normalized evidence' }
    }
    const uploadStartedAtMs = Number(evidence.uploadStartedAtMs || 0)
    if (!Number.isFinite(uploadStartedAtMs) || uploadStartedAtMs <= 0) {
      return { reusable: false, reason: 'upload attempt start time is missing' }
    }
    if (fileStat.mtimeMs + 5000 < uploadStartedAtMs) {
      return { reusable: false, reason: 'upload info predates the recorded upload attempt' }
    }
  }
  return {
    reusable: true,
    reason: 'normalized upload evidence matches ledger version/desc',
    evidence: {
      uploadEvidencePath: relativeToRoot(root, uploadEvidencePath),
      uploadInfoPath: relativeToRoot(root, uploadInfoPath),
    },
  }
}

export async function inspectReleaseStageReuse(runState, stageName, context) {
  const stage = runState?.stages?.[stageName]
  if (!stage) return { reusable: false, reason: `${stageName} has no ledger entry` }
  if (stage.status !== 'passed' && !(stage.status === 'skipped' && stage.reused === true)) {
    return { reusable: false, reason: `${stageName} status is ${stage.status || 'unknown'}` }
  }

  const mismatch = contextMismatch(stage.context || runState.context, context)
  if (mismatch) return { reusable: false, reason: mismatch }

  if (stageName === 'miniprogram-build-gate') return await inspectBuildInfoEvidence(stage, context)
  if (stageName === 'cloud-deploy') {
    if (stage.result?.path !== 'cloudbase-cli') return { reusable: false, reason: 'cloud deploy did not use CloudBase CLI/COS' }
    if (!Array.isArray(stage.result?.fns) || stage.result.fns.length === 0) return { reusable: false, reason: 'cloud deploy function list missing' }
    return { reusable: true, reason: 'cloud deploy stage passed for this commit/version', result: stage.result }
  }
  if (stageName === 'cloud-smoke') {
    const cloudDeployFns = runState?.stages?.['cloud-deploy']?.result?.fns
    return await inspectCloudSmokeEvidence(stage, {
      ...context,
      cloudFunctions: context.cloudFunctions || cloudDeployFns,
    })
  }
  if (stageName === 'miniprogram-upload') {
    return await inspectUploadEvidence(stage, {
      ...context,
      packageDigest: context.packageDigest || runState?.stages?.['miniprogram-build-gate']?.evidence?.packageDigest || '',
    })
  }

  return { reusable: true, reason: `${stageName} passed for this commit/version`, result: stage.result, evidence: stage.evidence }
}

export class ReleaseRunLedger {
  constructor(options) {
    this.root = resolve(options.root || process.cwd())
    this.runId = options.runId
    this.now = options.now || (() => new Date())
    this.runDir = resolve(this.root, RELEASE_RUNS_DIR, this.runId)
    this.runPath = join(this.runDir, 'run.json')
    this.eventsPath = join(this.runDir, 'events.jsonl')
    this.latestPath = resolve(this.root, RELEASE_RUNS_DIR, 'latest.json')
    this.state = options.state
  }

  async save() {
    this.state.updatedAt = isoNow(this.now)
    await writeJson(this.runPath, this.state)
    await writeJson(this.latestPath, {
      runId: this.runId,
      runDir: relativeToRoot(this.root, this.runDir),
      runPath: relativeToRoot(this.root, this.runPath),
      updatedAt: this.state.updatedAt,
      status: this.state.status,
      gitSha: this.state.context?.gitSha,
      version: this.state.context?.version,
      desc: this.state.context?.desc,
      envId: this.state.context?.envId,
      releaseStrategy: this.state.context?.releaseStrategy || 'main',
    })
  }

  async appendEvent(event, payload = {}) {
    await mkdir(this.runDir, { recursive: true })
    await appendFile(this.eventsPath, oneLineJson({
      at: isoNow(this.now),
      event,
      runId: this.runId,
      ...payload,
    }), 'utf8')
  }

  async startStage(name, details = {}) {
    const at = isoNow(this.now)
    this.state.status = 'running'
    this.state.stages[name] = {
      ...(this.state.stages[name] || {}),
      name,
      status: 'running',
      startedAt: at,
      finishedAt: null,
      durationMs: null,
      context: { ...this.state.context },
      command: details.command || this.state.stages[name]?.command || '',
      evidence: details.evidence || this.state.stages[name]?.evidence || {},
      result: details.result || this.state.stages[name]?.result || null,
      reason: details.reason || '',
    }
    await this.appendEvent('stage_started', { stage: name, command: this.state.stages[name].command })
    await this.save()
  }

  async passStage(name, details = {}) {
    const at = isoNow(this.now)
    const existing = this.state.stages[name] || {}
    const startedAt = existing.startedAt || at
    this.state.stages[name] = {
      ...existing,
      name,
      status: 'passed',
      startedAt,
      finishedAt: at,
      durationMs: durationMs(startedAt, at),
      context: { ...(existing.context || this.state.context) },
      command: details.command || existing.command || '',
      evidence: { ...(existing.evidence || {}), ...(details.evidence || {}) },
      result: details.result ?? existing.result ?? null,
      reason: '',
    }
    await this.appendEvent('stage_passed', { stage: name, evidence: this.state.stages[name].evidence, result: this.state.stages[name].result })
    await this.save()
  }

  async failStage(name, error, details = {}) {
    const at = isoNow(this.now)
    const existing = this.state.stages[name] || {}
    const startedAt = existing.startedAt || at
    this.state.status = 'failed'
    this.state.stages[name] = {
      ...existing,
      name,
      status: 'failed',
      startedAt,
      finishedAt: at,
      durationMs: durationMs(startedAt, at),
      context: { ...(existing.context || this.state.context) },
      command: details.command || existing.command || '',
      evidence: { ...(existing.evidence || {}), ...(details.evidence || {}) },
      result: details.result ?? existing.result ?? null,
      error: String(error?.stack || error?.message || error),
      reason: details.reason || String(error?.message || error),
    }
    await this.appendEvent('stage_failed', { stage: name, reason: this.state.stages[name].reason })
    await this.save()
  }

  async skipStage(name, details = {}) {
    const at = isoNow(this.now)
    const existing = this.state.stages[name] || {}
    this.state.stages[name] = {
      ...existing,
      name,
      status: 'passed',
      skippedAt: at,
      reusedAt: at,
      context: { ...(existing.context || this.state.context) },
      command: details.command || existing.command || '',
      evidence: { ...(existing.evidence || {}), ...(details.evidence || {}) },
      result: details.result ?? existing.result ?? null,
      reason: details.reason || 'reused previous passed stage',
      reused: details.reused ?? true,
    }
    await this.appendEvent('stage_reused', { stage: name, reason: this.state.stages[name].reason })
    await this.save()
  }

  async complete(status = 'passed') {
    this.state.status = status
    this.state.finishedAt = isoNow(this.now)
    await this.appendEvent('run_completed', { status })
    await this.save()
  }
}

export async function createReleaseRunLedger(options) {
  const root = resolve(options.root || process.cwd())
  const runId = options.runId
  if (!runId) throw new Error('release runId is required')
  const runPath = resolve(root, RELEASE_RUNS_DIR, runId, 'run.json')
  let state
  if (await pathExists(runPath)) {
    state = await readJson(runPath)
    state.context = mergeExistingRunContext(state.context || {}, {
      gitSha: options.gitSha || '',
      version: options.version || '',
      desc: options.desc || '',
      envId: options.envId || '',
      releaseStrategy: options.releaseStrategy || 'main',
    })
  } else {
    const createdAt = isoNow(options.now)
    state = {
      schemaVersion: 1,
      runId,
      command: options.command || '',
      status: 'running',
      createdAt,
      updatedAt: createdAt,
      finishedAt: null,
      context: {
        gitSha: options.gitSha || '',
        version: options.version || '',
        desc: options.desc || '',
        envId: options.envId || '',
        releaseStrategy: options.releaseStrategy || 'main',
      },
      stages: {},
    }
  }

  const ledger = new ReleaseRunLedger({ ...options, root, runId, state })
  await ledger.appendEvent('run_opened', { command: state.command, status: state.status })
  await ledger.save()
  return ledger
}

function releaseIdentityFromLedger(ledger) {
  const gitSha = String(ledger?.state?.context?.gitSha || '').trim()
  const runId = String(ledger?.runId || '').trim()
  if (!gitSha || !runId) throw new Error('release ledger is missing gitSha or runId')
  return { gitSha, runId }
}

export function productionInspectionProvesReleaseCompletion(ledger, productionInspection) {
  const expected = releaseIdentityFromLedger(ledger)
  const productionState = productionInspection?.state
  const run = productionInspection?.run
  return productionInspection?.lock == null &&
    String(productionState?.gitSha || '') === expected.gitSha &&
    String(productionState?.lastSuccessfulRunId || '') === expected.runId &&
    String(run?.gitSha || '') === expected.gitSha &&
    String(run?.runId || '') === expected.runId &&
    run?.status === 'passed'
}

export async function confirmReleaseLedgerAgainstProductionInspection({ ledger, productionInspection }) {
  const expected = releaseIdentityFromLedger(ledger)
  if (!productionInspectionProvesReleaseCompletion(ledger, productionInspection)) {
    throw new Error(`Production state does not prove completion for run ${expected.runId} at ${expected.gitSha}`)
  }
  const productionState = productionInspection.state
  const evidence = {
    gitSha: expected.gitSha,
    lastSuccessfulRunId: expected.runId,
    releasedAt: productionState.releasedAt || null,
  }
  await ledger.appendEvent('remote_release_completion_confirmed', { evidence })
  await ledger.complete('passed')
  return evidence
}

export async function loadReleaseRun(root, runId) {
  const absoluteRoot = resolve(root || process.cwd())
  return await readJson(resolve(absoluteRoot, RELEASE_RUNS_DIR, runId, 'run.json'))
}

export async function loadLatestReleaseRun(root) {
  const absoluteRoot = resolve(root || process.cwd())
  const latest = await readJson(resolve(absoluteRoot, RELEASE_RUNS_DIR, 'latest.json'))
  return await loadReleaseRun(absoluteRoot, latest.runId)
}

export async function findLatestReleaseUiEvidence(root) {
  const evidenceRoot = resolve(root || process.cwd(), '.codex-local', 'release-evidence')
  if (!(await pathExists(evidenceRoot))) return ''
  const entries = await readdir(evidenceRoot, { withFileTypes: true })
  const candidates = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const evidencePath = join(evidenceRoot, entry.name, 'release-ui-evidence.json')
    if (await pathExists(evidencePath)) {
      const evidenceStat = await stat(evidencePath)
      candidates.push({ path: evidencePath, mtimeMs: evidenceStat.mtimeMs })
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return candidates[0]?.path || ''
}

export async function runLedgerStage(ledger, name, options = {}, action) {
  if (options.resume && options.reuseCheck) {
    const reuse = await options.reuseCheck(ledger.state, name)
    if (reuse.reusable) {
      await ledger.skipStage(name, {
        command: options.command,
        reason: reuse.reason,
        evidence: reuse.evidence,
        result: reuse.result,
        reused: true,
      })
      return reuse.result ?? ledger.state.stages[name]?.result ?? null
    }
    await ledger.appendEvent('stage_reuse_rejected', {
      stage: name,
      reason: reuse.reason || 'reuse check did not approve this stage',
    })
    if (options.mustReuse) {
      throw new Error(`${name} must reuse prepared evidence: ${reuse.reason || 'reuse check did not approve this stage'}`)
    }
  }

  await ledger.startStage(name, { command: options.command, evidence: options.evidence })
  try {
    const value = await action()
    const stageDetails = value && typeof value === 'object' && (
      Object.hasOwn(value, 'result') ||
      Object.hasOwn(value, 'evidence') ||
      Object.hasOwn(value, 'reason')
    )
      ? value
      : { result: value }
    await ledger.passStage(name, { command: options.command, ...stageDetails })
    return stageDetails.result ?? value
  } catch (error) {
    const errorDetails = error && typeof error === 'object'
      ? {
          evidence: error.evidence,
          result: error.result,
          reason: error.reason || error.message,
        }
      : {}
    await ledger.failStage(name, error, { command: options.command, ...errorDetails })
    throw error
  }
}

export function formatReleaseRunStatus(runState) {
  if (!runState) return 'No HappyHome release run found.'
  const lines = [
    `HappyHome release run ${runState.runId}`,
    `Status: ${runState.status}`,
    `Git: ${runState.context?.gitSha || 'unknown'}`,
    `Strategy: ${runState.context?.releaseStrategy || 'main'}`,
    `Version: ${runState.context?.version || 'unknown'}`,
    `Desc: ${runState.context?.desc || 'unknown'}`,
    'Stages:',
  ]

  const seen = new Set()
  for (const stageName of RELEASE_STAGE_ORDER) {
    const stage = runState.stages?.[stageName]
    seen.add(stageName)
    lines.push(`- ${stageName}: ${stage?.status || 'pending'}${stage?.reason ? ` (${stage.reason})` : ''}`)
  }
  for (const [stageName, stage] of Object.entries(runState.stages || {})) {
    if (!seen.has(stageName)) lines.push(`- ${stageName}: ${stage.status}${stage.reason ? ` (${stage.reason})` : ''}`)
  }
  return lines.join('\n')
}

export function summarizeReleaseRun(runState) {
  const stages = {}
  const allStageNames = [
    ...RELEASE_STAGE_ORDER,
    ...Object.keys(runState?.stages || {}).filter((stageName) => !RELEASE_STAGE_ORDER.includes(stageName)),
  ]
  for (const stageName of allStageNames) {
    const stage = runState?.stages?.[stageName] || {}
    stages[stageName] = {
      status: stage.status || 'pending',
      durationMs: stage.durationMs ?? null,
      startedAt: stage.startedAt || null,
      finishedAt: stage.finishedAt || null,
      skippedAt: stage.skippedAt || null,
      command: stage.command || '',
      evidence: stage.evidence || {},
      result: stage.result || null,
      reason: stage.reason || '',
      reused: stage.reused === true,
    }
  }
  return {
    runId: runState?.runId || '',
    status: runState?.status || 'unknown',
    createdAt: runState?.createdAt || null,
    updatedAt: runState?.updatedAt || null,
    finishedAt: runState?.finishedAt || null,
    context: {
      gitSha: runState?.context?.gitSha || '',
      version: runState?.context?.version || '',
      desc: runState?.context?.desc || '',
      envId: runState?.context?.envId || '',
      releaseStrategy: runState?.context?.releaseStrategy || 'main',
    },
    stages,
  }
}
