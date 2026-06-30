#!/usr/bin/env node
import CloudBase from '@cloudbase/manager-node'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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
const lkeapEnv = loadDotEnvFile(path.join(home, '.happyhome', 'tencent-lkeap.env'))

const envId = process.env.TCB_ENV || camEnv.TCB_ENV || 'cloudbase-3gh862acb1505ff3'
const managerSecretId = process.env.TENCENTCLOUD_SECRETID || camEnv.TENCENTCLOUD_SECRETID
const managerSecretKey = process.env.TENCENTCLOUD_SECRETKEY || camEnv.TENCENTCLOUD_SECRETKEY

if (!managerSecretId || !managerSecretKey) {
  console.error('[rag-env] Missing manager TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY in env or ~/.happyhome/cam.env')
  process.exit(1)
}

const targetEnv = {
  TENCENT_RAG_PROVIDER: 'lkeap',
  TENCENT_LKEAP_SECRET_ID: process.env.RAG_TENCENTCLOUD_SECRETID || process.env.TENCENT_LKEAP_SECRET_ID || lkeapEnv.TENCENTCLOUD_SECRETID || lkeapEnv.TENCENT_LKEAP_SECRET_ID,
  TENCENT_LKEAP_SECRET_KEY: process.env.RAG_TENCENTCLOUD_SECRETKEY || process.env.TENCENT_LKEAP_SECRET_KEY || lkeapEnv.TENCENTCLOUD_SECRETKEY || lkeapEnv.TENCENT_LKEAP_SECRET_KEY,
  TENCENT_LKEAP_REGION: process.env.TENCENT_LKEAP_REGION || lkeapEnv.TENCENT_LKEAP_REGION || 'ap-guangzhou',
  TENCENT_LKEAP_EMBEDDING_MODEL: process.env.TENCENT_LKEAP_EMBEDDING_MODEL || lkeapEnv.TENCENT_LKEAP_EMBEDDING_MODEL || 'lke-text-embedding-v2',
  TENCENT_LKEAP_RERANK_MODEL: process.env.TENCENT_LKEAP_RERANK_MODEL || lkeapEnv.TENCENT_LKEAP_RERANK_MODEL || 'lke-reranker-base',
  TENCENT_LKEAP_CHAT_MODEL: process.env.TENCENT_LKEAP_CHAT_MODEL || lkeapEnv.TENCENT_LKEAP_CHAT_MODEL || 'deepseek-v3-0324',
}

const missing = Object.entries(targetEnv)
  .filter(([, value]) => !value)
  .map(([key]) => key)

if (missing.length > 0) {
  console.error(`[rag-env] Missing RAG env values: ${missing.join(', ')}`)
  console.error('  Expected LKEAP file: ~/.happyhome/tencent-lkeap.env')
  process.exit(1)
}

const functionNames = (process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length) || 'post,post-rag-worker')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

function redact(value, key) {
  if (/SECRET|KEY|TOKEN|PASSWORD/i.test(key)) return '[redacted]'
  return value
}

const app = CloudBase.init({ secretId: managerSecretId, secretKey: managerSecretKey, envId })

for (const functionName of functionNames) {
  const detail = await app.functions.getFunctionDetail(functionName)
  const existing = {}
  for (const item of detail?.Environment?.Variables || []) existing[item.Key] = item.Value
  const merged = { ...existing, ...targetEnv }
  await app.functions.updateFunctionConfig({ name: functionName, envVariables: merged })
  console.log(`[rag-env] ${functionName} updated`)
  console.table(Object.entries(targetEnv).map(([Key, Value]) => ({ Key, Value: redact(Value, Key) })))
}

console.log(`[rag-env] Done for env ${envId}`)
