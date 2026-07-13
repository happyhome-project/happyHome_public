import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'

import {
  assertIndependentValidationTokens,
  assertProbeOwnedId,
  createValidationIdentity,
  runIsolatedValidation,
  sanitizeValidationEvidence,
  selectExactCandidates,
} from './post-rag-isolated-validation.mjs'
import {
  assertExactSemanticSearchResult,
  normalizeValidationVpc,
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
  assert.throws(() => normalizeValidationVpc({ VpcId: 'vpc-a' }), /VPC/)
})

test('exposes the isolated validator package command', async () => {
  const pkg = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
  assert.equal(pkg.scripts['validate:rag:isolated'], 'node scripts/validate-post-rag-isolated.mjs')
})

function scenario(overrides = {}) {
  const calls = []
  const probe = {
    runId: '20260713T210000', communityId: 'community-a',
    sectionId: 'rag_timer_section_a', postId: 'rag_timer_post_a', outboxId: 'outbox-a',
  }
  const deps = {
    async baseline(identity) { calls.push(['baseline', identity.functionName]); return { nonProbeCount: 7 } },
    async build(identity) { calls.push(['build', identity.functionName]); return { directory: 'artifact' } },
    async deploy() { calls.push(['deploy']) },
    async copyRuntimeConfig() { calls.push(['copyRuntimeConfig']) },
    async createTrigger() { calls.push(['createTrigger']) },
    async invoke(_identity, event) { calls.push(['invoke', event.action]); return probe },
    async waitIndexed() { calls.push(['waitIndexed']); return { jobId: 'job-create', outcome: 'indexed' } },
    async assertSemanticHit() { calls.push(['assertSemanticHit']); return { exactHit: true, sourceFieldsVerified: true } },
    async waitRemoved() { calls.push(['waitRemoved']); return { jobId: 'job-delete', outcome: 'removed' } },
    async assertSemanticAbsent() { calls.push(['assertSemanticAbsent']); return { exactAbsent: true } },
    async waitCleaned() { calls.push(['waitCleaned']); return { status: 'cleaned' } },
    async assertNoResidue() { calls.push(['assertNoResidue']); return { operationalResidueCount: 0, cleanedAuditCount: 1, nonProbeCount: 7 } },
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
  const result = await runIsolatedValidation({ head: 'f16b88f', runId: probe.runId }, deps)
  assert.equal(result.status, 'passed')
  assert.deepEqual(calls.map(([name]) => name), [
    'baseline', 'build', 'deploy', 'copyRuntimeConfig', 'createTrigger',
    'invoke', 'waitIndexed', 'assertSemanticHit', 'invoke', 'waitRemoved',
    'assertSemanticAbsent', 'waitCleaned', 'assertNoResidue',
    'deleteTrigger', 'deleteFunction', 'removeArtifact', 'clearSecrets', 'assertControlPlaneAbsent', 'writeEvidence',
  ])
})

test('always deletes the trigger, function, artifacts and temporary secrets after semantic failure', async () => {
  const { calls, deps, probe } = scenario({
    async assertSemanticHit() { throw new Error('semantic assertion failed') },
  })
  await assert.rejects(
    runIsolatedValidation({ head: 'f16b88f', runId: probe.runId }, deps),
    /semantic assertion failed/,
  )
  assert.deepEqual(calls.slice(-5).map(([name]) => name), [
    'deleteTrigger', 'deleteFunction', 'removeArtifact', 'clearSecrets', 'assertControlPlaneAbsent',
  ])
})

test('does not delete resources that were never created and still proves absence', async () => {
  const { calls, deps, probe } = scenario({
    async deploy() { throw new Error('deploy failed') },
  })
  await assert.rejects(runIsolatedValidation({ head: 'f16b88f', runId: probe.runId }, deps), /deploy failed/)
  assert.equal(calls.some(([name]) => name === 'deleteTrigger'), false)
  assert.equal(calls.some(([name]) => name === 'deleteFunction'), false)
  assert.deepEqual(calls.slice(-3).map(([name]) => name), ['removeArtifact', 'clearSecrets', 'assertControlPlaneAbsent'])
})

test('records non-probe count drift as observation without treating shared traffic as a failure', async () => {
  const { deps, probe } = scenario({
    async assertNoResidue() { return { operationalResidueCount: 0, cleanedAuditCount: 1, nonProbeCount: 9 } },
  })
  const result = await runIsolatedValidation({ head: 'f16b88f', runId: probe.runId }, deps)
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
    runIsolatedValidation({ head: 'f16b88f', runId: probe.runId }, deps),
    (error) => {
      assert.ok(error instanceof AggregateError)
      assert.match(String(error.errors[0]?.message), /primary semantic failure/)
      const cleanupMessages = error.errors.slice(1).map(item => String(item?.message || item)).join('\n')
      assert.doesNotMatch(cleanupMessages, /secret|token=abc|9200/i)
      assert.match(cleanupMessages, /fingerprint/)
      return true
    },
  )
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
    const handler = loaded.module.createExactIdValidationHandler({
      async create(runId) { calls.push(['create', runId]); return probe },
      async status(input) { calls.push(['status', input.outboxId]); return { complete: false } },
      async cleanup(input) { calls.push(['cleanup', input.postId]); return { pending: true, status: 'cleaning' } },
      async readProbe(runId) { calls.push(['readProbe', runId]); return probe },
      async readOutbox(id) { calls.push(['readOutbox', id]); return { _id: id, aggregateId: probe.postId, communityId: probe.communityId, status: 'pending' } },
      async materializeExact(id) { calls.push(['materializeExact', id]); return { jobId: 'job-a' } },
      async readJob(id) { calls.push(['readJob', id]); return { _id: id, postId: probe.postId, communityId: probe.communityId } },
      async processExactJob(id) { calls.push(['processExactJob', id]); return { candidateCount: 1, results: [{ jobId: id, status: 'completed', outcome: 'indexed' }] } },
    }, {
      validationToken: 'validation-token-123456',
      timerToken: 'timer-token-654321',
    })

    await assert.rejects(handler({ action: 'create', runId: probe.runId, validationToken: 'wrong-token-123456' }), /unauthorized/)
    const result = await handler({ action: 'timer', runId: probe.runId, timerToken: 'timer-token-654321' })
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
  } finally {
    await loaded.cleanup()
  }
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
    }, { validationToken: 'validation-token-123456', timerToken: 'timer-token-654321' })
    await assert.rejects(handler({ action: 'timer', runId: probe.runId, timerToken: 'timer-token-654321' }), /binding/)
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
    const handler = loaded.module.createExactIdValidationHandler({
      async readProbe() { return probe },
      async readOutbox(id) { return { _id: id, aggregateId: probe.postId, communityId: probe.communityId } },
      async materializeExact() { return { jobId: 'job-delete' } },
      async readJob(id) { return { _id: id, postId: probe.postId, communityId: probe.communityId, status: 'completed', outcome: 'removed' } },
      async processExactJob() { processed = true; throw new Error('must not process completed job') },
    }, { validationToken: 'validation-token-123456', timerToken: 'timer-token-654321' })
    const result = await handler({ action: 'timer', runId, timerToken: 'timer-token-654321' })
    assert.equal(processed, false)
    assert.deepEqual(result, {
      runId, postId: probe.postId, outboxId: probe.cleanupOutboxId, jobId: 'job-delete',
      candidateCount: 1, completedCount: 1, outcome: 'removed',
    })
  } finally {
    await loaded.cleanup()
  }
})
