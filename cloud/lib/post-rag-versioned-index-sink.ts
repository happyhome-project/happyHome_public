
import { createHash } from 'node:crypto'
import type { PostRagSourceProjection } from './post-rag-indexing'
import type { PostRagJobDocument } from './post-rag-jobs'

export type PostRagActivationOrder = Readonly<{ contentVersion: number; jobId: string }>

export function comparePostRagActivationOrder(left: PostRagActivationOrder, right: PostRagActivationOrder): -1 | 0 | 1 {
  if (left.contentVersion !== right.contentVersion) return left.contentVersion < right.contentVersion ? -1 : 1
  if (left.jobId === right.jobId) return 0
  return left.jobId < right.jobId ? -1 : 1
}

export interface PostRagVersionedIndexSink {
  stageUpsert(input: { projection: PostRagSourceProjection; job: PostRagJobDocument; jobId: string; leaseToken: string }): Promise<void>
  inspectStaged(input: { postId: string; sourceVersion: string; jobId: string; leaseToken: string }): Promise<{ chunkCount: number; chunkChecksum: string }>
  activate(input: { postId: string; sourceVersion: string; activationOrder: PostRagActivationOrder; jobId: string; leaseToken: string }): Promise<{ activated: boolean }>
  cleanupOldVersions(input: { postId: string; keepSourceVersion: string; activationOrder: PostRagActivationOrder; jobId: string; leaseToken: string }): Promise<void>
  remove(input: { postId: string; sourceVersion: string; activationOrder: PostRagActivationOrder }): Promise<{ removed: boolean }>
}

type JsonRecord = Record<string, any>

type Database = {
  runTransaction<T>(operation: (transaction: {
    getById(collection: string, id: string): Promise<JsonRecord | null>
    setById(collection: string, id: string, data: JsonRecord): Promise<void>
  }) => Promise<T>): Promise<T>
  queryAfterId(collection: string, where: JsonRecord, afterId: string | null, limit: number): Promise<JsonRecord[]>
  removeById(collection: string, id: string): Promise<void>
}

type RequestJson = (method: string, path: string, body?: unknown, options?: { contentType?: string }) => Promise<any>

export type PostRagVersionedSinkErrorCode =
  | 'VALIDATION_FAILED' | 'EMBEDDING_INVALID' | 'ES_BULK_FAILED' | 'ES_INSPECTION_FAILED'
  | 'ES_DELETE_FAILED' | 'STATE_INVALID' | 'ACTIVATION_CONFLICT' | 'LEASE_LOST'

const authenticatedErrors = new WeakSet<object>()

export class PostRagVersionedSinkError extends Error {
  constructor(readonly code: PostRagVersionedSinkErrorCode, readonly cleanupCode?: PostRagVersionedSinkErrorCode) {
    super('Versioned RAG index operation failed')
    this.name = 'PostRagVersionedSinkError'
    authenticatedErrors.add(this)
  }
}

export function isPostRagVersionedSinkError(value: unknown): value is PostRagVersionedSinkError {
  return Boolean(value && typeof value === 'object' && authenticatedErrors.has(value as object))
}

function fail(code: PostRagVersionedSinkErrorCode): never { throw new PostRagVersionedSinkError(code) }

function safeIdentifier(value: unknown, maxLength = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value)
}

function requireIdentifier(value: unknown) { if (!safeIdentifier(value)) fail('VALIDATION_FAILED') }

function validOrder(value: unknown): value is PostRagActivationOrder {
  if (!value || typeof value !== 'object') return false
  const order = value as PostRagActivationOrder
  return Number.isSafeInteger(order.contentVersion) && order.contentVersion >= 0 && safeIdentifier(order.jobId)
}

type State = {
  schemaVersion: 2
  postId: string
  state: 'active' | 'removed'
  sourceVersion: string
  attemptId?: string
  activatedAt?: string
  activationOrder: PostRagActivationOrder
}

function parseState(value: JsonRecord | null, postId: string): State | null {
  if (!value) return null
  if (value.schemaVersion !== 2 || value.postId !== postId || (value.state !== 'active' && value.state !== 'removed')
    || !safeIdentifier(value.sourceVersion) || !validOrder(value.activationOrder)
    || (value.state === 'active' && (!safeIdentifier(value.attemptId) || !validTimestamp(value.activatedAt)))) fail('STATE_INVALID')
  return value as State
}

function assertProjection(projection: PostRagSourceProjection, job: PostRagJobDocument) {
  if (!projection?.eligible || !safeIdentifier(projection.sourceVersion) || !safeIdentifier(projection.retrievalIndexVersion)
    || !safeIdentifier(projection.chunkChecksum) || !Array.isArray(projection.chunks)
    || projection.chunkCount !== projection.chunks.length || projection.sourceVersion !== job?.sourceVersion
    || !safeIdentifier(job?.postId) || !validOrder({ contentVersion: job?.contentVersion, jobId: job?._id })) fail('VALIDATION_FAILED')
  for (const chunk of projection.chunks) {
    if (!safeIdentifier(chunk.postId) || chunk.postId !== job.postId || chunk.communityId !== job.communityId
      || chunk.sectionId !== job.sectionId || !safeIdentifier(chunk.sourceVersion)
      || chunk.sourceVersion !== projection.sourceVersion || !safeIdentifier(chunk.chunkId)
      || !safeIdentifier(chunk.chunkChecksum) || typeof chunk.text !== 'string') fail('VALIDATION_FAILED')
  }
}

function validEmbedding(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'number' && Number.isFinite(item))
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as JsonRecord)[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function derivePostRagIndexAttemptId(jobId: string, leaseToken: string): string {
  if (!safeIdentifier(jobId) || !safeIdentifier(leaseToken)) fail('VALIDATION_FAILED')
  return createHash('sha256').update(jobId).update('\0').update(leaseToken).digest('hex').slice(0, 32)
}

export function createVersionedTencentEsRagSink(options: {
  database: Database
  requestJson: RequestJson
  embedTexts(texts: string[]): Promise<number[][]>
  indexName: string
  embeddingBatchSize?: number
  mirrorPageSize?: number
  deleteBatchSize?: number
}): PostRagVersionedIndexSink {
  const { database, requestJson, embedTexts } = options
  if (typeof options.indexName !== 'string' || options.indexName.length > 255
    || !/^[a-z0-9][a-z0-9._-]*$/.test(options.indexName)) fail('VALIDATION_FAILED')
  const embeddingBatchSize = options.embeddingBatchSize ?? 16
  const mirrorPageSize = options.mirrorPageSize ?? 100
  const deleteBatchSize = options.deleteBatchSize ?? 100
  if (!Number.isSafeInteger(embeddingBatchSize) || embeddingBatchSize < 1 || embeddingBatchSize > 100
    || !Number.isSafeInteger(mirrorPageSize) || mirrorPageSize < 1 || mirrorPageSize > 500
    || !Number.isSafeInteger(deleteBatchSize) || deleteBatchSize < 1 || deleteBatchSize > 500) fail('VALIDATION_FAILED')

  type Mirror = JsonRecord & { _id: string; esDocumentId: string; attemptId: string; stagedAt: string; activationOrder: PostRagActivationOrder }

  async function listMirrors(postId: string): Promise<Mirror[]> {
    const mirrors: Mirror[] = []
    let afterId: string | null = null
    for (;;) {
      const page = await database.queryAfterId('post_rag_index_versions', { schemaVersion: 2, postId }, afterId, mirrorPageSize)
      for (const doc of page) {
        if (!safeIdentifier(doc._id) || !safeIdentifier(doc.esDocumentId) || doc.postId !== postId || doc.schemaVersion !== 2
          || !safeIdentifier(doc.sourceVersion) || !safeIdentifier(doc.attemptId) || !validTimestamp(doc.stagedAt)
          || !validOrder(doc.activationOrder)) fail('STATE_INVALID')
        mirrors.push(doc as Mirror)
      }
      if (page.length < mirrorPageSize) return mirrors
      afterId = page[page.length - 1]._id
    }
  }

  async function deleteMirrorsFromEs(mirrors: Mirror[], beforeBatch?: () => Promise<void>) {
    for (let offset = 0; offset < mirrors.length; offset += deleteBatchSize) {
      if (beforeBatch) await beforeBatch()
      const ids = mirrors.slice(offset, offset + deleteBatchSize).map((mirror) => mirror.esDocumentId)
      let response: any
      try { response = await requestJson('POST', `${options.indexName}/_delete_by_query`, { query: { ids: { values: ids } } }) }
      catch { fail('ES_DELETE_FAILED') }
      if (!response || typeof response !== 'object' || Array.isArray(response)
        || response.timed_out !== false || !Number.isSafeInteger(response.deleted) || response.deleted < 0
        || !Array.isArray(response.failures) || response.failures.length !== 0) fail('ES_DELETE_FAILED')
    }
  }

  async function deleteExplicitIds(ids: string[]) {
    if (ids.length === 0) return
    let response: any
    try { response = await requestJson('POST', `${options.indexName}/_delete_by_query`, { query: { ids: { values: ids } } }) }
    catch { fail('ES_DELETE_FAILED') }
    if (!response || response.timed_out !== false || !Number.isSafeInteger(response.deleted) || response.deleted < 0
      || !Array.isArray(response.failures) || response.failures.length !== 0) fail('ES_DELETE_FAILED')
  }

  async function cleanupAttemptAndFail(code: PostRagVersionedSinkErrorCode, ids: string[]): Promise<never> {
    try { await deleteExplicitIds(ids) }
    catch (cleanupError) {
      const cleanupCode = cleanupError instanceof PostRagVersionedSinkError ? cleanupError.code : 'ES_DELETE_FAILED'
      throw new PostRagVersionedSinkError(code, cleanupCode)
    }
    fail(code)
  }

  function leaseMatches(value: JsonRecord | null, jobId: string, leaseToken: string) {
    return Boolean(value && value.schemaVersion === 2 && value._id === jobId && value.status === 'processing'
      && value.leaseToken === leaseToken && typeof value.leaseExpiresAt === 'string'
      && Date.parse(value.leaseExpiresAt) > Date.now())
  }

  async function hasLease(jobId: string, leaseToken: string) {
    if (!safeIdentifier(jobId) || !safeIdentifier(leaseToken)) return false
    return database.runTransaction(async (tx) => leaseMatches(await tx.getById('post_rag_jobs', jobId), jobId, leaseToken))
  }

  async function getActiveLease(jobId: string, leaseToken: string) {
    if (!safeIdentifier(jobId) || !safeIdentifier(leaseToken)) return null
    return database.runTransaction(async (tx) => {
      const lease = await tx.getById('post_rag_jobs', jobId)
      return leaseMatches(lease, jobId, leaseToken) && validTimestamp(lease?.updatedAt) ? lease : null
    })
  }

  async function removeMirrorRows(mirrors: Mirror[]) {
    for (const mirror of mirrors) await database.removeById('post_rag_index_versions', mirror._id)
  }

  async function currentMatches(postId: string, sourceVersion: string, order: PostRagActivationOrder, state: State['state'], attemptId?: string) {
    const current = parseState(await database.runTransaction((tx) => tx.getById('post_rag_index_state_v2', postId)), postId)
    return Boolean(current && current.state === state && current.sourceVersion === sourceVersion
      && comparePostRagActivationOrder(current.activationOrder, order) === 0
      && (state !== 'active' || current.attemptId === attemptId))
  }

  return {
    async stageUpsert({ projection, job, jobId, leaseToken }) {
      assertProjection(projection, job)
      const lease = await getActiveLease(jobId, leaseToken)
      if (jobId !== job._id || !lease) fail('LEASE_LOST')
      const attemptId = derivePostRagIndexAttemptId(jobId, leaseToken)
      const stagedAt = lease.updatedAt
      const embeddings: number[][] = []
      for (let offset = 0; offset < projection.chunks.length; offset += embeddingBatchSize) {
        if (!await hasLease(jobId, leaseToken)) fail('LEASE_LOST')
        const batch = projection.chunks.slice(offset, offset + embeddingBatchSize)
        let output: number[][]
        try { output = await embedTexts(batch.map((chunk) => chunk.text)) } catch { fail('EMBEDDING_INVALID') }
        if (!Array.isArray(output) || output.length !== batch.length || output.some((vector) => !validEmbedding(vector))) fail('EMBEDDING_INVALID')
        embeddings.push(...output)
        if (!await hasLease(jobId, leaseToken)) fail('LEASE_LOST')
      }
      const lines: string[] = []
      const documents = new Map<string, JsonRecord>()
      projection.chunks.forEach((chunk, index) => {
        const id = `${chunk.postId}:${projection.sourceVersion}:${attemptId}:${chunk.chunkId}`
        const document = { ...chunk, indexAttemptId: attemptId, stagedAt, projectionChecksum: projection.chunkChecksum, embedding: embeddings[index] }
        documents.set(id, document)
        lines.push(JSON.stringify({ create: { _id: id } }))
        lines.push(JSON.stringify(document))
      })
      const documentIds = [...documents.keys()]
      let response: any
      if (!await hasLease(jobId, leaseToken)) fail('LEASE_LOST')
      try {
        response = await requestJson('POST', `${options.indexName}/_bulk?refresh=wait_for`, `${lines.join('\n')}\n`, { contentType: 'application/x-ndjson' })
      } catch { await cleanupAttemptAndFail('ES_BULK_FAILED', documentIds) }
      if (!Array.isArray(response?.items) || response.items.length !== projection.chunks.length) {
        await cleanupAttemptAndFail('ES_BULK_FAILED', documentIds)
      }
      const conflicts: string[] = []
      let hasFailure = false
      for (let index = 0; index < response.items.length; index += 1) {
        const result = response.items[index]?.create
        if (!result || !Number.isSafeInteger(result.status)) { hasFailure = true; continue }
        if (result.status === 409) conflicts.push(documentIds[index])
        else if (result.status < 200 || result.status >= 300) hasFailure = true
      }
      if (hasFailure) {
        await cleanupAttemptAndFail('ES_BULK_FAILED', documentIds)
      }
      if (!await hasLease(jobId, leaseToken)) {
        await cleanupAttemptAndFail('LEASE_LOST', documentIds)
      }
      if (conflicts.length > 0) {
        let existing: any
        try { existing = await requestJson('POST', `${options.indexName}/_mget`, { ids: conflicts }) }
        catch { await cleanupAttemptAndFail('ES_BULK_FAILED', documentIds) }
        if (!Array.isArray(existing?.docs) || existing.docs.length !== conflicts.length) {
          await cleanupAttemptAndFail('ES_BULK_FAILED', documentIds)
        }
        for (let index = 0; index < conflicts.length; index += 1) {
          const doc = existing.docs[index]
          if (doc?._id !== conflicts[index] || doc?.found !== true
            || canonicalJson(doc._source) !== canonicalJson(documents.get(conflicts[index]))) {
            await cleanupAttemptAndFail('ACTIVATION_CONFLICT', documentIds)
          }
        }
        if (!await hasLease(jobId, leaseToken)) {
          await cleanupAttemptAndFail('LEASE_LOST', documentIds)
        }
      }
      const mirrors = projection.chunks.map((chunk) => {
        const id = `${chunk.postId}:${projection.sourceVersion}:${attemptId}:${chunk.chunkId}`
        return {
          _id: id, esDocumentId: id, schemaVersion: 2, postId: chunk.postId, communityId: chunk.communityId,
          sectionId: chunk.sectionId, sourceVersion: projection.sourceVersion, chunkId: chunk.chunkId,
          attemptId, stagedAt,
          chunkChecksum: chunk.chunkChecksum, projectionChecksum: projection.chunkChecksum,
          activationOrder: { contentVersion: job.contentVersion, jobId: job._id },
        }
      })
      try {
        await database.runTransaction(async (tx) => {
          if (!leaseMatches(await tx.getById('post_rag_jobs', jobId), jobId, leaseToken)) fail('LEASE_LOST')
          for (const mirror of mirrors) {
            const existing = await tx.getById('post_rag_index_versions', mirror._id)
            if (existing) {
              if (canonicalJson(existing) !== canonicalJson(mirror)) fail('ACTIVATION_CONFLICT')
              continue
            }
            await tx.setById('post_rag_index_versions', mirror._id, mirror)
          }
        })
      } catch (error) {
        if (error instanceof PostRagVersionedSinkError && error.code === 'LEASE_LOST') {
          await cleanupAttemptAndFail('LEASE_LOST', documentIds)
        }
        throw error
      }
    },

    async inspectStaged({ postId, sourceVersion, jobId, leaseToken }) {
      requireIdentifier(postId); requireIdentifier(sourceVersion)
      const attemptId = derivePostRagIndexAttemptId(jobId, leaseToken)
      let response: any
      try {
        response = await requestJson('POST', `${options.indexName}/_search`, {
          size: 10000, _source: ['postId', 'sourceVersion', 'projectionChecksum'],
           query: { bool: { filter: [{ term: { postId } }, { term: { sourceVersion } }, { term: { indexAttemptId: attemptId } }] } },
        })
      } catch { fail('ES_INSPECTION_FAILED') }
      const hits = response?.hits?.hits
      if (!Array.isArray(hits) || hits.length === 0) fail('ES_INSPECTION_FAILED')
      const checksums = new Set<string>()
      for (const hit of hits) {
        const source = hit?._source
        if (!source || (source.postId !== undefined && source.postId !== postId)
          || (source.sourceVersion !== undefined && source.sourceVersion !== sourceVersion)
          || !safeIdentifier(source.projectionChecksum)) fail('ES_INSPECTION_FAILED')
        checksums.add(source.projectionChecksum)
      }
      if (checksums.size !== 1) fail('ES_INSPECTION_FAILED')
      return { chunkCount: hits.length, chunkChecksum: [...checksums][0] }
    },

    async activate({ postId, sourceVersion, activationOrder, jobId, leaseToken }) {
      requireIdentifier(postId); requireIdentifier(sourceVersion)
      if (!validOrder(activationOrder) || jobId !== activationOrder.jobId) fail('VALIDATION_FAILED')
      const attemptId = derivePostRagIndexAttemptId(jobId, leaseToken)
      return database.runTransaction(async (tx) => {
        const lease = await tx.getById('post_rag_jobs', jobId)
        if (!safeIdentifier(jobId) || !safeIdentifier(leaseToken) || !leaseMatches(lease, jobId, leaseToken)
          || !validTimestamp(lease?.updatedAt)) fail('LEASE_LOST')
        const activatedAt = lease.updatedAt
        const current = parseState(await tx.getById('post_rag_index_state_v2', postId), postId)
        if (current) {
          const comparison = comparePostRagActivationOrder(activationOrder, current.activationOrder)
          if (comparison < 0) return { activated: false }
          if (comparison === 0) {
            if (current.sourceVersion !== sourceVersion || current.state !== 'active') fail('ACTIVATION_CONFLICT')
            if (current.attemptId !== attemptId) {
              await tx.setById('post_rag_index_state_v2', postId, { schemaVersion: 2, postId, state: 'active', sourceVersion, attemptId, activatedAt, activationOrder })
            }
            return { activated: true }
          }
        }
        await tx.setById('post_rag_index_state_v2', postId, { schemaVersion: 2, postId, state: 'active', sourceVersion, attemptId, activatedAt, activationOrder })
        return { activated: true }
      })
    },

    async cleanupOldVersions({ postId, keepSourceVersion, activationOrder, jobId, leaseToken }) {
      requireIdentifier(postId); requireIdentifier(keepSourceVersion)
      if (!validOrder(activationOrder) || jobId !== activationOrder.jobId) fail('VALIDATION_FAILED')
      const attemptId = derivePostRagIndexAttemptId(jobId, leaseToken)
      const guard = async () => database.runTransaction(async (tx) => {
        if (!leaseMatches(await tx.getById('post_rag_jobs', jobId), jobId, leaseToken)) fail('LEASE_LOST')
        const current = parseState(await tx.getById('post_rag_index_state_v2', postId), postId)
        return current && current.state === 'active' && current.sourceVersion === keepSourceVersion
          && current.attemptId === attemptId && comparePostRagActivationOrder(current.activationOrder, activationOrder) === 0
          ? current : null
      })
      const winning = await guard()
      if (!winning) return
      const mirrors = await listMirrors(postId)
      const removable = mirrors.filter((mirror) => comparePostRagActivationOrder(mirror.activationOrder, activationOrder) < 0
        || (comparePostRagActivationOrder(mirror.activationOrder, activationOrder) === 0
          && mirror.sourceVersion === keepSourceVersion && mirror.attemptId !== attemptId
          && Date.parse(mirror.stagedAt) <= Date.parse(winning.activatedAt!)))
      await deleteMirrorsFromEs(removable, async () => { if (!await guard()) fail('LEASE_LOST') })
      if (!await guard()) return
      await removeMirrorRows(removable)
    },

    async remove({ postId, sourceVersion, activationOrder }) {
      requireIdentifier(postId); requireIdentifier(sourceVersion)
      if (!validOrder(activationOrder)) fail('VALIDATION_FAILED')
      const accepted = await database.runTransaction(async (tx) => {
        const current = parseState(await tx.getById('post_rag_index_state_v2', postId), postId)
        if (current) {
          const comparison = comparePostRagActivationOrder(activationOrder, current.activationOrder)
          if (comparison < 0) return false
          if (comparison === 0 && (current.sourceVersion !== sourceVersion || current.state !== 'removed')) fail('ACTIVATION_CONFLICT')
        }
        if (!current || comparePostRagActivationOrder(activationOrder, current.activationOrder) > 0) {
          await tx.setById('post_rag_index_state_v2', postId, { schemaVersion: 2, postId, state: 'removed', sourceVersion, activationOrder })
        }
        return true
      })
      if (!accepted) return { removed: false }
      const mirrors = await listMirrors(postId)
      const removable = mirrors.filter((mirror) => comparePostRagActivationOrder(mirror.activationOrder, activationOrder) <= 0)
      await deleteMirrorsFromEs(removable)
      if (await currentMatches(postId, sourceVersion, activationOrder, 'removed')) await removeMirrorRows(removable)
      return { removed: true }
    },
  }
}
