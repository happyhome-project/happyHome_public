#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import {
  assertPostSemanticIndexCompatible,
  buildPostSemanticIndexDefinition,
} from './lib/tencent-rag-index-schema.mjs'

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
const MAX_HTTP_RETRIES = Math.max(1, Math.floor(Number(env.TENCENT_RAG_HTTP_RETRIES || 4)))

const config = {
  endpoint: String(env.TENCENT_RAG_ES_ENDPOINT || '').trim().replace(/\/+$/, ''),
  username: String(env.TENCENT_RAG_ES_USERNAME || '').trim(),
  password: String(env.TENCENT_RAG_ES_PASSWORD || ''),
  indexName: String(env.TENCENT_RAG_INDEX_NAME || 'happyhome_post_rag_chunks').trim(),
  vectorField: String(env.TENCENT_RAG_VECTOR_FIELD || 'embedding').trim(),
  embeddingInferenceId: String(env.TENCENT_RAG_EMBEDDING_INFERENCE_ID || '').trim(),
  atomicSecretId: String(env.TENCENT_RAG_ATOMIC_SECRET_ID || env.TENCENTCLOUD_SECRETID || '').trim(),
  atomicSecretKey: String(env.TENCENT_RAG_ATOMIC_SECRET_KEY || env.TENCENTCLOUD_SECRETKEY || ''),
  atomicRegion: String(env.TENCENT_RAG_ATOMIC_REGION || 'ap-beijing').trim(),
  embeddingModel: String(env.TENCENT_RAG_EMBEDDING_MODEL || 'bge-base-zh-v1.5').trim(),
}

const baseConfig = {
  endpoint: config.endpoint,
  username: config.username,
  password: config.password,
  indexName: config.indexName,
  vectorField: config.vectorField,
}
const atomicConfig = {
  atomicSecretId: config.atomicSecretId,
  atomicSecretKey: config.atomicSecretKey,
  atomicRegion: config.atomicRegion,
  embeddingModel: config.embeddingModel,
}

const missing = Object.entries(baseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key)

if (!config.embeddingInferenceId && !Object.values(atomicConfig).every(Boolean)) {
  missing.push(...Object.entries(atomicConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key))
}

if (missing.length > 0) {
  console.error(`[ensure-tencent-rag-index] Missing config: ${missing.join(', ')}`)
  console.error(`  Expected file: ${RAG_ENV_FILE}`)
  process.exit(1)
}

function authHeader() {
  return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`
}

function isTransientNetworkError(error) {
  const text = [error?.code, error?.message, error].filter(Boolean).join(' ')
  return /ECONNRESET|fetch failed|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket disconnected/i.test(text)
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
      if (!isTransientNetworkError(error) || attempt >= MAX_HTTP_RETRIES) throw error
      console.warn(`[ensure-tencent-rag-index] transient ${label} failure; retry ${attempt + 1}/${MAX_HTTP_RETRIES}`)
      await delay(1000 * attempt)
    }
  }
  throw lastError
}

function requestJson(method, requestPath, body, { allow404 = false } = {}) {
  const url = new URL(`${config.endpoint}/${requestPath.replace(/^\/+/, '')}`)
  const transport = url.protocol === 'http:' ? http : https
  const payload = body === undefined ? '' : JSON.stringify(body)
  return withTransientRetry(`${method} ${url.pathname}`, () => new Promise((resolve, reject) => {
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
        if (allow404 && res.statusCode === 404) {
          resolve({ statusCode: 404, body: text })
          return
        }
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
  }))
}

function sha256(message, encoding = 'hex') {
  return crypto.createHash('sha256').update(message, 'utf8').digest(encoding)
}

function hmac(key, message, encoding) {
  return crypto.createHmac('sha256', key).update(message, 'utf8').digest(encoding)
}

async function requestTencentAtomic(action, payload) {
  const host = 'es.tencentcloudapi.com'
  const service = 'es'
  const version = '2025-01-01'
  const res = await withTransientRetry(action, async () => {
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

    return fetch(`https://${host}/`, {
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

async function probeEmbedding() {
  if (config.embeddingInferenceId) {
    return requestJson('POST', `_inference/text_embedding/${config.embeddingInferenceId}`, {
      input: ['HappyHome RAG index mapping dimension probe'],
    })
  }
  return requestTencentAtomic('GetTextEmbedding', {
    ModelName: config.embeddingModel,
    Texts: ['HappyHome RAG index mapping dimension probe'],
  })
}

const embedding = await probeEmbedding()
const dims = embeddingLength(embedding)
if (dims <= 0) throw new Error('embedding endpoint returned no vector; cannot create dense_vector mapping')
const schemaOptions = { vectorField: config.vectorField, dims }

const existing = await requestJson('HEAD', config.indexName, undefined, { allow404: true })
if (existing?.statusCode !== 404) {
  const mapping = await requestJson('GET', `${config.indexName}/_mapping`)
  assertPostSemanticIndexCompatible(mapping?.[config.indexName]?.mappings, schemaOptions)
  console.log(`[ensure-tencent-rag-index] ${config.indexName} exists with compatible v2 mapping dims=${dims}`)
  process.exit(0)
}

await requestJson('PUT', config.indexName, buildPostSemanticIndexDefinition({ vectorField: config.vectorField, dims }))

console.log(`[ensure-tencent-rag-index] created ${config.indexName} with ${config.vectorField} dims=${dims}`)
