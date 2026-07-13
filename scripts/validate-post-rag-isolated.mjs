#!/usr/bin/env node
import CloudBase from '@cloudbase/manager-node'
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, open, readFile, rm, unlink, writeFile, mkdtemp } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  analyzeCloudInvoke,
  buildTcbCommand,
  defaultRunner,
  extractFunctionResult,
  formatCommand,
  parseFirstJson,
  redactSensitive,
} from './cloud-release-smoke.mjs'
import { createProductionReleaseStore, resolveCloudBaseReleaseCredentials } from './lib/cloudbase-release-store.mjs'
import { buildPostSemanticFunctionEnvironments } from './lib/post-semantic-function-env.mjs'
import { assertIndependentValidationTokens, createProbeFixtureIds, createValidationIdentity, runIsolatedValidation } from './lib/post-rag-isolated-validation.mjs'
import { isScfTriggerEnabled } from './lib/scf-owned-timer.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const POLL_MS = 3_000
const WAIT_MS = 5 * 60_000
const TRIGGER_NAME = 'post-rag-worker-every-minute'
const REPO_DEFAULT_PUBLIC_COMMUNITY_ID = '56ba808e69df985c046e3d4407e8c672'

function sleep(ms) { return new Promise(resolveWait => setTimeout(resolveWait, ms)) }

function readFlag(argv, name, fallback = '') {
  const exact = argv.find(value => value.startsWith(`--${name}=`))
  if (exact) return exact.slice(name.length + 3)
  const index = argv.indexOf(`--${name}`)
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : fallback
}

function makeRunId(now = new Date()) {
  return `${now.toISOString().replace(/[-:.Z]/g, '').slice(0, 15)}-${randomBytes(3).toString('hex')}`
}

function environmentMap(detail) {
  return Object.fromEntries((detail?.Environment?.Variables || []).map(item => [String(item.Key), String(item.Value)]))
}

export function normalizeValidationVpc(value) {
  const vpcId = String(value?.VpcId || value?.vpcId || value?.Vpc?.VpcId || value?.Vpc?.vpcId
    || value?.vpc?.VpcId || value?.vpc?.vpcId || '').trim()
  const subnetId = String(value?.SubnetId || value?.subnetId || value?.Subnet?.SubnetId || value?.Subnet?.subnetId
    || value?.subnet?.SubnetId || value?.subnet?.subnetId || '').trim()
  if (!vpcId || !subnetId) throw new Error('production RAG worker VPC binding is incomplete')
  return { vpcId, subnetId }
}

export function assertExactTemporaryEnvironment(detail, expected) {
  const variables = detail?.Environment?.Variables || []
  const actual = environmentMap(detail)
  if (Object.prototype.hasOwnProperty.call(actual, 'POST_RAG_WORKER_TOKEN')) throw new Error('temporary environment contains worker token')
  const actualKeys = Object.keys(actual).sort()
  const expectedKeys = Object.keys(expected).sort()
  if (variables.length !== actualKeys.length || JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)
    || expectedKeys.some(key => actual[key] !== String(expected[key]))) throw new Error('temporary environment readback mismatch')
  return true
}

export function assertExactTimerReadback(triggers, expectedArgument) {
  const rows = Array.isArray(triggers) ? triggers : []
  const matches = rows.filter(trigger => trigger?.TriggerName === TRIGGER_NAME
    && trigger?.CustomArgument === expectedArgument && isScfTriggerEnabled(trigger))
  if (rows.length !== 1 || matches.length !== 1) throw new Error('temporary timer trigger readback mismatch')
  return true
}

export async function runCommandWithInput(command, args, options = {}) {
  return new Promise(resolveResult => {
    const spawnCommand = process.platform === 'win32' && command.endsWith('.cmd') ? 'cmd.exe' : command
    const spawnArgs = process.platform === 'win32' && command.endsWith('.cmd')
      ? ['/d', '/s', '/c', formatCommand(command, args)] : args
    const child = spawn(spawnCommand, spawnArgs, { cwd: options.cwd || ROOT, env: options.env || process.env, stdio: ['pipe', 'pipe', 'pipe'], shell: false })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = result => { if (!settled) { settled = true; clearTimeout(timer); resolveResult(result) } }
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ status: 1, stdout, stderr, error: 'command timed out' }) }, Number(options.timeoutMs || 300_000))
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', error => finish({ status: 1, stdout, stderr, error: String(error?.message || error) }))
    child.on('exit', code => finish({ status: code ?? 1, stdout, stderr }))
    child.stdin.end(String(options.input ?? '\n'))
  })
}

export async function acquireLocalValidationLock(lockPath, owner) {
  if (typeof owner !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(owner)) throw new Error('validation lock owner is invalid')
  await mkdir(dirname(lockPath), { recursive: true })
  let handle
  try { handle = await open(lockPath, 'wx') } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('isolated validation already running for this identity')
    throw error
  }
  await handle.writeFile(owner, 'utf8')
  let released = false
  return {
    async release() {
      if (released) return
      released = true
      let current = ''
      try { current = await readFile(lockPath, 'utf8') } finally { await handle.close() }
      if (current !== owner) throw new Error('validation lock ownership changed')
      await unlink(lockPath)
    },
  }
}

export async function resolveSharedValidationLockPath(options, runner = runCommandWithInput) {
  const root = resolve(String(options?.root || ROOT))
  const environmentId = String(options?.environmentId || '')
  const functionName = String(options?.functionName || '')
  if (!environmentId || environmentId.length > 128 || !/^post-rag-validate-[a-f0-9]{8}$/.test(functionName)) {
    throw new Error('shared validation lock identity is invalid')
  }
  const result = await runner('git', ['rev-parse', '--git-common-dir'], { cwd: root, timeoutMs: 10_000, input: '' })
  const raw = String(result?.stdout || '').trim()
  if (result?.status !== 0 || !raw || /[\r\n]/.test(raw)) throw new Error('unable to resolve git common directory')
  const commonDir = resolve(root, raw)
  const identityHash = createHash('sha256').update(`${environmentId}:${functionName}`).digest('hex').slice(0, 16)
  return join(commonDir, 'codex-locks', 'rag-validation', `${functionName}-${identityHash}.lock`)
}

function fingerprintRecoveryError(error) {
  return createHash('sha256').update(String(error && typeof error === 'object' ? error.message || '' : error || ''))
    .digest('hex').slice(0, 16)
}

// Two jobs may each consume 755s retry delays + a 120s lease/operation window.
// 35 minutes leaves a further 350s margin: 2 * (755s + 120s) + 350s = 2100s.
export async function recoverExactProbe(options, deps) {
  const timeoutMs = Number(options?.timeoutMs || 35 * 60_000)
  const pollMs = Number(options?.pollMs || 5000)
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || !Number.isFinite(pollMs) || pollMs < 1) throw new Error('recovery timing is invalid')
  const now = deps.now || Date.now
  const wait = deps.sleep || sleep
  const deadline = now() + timeoutMs
  let lastErrorFingerprint = null
  const retainError = error => { lastErrorFingerprint = fingerprintRecoveryError(error) }
  const waitRemaining = async () => {
    const remaining = Math.max(0, deadline - now())
    if (remaining > 0) await wait(Math.min(pollMs, remaining))
  }
  while (now() < deadline) {
    let inspection
    try { inspection = await deps.inspect(options.runId) } catch (error) {
      retainError(error)
      await waitRemaining()
      continue
    }
    if (!inspection?.exists) return { status: 'absent', lastErrorFingerprint }
    if (inspection.status === 'cleaned') {
      try {
        await deps.verifyNoResidue(inspection)
        return { status: 'cleaned', lastErrorFingerprint }
      } catch (error) { retainError(error) }
    } else {
      if (inspection.status === 'active' || inspection.status === 'cleaning') {
        try { await deps.processExact(options.runId) } catch (error) { retainError(error) }
      }
      try { await deps.cleanup(inspection) } catch (error) { retainError(error) }
    }
    await waitRemaining()
  }
  let count = -1
  try {
    const residue = await deps.inspectResidueDirect(options.runId)
    const parsed = Number(residue?.unresolvedResidueCount ?? residue?.operationalResidueCount)
    count = Number.isFinite(parsed) && parsed >= 0 ? parsed : -1
  } catch (error) { retainError(error) }
  throw new Error(`exact probe recovery timed out ${JSON.stringify({
    unresolvedResidueCount: count, lastErrorFingerprint,
  })}`)
}

export function selectTemporaryWorkerEnvironment(source, tokens) {
  assertIndependentValidationTokens(tokens?.validationToken, tokens?.timerToken)
  const generated = randomBytes(32).toString('hex')
  const allowlisted = buildPostSemanticFunctionEnvironments({
    ...source,
    POST_RAG_WORKER_TOKEN: generated,
    POST_RAG_TIMER_TOKEN: tokens.timerToken,
    POST_RAG_SMOKE_IDENTITY_SECRET: generated,
  })['post-rag-worker']
  const { POST_RAG_WORKER_TOKEN: _excluded, ...shared } = allowlisted
  return { ...shared, RAG_VALIDATION_TOKEN: tokens.validationToken, POST_RAG_TIMER_TOKEN: tokens.timerToken }
}

export function assertExactSemanticSearchResult(result, postId) {
  const exact = Array.isArray(result?.items) ? result.items.find(item => item?.postId === postId) : null
  return {
    exactHit: Boolean(exact),
    sourceFieldsVerified: Boolean(exact && String(exact.matchedSnippet || '').trim() && String(exact.matchedField || '').trim()),
  }
}

function responseData(response) {
  const raw = response?.data
  return Array.isArray(raw) ? raw : raw ? [raw] : []
}

async function getDocumentOrNull(db, collection, id) {
  try { return responseData(await db.collection(collection).doc(id).get())[0] || null } catch (error) {
    if (/document(?:\.get)?:fail[\s\S]*(?:does not exist|not found)|document not found/i.test(String(error?.message || error))) return null
    throw error
  }
}

async function exactRows(db, collection, where) {
  return responseData(await db.collection(collection).where(where).limit(100).get())
}

async function totalCount(db, collection) {
  const response = await db.collection(collection).where({}).count()
  return Number(response?.total || 0)
}

async function observeNonProbeCount(db) {
  const collections = ['posts', 'sections', 'post_rag_outbox', 'post_rag_jobs', 'post_rag_index_versions', 'post_rag_index_state_v2']
  const counts = await Promise.all(collections.map(name => totalCount(db, name)))
  return counts.reduce((sum, count) => sum + count, 0)
}

async function invokeTcb(functionName, payload, options) {
  const directory = await mkdtemp(join(tmpdir(), 'happyhome-rag-validation-invoke-'))
  const payloadFile = join(directory, 'payload.json')
  try {
    await writeFile(payloadFile, JSON.stringify(payload), 'utf8')
    const command = buildTcbCommand(['fn', 'invoke', functionName, '-d', `@${payloadFile}`, '--env-id', options.envId, '--json'])
    const result = await defaultRunner(command.command, command.args, { timeoutMs: options.commandTimeoutMs })
    const parsed = parseFirstJson(`${result.stdout || ''}${result.stderr || ''}`)
    const invoke = analyzeCloudInvoke(parsed)
    if (result.status !== 0 || !parsed || (invoke && !invoke.ok)) {
      throw new Error(redactSensitive(`${functionName} invoke failed status=${result.status} code=${invoke?.errMsg || result.error || 'UNKNOWN'}`))
    }
    return extractFunctionResult(parsed)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function waitFor(label, operation, predicate, timeoutMs = WAIT_MS) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await operation()
    if (predicate(last)) return last
    await sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())))
  }
  throw new Error(`${label} timed out`)
}

async function resolveHead() {
  const result = await defaultRunner('git', ['rev-parse', 'HEAD'], { cwd: ROOT, timeoutMs: 10_000 })
  const head = String(result.stdout || '').trim()
  if (result.status !== 0 || !/^[a-f0-9]{40}$/.test(head)) throw new Error('unable to resolve exact validation HEAD')
  return head
}

export function createCloudValidationDependencies(options) {
  const credentials = options.credentials || resolveCloudBaseReleaseCredentials({ env: process.env, home: homedir() })
  const app = CloudBase.init(credentials)
  const db = createProductionReleaseStore({ root: ROOT }).db
  const state = {
    namespace: credentials.envId,
    validationToken: randomBytes(32).toString('hex'),
    timerToken: randomBytes(32).toString('hex'),
  }
  assertIndependentValidationTokens(state.validationToken, state.timerToken)
  const artifactRoot = resolve(ROOT, '.codex-local', 'rag-validation', options.runId)
  const artifactDirectory = join(artifactRoot, 'function')
  const evidencePath = join(artifactRoot, 'evidence.json')

  const invokeTemporary = (identity, event) => invokeTcb(identity.functionName, {
    ...event, validationToken: state.validationToken,
  }, { ...options, envId: credentials.envId })

  const functionExists = async functionName => {
    const response = await app.functions.scfService.request('ListFunctions', { Namespace: state.namespace, SearchKey: functionName })
    return (response?.Functions || []).some(item => item.FunctionName === functionName)
  }

  const readExactResidueFromRun = async (runId, includeNonProbeCount = true) => {
    const ids = createProbeFixtureIds(runId)
    const audit = await getDocumentOrNull(db, 'post_rag_release_probes', runId)
    const exact = await Promise.all([
      getDocumentOrNull(db, 'posts', ids.postId), getDocumentOrNull(db, 'sections', ids.sectionId),
      getDocumentOrNull(db, 'post_rag_index_state_v2', ids.postId),
      exactRows(db, 'post_rag_outbox', { aggregateId: ids.postId }), exactRows(db, 'post_rag_jobs', { postId: ids.postId }),
      exactRows(db, 'post_rag_index_versions', { postId: ids.postId }),
    ])
    const operationalResidueCount = exact.slice(0, 3).filter(Boolean).length + exact.slice(3).reduce((sum, rows) => sum + rows.length, 0)
    const cleanedAuditCount = audit?.status === 'cleaned' && audit?.runId === runId
      && audit?.postId === ids.postId && audit?.sectionId === ids.sectionId ? 1 : 0
    const unresolvedAuditCount = audit && cleanedAuditCount !== 1 ? 1 : 0
    return {
      operationalResidueCount,
      cleanedAuditCount,
      unresolvedResidueCount: operationalResidueCount + unresolvedAuditCount,
      ...(includeNonProbeCount ? { nonProbeCount: await observeNonProbeCount(db) } : {}),
    }
  }
  const verifyNoResidue = async probe => {
    const ids = createProbeFixtureIds(probe.runId)
    if (probe.postId !== ids.postId || probe.sectionId !== ids.sectionId) throw new Error('exact probe residue binding mismatch')
    const residue = await readExactResidueFromRun(probe.runId)
    if (residue.operationalResidueCount !== 0 || residue.cleanedAuditCount !== 1) throw new Error('exact probe residue verification failed')
    return residue
  }

  return {
    async resolvePublicCommunity() {
      const detail = await app.functions.getFunctionDetail('post')
      const env = environmentMap(detail)
      const candidates = [env.DEFAULT_PUBLIC_COMMUNITY_ID, ...(env.PUBLIC_READ_COMMUNITY_IDS || '').split(/[,\s;]+/), REPO_DEFAULT_PUBLIC_COMMUNITY_ID]
        .map(value => String(value || '').trim()).filter((value, index, values) => value && values.indexOf(value) === index)
      for (const communityId of candidates) {
        const community = await getDocumentOrNull(db, 'communities', communityId)
        if (community?._id === communityId && community?.status === 'active') return communityId
      }
      throw new Error('active public community required')
    },
    async baseline(identity) {
      if (await functionExists(identity.functionName)) throw new Error('temporary function already exists')
      return { functionAbsent: true, nonProbeCount: await observeNonProbeCount(db) }
    },
    async build() {
      await rm(artifactDirectory, { recursive: true, force: true })
      await mkdir(artifactDirectory, { recursive: true })
      await build({
        entryPoints: [resolve(ROOT, 'scripts', 'fixtures', 'post-rag-isolated-worker', 'index.ts')],
        outfile: join(artifactDirectory, 'index.js'), bundle: true, platform: 'node', target: 'node16', format: 'cjs',
        external: ['wx-server-sdk'],
      })
      const lock = JSON.parse(await readFile(resolve(ROOT, 'package-lock.json'), 'utf8'))
      const sdkVersion = String(lock.packages?.['node_modules/wx-server-sdk']?.version || '')
      if (!/^\d+\.\d+\.\d+/.test(sdkVersion)) throw new Error('wx-server-sdk lock version is missing')
      await writeFile(join(artifactDirectory, 'package.json'), `${JSON.stringify({
        name: 'post-rag-isolated-worker', version: '1.0.0', main: 'index.js', dependencies: { 'wx-server-sdk': sdkVersion },
      }, null, 2)}\n`, 'utf8')
      return { directory: artifactDirectory }
    },
    async deploy({ functionName, artifact }) {
      const command = buildTcbCommand(['fn', 'deploy', functionName, '--env-id', credentials.envId, '--deployMode', 'cos', '--json'])
      const result = await runCommandWithInput(command.command, command.args, { cwd: artifact.directory, timeoutMs: options.commandTimeoutMs, input: '\n' })
      if (result.status !== 0) throw new Error(redactSensitive(`temporary function deploy failed status=${result.status} code=${result.error || 'UNKNOWN'}`))
      const detail = await app.functions.getFunctionDetail(functionName)
      state.namespace = detail?.Namespace || credentials.envId
    },
    async copyRuntimeConfig(identity) {
      const production = await app.functions.getFunctionDetail('post-rag-worker')
      const vpc = normalizeValidationVpc(production?.VpcConfig)
      const envVariables = selectTemporaryWorkerEnvironment(environmentMap(production), state)
      await app.functions.updateFunctionConfig({
        name: identity.functionName,
        timeout: Number(production?.Timeout || 120),
        memorySize: Number(production?.MemorySize || 512),
        vpc,
        envVariables,
      })
      const readback = await app.functions.getFunctionDetail(identity.functionName)
      const readbackVpc = normalizeValidationVpc(readback?.VpcConfig)
      if (readbackVpc.vpcId !== vpc.vpcId || readbackVpc.subnetId !== vpc.subnetId) throw new Error('temporary function VPC readback mismatch')
      assertExactTemporaryEnvironment(readback, envVariables)
    },
    async createTrigger(identity) {
      await app.functions.scfService.request('CreateTrigger', {
        FunctionName: identity.functionName, Namespace: state.namespace, TriggerName: TRIGGER_NAME,
        Type: 'timer', TriggerDesc: '0 * * * * * *',
        CustomArgument: JSON.stringify({ runId: identity.runId, timerToken: state.timerToken }), Enable: 'OPEN',
      })
      const listed = await app.functions.scfService.request('ListTriggers', { FunctionName: identity.functionName, Namespace: state.namespace })
      const expectedArgument = JSON.stringify({ runId: identity.runId, timerToken: state.timerToken })
      assertExactTimerReadback(listed?.Triggers, expectedArgument)
    },
    invoke: invokeTemporary,
    async waitIndexed(identity, probe) {
      return waitFor('authentic exact create job', () => invokeTemporary(identity, { action: 'inspect', runId: identity.runId }), inspection => {
        const evidence = inspection?.timerEvidence
        return inspection?.job?.status === 'completed' && inspection.job.outcome === 'indexed'
          && evidence?.triggerName === TRIGGER_NAME && evidence?.outboxId === probe.outboxId
          && evidence?.jobId === inspection.job.jobId && evidence?.outcome === 'indexed' && evidence?.phase === 'create'
          && evidence?.outboxMaterializedByTimer === true && evidence?.jobCompletedByTimer === true
      }).then(inspection => ({ jobId: inspection.job.jobId, outcome: inspection.job.outcome }))
    },
    async assertSemanticHit(probe) {
      const result = await invokeTcb('post', {
        action: 'search', communityId: probe.communityId, q: `probe-${probe.runId}`, limit: 5, asGuest: true,
      }, { ...options, envId: credentials.envId })
      const assertion = assertExactSemanticSearchResult(result, probe.postId)
      if (!assertion.exactHit || !assertion.sourceFieldsVerified) throw new Error('exact semantic fixture post was not returned')
      return assertion
    },
    async waitRemoved(identity, probe) {
      return waitFor('authentic exact delete job', () => invokeTemporary(identity, { action: 'inspect', runId: identity.runId }), inspection => {
        const evidence = inspection?.timerEvidence
        return inspection?.job?.status === 'completed' && ['removed', 'superseded'].includes(inspection.job.outcome)
          && evidence?.triggerName === TRIGGER_NAME && evidence?.outboxId === inspection.outboxId
          && evidence?.jobId === inspection.job.jobId && evidence?.outcome === inspection.job.outcome && evidence?.phase === 'cleanup'
          && evidence?.outboxMaterializedByTimer === true && evidence?.jobCompletedByTimer === true
      }).then(inspection => ({ jobId: inspection.job.jobId, outcome: inspection.job.outcome }))
    },
    async assertSemanticAbsent(probe) {
      const result = await invokeTcb('post', {
        action: 'search', communityId: probe.communityId, q: `probe-${probe.runId}`, limit: 5, asGuest: true,
      }, { ...options, envId: credentials.envId })
      if ((result?.items || []).some(item => item?.postId === probe.postId)) throw new Error('deleted semantic fixture post is still returned')
      return { exactAbsent: true }
    },
    async waitCleaned(identity, probe) {
      return waitFor('probe cleanup', () => invokeTemporary(identity, { action: 'cleanup', ...probe }), result => result?.status === 'cleaned')
    },
    assertNoResidue: verifyNoResidue,
    async recoverProbe(identity, recovery) {
      return recoverExactProbe({ runId: recovery.runId }, {
        inspect: () => invokeTemporary(identity, { action: 'inspect', runId: recovery.runId }),
        processExact: () => invokeTemporary(identity, { action: 'processExact', runId: recovery.runId }),
        cleanup: inspection => invokeTemporary(identity, {
          action: 'cleanup', runId: recovery.runId, communityId: inspection.communityId,
          sectionId: inspection.sectionId, postId: inspection.postId,
        }),
        verifyNoResidue,
        inspectResidueDirect: runId => readExactResidueFromRun(runId, false),
      })
    },
    async writeEvidence(evidence) {
      await mkdir(dirname(evidencePath), { recursive: true })
      await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
      return evidence
    },
    async deleteTrigger(identity) {
      try {
        await app.functions.scfService.request('DeleteTrigger', {
          FunctionName: identity.functionName, Namespace: state.namespace, TriggerName: TRIGGER_NAME, Type: 'timer',
        })
      } catch (error) {
        const text = String(error?.code || error?.original?.Code || error?.message || error)
        if (!/ResourceNotFound\.(?:Trigger|Function)|TriggerNotFound|trigger does not exist/i.test(text)) throw error
      }
      await waitFor('temporary trigger deletion', async () => {
        const response = await app.functions.scfService.request('ListTriggers', { FunctionName: identity.functionName, Namespace: state.namespace })
        return !(response?.Triggers || []).some(trigger => trigger.TriggerName === TRIGGER_NAME)
      }, absent => absent === true, 60_000)
    },
    async deleteFunction(identity) {
      try { await app.functions.scfService.request('DeleteFunction', { FunctionName: identity.functionName, Namespace: state.namespace }) }
      catch (error) {
        const text = String(error?.code || error?.original?.Code || error?.message || error)
        if (!/ResourceNotFound\.(?:Function|FunctionName)|FunctionNotFound|function does not exist/i.test(text)) throw error
      }
    },
    async removeArtifact() { await rm(artifactDirectory, { recursive: true, force: true }) },
    async clearSecrets() { state.validationToken = ''; state.timerToken = '' },
    async assertControlPlaneAbsent(identity) {
      await waitFor('temporary function deletion', async () => {
        return !(await functionExists(identity.functionName))
      }, absent => absent === true, 60_000)
    },
  }
}

export async function main(argv = process.argv.slice(2)) {
  const runId = readFlag(argv, 'run-id', makeRunId())
  const commandTimeoutMs = Math.max(60_000, Number(readFlag(argv, 'command-timeout-ms', '300000')) || 300_000)
  const head = readFlag(argv, 'head', await resolveHead())
  const identity = createValidationIdentity(head, runId)
  const credentials = resolveCloudBaseReleaseCredentials({ env: process.env, home: homedir() })
  const lockPath = await resolveSharedValidationLockPath({
    root: ROOT, environmentId: credentials.envId, functionName: identity.functionName,
  })
  const lock = await acquireLocalValidationLock(
    lockPath,
    randomBytes(16).toString('hex'),
  )
  let result
  let primaryError
  try {
    const deps = createCloudValidationDependencies({ runId, commandTimeoutMs, credentials })
    const communityId = await deps.resolvePublicCommunity()
    result = await runIsolatedValidation({ head, runId, communityId }, deps)
  } catch (error) { primaryError = error }
  try { await lock.release() } catch (error) {
    primaryError = primaryError ? new AggregateError([primaryError, error], 'isolated validation lock release failed') : error
  }
  if (primaryError) throw primaryError
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`[validate-post-rag-isolated] FAILED: ${redactSensitive(error?.message || String(error))}`)
    process.exit(1)
  })
}
