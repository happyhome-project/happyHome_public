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
  embeddingInferenceId: String(env.TENCENT_RAG_EMBEDDING_INFERENCE_ID || '').trim(),
  rerankInferenceId: String(env.TENCENT_RAG_RERANK_INFERENCE_ID || '').trim(),
  llmInferenceId: String(env.TENCENT_RAG_LLM_INFERENCE_ID || '').trim(),
}

const missing = Object.entries(config)
  .filter(([, value]) => !value)
  .map(([key]) => key)

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

function embeddingLength(value) {
  const direct = value?.embedding?.[0]?.result
    || value?.embedding?.[0]?.embedding
    || value?.data?.[0]?.embedding
    || value?.result
    || value?.vector
  return Array.isArray(direct) ? direct.length : 0
}

function completionText(value) {
  return String(
    value?.completion?.[0]?.result
    || value?.completion?.[0]?.text
    || value?.result
    || value?.text
    || value?.choices?.[0]?.message?.content
    || ''
  ).trim()
}

console.log('[verify-tencent-rag] Checking Tencent ES AI Search inference endpoints')

const embedding = await requestJson('POST', `_inference/text_embedding/${config.embeddingInferenceId}`, {
  input: ['有没有讲节俭家风的帖子？'],
})
const dim = embeddingLength(embedding)
if (dim <= 0) throw new Error('embedding endpoint returned no vector')
console.log(`[ok] embedding vector dimension: ${dim}`)

const rerank = await requestJson('POST', `_inference/rerank/${config.rerankInferenceId}`, {
  query: '有没有讲节俭家风的帖子？',
  input: [
    '朱子治家格言：一粥一饭，当思来处不易；半丝半缕，恒念物力维艰。',
    '今天晚饭吃什么。',
  ],
})
if (!Array.isArray(rerank?.rerank) && !Array.isArray(rerank?.data)) {
  throw new Error('rerank endpoint returned no ranking array')
}
console.log('[ok] rerank returned ranking data')

const answer = await requestJson('POST', `_inference/completion/${config.llmInferenceId}?timeout=300s`, {
  input: [
    '只根据证据回答：有没有讲节俭家风的帖子？',
    '证据：朱子治家格言提到一粥一饭，当思来处不易；半丝半缕，恒念物力维艰。',
  ].join('\n'),
  task_settings: { temperature: 0.1, max_new_tokens: 120 },
})
const text = completionText(answer)
if (!text) throw new Error('LLM endpoint returned empty answer')
console.log(`[ok] llm answer returned ${text.length} chars`)
console.log('[verify-tencent-rag] Done')
