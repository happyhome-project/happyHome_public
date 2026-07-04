#!/usr/bin/env node
import CloudBase from '@cloudbase/manager-node'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolvePostRagWorkerToken } from './lib/post-rag-worker-token.mjs'

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

if (!managerSecretId || !managerSecretKey) {
  console.error('[rag-env] Missing manager TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY in env or ~/.happyhome/cam.env')
  process.exit(1)
}

const targetEnv = {
  TENCENT_RAG_PROVIDER: 'es',
  TENCENT_RAG_ES_ENDPOINT: process.env.TENCENT_RAG_ES_ENDPOINT || ragEnv.TENCENT_RAG_ES_ENDPOINT,
  TENCENT_RAG_ES_USERNAME: process.env.TENCENT_RAG_ES_USERNAME || ragEnv.TENCENT_RAG_ES_USERNAME,
  TENCENT_RAG_ES_PASSWORD: process.env.TENCENT_RAG_ES_PASSWORD || ragEnv.TENCENT_RAG_ES_PASSWORD,
  TENCENT_RAG_INDEX_NAME: process.env.TENCENT_RAG_INDEX_NAME || ragEnv.TENCENT_RAG_INDEX_NAME || 'happyhome_post_rag_chunks',
  TENCENT_RAG_VECTOR_FIELD: process.env.TENCENT_RAG_VECTOR_FIELD || ragEnv.TENCENT_RAG_VECTOR_FIELD || 'embedding',
  TENCENT_RAG_EMBEDDING_INFERENCE_ID: process.env.TENCENT_RAG_EMBEDDING_INFERENCE_ID || ragEnv.TENCENT_RAG_EMBEDDING_INFERENCE_ID,
  TENCENT_RAG_RERANK_INFERENCE_ID: process.env.TENCENT_RAG_RERANK_INFERENCE_ID || ragEnv.TENCENT_RAG_RERANK_INFERENCE_ID,
  TENCENT_RAG_LLM_INFERENCE_ID: process.env.TENCENT_RAG_LLM_INFERENCE_ID || ragEnv.TENCENT_RAG_LLM_INFERENCE_ID,
}

const workerEnv = {
  POST_RAG_WORKER_TOKEN: resolvePostRagWorkerToken(),
}

const functionNames = (process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length) || 'post,post-rag-worker,post-video-rag-worker')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

const workerFunctions = new Set(['post-rag-worker', 'post-video-rag-worker'])

const missing = Object.entries(targetEnv)
  .filter(([, value]) => !value)
  .map(([key]) => key)

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

for (const functionName of functionNames) {
  const detail = await app.functions.getFunctionDetail(functionName)
  const existing = {}
  for (const item of detail?.Environment?.Variables || []) existing[item.Key] = item.Value
  const envForFunction = workerFunctions.has(functionName) ? { ...targetEnv, ...workerEnv } : targetEnv
  const merged = { ...existing, ...envForFunction }
  await app.functions.updateFunctionConfig({ name: functionName, envVariables: merged })
  console.log(`[rag-env] ${functionName} updated`)
  console.table(Object.entries(envForFunction).map(([Key, Value]) => ({ Key, Value: redact(Value, Key) })))
}

console.log(`[rag-env] Done for env ${envId}`)
