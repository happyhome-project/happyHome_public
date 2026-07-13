#!/usr/bin/env node
import CloudBase from '@cloudbase/manager-node'
import { build } from 'esbuild'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm, writeFile, mkdtemp } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  analyzeCloudInvoke,
  buildTcbCommand,
  defaultRunner,
  extractFunctionResult,
  parseFirstJson,
  redactSensitive,
} from './cloud-release-smoke.mjs'
import { createProductionReleaseStore, resolveCloudBaseReleaseCredentials } from './lib/cloudbase-release-store.mjs'
import { buildPostSemanticFunctionEnvironments } from './lib/post-semantic-function-env.mjs'
import { assertIndependentValidationTokens, runIsolatedValidation } from './lib/post-rag-isolated-validation.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const POLL_MS = 3_000
const WAIT_MS = 5 * 60_000
const TRIGGER_NAME = 'post-rag-worker-every-minute'

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
  const vpcId = String(value?.VpcId || value?.vpcId || value?.Vpc?.VpcId || value?.Vpc?.vpcId || '').trim()
  const subnetId = String(value?.SubnetId || value?.subnetId || value?.Subnet?.SubnetId || value?.Subnet?.subnetId || '').trim()
  if (!vpcId || !subnetId) throw new Error('production RAG worker VPC binding is incomplete')
  return { vpcId, subnetId }
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
  const credentials = resolveCloudBaseReleaseCredentials({ env: process.env, home: homedir() })
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
    ...event,
    ...(event.action === 'timer' ? { timerToken: state.timerToken } : { validationToken: state.validationToken }),
  }, { ...options, envId: credentials.envId })

  return {
    async baseline() { return { nonProbeCount: await observeNonProbeCount(db) } },
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
      const command = buildTcbCommand(['fn', 'deploy', functionName, '--force', '--env-id', credentials.envId, '--deployMode', 'cos', '--json'])
      const result = await defaultRunner(command.command, command.args, { cwd: artifact.directory, timeoutMs: options.commandTimeoutMs })
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
      const keys = new Set((readback?.Environment?.Variables || []).map(item => String(item.Key)))
      for (const key of Object.keys(envVariables)) if (!keys.has(key)) throw new Error('temporary function environment readback incomplete')
    },
    async createTrigger(identity) {
      await app.functions.scfService.request('CreateTrigger', {
        FunctionName: identity.functionName, Namespace: state.namespace, TriggerName: TRIGGER_NAME,
        Type: 'timer', TriggerDesc: '0 * * * * * *',
        CustomArgument: JSON.stringify({ action: 'timer', runId: identity.runId, timerToken: state.timerToken }), Enable: 'OPEN',
      })
      const listed = await app.functions.scfService.request('ListTriggers', { FunctionName: identity.functionName, Namespace: state.namespace })
      const expectedArgument = JSON.stringify({ action: 'timer', runId: identity.runId, timerToken: state.timerToken })
      const matches = (listed?.Triggers || []).filter(trigger => trigger.TriggerName === TRIGGER_NAME
        && trigger.CustomArgument === expectedArgument && trigger.Enable !== 0)
      if (matches.length !== 1) throw new Error('temporary timer trigger readback mismatch')
    },
    invoke: invokeTemporary,
    async waitIndexed(identity, probe) {
      return waitFor('exact create job', async () => {
        await invokeTemporary(identity, { action: 'timer', runId: identity.runId })
        return invokeTemporary(identity, { action: 'status', ...probe })
      }, status => status?.complete === true && status?.job?.status === 'completed')
        .then(status => ({ jobId: status.job._id, outcome: 'indexed' }))
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
      return waitFor('exact delete job', async () => invokeTemporary(identity, { action: 'timer', runId: identity.runId }),
        result => result?.completedCount === 1 && ['removed', 'superseded'].includes(result?.outcome))
        .then(result => ({ jobId: result.jobId, outcome: result.outcome }))
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
    async assertNoResidue(probe) {
      const audit = await getDocumentOrNull(db, 'post_rag_release_probes', probe.runId)
      const exact = await Promise.all([
        getDocumentOrNull(db, 'posts', probe.postId),
        getDocumentOrNull(db, 'sections', probe.sectionId),
        getDocumentOrNull(db, 'post_rag_index_state_v2', probe.postId),
        exactRows(db, 'post_rag_outbox', { aggregateId: probe.postId }),
        exactRows(db, 'post_rag_jobs', { postId: probe.postId }),
        exactRows(db, 'post_rag_index_versions', { postId: probe.postId }),
      ])
      const operationalResidueCount = exact.slice(0, 3).filter(Boolean).length + exact.slice(3).reduce((sum, rows) => sum + rows.length, 0)
      const cleanedAuditCount = audit?.status === 'cleaned' && audit?.runId === probe.runId && audit?.postId === probe.postId ? 1 : 0
      if (operationalResidueCount !== 0 || cleanedAuditCount !== 1) throw new Error('exact probe residue verification failed')
      return { operationalResidueCount, cleanedAuditCount, nonProbeCount: await observeNonProbeCount(db) }
    },
    async writeEvidence(evidence) {
      await mkdir(dirname(evidencePath), { recursive: true })
      await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
      return evidence
    },
    async deleteTrigger(identity) {
      await app.functions.scfService.request('DeleteTrigger', {
        FunctionName: identity.functionName, Namespace: state.namespace, TriggerName: TRIGGER_NAME, Type: 'timer',
      })
      await waitFor('temporary trigger deletion', async () => {
        const response = await app.functions.scfService.request('ListTriggers', { FunctionName: identity.functionName, Namespace: state.namespace })
        return !(response?.Triggers || []).some(trigger => trigger.TriggerName === TRIGGER_NAME)
      }, absent => absent === true, 60_000)
    },
    async deleteFunction(identity) {
      await app.functions.scfService.request('DeleteFunction', { FunctionName: identity.functionName, Namespace: state.namespace })
    },
    async removeArtifact() { await rm(artifactDirectory, { recursive: true, force: true }) },
    async clearSecrets() { state.validationToken = ''; state.timerToken = '' },
    async assertControlPlaneAbsent(identity) {
      await waitFor('temporary function deletion', async () => {
        const response = await app.functions.scfService.request('ListFunctions', { Namespace: state.namespace, SearchKey: identity.functionName })
        return !(response?.Functions || []).some(item => item.FunctionName === identity.functionName)
      }, absent => absent === true, 60_000)
    },
  }
}

export async function main(argv = process.argv.slice(2)) {
  const runId = readFlag(argv, 'run-id', makeRunId())
  const commandTimeoutMs = Math.max(60_000, Number(readFlag(argv, 'command-timeout-ms', '300000')) || 300_000)
  const head = readFlag(argv, 'head', await resolveHead())
  const deps = createCloudValidationDependencies({ runId, commandTimeoutMs })
  const result = await runIsolatedValidation({ head, runId }, deps)
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`[validate-post-rag-isolated] FAILED: ${redactSensitive(error?.message || String(error))}`)
    process.exit(1)
  })
}
