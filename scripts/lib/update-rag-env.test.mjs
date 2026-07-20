import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { reconcileRagFunctionEnvironment } from './rag-env-reconcile.mjs'
import * as ragFunctionEnv from './rag-function-env.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, '..', 'update-rag-env.mjs'), 'utf8')
const reconcileSource = readFileSync(resolve(__dirname, 'rag-env-reconcile.mjs'), 'utf8')

test('formal RAG environment composition keeps release-owned provider ahead of legacy local values', () => {
  assert.equal(typeof ragFunctionEnv.buildFormalRagFunctionEnvironments, 'function')
  const environments = ragFunctionEnv.buildFormalRagFunctionEnvironments({
    baseEnv: {
      TENCENT_RAG_PROVIDER: 'cloudbase',
      TENCENT_RAG_CLOUDBASE_CHUNK_PAGE_SIZE: '100',
      TENCENT_RAG_CLOUDBASE_MAX_CANDIDATE_CHUNKS: '200',
    },
    ragSource: {
      TENCENT_RAG_PROVIDER: 'es',
      TENCENT_RAG_CLOUDBASE_CHUNK_PAGE_SIZE: '1',
      TENCENT_RAG_CLOUDBASE_MAX_CANDIDATE_CHUNKS: '2',
      POST_RAG_WORKER_TOKEN: 'worker-token',
      POST_RAG_TIMER_TOKEN: 'timer-token',
      POST_RAG_SMOKE_IDENTITY_SECRET: 'smoke-secret',
    },
    atomicEnv: {
      TENCENT_RAG_ATOMIC_SECRET_ID: 'atomic-id',
      TENCENT_RAG_ATOMIC_SECRET_KEY: 'atomic-key',
      TENCENT_RAG_ATOMIC_REGION: 'ap-beijing',
      TENCENT_RAG_EMBEDDING_MODEL: 'embedding-model',
      TENCENT_RAG_RERANK_MODEL: 'rerank-model',
      TENCENT_RAG_LLM_MODEL: 'llm-model',
    },
  })

  assert.equal(environments.post.TENCENT_RAG_PROVIDER, 'cloudbase')
  assert.equal(environments.post.TENCENT_RAG_CLOUDBASE_CHUNK_PAGE_SIZE, '100')
  assert.equal(environments.post.TENCENT_RAG_EMBEDDING_MODEL, 'embedding-model')
  assert.equal(environments['post-rag-worker'].POST_RAG_WORKER_TOKEN, 'worker-token')
  assert.equal(environments['post-rag-worker'].POST_RAG_TIMER_TOKEN, 'timer-token')
})

test('update-rag-env configures CloudBase retrieval with Tencent atomic models as the formal post RAG provider', () => {
  assert.match(source, /tencent-rag\.env/)
  assert.match(source, /TENCENT_RAG_PROVIDER:\s*'cloudbase'/)
  assert.match(source, /TENCENT_RAG_CLOUDBASE_CHUNK_PAGE_SIZE/)
  assert.match(source, /TENCENT_RAG_CLOUDBASE_MAX_CANDIDATE_CHUNKS/)
  assert.match(source, /deprecatedEsEnvKeys/)
  assert.match(source, /TENCENT_RAG_ES_ENDPOINT/)
  assert.match(reconcileSource, /delete existing\[key\]/)
  assert.match(source, /TENCENT_RAG_ATOMIC_SECRET_ID/)
  assert.match(source, /TENCENT_RAG_ATOMIC_SECRET_KEY/)
  assert.match(source, /TENCENT_RAG_ATOMIC_REGION/)
  assert.match(source, /TENCENT_RAG_EMBEDDING_MODEL/)
  assert.match(source, /TENCENT_RAG_RERANK_MODEL/)
  assert.match(source, /TENCENT_RAG_LLM_MODEL/)
  assert.match(source, /ensurePostRagSmokeIdentitySecret/)
  assert.match(source, /POST_RAG_SMOKE_IDENTITY_SECRET/)
  assert.match(source, /functionName === 'post'/)
  assert.doesNotMatch(source, /TENCENT_RAG_PROVIDER:\s*'es'/)
  assert.doesNotMatch(source, /buildPostSemanticFunctionEnvironments/)
})

test('update-rag-env carries cost-controlled video ASR policy into RAG workers', () => {
  assert.match(source, /videoPolicyEnv/)
  assert.match(source, /videoAnalyzerEnv/)
  assert.match(source, /POST_VIDEO_RAG_ANALYSIS_ENABLED/)
  assert.match(source, /POST_VIDEO_RAG_ASR_SECRET_ID/)
  assert.match(source, /POST_VIDEO_RAG_ASR_SECRET_KEY/)
  assert.match(source, /POST_VIDEO_RAG_MAX_JOBS_PER_POST/)
  assert.match(source, /POST_VIDEO_RAG_MAX_FRAMES_PER_VIDEO/)
  assert.match(source, /POST_VIDEO_RAG_MAX_ASR_SECONDS_PER_VIDEO/)
  assert.match(source, /POST_VIDEO_RAG_MAX_COST_UNITS_PER_POST/)
  assert.match(source, /POST_VIDEO_RAG_MIN_TEXT_CHARS_FOR_ANALYSIS/)
  assert.match(source, /functionName === 'post-video-rag-worker'\s*\?\s*\{ \.\.\.targetEnv, \.\.\.workerEnv, \.\.\.videoPolicyEnv, \.\.\.videoAnalyzerEnv \}/)
})

test('update-rag-env retries transient Tencent Cloud API failures', () => {
  assert.match(source, /TENCENT_RAG_HTTP_RETRIES/)
  assert.match(source, /withTransientRetry/)
  assert.match(source, /ECONNRESET|ETIMEDOUT|TLS connection|socket disconnected|ENOTFOUND|EAI_AGAIN/)
  assert.match(reconcileSource, /getFunctionDetail/)
  assert.match(reconcileSource, /updateFunctionConfig/)
})

test('reconcileRagFunctionEnvironment does not write an identical normalized environment', async () => {
  const calls = []
  const app = { functions: {
    async getFunctionDetail() { return { Environment: { Variables: [{ Key: 'B', Value: '2' }, { Key: 'A', Value: '1' }] } } },
    async updateFunctionConfig(payload) { calls.push(payload) },
  } }
  const result = await reconcileRagFunctionEnvironment(app, 'post', { A: '1', B: 2 })
  assert.equal(result.changed, false)
  assert.deepEqual(calls, [])
  assert.deepEqual(result.keys, ['A', 'B'])
})

test('reconcileRagFunctionEnvironment writes only when desired values differ and removes deprecated keys', async () => {
  const calls = []
  const app = { functions: {
    async getFunctionDetail() { return { Environment: { Variables: [{ Key: 'KEEP', Value: 'x' }, { Key: 'OLD', Value: 'y' }] } } },
    async updateFunctionConfig(payload) { calls.push(payload) },
  } }
  const result = await reconcileRagFunctionEnvironment(app, 'post', { NEW: 'secret' }, { deprecatedKeys: new Set(['OLD']) })
  assert.equal(result.changed, true)
  assert.deepEqual(calls, [{ name: 'post', envVariables: { KEEP: 'x', NEW: 'secret' } }])
  assert.deepEqual(result.keys, ['KEEP', 'NEW'])
})
