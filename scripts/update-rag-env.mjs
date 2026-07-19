#!/usr/bin/env node
import CloudBase from '@cloudbase/manager-node'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ensurePostRagSmokeIdentitySecret } from './lib/post-rag-smoke-identity.mjs'
import { resolvePostRagWorkerToken } from './lib/post-rag-worker-token.mjs'
import { buildRagFunctionEnvironments } from './lib/rag-function-env.mjs'
import { reconcileRagFunctionEnvironment } from './lib/rag-env-reconcile.mjs'

function loadDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const out = {}
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

const home = os.homedir()
const camEnv = loadDotEnvFile(path.join(home, '.happyhome', 'cam.env'))
const ragEnv = loadDotEnvFile(path.join(home, '.happyhome', 'tencent-rag.env'))

const envId = process.env.TCB_ENV || camEnv.TCB_ENV || 'cloudbase-3gh862acb1505ff3'
const managerSecretId = process.env.TENCENTCLOUD_SECRETID || camEnv.TENCENTCLOUD_SECRETID
const managerSecretKey = process.env.TENCENTCLOUD_SECRETKEY || camEnv.TENCENTCLOUD_SECRETKEY
const MAX_HTTP_RETRIES = Math.max(1, Math.floor(Number(process.env.TENCENT_RAG_HTTP_RETRIES || 5)))

if (!managerSecretId || !managerSecretKey) {
  console.error('[rag-env] Missing manager TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY in env or ~/.happyhome/cam.env')
  process.exit(1)
}

const baseEnv = {
  TENCENT_RAG_PROVIDER: 'cloudbase',
  TENCENT_RAG_CLOUDBASE_CHUNK_PAGE_SIZE: process.env.TENCENT_RAG_CLOUDBASE_CHUNK_PAGE_SIZE || ragEnv.TENCENT_RAG_CLOUDBASE_CHUNK_PAGE_SIZE || '100',
  TENCENT_RAG_CLOUDBASE_MAX_CANDIDATE_CHUNKS: process.env.TENCENT_RAG_CLOUDBASE_MAX_CANDIDATE_CHUNKS || ragEnv.TENCENT_RAG_CLOUDBASE_MAX_CANDIDATE_CHUNKS || '200',
}

const atomicEnv = {
  TENCENT_RAG_ATOMIC_SECRET_ID: process.env.TENCENT_RAG_ATOMIC_SECRET_ID || ragEnv.TENCENT_RAG_ATOMIC_SECRET_ID || camEnv.TENCENTCLOUD_SECRETID,
  TENCENT_RAG_ATOMIC_SECRET_KEY: process.env.TENCENT_RAG_ATOMIC_SECRET_KEY || ragEnv.TENCENT_RAG_ATOMIC_SECRET_KEY || camEnv.TENCENTCLOUD_SECRETKEY,
  TENCENT_RAG_ATOMIC_REGION: process.env.TENCENT_RAG_ATOMIC_REGION || ragEnv.TENCENT_RAG_ATOMIC_REGION || 'ap-beijing',
  TENCENT_RAG_EMBEDDING_MODEL: process.env.TENCENT_RAG_EMBEDDING_MODEL || ragEnv.TENCENT_RAG_EMBEDDING_MODEL || 'bge-base-zh-v1.5',
  TENCENT_RAG_RERANK_MODEL: process.env.TENCENT_RAG_RERANK_MODEL || ragEnv.TENCENT_RAG_RERANK_MODEL || 'bge-reranker-large',
  TENCENT_RAG_LLM_MODEL: process.env.TENCENT_RAG_LLM_MODEL || ragEnv.TENCENT_RAG_LLM_MODEL || 'deepseek-v3',
}

const hasAtomicModelConfig = Object.values(atomicEnv).every(Boolean)
const targetEnv = {
  ...baseEnv,
  ...(hasAtomicModelConfig ? atomicEnv : {}),
}

const workerEnv = {
  POST_RAG_WORKER_TOKEN: resolvePostRagWorkerToken(),
}

const postSmokeIdentityEnv = {
  POST_RAG_SMOKE_IDENTITY_SECRET: ensurePostRagSmokeIdentitySecret(),
}
const ragSource = {
  ...camEnv,
  ...ragEnv,
  ...process.env,
  POST_RAG_WORKER_TOKEN: workerEnv.POST_RAG_WORKER_TOKEN,
  POST_RAG_TIMER_TOKEN: process.env.POST_RAG_TIMER_TOKEN || ragEnv.POST_RAG_TIMER_TOKEN,
  POST_RAG_SMOKE_IDENTITY_SECRET: postSmokeIdentityEnv.POST_RAG_SMOKE_IDENTITY_SECRET,
  TENCENT_RAG_ATOMIC_SECRET_ID: atomicEnv.TENCENT_RAG_ATOMIC_SECRET_ID,
  TENCENT_RAG_ATOMIC_SECRET_KEY: atomicEnv.TENCENT_RAG_ATOMIC_SECRET_KEY,
  TENCENT_RAG_ATOMIC_REGION: atomicEnv.TENCENT_RAG_ATOMIC_REGION,
  TENCENT_RAG_EMBEDDING_MODEL: atomicEnv.TENCENT_RAG_EMBEDDING_MODEL,
}
const functionEnvironments = buildRagFunctionEnvironments({ ...baseEnv, ...ragSource, ...atomicEnv })

function configuredEnv(values) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== ''))
}

const videoPolicyEnv = configuredEnv({
  POST_VIDEO_RAG_ANALYSIS_ENABLED: process.env.POST_VIDEO_RAG_ANALYSIS_ENABLED || ragEnv.POST_VIDEO_RAG_ANALYSIS_ENABLED || 'false',
  POST_VIDEO_RAG_MAX_JOBS_PER_POST: process.env.POST_VIDEO_RAG_MAX_JOBS_PER_POST || ragEnv.POST_VIDEO_RAG_MAX_JOBS_PER_POST || '1',
  POST_VIDEO_RAG_MAX_FRAMES_PER_VIDEO: process.env.POST_VIDEO_RAG_MAX_FRAMES_PER_VIDEO || ragEnv.POST_VIDEO_RAG_MAX_FRAMES_PER_VIDEO || '0',
  POST_VIDEO_RAG_MAX_ASR_SECONDS_PER_VIDEO: process.env.POST_VIDEO_RAG_MAX_ASR_SECONDS_PER_VIDEO || ragEnv.POST_VIDEO_RAG_MAX_ASR_SECONDS_PER_VIDEO || '3600',
  POST_VIDEO_RAG_MAX_COST_UNITS_PER_POST: process.env.POST_VIDEO_RAG_MAX_COST_UNITS_PER_POST || ragEnv.POST_VIDEO_RAG_MAX_COST_UNITS_PER_POST || '120',
  POST_VIDEO_RAG_MIN_TEXT_CHARS_FOR_ANALYSIS: process.env.POST_VIDEO_RAG_MIN_TEXT_CHARS_FOR_ANALYSIS || ragEnv.POST_VIDEO_RAG_MIN_TEXT_CHARS_FOR_ANALYSIS || '48',
})

const videoAnalyzerEnv = configuredEnv({
  POST_VIDEO_RAG_ASR_SECRET_ID: process.env.POST_VIDEO_RAG_ASR_SECRET_ID || ragEnv.POST_VIDEO_RAG_ASR_SECRET_ID,
  POST_VIDEO_RAG_ASR_SECRET_KEY: process.env.POST_VIDEO_RAG_ASR_SECRET_KEY || ragEnv.POST_VIDEO_RAG_ASR_SECRET_KEY,
  POST_VIDEO_RAG_ASR_REGION: process.env.POST_VIDEO_RAG_ASR_REGION || ragEnv.POST_VIDEO_RAG_ASR_REGION || 'ap-guangzhou',
  POST_VIDEO_RAG_ASR_ENGINE_MODEL_TYPE: process.env.POST_VIDEO_RAG_ASR_ENGINE_MODEL_TYPE || ragEnv.POST_VIDEO_RAG_ASR_ENGINE_MODEL_TYPE || '16k_zh',
  POST_VIDEO_RAG_ASR_CHANNEL_NUM: process.env.POST_VIDEO_RAG_ASR_CHANNEL_NUM || ragEnv.POST_VIDEO_RAG_ASR_CHANNEL_NUM || '1',
  POST_VIDEO_RAG_ASR_RES_TEXT_FORMAT: process.env.POST_VIDEO_RAG_ASR_RES_TEXT_FORMAT || ragEnv.POST_VIDEO_RAG_ASR_RES_TEXT_FORMAT || '0',
  POST_VIDEO_RAG_TOKENHUB_API_KEY: process.env.POST_VIDEO_RAG_TOKENHUB_API_KEY || ragEnv.POST_VIDEO_RAG_TOKENHUB_API_KEY,
  POST_VIDEO_RAG_TOKENHUB_MODEL: process.env.POST_VIDEO_RAG_TOKENHUB_MODEL || ragEnv.POST_VIDEO_RAG_TOKENHUB_MODEL,
  POST_VIDEO_RAG_TOKENHUB_BASE_URL: process.env.POST_VIDEO_RAG_TOKENHUB_BASE_URL || ragEnv.POST_VIDEO_RAG_TOKENHUB_BASE_URL,
  POST_VIDEO_RAG_ANALYZER_URL: process.env.POST_VIDEO_RAG_ANALYZER_URL || ragEnv.POST_VIDEO_RAG_ANALYZER_URL,
  POST_VIDEO_RAG_ANALYZER_TOKEN: process.env.POST_VIDEO_RAG_ANALYZER_TOKEN || ragEnv.POST_VIDEO_RAG_ANALYZER_TOKEN,
})

const functionNames = (process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length) || 'post,post-rag-worker,post-video-rag-worker')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

const workerFunctions = new Set(['post-rag-worker', 'post-video-rag-worker'])
const deprecatedEsEnvKeys = new Set([
  'TENCENT_RAG_ES_ENDPOINT',
  'TENCENT_RAG_ES_USERNAME',
  'TENCENT_RAG_ES_PASSWORD',
  'TENCENT_RAG_INDEX_NAME',
  'TENCENT_RAG_VECTOR_FIELD',
  'TENCENT_RAG_EMBEDDING_INFERENCE_ID',
  'TENCENT_RAG_RERANK_INFERENCE_ID',
  'TENCENT_RAG_LLM_INFERENCE_ID',
])

const missing = Object.entries(baseEnv)
  .filter(([, value]) => !value)
  .map(([key]) => key)

if (!hasAtomicModelConfig) missing.push(...Object.entries(atomicEnv).filter(([, value]) => !value).map(([key]) => key))

if (functionNames.some((functionName) => workerFunctions.has(functionName)) && !workerEnv.POST_RAG_WORKER_TOKEN) {
  missing.push('POST_RAG_WORKER_TOKEN')
}

if (missing.length > 0) {
  console.error(`[rag-env] Missing RAG env values: ${missing.join(', ')}`)
  console.error('  Expected Tencent ES RAG file: ~/.happyhome/tencent-rag.env')
  process.exit(1)
}

function redact(value, key) {
  if (/SECRET|KEY|TOKEN|PASSWORD/i.test(key)) return '[redacted]'
  return value
}

const app = CloudBase.init({ secretId: managerSecretId, secretKey: managerSecretKey, envId })

function isTransientCloudApiError(error) {
  const text = String(error?.message || error?.code || error?.original?.Code || error?.original?.Message || error)
  return /ECONNRESET|ETIMEDOUT|TLS connection|socket disconnected|ENOTFOUND|EAI_AGAIN|FetchError|Updating状态|FailedOperation\.UpdateFunctionConfiguration/i.test(text)
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withTransientRetry(label, fn) {
  let lastError
  for (let attempt = 1; attempt <= MAX_HTTP_RETRIES; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (!isTransientCloudApiError(error) || attempt >= MAX_HTTP_RETRIES) throw error
      console.warn(`[rag-env] transient ${label} failure; retry ${attempt + 1}/${MAX_HTTP_RETRIES}`)
      await delay(Math.min(10000, 1000 * attempt))
    }
  }
  throw lastError
}

for (const functionName of functionNames) {
  const envForFunction = functionName === 'post' ? functionEnvironments.post : (
    functionName === 'post-video-rag-worker' ? { ...targetEnv, ...workerEnv, ...videoPolicyEnv, ...videoAnalyzerEnv } : (
      functionName === 'post-rag-worker' ? { ...functionEnvironments['post-rag-worker'], ...videoPolicyEnv } : targetEnv
    )
  )
  const result = await withTransientRetry(`${functionName}.reconcile`, () =>
    reconcileRagFunctionEnvironment(app, functionName, envForFunction, { deprecatedKeys: deprecatedEsEnvKeys })
  )
  console.log(`[rag-env] ${functionName} changed=${result.changed}`)
  console.table(Object.entries(envForFunction).map(([Key, Value]) => ({ Key, Value: redact(Value, Key) })))
}

console.log(`[rag-env] Done for env ${envId}`)
