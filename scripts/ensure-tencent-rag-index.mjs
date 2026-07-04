#!/usr/bin/env node
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
const fileEnv = loadDotEnvFile(RAG_ENV_FILE)
const env = { ...fileEnv, ...process.env }

const config = {
  endpoint: String(env.TENCENT_RAG_ES_ENDPOINT || '').trim().replace(/\/+$/, ''),
  username: String(env.TENCENT_RAG_ES_USERNAME || '').trim(),
  password: String(env.TENCENT_RAG_ES_PASSWORD || ''),
  indexName: String(env.TENCENT_RAG_INDEX_NAME || 'happyhome_post_rag_chunks').trim(),
  vectorField: String(env.TENCENT_RAG_VECTOR_FIELD || 'embedding').trim(),
  embeddingInferenceId: String(env.TENCENT_RAG_EMBEDDING_INFERENCE_ID || '').trim(),
}

const missing = Object.entries(config)
  .filter(([, value]) => !value)
  .map(([key]) => key)

if (missing.length > 0) {
  console.error(`[ensure-tencent-rag-index] Missing config: ${missing.join(', ')}`)
  console.error(`  Expected file: ${RAG_ENV_FILE}`)
  process.exit(1)
}

function authHeader() {
  return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`
}

function requestJson(method, requestPath, body, { allow404 = false } = {}) {
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
  })
}

function embeddingLength(value) {
  const direct = value?.embedding?.[0]?.result
    || value?.embedding?.[0]?.embedding
    || value?.data?.[0]?.embedding
    || value?.result
    || value?.vector
  return Array.isArray(direct) ? direct.length : 0
}

const existing = await requestJson('HEAD', config.indexName, undefined, { allow404: true })
if (existing?.statusCode !== 404) {
  console.log(`[ensure-tencent-rag-index] ${config.indexName} already exists`)
  process.exit(0)
}

const embedding = await requestJson('POST', `_inference/text_embedding/${config.embeddingInferenceId}`, {
  input: ['HappyHome RAG index mapping dimension probe'],
})
const dims = embeddingLength(embedding)
if (dims <= 0) throw new Error('embedding endpoint returned no vector; cannot create dense_vector mapping')

await requestJson('PUT', config.indexName, {
  mappings: {
    properties: {
      chunkId: { type: 'keyword' },
      postId: { type: 'keyword' },
      communityId: { type: 'keyword' },
      sectionId: { type: 'keyword' },
      sectionName: { type: 'text' },
      title: { type: 'text' },
      fieldLabel: { type: 'text' },
      fieldType: { type: 'keyword' },
      text: { type: 'text' },
      preview: { type: 'text' },
      sourceUpdatedAt: { type: 'date' },
      visibility: { type: 'keyword' },
      [config.vectorField]: {
        type: 'dense_vector',
        dims,
        index: true,
        similarity: 'cosine',
      },
    },
  },
})

console.log(`[ensure-tencent-rag-index] created ${config.indexName} with ${config.vectorField} dims=${dims}`)
