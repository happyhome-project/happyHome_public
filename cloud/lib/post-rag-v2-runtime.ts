import https from 'https'
import * as db from './db'
import { createVersionedTencentEsRagSink } from './post-rag-versioned-index-sink'
import { extractEmbeddingVectors, readTencentRagConfigFromEnv, requestTencentEsAtomic, type TencentRagAtomicRequestJson } from './post-rag'

type JsonRecord = Record<string, any>
type CloudDatabase = Pick<typeof db, 'runTransaction' | 'transactionGetByIdOrNull' | 'getById' | 'queryAfterId' | 'create' | 'updateById' | 'removeById'>
type SinkRequest = (method: string, path: string, body?: unknown, options?: { contentType?: string }) => Promise<any>

export class PostRagV2RuntimeError extends Error {
  constructor(message = 'RAG v2 runtime is not configured') { super(message); this.name = 'PostRagV2RuntimeError' }
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
  const atomic = options.requestAtomicJson || requestTencentEsAtomic
  const embedTexts = async (texts: string[]) => {
    const response = await atomic(config, 'GetTextEmbedding', { ModelName: config.embeddingModel, Texts: texts })
    const vectors = extractEmbeddingVectors(response)
    if (vectors.length !== texts.length || vectors.some(vector => !vector.length || vector.some(value => !Number.isFinite(value)))) throw new Error('RAG embedding response is invalid')
    return vectors
  }
  const sink = createVersionedTencentEsRagSink({ database: createDatabaseAdapter(database), requestJson, embedTexts, indexName: config.indexName })
  return { sink, embedTexts }
}
