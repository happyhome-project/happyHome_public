#!/usr/bin/env node
import crypto from 'node:crypto'
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

const LKEAP_ENV_FILE = path.join(os.homedir(), '.happyhome', 'tencent-lkeap.env')
const fileEnv = loadDotEnvFile(LKEAP_ENV_FILE)
const env = { ...fileEnv, ...process.env }

const config = {
  secretId: String(env.TENCENTCLOUD_SECRETID || '').trim(),
  secretKey: String(env.TENCENTCLOUD_SECRETKEY || ''),
  region: String(env.TENCENT_LKEAP_REGION || 'ap-guangzhou').trim(),
}

const missing = Object.entries(config)
  .filter(([, value]) => !value)
  .map(([key]) => key)

if (missing.length > 0) {
  console.error(`[verify-tencent-lkeap] Missing config: ${missing.join(', ')}`)
  console.error(`  Expected file: ${LKEAP_ENV_FILE}`)
  process.exit(1)
}

function sha256(message, encoding = 'hex') {
  return crypto.createHash('sha256').update(message, 'utf8').digest(encoding)
}

function hmac(key, message, encoding) {
  return crypto.createHmac('sha256', key).update(message, 'utf8').digest(encoding)
}

async function callTencent(action, payload, region = config.region) {
  const host = 'lkeap.tencentcloudapi.com'
  const service = 'lkeap'
  const version = '2024-05-22'
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const body = JSON.stringify(payload)
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`
  const signedHeaders = 'content-type;host'
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256(body)].join('\n')
  const credentialScope = `${date}/${service}/tc3_request`
  const stringToSign = ['TC3-HMAC-SHA256', timestamp, credentialScope, sha256(canonicalRequest)].join('\n')
  const secretDate = hmac(`TC3${config.secretKey}`, date)
  const secretService = hmac(secretDate, service)
  const secretSigning = hmac(secretService, 'tc3_request')
  const signature = hmac(secretSigning, stringToSign, 'hex')
  const authorization = `TC3-HMAC-SHA256 Credential=${config.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const res = await fetch(`https://${host}/`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json; charset=utf-8',
      Host: host,
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': region,
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

function cosine(left, right) {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  const len = Math.min(left.length, right.length)
  for (let index = 0; index < len; index += 1) {
    dot += left[index] * right[index]
    leftNorm += left[index] * left[index]
    rightNorm += right[index] * right[index]
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

console.log('[verify-tencent-lkeap] Checking LKEAP atomic APIs')

const query = '有没有讲节俭家风的帖子？'
const docs = [
  '帖子标题：朱子治家格言。正文：一粥一饭，当思来处不易；半丝半缕，恒念物力维艰。主题是勤俭持家和家风教育。',
  '帖子标题：露营装备视频。正文：今天分享帐篷收纳和炉具使用视频，适合周末户外。',
  '帖子标题：亲子阅读。正文：孩子今天背诵论语学而篇，讨论学习方法。',
]

const queryEmbedding = await callTencent('GetEmbedding', {
  Model: 'lke-text-embedding-v2',
  Inputs: [query],
  TextType: 'query',
})
const queryVector = queryEmbedding.Data?.[0]?.Embedding || []
if (!Array.isArray(queryVector) || queryVector.length <= 0) {
  throw new Error('GetEmbedding returned no query vector')
}
console.log(`[ok] embedding query vector dimension: ${queryVector.length}`)

const docEmbedding = await callTencent('GetEmbedding', {
  Model: 'lke-text-embedding-v2',
  Inputs: docs,
  TextType: 'document',
})
const docVectors = (docEmbedding.Data || []).map((item) => item.Embedding || [])
if (docVectors.length !== docs.length || docVectors.some((vector) => !Array.isArray(vector) || vector.length <= 0)) {
  throw new Error('GetEmbedding returned incomplete document vectors')
}
const similarities = docVectors.map((vector, index) => ({ index, score: cosine(queryVector, vector) }))
  .sort((left, right) => right.score - left.score)
console.log(`[ok] embedding semantic top index: ${similarities[0].index}`)

const rerank = await callTencent('RunRerank', {
  Query: query,
  Docs: docs,
  Model: 'lke-reranker-base',
})
if (!Array.isArray(rerank.ScoreList) || rerank.ScoreList.length !== docs.length) {
  throw new Error('RunRerank returned no score list')
}
console.log(`[ok] rerank returned scores: ${rerank.ScoreList.map((score) => Number(score).toFixed(4)).join(', ')}`)

const chat = await callTencent('ChatCompletions', {
  Model: 'deepseek-v3-0324',
  Messages: [{ Role: 'user', Content: '请回答 1+1 的结果，只输出一个数字。' }],
  Stream: false,
  MaxTokens: 32,
  Temperature: 0,
})
const answer = String(chat.Choices?.[0]?.Message?.Content || chat.Choices?.[0]?.Content || '').trim()
if (!answer.includes('2')) {
  throw new Error(`ChatCompletions returned unexpected answer: ${answer.slice(0, 80)}`)
}
console.log(`[ok] chat answer returned: ${answer.slice(0, 80)}`)
console.log('[verify-tencent-lkeap] Done')

