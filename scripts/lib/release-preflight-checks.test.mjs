import assert from 'node:assert/strict'
import test from 'node:test'
import {
  verifyPreflightCollections, verifyPreflightIndex, verifyPreflightTimers,
  verifyPreflightGitAndPlan, evaluatePreflightTimerEvidence, evaluateProbeEvidence, resolvePreflightIndexOptions,
} from './release-preflight-checks.mjs'
import { buildPostSemanticIndexDefinition } from './tencent-rag-index-schema.mjs'

test('collections preserve missing versus indeterminate release-control-plane semantics', async () => {
  const results = new Map([
    ['release_locks', { Exists: true }], ['release_runs', { Exists: false, Msg: 'release_runs TableNotExist' }],
    ['release_state', { Exists: false, Msg: 'permission denied' }],
  ])
  await assert.rejects(() => verifyPreflightCollections({ checkCollectionExists: name => results.get(name) }, []), /missing.*release_runs/i)
  results.set('release_runs', { Exists: true })
  await assert.rejects(() => verifyPreflightCollections({ checkCollectionExists: name => results.get(name) }, []), /indeterminate.*permission denied/i)
})

test('index validation uses the complete v2 mapping compatibility truth', async () => {
  const definition = buildPostSemanticIndexDefinition({ vectorField: 'embedding', dims: 768 })
  await verifyPreflightIndex({ readMappings: async () => definition.mappings, dims: 768 })
  const bad = structuredClone(definition.mappings); bad.properties.updatedAt.type = 'keyword'
  await assert.rejects(() => verifyPreflightIndex({ readMappings: async () => bad, dims: 768 }), /updatedAt.*incompatible/i)
})

test('timer validation requires unique enabled exact desired triggers and rejects stale owned video triggers', async () => {
  const configs = [{ name: 'post-rag-worker', triggers: [{ name: 'post-rag-worker-every-minute', config: 'cron', customArgument: 'arg' }] },
    { name: 'post-video-rag-worker', triggers: [{ name: 'post-video-rag-worker-every-10-min', config: 'video' }] }]
  const triggers = {
    'post-rag-worker': [{ TriggerName: 'post-rag-worker-every-minute', TriggerDesc: 'cron', CustomArgument: 'arg', Enable: 'OPEN' }],
    'post-video-rag-worker': [{ TriggerName: 'post-video-rag-worker-every-10-min', TriggerDesc: 'video', Enable: 'OPEN' }],
  }
  await verifyPreflightTimers({ listTriggers: async name => triggers[name], configs })
  triggers['post-rag-worker'][0].Enable = 'CLOSE'
  await assert.rejects(() => verifyPreflightTimers({ listTriggers: async name => triggers[name], configs }), /timer.*mismatch/i)
  triggers['post-rag-worker'][0].Enable = 'OPEN'
  triggers['post-video-rag-worker'].push({ ...triggers['post-video-rag-worker'][0] })
  await assert.rejects(() => verifyPreflightTimers({ listTriggers: async name => triggers[name], configs }), /timer.*mismatch/i)
})

test('git and full-current plan validation binds canonical current state and explicit resume mode', async () => {
  const actualHead = 'a'.repeat(40)
  const canonical = { cwd: 'C:\\Project\\Claude\\happyHome_public', originUrl: 'https://github.com/happyhome-project/happyHome_public.git', branch: 'main', headSha: actualHead, originMainSha: actualHead, changedPaths: [] }
  const plan = verifyPreflightGitAndPlan({ gitState: canonical, expectedHeadSha: actualHead, resumeRequested: false })
  assert.equal(plan.plan.mode, 'full-current')
  assert.throws(() => verifyPreflightGitAndPlan({ gitState: { ...canonical, cwd: 'C:\\feature' }, expectedHeadSha: actualHead, resumeRequested: false }), /canonical main workspace/i)
  assert.throws(() => verifyPreflightGitAndPlan({ gitState: canonical, expectedHeadSha: '', resumeRequested: false }), /expected.*40/i)
  assert.throws(() => verifyPreflightGitAndPlan({ gitState: canonical, expectedHeadSha: 'b'.repeat(40), resumeRequested: false }), /expected HEAD.*workspace HEAD/i)
  assert.throws(() => verifyPreflightGitAndPlan({ gitState: canonical, expectedHeadSha: actualHead, resumeRequested: true }), /resume state is required/i)
  assert.throws(() => verifyPreflightGitAndPlan({ gitState: canonical, expectedHeadSha: actualHead, resumeRequested: true, resumeRunState: { context: { gitSha: 'deadbee', releaseStrategy: 'full-current' } } }), /resume context mismatch/i)
})

test('git preflight binds matching main resume and rejects main/full-current strategy mismatches', () => {
  const actualHead = 'a'.repeat(40)
  const canonical = { cwd: 'C:\\Project\\Claude\\happyHome_public', originUrl: 'https://github.com/happyhome-project/happyHome_public.git', branch: 'main', headSha: actualHead, originMainSha: actualHead, changedPaths: [] }
  const mainResume = { context: { gitSha: actualHead, releaseStrategy: 'main' } }
  const result = verifyPreflightGitAndPlan({
    gitState: canonical, expectedHeadSha: actualHead, resumeRequested: true, resumeRunState: mainResume,
    releaseStrategy: 'main', fullCurrentExplicit: false,
  })
  assert.equal(result.plan.mode, 'main')
  assert.throws(() => verifyPreflightGitAndPlan({
    gitState: canonical, expectedHeadSha: actualHead, resumeRequested: true, resumeRunState: mainResume,
    releaseStrategy: 'full-current', fullCurrentExplicit: true,
  }), /resume context mismatch.*releaseStrategy/i)
})

test('preflight binds force-redeploy-current to explicit full-current resume identity', () => {
  const actualHead = 'a'.repeat(40)
  const canonical = { cwd: 'C:\\Project\\Claude\\happyHome_public', originUrl: 'https://github.com/happyhome-project/happyHome_public.git', branch: 'main', headSha: actualHead, originMainSha: actualHead, changedPaths: [] }
  const resumeRunState = { context: { gitSha: actualHead, releaseStrategy: 'full-current', forceRedeployCurrent: true } }
  const result = verifyPreflightGitAndPlan({
    gitState: canonical, expectedHeadSha: actualHead, resumeRequested: true, resumeRunState,
    releaseStrategy: 'full-current', fullCurrentExplicit: true, forceRedeployCurrent: true,
  })
  assert.equal(result.plan.forceRedeployCurrent, true)
  assert.throws(() => verifyPreflightGitAndPlan({
    gitState: canonical, expectedHeadSha: actualHead, resumeRequested: true, resumeRunState,
    releaseStrategy: 'full-current', fullCurrentExplicit: true, forceRedeployCurrent: false,
  }), /forceRedeployCurrent/i)
  assert.throws(() => verifyPreflightGitAndPlan({
    gitState: canonical, expectedHeadSha: actualHead, resumeRequested: false,
    releaseStrategy: 'main', fullCurrentExplicit: false, forceRedeployCurrent: true,
  }), /force-redeploy-current.*full-current/i)
})

test('publish resume permits only matching generated build-info and rejects every unexpected dirty path', () => {
  const actualHead = 'a'.repeat(40)
  const canonical = { cwd: 'C:\\Project\\Claude\\happyHome_public', originUrl: 'https://github.com/happyhome-project/happyHome_public.git', branch: 'main', headSha: actualHead, originMainSha: actualHead, changedPaths: ['miniprogram/src/generated/build-info.ts'] }
  const resumeRunState = { context: { gitSha: actualHead, releaseStrategy: 'full-current' } }
  assert.doesNotThrow(() => verifyPreflightGitAndPlan({ gitState: canonical, expectedHeadSha: actualHead, resumeRequested: true, resumeRunState, releaseStrategy: 'full-current', fullCurrentExplicit: true, publishOnly: true, generatedBuildInfoMatches: true }))
  assert.throws(() => verifyPreflightGitAndPlan({ gitState: canonical, expectedHeadSha: actualHead, resumeRequested: true, resumeRunState, releaseStrategy: 'full-current', fullCurrentExplicit: true, publishOnly: true, generatedBuildInfoMatches: false }), /build-info does not match/i)
  assert.throws(() => verifyPreflightGitAndPlan({ gitState: { ...canonical, changedPaths: [...canonical.changedPaths, 'cloud/functions/post/index.js'] }, expectedHeadSha: actualHead, resumeRequested: true, resumeRunState, releaseStrategy: 'full-current', fullCurrentExplicit: true, publishOnly: true, generatedBuildInfoMatches: true }), /unexpected worktree changes/i)
})

test('probe evidence requires authenticated timer outbox and v2 job evidence plus completion', () => {
  const input = { startedAt: '2026-01-01T00:00:00Z', outboxId: 'o', jobId: 'j' }
  const evidence = { source: 'timer', triggerName: 'post-rag-worker-every-minute', invokedAt: '2026-01-01T00:00:01Z', outboxIds: ['o'], v2JobIds: ['j'], v2Attempted: true, v2Succeeded: true, v2CompletedCount: 1 }
  assert.equal(evaluateProbeEvidence({ ...input, evidence, complete: true }).passed, true)
  assert.equal(evaluateProbeEvidence({ ...input, evidence: { ...evidence, source: 'manual' }, complete: true }).passed, false)
  assert.equal(evaluateProbeEvidence({ ...input, evidence, complete: false }).passed, false)
})

test('index preflight resolves the real Serverless index name and public control-plane region', () => {
  assert.deepEqual(resolvePreflightIndexOptions({
    TENCENT_RAG_INDEX_NAME: 'real-index',
    TENCENT_RAG_ATOMIC_REGION: 'ap-beijing',
    TENCENT_RAG_EMBEDDING_DIMS: '768',
  }), { indexName: 'real-index', region: 'ap-shanghai', dims: 768 })
  assert.equal(resolvePreflightIndexOptions({ TENCENT_RAG_INDEX_NAME: 'real-index', TENCENT_RAG_ES_REGION: 'ap-nanjing' }).region, 'ap-nanjing')
  assert.throws(() => resolvePreflightIndexOptions({ TENCENT_RAG_ES_INDEX: 'wrong-legacy-key' }), /index name/i)
})

test('preflight timer evidence proves the authenticated fixture outbox without duplicating semantic completion', () => {
  const input = { startedAt: '2026-01-01T00:00:00Z', outboxId: 'o' }
  const evidence = { source: 'timer', triggerName: 'post-rag-worker-every-minute', invokedAt: '2026-01-01T00:00:01Z', outboxIds: ['o'], v2JobIds: [], v2Attempted: true, v2Succeeded: false, v2CompletedCount: 0 }
  assert.equal(evaluatePreflightTimerEvidence({ ...input, evidence }).passed, true)
  assert.equal(evaluatePreflightTimerEvidence({ ...input, evidence: { ...evidence, source: 'manual' } }).passed, false)
  assert.equal(evaluatePreflightTimerEvidence({ ...input, evidence: { ...evidence, outboxIds: [] } }).passed, false)
})

test('probe evidence accumulates outbox and v2 job observations across timer invocations', () => {
  const base = { startedAt: '2026-01-01T00:00:00Z', outboxId: 'o', jobId: 'j' }
  const first = evaluateProbeEvidence({ ...base, evidence: { source: 'timer', triggerName: 'post-rag-worker-every-minute', invokedAt: '2026-01-01T00:00:01Z', outboxIds: ['o'], v2JobIds: [], v2Attempted: false, v2Succeeded: false, v2CompletedCount: 0 }, complete: false })
  const second = evaluateProbeEvidence({ ...base, state: first, evidence: { source: 'timer', triggerName: 'post-rag-worker-every-minute', invokedAt: '2026-01-01T00:00:02Z', outboxIds: [], v2JobIds: ['j'], v2Attempted: true, v2Succeeded: true, v2CompletedCount: 1 }, complete: true })
  assert.equal(second.passed, true)
})
