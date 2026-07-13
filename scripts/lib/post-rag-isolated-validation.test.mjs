import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'

import {
  assertIndependentValidationTokens,
  assertProbeOwnedId,
  createProbeFixtureIds,
  createValidationIdentity,
  runIsolatedValidation,
  sanitizeValidationEvidence,
  selectExactCandidates,
} from './post-rag-isolated-validation.mjs'
import {
  assertExactSemanticSearchResult,
  assertExactTimerReadback,
  acquireLocalValidationLock,
  assertExactTemporaryEnvironment,
  formatValidationFailure,
  normalizeValidationVpc,
  recoverExactProbe,
  resolveSharedValidationLockPath,
  runCommandWithInput,
  selectTemporaryWorkerEnvironment,
} from '../validate-post-rag-isolated.mjs'

const require = createRequire(import.meta.url)

async function loadFixtureHandler() {
  const { build } = await import('esbuild')
  const directory = await mkdtemp(join(tmpdir(), 'happyhome-rag-isolated-handler-'))
  const outfile = join(directory, 'index.cjs')
  await build({
    entryPoints: [resolve('scripts/fixtures/post-rag-isolated-worker/index.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node16',
    format: 'cjs',
  })
  return { module: require(outfile), cleanup: () => rm(directory, { recursive: true, force: true }) }
}

test('creates a deterministic bounded temporary function identity', () => {
  const left = createValidationIdentity('f16b88f', '20260713T210000')
  const right = createValidationIdentity('f16b88f', '20260713T210000')
  assert.deepEqual(left, right)
  assert.match(left.functionName, /^post-rag-validate-[a-f0-9]{8}$/)
  assert.equal(left.runId, '20260713T210000')
})

test('rejects malformed runs and non-probe or mismatched identifiers', () => {
  assert.throws(() => createValidationIdentity('f16b88f', '../outside'), /runId/)
  assert.equal(assertProbeOwnedId('rag_timer_post_abcd', 'rag_timer_post_abcd'), true)
  assert.throws(() => assertProbeOwnedId('business-post', 'rag_timer_post_abcd'), /binding/)
  assert.throws(() => assertProbeOwnedId('rag_timer_post_other', 'rag_timer_post_abcd'), /binding/)
  assert.deepEqual(createProbeFixtureIds('20260713T210000'), fixtureIds('20260713T210000'))
})

test('selects only exact bound candidates and rejects unrelated available ids', () => {
  assert.deepEqual(selectExactCandidates(['job-a'], ['job-a']), ['job-a'])
  assert.deepEqual(selectExactCandidates(['job-a'], ['job-a', 'job-b']), ['job-a'])
  assert.throws(() => selectExactCandidates(['job-a', 'job-b'], ['job-a']), /exactly one/)
})

test('requires independent constant-time validation and timer credentials', () => {
  assert.equal(assertIndependentValidationTokens('validation-token-123456', 'timer-token-654321'), true)
  assert.throws(() => assertIndependentValidationTokens('same-token-123456', 'same-token-123456'), /independent/)
  assert.throws(() => assertIndependentValidationTokens('short', 'timer-token-654321'), /token/)
})

test('accepts the production exact-post search contract without AI citations', () => {
  assert.deepEqual(assertExactSemanticSearchResult({
    items: [{ postId: 'rag_timer_post_a', matchedSnippet: 'probe text', matchedField: 'Probe' }],
    citations: [],
  }, 'rag_timer_post_a'), { exactHit: true, sourceFieldsVerified: true })
  assert.deepEqual(assertExactSemanticSearchResult({ items: [], citations: [] }, 'rag_timer_post_a'), {
    exactHit: false, sourceFieldsVerified: false,
  })
})

test('copies only the semantic RAG allowlist and independent temporary credentials', () => {
  const selected = selectTemporaryWorkerEnvironment({
    TENCENT_RAG_ES_ENDPOINT: 'https://es.example', TENCENT_RAG_ES_USERNAME: 'user', TENCENT_RAG_ES_PASSWORD: 'pass',
    TENCENT_RAG_INDEX_NAME: 'index', TENCENT_RAG_VECTOR_FIELD: 'embedding',
    TENCENT_RAG_ATOMIC_SECRET_ID: 'atomic-id', TENCENT_RAG_ATOMIC_SECRET_KEY: 'atomic-key',
    TENCENT_RAG_ATOMIC_REGION: 'ap-beijing', TENCENT_RAG_EMBEDDING_MODEL: 'model',
    POST_RAG_WORKER_TOKEN: 'production-worker-secret', UNRELATED_SECRET: 'must-not-copy',
  }, { validationToken: 'validation-token-123456', timerToken: 'timer-token-654321' })
  assert.equal(selected.RAG_VALIDATION_TOKEN, 'validation-token-123456')
  assert.equal(selected.POST_RAG_TIMER_TOKEN, 'timer-token-654321')
  assert.equal(selected.POST_RAG_WORKER_TOKEN, undefined)
  assert.equal(selected.UNRELATED_SECRET, undefined)
})

test('normalizes only an exact VPC and subnet binding', () => {
  assert.deepEqual(normalizeValidationVpc({ VpcId: 'vpc-a', SubnetId: 'subnet-a' }), { vpcId: 'vpc-a', subnetId: 'subnet-a' })
  assert.deepEqual(normalizeValidationVpc({ vpc: { vpcId: 'vpc-b' }, subnet: { subnetId: 'subnet-b' } }), { vpcId: 'vpc-b', subnetId: 'subnet-b' })
  assert.throws(() => normalizeValidationVpc({ VpcId: 'vpc-a' }), /VPC/)
})

test('requires exact environment key and value readback with no worker token or unrelated values', () => {
  const expected = { A: '1', RAG_VALIDATION_TOKEN: 'v', POST_RAG_TIMER_TOKEN: 't' }
  const variables = Object.entries(expected).map(([Key, Value]) => ({ Key, Value }))
  assert.equal(assertExactTemporaryEnvironment({ Environment: { Variables: variables } }, expected), true)
  assert.throws(() => assertExactTemporaryEnvironment({ Environment: { Variables: [...variables, { Key: 'EXTRA', Value: 'x' }] } }, expected), /environment/)
  assert.throws(() => assertExactTemporaryEnvironment({ Environment: { Variables: [{ Key: 'A', Value: 'wrong' }] } }, expected), /environment/)
  assert.throws(() => assertExactTemporaryEnvironment({ Environment: { Variables: [{ Key: 'POST_RAG_WORKER_TOKEN', Value: 'secret' }] } }, {}), /worker token/)
  assert.throws(() => assertExactTemporaryEnvironment({ Environment: { Variables: [{ Key: 'A', Value: '1' }, { Key: 'A', Value: '1' }] } }, { A: '1' }), /environment/)
})

test('requires one exact enabled timer trigger with the exact custom argument', () => {
  const expected = JSON.stringify({ runId: 'run-a', timerToken: 'secret' })
  const trigger = { TriggerName: 'post-rag-worker-every-minute', CustomArgument: expected, Enable: 'OPEN' }
  assert.equal(assertExactTimerReadback([trigger], expected), true)
  assert.throws(() => assertExactTimerReadback([{ ...trigger, Enable: 0 }], expected), /trigger/)
  assert.throws(() => assertExactTimerReadback([{ ...trigger, CustomArgument: '{}' }], expected), /trigger/)
  assert.throws(() => assertExactTimerReadback([trigger, { ...trigger, TriggerName: 'extra' }], expected), /trigger/)
})

test('noninteractive runner writes the requested blank confirmation to stdin', async () => {
  const result = await runCommandWithInput(process.execPath, ['-e', "process.stdin.once('data',d=>process.stdout.write(d))"], { input: '\n', timeoutMs: 5000 })
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '\n')
})

test('same validation identity uses one atomic local lock and removes only its own lock', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'happyhome-rag-lock-'))
  const lockPath = join(directory, 'validation.lock')
  try {
    const first = await acquireLocalValidationLock(lockPath, 'owner-a')
    await assert.rejects(acquireLocalValidationLock(lockPath, 'owner-b'), /already running/)
    await first.release()
    const second = await acquireLocalValidationLock(lockPath, 'owner-b')
    await second.release()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('separate worktree roots contend on the same git-common-dir validation lock', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'happyhome-rag-shared-lock-'))
  const commonDir = join(directory, 'repo', '.git')
  const rootA = join(directory, 'worktrees', 'a')
  const rootB = join(directory, 'worktrees', 'b')
  const identity = { environmentId: 'env-a', functionName: 'post-rag-validate-1234abcd' }
  try {
    const pathA = await resolveSharedValidationLockPath({ root: rootA, ...identity }, async () => ({ status: 0, stdout: commonDir }))
    const pathB = await resolveSharedValidationLockPath({ root: rootB, ...identity }, async () => ({ status: 0, stdout: relative(rootB, commonDir) }))
    assert.equal(pathA, pathB)
    assert.equal(pathA.startsWith(resolve(commonDir)), true)
    const first = await acquireLocalValidationLock(pathA, 'owner-a')
    await assert.rejects(acquireLocalValidationLock(pathB, 'owner-b'), /already running/)
    await first.release()
    const second = await acquireLocalValidationLock(pathB, 'owner-b')
    await second.release()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('35 minute recovery horizon does not tear down a 600 second retry_wait fixture early', async () => {
  let now = 0
  let verified = false
  const result = await recoverExactProbe({ runId: 'run-a', timeoutMs: 35 * 60_000, pollMs: 5000 }, {
    now: () => now,
    sleep: async ms => { now += ms },
    inspect: async () => now >= 605_000 ? { exists: true, status: 'cleaned' } : { exists: true, status: 'cleaning' },
    processExact: async () => ({ status: 'retry_wait' }),
    cleanup: async () => ({ pending: true }),
    verifyNoResidue: async () => { verified = true; return { operationalResidueCount: 0 } },
    inspectResidueDirect: async () => ({ operationalResidueCount: 0 }),
  })
  assert.equal(result.status, 'cleaned')
  assert.ok(now >= 605_000)
  assert.equal(verified, true)
})

test('recovery tolerates transient inspect, process, and cleanup invocation failures', async () => {
  let now = 0
  let inspectCalls = 0
  let processCalls = 0
  let cleanupCalls = 0
  const result = await recoverExactProbe({ runId: 'run-a', timeoutMs: 30_000, pollMs: 5000 }, {
    now: () => now,
    sleep: async ms => { now += ms },
    inspect: async () => {
      inspectCalls += 1
      if (inspectCalls === 1) throw new Error('inspect leaked-secret-value')
      return inspectCalls >= 4 ? { exists: true, status: 'cleaned' } : { exists: true, status: 'cleaning' }
    },
    processExact: async () => {
      processCalls += 1
      if (processCalls === 1) throw new Error('process leaked-secret-value')
      return { status: 'retry_wait' }
    },
    cleanup: async () => {
      cleanupCalls += 1
      if (cleanupCalls === 1) throw new Error('cleanup leaked-secret-value')
      return { pending: true }
    },
    verifyNoResidue: async () => ({ operationalResidueCount: 0 }),
    inspectResidueDirect: async () => ({ operationalResidueCount: 0 }),
  })
  assert.equal(result.status, 'cleaned')
  assert.match(result.lastErrorFingerprint, /^[a-f0-9]{16}$/)
  assert.ok(inspectCalls >= 4)
  assert.ok(processCalls >= 2)
  assert.ok(cleanupCalls >= 2)
})

test('persistent temporary invoke failure reaches direct residue inspection with sanitized evidence', async () => {
  let now = 0
  let directInspections = 0
  await assert.rejects(
    recoverExactProbe({ runId: 'run-a', timeoutMs: 10_000, pollMs: 5000 }, {
      now: () => now,
      sleep: async ms => { now += ms },
      inspect: async () => { throw new Error('temporary invoke failed token=secret-value') },
      processExact: async () => ({ status: 'retry_wait' }),
      cleanup: async () => ({ pending: true }),
      verifyNoResidue: async () => ({ operationalResidueCount: 0 }),
      inspectResidueDirect: async runId => {
        directInspections += 1
        assert.equal(runId, 'run-a')
        return { unresolvedResidueCount: 3 }
      },
    }),
    error => {
      assert.doesNotMatch(error.message, /secret-value|token=/)
      assert.match(error.message, /"unresolvedResidueCount":3/)
      assert.match(error.message, /"lastErrorFingerprint":"[a-f0-9]{16}"/)
      return true
    },
  )
  assert.ok(directInspections >= 2)
})

test('inspect failure accepts only exact zero residue with one cleaned audit', async () => {
  let now = 0
  const result = await recoverExactProbe({ runId: 'run-a', timeoutMs: 10_000, pollMs: 5000 }, {
    now: () => now,
    sleep: async ms => { now += ms },
    inspect: async () => { throw new Error('temporary invoke failed token=secret-value') },
    processExact: async () => { throw new Error('must not process after direct cleanup proof') },
    cleanup: async () => { throw new Error('must not cleanup after direct cleanup proof') },
    verifyNoResidue: async () => { throw new Error('inspect path is unavailable') },
    inspectResidueDirect: async () => ({
      operationalResidueCount: 0, cleanedAuditCount: 1, unresolvedResidueCount: 0,
    }),
  })
  assert.equal(result.status, 'cleaned')
  assert.equal(result.source, 'direct_exact_residue')
  assert.match(result.lastErrorFingerprint, /^[a-f0-9]{16}$/)
  assert.equal(now, 0)
})

test('inspect failure never treats an absent cleanup audit as cleaned', async () => {
  let now = 0
  await assert.rejects(recoverExactProbe({ runId: 'run-a', timeoutMs: 10_000, pollMs: 5000 }, {
    now: () => now,
    sleep: async ms => { now += ms },
    inspect: async () => { throw new Error('temporary invoke unavailable') },
    processExact: async () => ({ status: 'retry_wait' }),
    cleanup: async () => ({ pending: true }),
    verifyNoResidue: async () => ({ operationalResidueCount: 0 }),
    inspectResidueDirect: async () => ({
      operationalResidueCount: 0, cleanedAuditCount: 0, unresolvedResidueCount: 0,
    }),
  }), /recovery timed out/)
  assert.equal(now, 10_000)
})

test('exposes the isolated validator package command', async () => {
  const pkg = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
  assert.equal(pkg.scripts['validate:rag:isolated'], 'node scripts/validate-post-rag-isolated.mjs')
  const source = await readFile(resolve('scripts/validate-post-rag-isolated.mjs'), 'utf8')
  assert.match(source, /const WAIT_MS = 10 \* 60_000/)
})

function scenario(overrides = {}) {
  const calls = []
  const ids = fixtureIds('20260713T210000')
  const probe = {
    runId: '20260713T210000', communityId: 'community-a',
    ...ids, outboxId: 'outbox-a',
  }
  const deps = {
    async baseline(identity) { calls.push(['baseline', identity.functionName]); return { functionAbsent: true, nonProbeCount: 7 } },
    async build(identity) { calls.push(['build', identity.functionName]); return { directory: 'artifact' } },
    async deploy() { calls.push(['deploy']) },
    async copyRuntimeConfig() { calls.push(['copyRuntimeConfig']) },
    async assertEsReady() { calls.push(['assertEsReady']); return { statusClass: '2xx' } },
    async createTrigger() { calls.push(['createTrigger']) },
    async invoke(_identity, event) { calls.push(['invoke', event.action]); return probe },
    async waitIndexed() { calls.push(['waitIndexed']); return { jobId: 'job-create', outcome: 'indexed' } },
    async assertSemanticHit() { calls.push(['assertSemanticHit']); return { exactHit: true, sourceFieldsVerified: true } },
    async waitRemoved() { calls.push(['waitRemoved']); return { jobId: 'job-delete', outcome: 'removed' } },
    async assertSemanticAbsent() { calls.push(['assertSemanticAbsent']); return { exactAbsent: true } },
    async waitCleaned() { calls.push(['waitCleaned']); return { status: 'cleaned' } },
    async assertNoResidue() { calls.push(['assertNoResidue']); return { operationalResidueCount: 0, cleanedAuditCount: 1, nonProbeCount: 7 } },
    async recoverProbe() { calls.push(['recoverProbe']); return { status: 'cleaned' } },
    async writeEvidence(value) { calls.push(['writeEvidence']); return value },
    async deleteTrigger() { calls.push(['deleteTrigger']) },
    async deleteFunction() { calls.push(['deleteFunction']) },
    async removeArtifact() { calls.push(['removeArtifact']) },
    async clearSecrets() { calls.push(['clearSecrets']) },
    async assertControlPlaneAbsent() { calls.push(['assertControlPlaneAbsent']) },
    ...overrides,
  }
  return { calls, deps, probe }
}

function fixtureIds(runId) {
  const suffix = createHash('sha256').update(runId).digest('hex').slice(0, 24)
  return { sectionId: `rag_timer_section_${suffix}`, postId: `rag_timer_post_${suffix}` }
}

test('runs exact semantic create/delete validation and proves final cleanup', async () => {
  const { calls, deps, probe } = scenario()
  const result = await runIsolatedValidation({ head: 'f16b88f', runId: probe.runId, communityId: 'community-a' }, deps)
  assert.equal(result.status, 'passed')
  assert.deepEqual(calls.map(([name]) => name), [
    'baseline', 'build', 'deploy', 'copyRuntimeConfig', 'assertEsReady', 'createTrigger',
    'invoke', 'waitIndexed', 'assertSemanticHit', 'invoke', 'waitRemoved',
    'assertSemanticAbsent', 'waitCleaned', 'assertNoResidue', 'recoverProbe',
    'deleteTrigger', 'deleteFunction', 'removeArtifact', 'clearSecrets', 'assertControlPlaneAbsent', 'writeEvidence',
  ])
})

test('always deletes the trigger, function, artifacts and temporary secrets after semantic failure', async () => {
  const { calls, deps, probe } = scenario({
    async assertSemanticHit() { throw new Error('semantic assertion failed') },
  })
  await assert.rejects(
    runIsolatedValidation({ head: 'f16b88f', runId: probe.runId, communityId: 'community-a' }, deps),
    /semantic assertion failed/,
  )
  assert.deepEqual(calls.slice(-6).map(([name]) => name), [
    'recoverProbe', 'deleteTrigger', 'deleteFunction', 'removeArtifact', 'clearSecrets', 'assertControlPlaneAbsent',
  ])
})

test('ambiguous deploy failure attempts exact function cleanup and still proves absence', async () => {
  const { calls, deps, probe } = scenario({
    async deploy() { throw new Error('deploy failed') },
  })
  await assert.rejects(runIsolatedValidation({ head: 'f16b88f', runId: probe.runId, communityId: 'community-a' }, deps), /deploy failed/)
  assert.equal(calls.some(([name]) => name === 'deleteTrigger'), false)
  assert.equal(calls.some(([name]) => name === 'deleteFunction'), true)
  assert.deepEqual(calls.slice(-4).map(([name]) => name), ['deleteFunction', 'removeArtifact', 'clearSecrets', 'assertControlPlaneAbsent'])
})

test('ambiguous trigger creation failure attempts exact trigger cleanup', async () => {
  const { calls, deps, probe } = scenario({
    async createTrigger() { calls.push(['createTrigger']); throw new Error('trigger readback failed') },
  })
  await assert.rejects(runIsolatedValidation({ head: 'f16b88f', runId: probe.runId, communityId: 'community-a' }, deps), /trigger readback failed/)
  assert.equal(calls.some(([name]) => name === 'deleteTrigger'), true)
})

test('pre-existing deterministic function stops before mutation and is never deleted', async () => {
  const { calls, deps, probe } = scenario({
    async baseline() { calls.push(['baseline']); throw new Error('temporary function already exists') },
  })
  await assert.rejects(runIsolatedValidation({ head: 'f16b88f', runId: probe.runId, communityId: 'community-a' }, deps), /already exists/)
  assert.equal(calls.some(([name]) => ['build', 'deploy', 'deleteFunction'].includes(name)), false)
  assert.equal(calls.some(([name]) => name === 'assertControlPlaneAbsent'), false)
})

test('a lost create response still recovers the exact run before infrastructure teardown', async () => {
  const { calls, deps, probe } = scenario({
    async invoke() { calls.push(['invoke']); throw new Error('create response lost') },
  })
  await assert.rejects(runIsolatedValidation({ head: 'f16b88f', runId: probe.runId, communityId: 'community-a' }, deps), /create response lost/)
  assert.ok(calls.findIndex(([name]) => name === 'recoverProbe') < calls.findIndex(([name]) => name === 'deleteTrigger'))
})

test('a wait failure still recovers the exact run before infrastructure teardown', async () => {
  const { calls, deps, probe } = scenario({
    async waitIndexed() { calls.push(['waitIndexed']); throw new Error('timer wait failed') },
  })
  await assert.rejects(runIsolatedValidation({ head: 'f16b88f', runId: probe.runId, communityId: 'community-a' }, deps), /timer wait failed/)
  assert.ok(calls.findIndex(([name]) => name === 'recoverProbe') < calls.findIndex(([name]) => name === 'deleteTrigger'))
})

test('recovery errors are fingerprinted without leaking alphanumeric secret text', async () => {
  const { deps, probe } = scenario({
    async waitIndexed() { throw new Error('timer wait failed') },
    async recoverProbe() { throw new Error('ALPHANUMERICSECRET') },
  })
  await assert.rejects(runIsolatedValidation({ head: 'f16b88f', runId: probe.runId, communityId: 'community-a' }, deps), error => {
    assert.ok(error instanceof AggregateError)
    const text = error.errors.map(item => String(item?.message || item)).join('\n')
    assert.match(text, /timer wait failed/)
    assert.match(text, /fingerprint=/)
    assert.doesNotMatch(text, /ALPHANUMERICSECRET/)
    return true
  })
})

test('records non-probe count drift as observation without treating shared traffic as a failure', async () => {
  const { deps, probe } = scenario({
    async assertNoResidue() { return { operationalResidueCount: 0, cleanedAuditCount: 1, nonProbeCount: 9 } },
  })
  const result = await runIsolatedValidation({ head: 'f16b88f', runId: probe.runId, communityId: 'community-a' }, deps)
  assert.equal(result.status, 'passed')
  assert.equal(result.nonProbeBaselineCount, 7)
  assert.equal(result.nonProbeFinalCount, 9)
})

test('preserves the primary failure and sanitized cleanup diagnostics', async () => {
  const { deps, probe } = scenario({
    async assertSemanticHit() { throw new Error('primary semantic failure') },
    async deleteTrigger() { throw new Error('https://secret:9200 token=abc') },
  })
  await assert.rejects(
    runIsolatedValidation({ head: 'f16b88f', runId: probe.runId, communityId: 'community-a' }, deps),
    (error) => {
      assert.ok(error instanceof AggregateError)
      assert.match(String(error.errors[0]?.message), /primary semantic failure/)
      const cleanupMessages = error.errors.slice(1).map(item => String(item?.message || item)).join('\n')
      assert.doesNotMatch(cleanupMessages, /secret|token=abc|9200/i)
      assert.match(cleanupMessages, /fingerprint/)
      assert.match(cleanupMessages, /stage=delete-trigger/)
      return true
    },
  )
})

test('CLI failure summary exposes safe cleanup stages without provider details', () => {
  const error = new AggregateError([
    new Error('primary https://secret:9200 token=abc'),
    new Error('cleanup failed stage=delete-trigger fingerprint=0123456789abcdef'),
  ], 'isolated RAG validation cleanup failed')
  const summary = formatValidationFailure(error)
  assert.match(summary, /isolated RAG validation cleanup failed/)
  assert.match(summary, /stage=delete-trigger fingerprint=0123456789abcdef/)
  assert.doesNotMatch(summary, /secret|token=abc|9200/i)
})

test('sanitizes evidence to the fixed release-grade schema without secrets or provider details', () => {
  const evidence = sanitizeValidationEvidence({
    identity: { functionName: 'post-rag-validate-aabbccdd', runId: '20260713T210000' },
    probe: { postId: 'rag_timer_post_a', communityId: 'community-a', token: 'secret-token' },
    indexed: { jobId: 'job-create', outcome: 'indexed', embedding: [1, 2] },
    semanticHit: { exactHit: true, sourceFieldsVerified: true, endpoint: 'http://secret:9200' },
    removed: { jobId: 'job-delete', outcome: 'removed' },
    semanticAbsent: { exactAbsent: true },
    cleaned: { status: 'cleaned' },
    residue: { operationalResidueCount: 0, cleanedAuditCount: 1, nonProbeCount: 7 },
  })
  assert.deepEqual(evidence, {
    schemaVersion: 1,
    status: 'passed',
    functionName: 'post-rag-validate-aabbccdd',
    runId: '20260713T210000',
    postId: 'rag_timer_post_a',
    communityId: 'community-a',
    createJobId: 'job-create',
    createOutcome: 'indexed',
    semanticExactHit: true,
    sourceFieldsVerified: true,
    deleteJobId: 'job-delete',
    deleteOutcome: 'removed',
    semanticExactAbsent: true,
    cleanupStatus: 'cleaned',
    operationalResidueCount: 0,
    cleanedAuditCount: 1,
    nonProbeBaselineCount: 7,
    nonProbeFinalCount: 7,
  })
  const serialized = JSON.stringify(evidence)
  assert.doesNotMatch(serialized, /secret|token|embedding|endpoint|9200/i)
})

const TIMER_NOW = '2026-07-13T13:00:30.000Z'
function timerEvent(runId, overrides = {}) {
  return {
    Type: 'Timer', TriggerName: 'post-rag-worker-every-minute', Time: '2026-07-13T13:00:00.000Z',
    Message: JSON.stringify({ runId, timerToken: 'timer-token-654321' }), ...overrides,
  }
}

test('temporary handler authenticates independently and processes only the bound outbox and job', async () => {
  const loaded = await loadFixtureHandler()
  try {
    const calls = []
    const ids = fixtureIds('20260713T210000')
    const probe = {
      _id: '20260713T210000', runId: '20260713T210000', status: 'active',
      communityId: 'community-a', sectionId: 'rag_timer_section_a', postId: 'rag_timer_post_a',
      outboxId: 'outbox-a', cleanupOutboxId: null,
    }
    Object.assign(probe, ids)
    let jobReads = 0
    const handler = loaded.module.createExactIdValidationHandler({
      async create(runId) { calls.push(['create', runId]); return probe },
      async status(input) { calls.push(['status', input.outboxId]); return { complete: false } },
      async cleanup(input) { calls.push(['cleanup', input.postId]); return { pending: true, status: 'cleaning' } },
      async readProbe(runId) { calls.push(['readProbe', runId]); return probe },
      async readOutbox(id) { calls.push(['readOutbox', id]); return { _id: id, aggregateId: probe.postId, communityId: probe.communityId, status: 'pending' } },
      async materializeExact(id) { calls.push(['materializeExact', id]); return { jobId: 'job-a', materializedByThisInvocation: true } },
      async readJob(id) {
        calls.push(['readJob', id]); jobReads += 1
        return { _id: id, postId: probe.postId, communityId: probe.communityId,
          ...(jobReads > 1 ? { status: 'completed', outcome: 'indexed' } : {}) }
      },
      async processExactJob(id) { calls.push(['processExactJob', id]); return { candidateCount: 1, results: [{ jobId: id, status: 'completed', outcome: 'indexed' }] } },
      async recordTimerEvidence(_runId, _field, evidence) { calls.push(['recordTimerEvidence', evidence]); },
    }, {
      validationToken: 'validation-token-123456',
      timerToken: 'timer-token-654321',
      now: () => TIMER_NOW,
    })

    await assert.rejects(handler({ action: 'create', runId: probe.runId, validationToken: 'wrong-token-123456' }), /unauthorized/)
    await assert.rejects(handler({ action: 'timer', runId: probe.runId, timerToken: 'timer-token-654321' }), /unauthorized|action/)
    const result = await handler(timerEvent(probe.runId))
    assert.deepEqual(result, {
      runId: probe.runId,
      postId: probe.postId,
      outboxId: probe.outboxId,
      jobId: 'job-a',
      candidateCount: 1,
      completedCount: 1,
      outcome: 'indexed',
    })
    assert.equal(calls.some(call => call.includes('job-b')), false)
    const evidence = calls.find(([name]) => name === 'recordTimerEvidence')?.[1]
    assert.deepEqual(evidence, {
      triggerName: 'post-rag-worker-every-minute', eventTime: '2026-07-13T13:00:00.000Z', invokedAt: TIMER_NOW,
      outboxId: 'outbox-a', jobId: 'job-a', outcome: 'indexed', phase: 'create',
      outboxMaterializedByTimer: true, jobCompletedByTimer: true,
    })
    assert.doesNotMatch(JSON.stringify(evidence), /token/i)
  } finally {
    await loaded.cleanup()
  }
})

test('temporary timer evidence records only allowlisted processor failure diagnostics', async () => {
  const loaded = await loadFixtureHandler()
  try {
    const runId = '20260713T210000'
    const ids = fixtureIds(runId)
    const probe = { _id: runId, runId, status: 'active', communityId: 'community-a', ...ids, outboxId: 'outbox-create' }
    let reads = 0
    let recorded
    const handler = loaded.module.createExactIdValidationHandler({
      async readProbe() { return probe },
      async readOutbox(id) { return { _id: id, aggregateId: probe.postId, communityId: probe.communityId } },
      async materializeExact() { return { jobId: 'job-create', materializedByThisInvocation: true } },
      async readJob(id) { reads += 1; return { _id: id, postId: probe.postId, communityId: probe.communityId, status: 'processing' } },
      async processExactJob(id) {
        return { candidateCount: 1, results: [{ jobId: id, status: 'failed', errorCode: 'INTERNAL_ERROR', errorStage: 'claim', raw: 'secret' }] }
      },
      async recordTimerEvidence(_runId, _field, evidence) { recorded = evidence },
    }, { validationToken: 'validation-token-123456', timerToken: 'timer-token-654321', now: () => TIMER_NOW })
    const result = await handler(timerEvent(runId))
    assert.equal(reads, 2)
    assert.equal(result.errorCode, 'INTERNAL_ERROR')
    assert.equal(result.errorStage, 'claim')
    assert.equal(recorded.errorCode, 'INTERNAL_ERROR')
    assert.equal(recorded.errorStage, 'claim')
    assert.doesNotMatch(JSON.stringify({ result, recorded }), /secret|raw/i)
  } finally { await loaded.cleanup() }
})

test('temporary handler rejects an exact outbox or job that escapes the probe binding', async () => {
  const loaded = await loadFixtureHandler()
  try {
    const ids = fixtureIds('20260713T210000')
    const probe = {
      _id: '20260713T210000', runId: '20260713T210000', status: 'active', communityId: 'community-a',
      sectionId: 'rag_timer_section_a', postId: 'rag_timer_post_a', outboxId: 'outbox-a',
    }
    Object.assign(probe, ids)
    const handler = loaded.module.createExactIdValidationHandler({
      async readProbe() { return probe },
      async readOutbox(id) { return { _id: id, aggregateId: 'business-post', communityId: probe.communityId } },
      async materializeExact() { throw new Error('must not materialize') },
    }, { validationToken: 'validation-token-123456', timerToken: 'timer-token-654321', now: () => TIMER_NOW })
    await assert.rejects(handler(timerEvent(probe.runId)), /binding/)
  } finally {
    await loaded.cleanup()
  }
})

test('temporary handler reports the exact already-completed delete job without scanning or reclaiming', async () => {
  const loaded = await loadFixtureHandler()
  try {
    const runId = '20260713T210000'
    const ids = fixtureIds(runId)
    const probe = { _id: runId, runId, status: 'cleaning', communityId: 'community-a', ...ids, outboxId: 'outbox-create', cleanupOutboxId: 'outbox-delete' }
    let processed = false
    let recorded
    const handler = loaded.module.createExactIdValidationHandler({
      async readProbe() { return probe },
      async readOutbox(id) { return { _id: id, aggregateId: probe.postId, communityId: probe.communityId } },
      async materializeExact() { return { jobId: 'job-delete', materializedByThisInvocation: false } },
      async readJob(id) { return { _id: id, postId: probe.postId, communityId: probe.communityId, status: 'completed', outcome: 'removed' } },
      async processExactJob() { processed = true; throw new Error('must not process completed job') },
      async recordTimerEvidence(_runId, _field, evidence) { recorded = evidence },
    }, { validationToken: 'validation-token-123456', timerToken: 'timer-token-654321', now: () => TIMER_NOW })
    const result = await handler(timerEvent(runId))
    assert.equal(processed, false)
    assert.deepEqual(result, {
      runId, postId: probe.postId, outboxId: probe.cleanupOutboxId, jobId: 'job-delete',
      candidateCount: 1, completedCount: 1, outcome: 'removed',
    })
    assert.equal(recorded.outboxMaterializedByTimer, false)
    assert.equal(recorded.jobCompletedByTimer, false)
  } finally {
    await loaded.cleanup()
  }
})

test('timer evidence cumulatively proves materialization then completion across two authentic timers', async () => {
  const loaded = await loadFixtureHandler()
  try {
    const runId = '20260713T210000'
    const ids = fixtureIds(runId)
    const probe = { _id: runId, runId, status: 'active', communityId: 'community-a', ...ids, outboxId: 'outbox-create' }
    let materializeCalls = 0
    let processCalls = 0
    let readCalls = 0
    const handler = loaded.module.createExactIdValidationHandler({
      async readProbe() { return probe },
      async readOutbox(id) { return { _id: id, aggregateId: probe.postId, communityId: probe.communityId } },
      async materializeExact() { materializeCalls += 1; return { jobId: 'job-create', materializedByThisInvocation: materializeCalls === 1 } },
      async readJob(id) {
        readCalls += 1
        const completed = readCalls >= 4
        return { _id: id, postId: probe.postId, communityId: probe.communityId, status: completed ? 'completed' : 'pending', outcome: completed ? 'indexed' : null }
      },
      async processExactJob(id) {
        processCalls += 1
        return { candidateCount: 1, results: [{ jobId: id, status: processCalls === 1 ? 'skipped' : 'completed', outcome: processCalls === 1 ? undefined : 'indexed' }] }
      },
      async recordTimerEvidence(_runId, field, evidence) { probe[field] = evidence },
    }, { validationToken: 'validation-token-123456', timerToken: 'timer-token-654321', now: () => TIMER_NOW })
    await handler(timerEvent(runId))
    assert.equal(probe.timerEvidenceCreate.outboxMaterializedByTimer, true)
    assert.equal(probe.timerEvidenceCreate.jobCompletedByTimer, false)
    await handler(timerEvent(runId))
    assert.equal(probe.timerEvidenceCreate.outboxMaterializedByTimer, true)
    assert.equal(probe.timerEvidenceCreate.jobCompletedByTimer, true)
  } finally { await loaded.cleanup() }
})

test('temporary handler rejects forged, stale, malformed, or overbroad timer shapes', async () => {
  const loaded = await loadFixtureHandler()
  try {
    const handler = loaded.module.createExactIdValidationHandler({}, {
      validationToken: 'validation-token-123456', timerToken: 'timer-token-654321', now: () => TIMER_NOW,
    })
    const runId = '20260713T210000'
    await assert.rejects(handler({ action: 'timer', runId, timerToken: 'timer-token-654321' }), /unauthorized|action/)
    await assert.rejects(handler(timerEvent(runId, { Time: '2026-07-13T12:50:00.000Z' })), /unauthorized/)
    await assert.rejects(handler(timerEvent(runId, { Message: JSON.stringify({ runId, timerToken: 'timer-token-654321', workerToken: 'x' }) })), /unauthorized/)
    await assert.rejects(handler(timerEvent(runId, { Message: JSON.stringify({ runId, timerToken: 'timer-token-654321', extra: true }) })), /unauthorized/)
    await assert.rejects(handler(timerEvent(runId, { TriggerName: 'other-trigger' })), /unauthorized/)
    await assert.rejects(handler({ ...timerEvent(runId), workerToken: 'worker-secret' }), /unauthorized/)
  } finally {
    await loaded.cleanup()
  }
})
