import { createHash, createHmac } from 'node:crypto'

const HOST = 'es.tencentcloudapi.com'
const SERVICE = 'es'
const ACTION = 'DescribeServerlessInstances'
const VERSION = '2018-04-16'
const DEFAULT_TIMEOUT_MS = 10_000

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function hmac(key, value, encoding) {
  return createHmac('sha256', key).update(value, 'utf8').digest(encoding)
}

function requiredString(value, name) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(`Tencent ES control ${name} is required`)
  return normalized
}

function safeProviderCode(value) {
  const code = String(value || '')
  return /^[A-Za-z0-9._-]{1,100}$/.test(code) ? code : 'unknown'
}

function signRequest({ secretId, secretKey, region, body, timestamp }) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const contentType = 'application/json; charset=utf-8'
  const canonicalHeaders = `content-type:${contentType}\nhost:${HOST}\n`
  const signedHeaders = 'content-type;host'
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256(body)].join('\n')
  const credentialScope = `${date}/${SERVICE}/tc3_request`
  const stringToSign = ['TC3-HMAC-SHA256', timestamp, credentialScope, sha256(canonicalRequest)].join('\n')
  const secretDate = hmac(`TC3${secretKey}`, date)
  const secretService = hmac(secretDate, SERVICE)
  const secretSigning = hmac(secretService, 'tc3_request')
  const signature = hmac(secretSigning, stringToSign, 'hex')

  return {
    Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'Content-Type': contentType,
    Host: HOST,
    'X-TC-Action': ACTION,
    'X-TC-Version': VERSION,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Region': region,
  }
}

async function fetchJsonWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController()
  const invalidJson = Symbol('invalid-json')
  let timedOut = false
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new Error('Tencent ES control request timed out'))
    }, timeoutMs)
  })

  try {
    return await Promise.race([
      Promise.resolve().then(async () => {
        const response = await fetchImpl(url, { ...init, signal: controller.signal })
        if (response?.ok !== true) return { response, payload: undefined }
        try {
          return { response, payload: await response.json() }
        } catch {
          throw invalidJson
        }
      }),
      timeout,
    ])
  } catch (error) {
    if (timedOut) throw new Error('Tencent ES control request timed out')
    if (error === invalidJson) throw new Error('Tencent ES control response is not valid JSON')
    throw new Error('Tencent ES control request failed')
  } finally {
    clearTimeout(timer)
  }
}

export async function readTencentServerlessIndexMappings({
  secretId,
  secretKey,
  region,
  indexName,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) {
  const normalizedSecretId = requiredString(secretId, 'secretId')
  const normalizedSecretKey = requiredString(secretKey, 'secretKey')
  const normalizedRegion = requiredString(region, 'region')
  const normalizedIndexName = requiredString(indexName, 'indexName')
  if (typeof fetchImpl !== 'function') throw new Error('Tencent ES control fetch is required')
  if (typeof now !== 'function') throw new Error('Tencent ES control now is required')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Tencent ES control timeout must be a positive integer')

  const nowMs = Number(now())
  if (!Number.isFinite(nowMs)) throw new Error('Tencent ES control clock is invalid')
  const timestamp = Math.floor(nowMs / 1000)
  const body = JSON.stringify({ IndexNames: [normalizedIndexName], Limit: 1 })
  const headers = signRequest({
    secretId: normalizedSecretId,
    secretKey: normalizedSecretKey,
    region: normalizedRegion,
    body,
    timestamp,
  })
  const { response, payload } = await fetchJsonWithTimeout(fetchImpl, `https://${HOST}/`, {
    method: 'POST',
    headers,
    body,
  }, timeoutMs)

  if (response?.ok !== true) {
    const status = Number.isInteger(response?.status) ? response.status : 'unknown'
    throw new Error(`Tencent ES control HTTP ${status}`)
  }

  const providerResponse = payload?.Response
  if (!providerResponse || typeof providerResponse !== 'object' || Array.isArray(providerResponse)) {
    throw new Error('Tencent ES control response is invalid')
  }
  if (providerResponse.Error) {
    throw new Error(`Tencent ES provider error: ${safeProviderCode(providerResponse.Error.Code)}`)
  }
  if (!Array.isArray(providerResponse.IndexMetaFields)) {
    throw new Error('Tencent ES control IndexMetaFields is invalid')
  }

  const exact = providerResponse.IndexMetaFields.find((field) => field?.IndexName === normalizedIndexName)
  if (!exact) throw new Error('Tencent ES control exact index was not found')
  if (typeof exact.IndexMetaJson !== 'string' || !exact.IndexMetaJson.trim()) {
    throw new Error('Tencent ES control IndexMetaJson is missing')
  }

  let indexMeta
  try {
    indexMeta = JSON.parse(exact.IndexMetaJson)
  } catch {
    throw new Error('Tencent ES control IndexMetaJson is invalid')
  }
  const mappings = indexMeta?.mappings
  if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) {
    throw new Error('Tencent ES control mappings is invalid')
  }
  return mappings
}
