#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
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

const RAG_ENV_FILE = path.join(os.homedir(), '.happyhome', 'tencent-rag.env')
const CAM_ENV_FILE = path.join(os.homedir(), '.happyhome', 'cam.env')
const fileEnv = loadDotEnvFile(RAG_ENV_FILE)
const camEnv = loadDotEnvFile(CAM_ENV_FILE)
const env = { ...camEnv, ...fileEnv, ...process.env }
const modelsOnly = process.argv.includes('--models-only')

const config = {
  endpoint: String(env.TENCENT_RAG_ES_ENDPOINT || '').trim().replace(/\/+$/, ''),
  username: String(env.TENCENT_RAG_ES_USERNAME || '').trim(),
  password: String(env.TENCENT_RAG_ES_PASSWORD || ''),
  embeddingInferenceId: String(env.TENCENT_RAG_EMBEDDING_INFERENCE_ID || '').trim(),
  rerankInferenceId: String(env.TENCENT_RAG_RERANK_INFERENCE_ID || '').trim(),
  llmInferenceId: String(env.TENCENT_RAG_LLM_INFERENCE_ID || '').trim(),
  atomicSecretId: String(env.TENCENT_RAG_ATOMIC_SECRET_ID || env.TENCENTCLOUD_SECRETID || '').trim(),
  atomicSecretKey: String(env.TENCENT_RAG_ATOMIC_SECRET_KEY || env.TENCENTCLOUD_SECRETKEY || ''),
  atomicRegion: String(env.TENCENT_RAG_ATOMIC_REGION || 'ap-beijing').trim(),
  embeddingModel: String(env.TENCENT_RAG_EMBEDDING_MODEL || 'bge-base-zh-v1.5').trim(),
  rerankModel: String(env.TENCENT_RAG_RERANK_MODEL || 'bge-reranker-large').trim(),
  llmModel: String(env.TENCENT_RAG_LLM_MODEL || 'deepseek-v3').trim(),
}

const baseConfig = {
  endpoint: config.endpoint,
  username: config.username,
  password: config.password,
}
const inferenceConfig = {
  embeddingInferenceId: config.embeddingInferenceId,
  rerankInferenceId: config.rerankInferenceId,
  llmInferenceId: config.llmInferenceId,
}
const atomicConfig = {
  atomicSecretId: config.atomicSecretId,
  atomicSecretKey: config.atomicSecretKey,
  atomicRegion: config.atomicRegion,
  embeddingModel: config.embeddingModel,
  rerankModel: config.rerankModel,
  llmModel: config.llmModel,
}
const hasInferenceModelConfig = Object.values(inferenceConfig).every(Boolean)
const hasAtomicModelConfig = Object.values(atomicConfig).every(Boolean)
const missing = (modelsOnly ? [] : Object.entries(baseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key))

if (!hasInferenceModelConfig && !hasAtomicModelConfig) {
  const atomicMissing = Object.entries(atomicConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key)
  const inferenceMissing = Object.entries(inferenceConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key)
  missing.push(...(atomicMissing.length < inferenceMissing.length ? atomicMissing : inferenceMissing))
}

if (missing.length > 0) {
  console.error(`[verify-tencent-rag] Missing config: ${missing.join(', ')}`)
  console.error(`  Expected file: ${RAG_ENV_FILE}`)
  process.exit(1)
}

function authHeader() {
  return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`
}

function requestJson(method, requestPath, body) {
  const url = new URL(`${config.endpoint}/${requestPath.replace(/^\/+/, '')}`)
  const transport = url.protocol === 'http:' ? http : https
  const payload = body === undefined ? '' : JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method,
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if ((res.statusCode || 500) >= 400) {
          reject(new Error(`${method} ${url.pathname} failed: ${res.statusCode} ${text}`))
          return
        }
        try {
          resolve(text ? JSON.parse(text) : {})
        } catch (error) {
          reject(error)
        }
      })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function sha256(message, encoding = 'hex') {
  return crypto.createHash('sha256').update(message, 'utf8').digest(encoding)
}

function hmac(key, message, encoding) {
  return crypto.createHmac('sha256', key).update(message, 'utf8').digest(encoding)
}

async function requestTencentAtomic(action, payload) {
  const host = action === 'ChatCompletions' ? 'es.ai.tencentcloudapi.com' : 'es.tencentcloudapi.com'
  const service = 'es'
  const version = '2025-01-01'
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const body = JSON.stringify(payload)
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`
  const signedHeaders = 'content-type;host'
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256(body)].join('\n')
  const credentialScope = `${date}/${service}/tc3_request`
  const stringToSign = ['TC3-HMAC-SHA256', timestamp, credentialScope, sha256(canonicalRequest)].join('\n')
  const secretDate = hmac(`TC3${config.atomicSecretKey}`, date)
  const secretService = hmac(secretDate, service)
  const secretSigning = hmac(secretService, 'tc3_request')
  const signature = hmac(secretSigning, stringToSign, 'hex')
  const authorization = `TC3-HMAC-SHA256 Credential=${config.atomicSecretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const res = await fetch(`https://${host}/`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json; charset=utf-8',
      Host: host,
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': config.atomicRegion,
    },
    body,
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text.slice(0, 1000) }
  }
  if (!res.ok || json.Response?.Error) {
    const error = json.Response?.Error
    throw new Error(`${action} failed: ${error?.Code || res.status} ${error?.Message || json.raw || ''}`)
  }
  return json.Response
}

function embeddingLength(value) {
  const response = value?.Response || value
  const direct = value?.embedding?.[0]?.result
    || value?.embedding?.[0]?.embedding
    || value?.data?.[0]?.embedding
    || response?.Data?.[0]?.Embedding
    || response?.Data?.[0]?.embedding
    || value?.result
    || value?.vector
  return Array.isArray(direct) ? direct.length : 0
}

function rerankItems(value) {
  const response = value?.Response || value
  return Array.isArray(value?.rerank)
    ? value.rerank
    : (Array.isArray(value?.data)
      ? value.data
      : (Array.isArray(response?.Data) ? response.Data : []))
}

function completionText(value) {
  const response = value?.Response || value
  const choice = response?.Choices?.[0] || response?.choices?.[0] || {}
  return String(
    value?.completion?.[0]?.result
    || value?.completion?.[0]?.text
    || value?.result
    || value?.text
    || value?.choices?.[0]?.message?.content
    || choice?.Message?.Content
    || choice?.message?.content
    || choice?.Content
    || ''
  ).trim()
}

console.log(`[verify-tencent-rag] Checking Tencent ES AI Search ${hasInferenceModelConfig ? 'inference endpoints' : 'atomic APIs'}`)

const embedding = hasInferenceModelConfig
  ? await requestJson('POST', `_inference/text_embedding/${config.embeddingInferenceId}`, {
    input: ['有没有讲节俭家风的帖子？'],
  })
  : await requestTencentAtomic('GetTextEmbedding', {
    ModelName: config.embeddingModel,
    Texts: ['有没有讲节俭家风的帖子？'],
  })
const dim = embeddingLength(embedding)
if (dim <= 0) throw new Error('embedding service returned no vector')
console.log(`[ok] embedding vector dimension: ${dim}`)

const rerankDocs = [
  '朱子治家格言：一粥一饭，当思来处不易；半丝半缕，恒念物力维艰。',
  '今天晚饭吃什么。',
]
const rerank = hasInferenceModelConfig
  ? await requestJson('POST', `_inference/rerank/${config.rerankInferenceId}`, {
    query: '有没有讲节俭家风的帖子？',
    input: rerankDocs,
  })
  : await requestTencentAtomic('RunRerank', {
    ModelName: config.rerankModel,
    Query: '有没有讲节俭家风的帖子？',
    Documents: rerankDocs,
    ReturnDocuments: false,
  })
if (!rerankItems(rerank).length) {
  throw new Error('rerank service returned no ranking array')
}
console.log('[ok] rerank returned ranking data')

const prompt = [
  '只根据证据回答：有没有讲节俭家风的帖子？',
  '证据：朱子治家格言提到一粥一饭，当思来处不易；半丝半缕，恒念物力维艰。',
].join('\n')
const answer = hasInferenceModelConfig
  ? await requestJson('POST', `_inference/completion/${config.llmInferenceId}?timeout=300s`, {
    input: prompt,
    task_settings: { temperature: 0.1, max_new_tokens: 120 },
  })
  : await requestTencentAtomic('ChatCompletions', {
    ModelName: config.llmModel,
    Messages: [{ Role: 'user', Content: prompt }],
    Stream: false,
    Temperature: 0.1,
  })
const text = completionText(answer)
if (!text) throw new Error('LLM service returned empty answer')
console.log(`[ok] llm answer returned ${text.length} chars`)
console.log('[verify-tencent-rag] Done')
