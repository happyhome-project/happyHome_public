import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, '..', 'update-rag-env.mjs'), 'utf8')

test('update-rag-env configures CloudBase retrieval with Tencent atomic models as the formal post RAG provider', () => {
  assert.match(source, /tencent-rag\.env/)
  assert.match(source, /TENCENT_RAG_PROVIDER:\s*'cloudbase'/)
  assert.match(source, /TENCENT_RAG_CLOUDBASE_CHUNK_PAGE_SIZE/)
  assert.match(source, /TENCENT_RAG_CLOUDBASE_MAX_CANDIDATE_CHUNKS/)
  assert.match(source, /deprecatedEsEnvKeys/)
  assert.match(source, /delete existing\[key\]/)
  assert.match(source, /TENCENT_RAG_ATOMIC_SECRET_ID/)
  assert.match(source, /TENCENT_RAG_ATOMIC_SECRET_KEY/)
  assert.match(source, /TENCENT_RAG_ATOMIC_REGION/)
  assert.match(source, /TENCENT_RAG_EMBEDDING_MODEL/)
  assert.match(source, /TENCENT_RAG_RERANK_MODEL/)
  assert.match(source, /TENCENT_RAG_LLM_MODEL/)
  assert.doesNotMatch(source, /TENCENT_RAG_PROVIDER:\s*'es'/)
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
  assert.match(source, /getFunctionDetail/)
  assert.match(source, /updateFunctionConfig/)
})
