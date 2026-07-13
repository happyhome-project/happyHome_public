import { createHash, createHmac } from 'node:crypto'
import https from 'https'
import * as db from './db'
import { createVersionedTencentEsRagSink } from './post-rag-versioned-index-sink'
import { extractEmbeddingVectors, readTencentRagConfigFromEnv, type TencentRagAtomicRequestJson, type TencentRagConfig } from './post-rag'

type JsonRecord = Record<string, any>
type CloudDatabase = Pick<typeof db, 'runTransaction' | 'transactionGetByIdOrNull' | 'getById' | 'queryAfterId' | 'create' | 'updateById' | 'removeById'>
type SinkRequest = (method: string, path: string, body?: unknown, options?: { contentType?: string }) => Promise<any>

export type PostRagV2RuntimeErrorCode = 'NOT_CONFIGURED' | 'ATOMIC_TIMEOUT' | 'ATOMIC_RESPONSE_TOO_LARGE'
  | 'ATOMIC_HTTP_ERROR' | 'ATOMIC_INVALID_RESPONSE' | 'ATOMIC_PROVIDER_ERROR' | 'ATOMIC_REQUEST_FAILED'

const RUNTIME_ERROR_MESSAGES: Record<PostRagV2RuntimeErrorCode, string> = {
  NOT_CONFIGURED: 'RAG v2 runtime is not configured',
  ATOMIC_TIMEOUT: 'RAG v2 embedding request timed out',
  ATOMIC_RESPONSE_TOO_LARGE: 'RAG v2 embedding response exceeded the size limit',
  ATOMIC_HTTP_ERROR: 'RAG v2 embedding service returned an error',
  ATOMIC_INVALID_RESPONSE: 'RAG v2 embedding response is invalid',
  ATOMIC_PROVIDER_ERROR: 'RAG v2 embedding provider rejected the request',
  ATOMIC_REQUEST_FAILED: 'RAG v2 embedding request failed',
}

export class PostRagV2RuntimeError extends Error {
  constructor(readonly code: PostRagV2RuntimeErrorCode = 'NOT_CONFIGURED') {
    super(RUNTIME_ERROR_MESSAGES[code]); this.name = 'PostRagV2RuntimeError'
  }
}

type AtomicTransportResponse = { status: number; body: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array> | null }
export type PostRagV2AtomicTransport = (url: string, init: {
  method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal
}) => Promise<AtomicTransportResponse>

function sha256(value: string) { return createHash('sha256').update(value).digest('hex') }
function hmac(key: Buffer | string, value: string) { return createHmac('sha256', key).update(value).digest() }

async function readBoundedBody(body: AtomicTransportResponse['body'], maxBytes: number): Promise<string> {
  if (!body || !(Symbol.asyncIterator in body)) throw new PostRagV2RuntimeError('ATOMIC_INVALID_RESPONSE')
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    const data = Buffer.from(chunk); size += data.length
    if (size > maxBytes) throw new PostRagV2RuntimeError('ATOMIC_RESPONSE_TOO_LARGE')
    chunks.push(data)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function createTencentAtomicEmbeddingRequester(options: {
  transport?: PostRagV2AtomicTransport; timeoutMs?: number; maxResponseBytes?: number; now?: () => number
} = {}): TencentRagAtomicRequestJson {
  const timeoutMs = options.timeoutMs ?? 10_000
  const maxResponseBytes = options.maxResponseBytes ?? 2 * 1024 * 1024
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000
    || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 2 * 1024 * 1024) {
    throw new PostRagV2RuntimeError()
  }
  const transport = options.transport || (async (url, init) => {
    const response = await fetch(url, init)
    return { status: response.status, body: response.body }
  })
  const now = options.now || Date.now
  return async <T>(config: TencentRagConfig, action: string, body: unknown): Promise<T> => {
    if (action !== 'GetTextEmbedding' || !configured(config.atomicSecretId) || !configured(config.atomicSecretKey)
      || !configured(config.atomicRegion)) throw new PostRagV2RuntimeError()
    const host = 'es.tencentcloudapi.com'; const service = 'es'; const version = '2025-01-01'
    const timestamp = Math.floor(now() / 1000); const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
    const payload = JSON.stringify(body)
    const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`
    const signedHeaders = 'content-type;host'
    const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256(payload)].join('\n')
    const credentialScope = `${date}/${service}/tc3_request`
    const stringToSign = ['TC3-HMAC-SHA256', timestamp, credentialScope, sha256(canonicalRequest)].join('\n')
    const secretDate = hmac(`TC3${config.atomicSecretKey}`, date)
    const secretService = hmac(secretDate, service)
    const secretSigning = hmac(secretService, 'tc3_request')
    const signature = createHmac('sha256', secretSigning).update(stringToSign).digest('hex')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    timer.unref?.()
    try {
      const response = await transport(`https://${host}/`, { method: 'POST', signal: controller.signal, body: payload, headers: {
        Authorization: `TC3-HMAC-SHA256 Credential=${config.atomicSecretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        'Content-Type': 'application/json; charset=utf-8', Host: host, 'X-TC-Action': action,
        'X-TC-Version': version, 'X-TC-Timestamp': String(timestamp), 'X-TC-Region': config.atomicRegion!,
      } })
      const text = await readBoundedBody(response.body, maxResponseBytes)
      if (response.status < 200 || response.status >= 300) throw new PostRagV2RuntimeError('ATOMIC_HTTP_ERROR')
      let parsed: any
      try { parsed = JSON.parse(text) } catch { throw new PostRagV2RuntimeError('ATOMIC_INVALID_RESPONSE') }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new PostRagV2RuntimeError('ATOMIC_INVALID_RESPONSE')
      if (parsed.Response?.Error) throw new PostRagV2RuntimeError('ATOMIC_PROVIDER_ERROR')
      return parsed as T
    } catch (error) {
      if (error instanceof PostRagV2RuntimeError) throw error
      if (controller.signal.aborted) throw new PostRagV2RuntimeError('ATOMIC_TIMEOUT')
      throw new PostRagV2RuntimeError('ATOMIC_REQUEST_FAILED')
    } finally { clearTimeout(timer) }
  }
}

function configured(value: unknown) { return typeof value === 'string' && value.trim().length > 0 }

export function createRawEsRequest(options: {
  endpoint: string; username: string; password: string; timeoutMs?: number; maxResponseBytes?: number
}): SinkRequest {
  const endpoint = new URL(options.endpoint)
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new PostRagV2RuntimeError()
  const timeoutMs = options.timeoutMs ?? 10_000
  const maxResponseBytes = options.maxResponseBytes ?? 2 * 1024 * 1024
  const authorization = `Basic ${Buffer.from(`${options.username}:${options.password}`).toString('base64')}`
  return async (method, path, body, requestOptions) => {
    const url = new URL(path.replace(/^\/+/, ''), `${endpoint.toString().replace(/\/+$/, '')}/`)
    const payload = body === undefined ? Buffer.alloc(0) : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
    return new Promise((resolve, reject) => {
      let settled = false
      const fail = () => { if (!settled) { settled = true; reject(new Error('RAG ES request failed')) } }
      const req = https.request(url, { method, headers: {
        Authorization: authorization,
        'Content-Type': requestOptions?.contentType || 'application/json',
        ...(payload.length ? { 'Content-Length': payload.length } : {}),
      } }, res => {
        const chunks: Buffer[] = []; let size = 0
        res.on('data', chunk => {
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += data.length
          if (size > maxResponseBytes) { req.destroy(); fail(); return }
          chunks.push(data)
        })
        res.on('end', () => {
          if (settled) return
          if ((res.statusCode || 500) >= 400) { fail(); return }
          try { const text = Buffer.concat(chunks).toString('utf8'); settled = true; resolve(text ? JSON.parse(text) : {}) } catch { fail() }
        })
        res.on('error', fail)
      })
      req.setTimeout(timeoutMs, () => { req.destroy(); fail() })
      req.on('error', fail)
      if (payload.length) req.write(payload)
      req.end()
    })
  }
}

function createDatabaseAdapter(database: CloudDatabase) {
  const setById = async (collection: string, id: string, data: JsonRecord) => {
    const payload = { ...data }; delete payload._id
    const updated = await database.updateById(collection, id, payload) as any
    if (Number(updated?.stats?.updated || 0) > 0) return
    try { if (await database.getById(collection, id)) return } catch { /* missing document */ }
    try { await database.create(collection, { _id: id, ...payload }) }
    catch {
      const retried = await database.updateById(collection, id, payload) as any
      if (Number(retried?.stats?.updated || 0) === 0) throw new Error('database set failed')
    }
  }
  return {
    runTransaction: <T>(operation: (tx: any) => Promise<T>) => database.runTransaction(transaction => operation({
      getById: (collection: string, id: string) => database.transactionGetByIdOrNull(transaction, collection, id),
      setById: (collection: string, id: string, data: JsonRecord) => transaction.collection(collection).doc(id).set({ data: (() => { const copy = { ...data }; delete copy._id; return copy })() }),
    })),
    setById,
    queryAfterId: (collection: string, where: JsonRecord, afterId: string | null, limit: number) => database.queryAfterId(collection, where, afterId, limit),
    removeById: (collection: string, id: string) => database.removeById(collection, id).then(() => undefined),
  }
}

export function createPostRagV2RuntimeFromEnv(options: {
  env?: NodeJS.ProcessEnv; database?: CloudDatabase; requestAtomicJson?: TencentRagAtomicRequestJson; requestJson?: SinkRequest
  atomicTransport?: PostRagV2AtomicTransport; atomicTimeoutMs?: number; atomicMaxResponseBytes?: number
} = {}) {
  const env = options.env || process.env
  const requiredEnv = ['TENCENT_RAG_ES_ENDPOINT', 'TENCENT_RAG_ES_USERNAME', 'TENCENT_RAG_ES_PASSWORD', 'TENCENT_RAG_INDEX_NAME', 'TENCENT_RAG_EMBEDDING_MODEL']
  if (!requiredEnv.every(key => configured(env[key]))
    || !configured(env.TENCENT_RAG_ATOMIC_SECRET_ID || env.TENCENTCLOUD_SECRETID)
    || !configured(env.TENCENT_RAG_ATOMIC_SECRET_KEY || env.TENCENTCLOUD_SECRETKEY)) throw new PostRagV2RuntimeError()
  const config = readTencentRagConfigFromEnv(env)
  if (config.vectorField !== 'embedding') throw new PostRagV2RuntimeError()
  if (![config.endpoint, config.username, config.password, config.indexName, config.atomicSecretId, config.atomicSecretKey, config.atomicRegion, config.embeddingModel].every(configured)) {
    throw new PostRagV2RuntimeError()
  }
  let parsed: URL
  try { parsed = new URL(config.endpoint) } catch { throw new PostRagV2RuntimeError() }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !/^[a-z0-9][a-z0-9._-]*$/.test(config.indexName)) throw new PostRagV2RuntimeError()
  const database = options.database || db
  const requestJson = options.requestJson || createRawEsRequest({ endpoint: config.endpoint, username: config.username, password: config.password })
  const atomic = options.requestAtomicJson || createTencentAtomicEmbeddingRequester({
    transport: options.atomicTransport, timeoutMs: options.atomicTimeoutMs, maxResponseBytes: options.atomicMaxResponseBytes,
  })
  const embedTexts = async (texts: string[]) => {
    try {
      const response = await atomic(config, 'GetTextEmbedding', { ModelName: config.embeddingModel, Texts: texts })
      const vectors = extractEmbeddingVectors(response)
      if (vectors.length !== texts.length || vectors.some(vector => !vector.length || vector.some(value => !Number.isFinite(value)))) {
        throw new PostRagV2RuntimeError('ATOMIC_INVALID_RESPONSE')
      }
      return vectors
    } catch (error) {
      if (error instanceof PostRagV2RuntimeError) throw error
      throw new PostRagV2RuntimeError('ATOMIC_REQUEST_FAILED')
    }
  }
  const sink = createVersionedTencentEsRagSink({ database: createDatabaseAdapter(database), requestJson, embedTexts, indexName: config.indexName })
  return { sink, embedTexts }
}
