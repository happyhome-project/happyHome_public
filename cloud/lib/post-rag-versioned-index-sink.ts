
import type { PostRagSourceProjection } from './post-rag-indexing'
import type { PostRagJobDocument } from './post-rag-jobs'

export type PostRagActivationOrder = Readonly<{ contentVersion: number; jobId: string }>

export function comparePostRagActivationOrder(left: PostRagActivationOrder, right: PostRagActivationOrder): -1 | 0 | 1 {
  if (left.contentVersion !== right.contentVersion) return left.contentVersion < right.contentVersion ? -1 : 1
  if (left.jobId === right.jobId) return 0
  return left.jobId < right.jobId ? -1 : 1
}

export interface PostRagVersionedIndexSink {
  stageUpsert(input: { projection: PostRagSourceProjection; job: PostRagJobDocument }): Promise<void>
  inspectStaged(input: { postId: string; sourceVersion: string }): Promise<{ chunkCount: number; chunkChecksum: string }>
  activate(input: { postId: string; sourceVersion: string; activationOrder: PostRagActivationOrder }): Promise<{ activated: boolean }>
  cleanupOldVersions(input: { postId: string; keepSourceVersion: string; activationOrder: PostRagActivationOrder }): Promise<void>
  remove(input: { postId: string; sourceVersion: string; activationOrder: PostRagActivationOrder }): Promise<{ removed: boolean }>
}

type JsonRecord = Record<string, any>

type Database = {
  runTransaction<T>(operation: (transaction: {
    getById(collection: string, id: string): Promise<JsonRecord | null>
    setById(collection: string, id: string, data: JsonRecord): Promise<void>
  }) => Promise<T>): Promise<T>
  setById(collection: string, id: string, data: JsonRecord): Promise<void>
  query(collection: string, where: JsonRecord, options: { limit: number; skip?: number }): Promise<JsonRecord[]>
  removeById(collection: string, id: string): Promise<void>
}

type RequestJson = (method: string, path: string, body?: unknown, options?: { contentType?: string }) => Promise<any>

export type PostRagVersionedSinkErrorCode =
  | 'VALIDATION_FAILED' | 'EMBEDDING_INVALID' | 'ES_BULK_FAILED' | 'ES_INSPECTION_FAILED'
  | 'ES_DELETE_FAILED' | 'STATE_INVALID' | 'ACTIVATION_CONFLICT'

const authenticatedErrors = new WeakSet<object>()

export class PostRagVersionedSinkError extends Error {
  constructor(readonly code: PostRagVersionedSinkErrorCode) {
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
  activationOrder: PostRagActivationOrder
}

function parseState(value: JsonRecord | null, postId: string): State | null {
  if (!value) return null
  if (value.schemaVersion !== 2 || value.postId !== postId || (value.state !== 'active' && value.state !== 'removed')
    || !safeIdentifier(value.sourceVersion) || !validOrder(value.activationOrder)) fail('STATE_INVALID')
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

  type Mirror = JsonRecord & { _id: string; esDocumentId: string; activationOrder: PostRagActivationOrder }

  async function listMirrors(postId: string): Promise<Mirror[]> {
    const mirrors: Mirror[] = []
    for (let skip = 0; ; skip += mirrorPageSize) {
      const page = await database.query('post_rag_index_versions', { schemaVersion: 2, postId }, { limit: mirrorPageSize, skip })
      for (const doc of page) {
        if (!safeIdentifier(doc._id) || !safeIdentifier(doc.esDocumentId) || doc.postId !== postId || doc.schemaVersion !== 2
          || !safeIdentifier(doc.sourceVersion) || !validOrder(doc.activationOrder)) fail('STATE_INVALID')
        mirrors.push(doc as Mirror)
      }
      if (page.length < mirrorPageSize) return mirrors
    }
  }

  async function deleteMirrorsFromEs(mirrors: Mirror[]) {
    for (let offset = 0; offset < mirrors.length; offset += deleteBatchSize) {
      const ids = mirrors.slice(offset, offset + deleteBatchSize).map((mirror) => mirror.esDocumentId)
      let response: any
      try { response = await requestJson('POST', `${options.indexName}/_delete_by_query`, { query: { ids: { values: ids } } }) }
      catch { fail('ES_DELETE_FAILED') }
      if (!response || typeof response !== 'object' || Array.isArray(response)
        || response.timed_out !== false || !Number.isSafeInteger(response.deleted) || response.deleted < 0
        || !Array.isArray(response.failures) || response.failures.length !== 0) fail('ES_DELETE_FAILED')
    }
  }

  async function removeMirrorRows(mirrors: Mirror[]) {
    for (const mirror of mirrors) await database.removeById('post_rag_index_versions', mirror._id)
  }

  async function currentMatches(postId: string, sourceVersion: string, order: PostRagActivationOrder, state: State['state']) {
    const current = parseState(await database.runTransaction((tx) => tx.getById('post_rag_index_state_v2', postId)), postId)
    return Boolean(current && current.state === state && current.sourceVersion === sourceVersion
      && comparePostRagActivationOrder(current.activationOrder, order) === 0)
  }

  return {
    async stageUpsert({ projection, job }) {
      assertProjection(projection, job)
      const embeddings: number[][] = []
      for (let offset = 0; offset < projection.chunks.length; offset += embeddingBatchSize) {
        const batch = projection.chunks.slice(offset, offset + embeddingBatchSize)
        let output: number[][]
        try { output = await embedTexts(batch.map((chunk) => chunk.text)) } catch { fail('EMBEDDING_INVALID') }
        if (!Array.isArray(output) || output.length !== batch.length || output.some((vector) => !validEmbedding(vector))) fail('EMBEDDING_INVALID')
        embeddings.push(...output)
      }
      const lines: string[] = []
      projection.chunks.forEach((chunk, index) => {
        const id = `${chunk.postId}:${projection.sourceVersion}:${chunk.chunkId}`
        lines.push(JSON.stringify({ index: { _id: id } }))
        lines.push(JSON.stringify({ ...chunk, projectionChecksum: projection.chunkChecksum, embedding: embeddings[index] }))
      })
      let response: any
      try {
        response = await requestJson('POST', `${options.indexName}/_bulk?refresh=wait_for`, `${lines.join('\n')}\n`, { contentType: 'application/x-ndjson' })
      } catch { fail('ES_BULK_FAILED') }
      if (response?.errors !== false || !Array.isArray(response.items) || response.items.length !== projection.chunks.length
        || response.items.some((item: any) => !item?.index || item.index.status < 200 || item.index.status >= 300)) fail('ES_BULK_FAILED')
      for (const chunk of projection.chunks) {
        const id = `${chunk.postId}:${projection.sourceVersion}:${chunk.chunkId}`
        await database.setById('post_rag_index_versions', id, {
          _id: id, esDocumentId: id, schemaVersion: 2, postId: chunk.postId, communityId: chunk.communityId,
          sectionId: chunk.sectionId, sourceVersion: projection.sourceVersion, chunkId: chunk.chunkId,
          chunkChecksum: chunk.chunkChecksum, projectionChecksum: projection.chunkChecksum,
          activationOrder: { contentVersion: job.contentVersion, jobId: job._id },
        })
      }
    },

    async inspectStaged({ postId, sourceVersion }) {
      requireIdentifier(postId); requireIdentifier(sourceVersion)
      let response: any
      try {
        response = await requestJson('POST', `${options.indexName}/_search`, {
          size: 10000, _source: ['postId', 'sourceVersion', 'projectionChecksum'],
          query: { bool: { filter: [{ term: { postId } }, { term: { sourceVersion } }] } },
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

    async activate({ postId, sourceVersion, activationOrder }) {
      requireIdentifier(postId); requireIdentifier(sourceVersion)
      if (!validOrder(activationOrder)) fail('VALIDATION_FAILED')
      return database.runTransaction(async (tx) => {
        const current = parseState(await tx.getById('post_rag_index_state_v2', postId), postId)
        if (current) {
          const comparison = comparePostRagActivationOrder(activationOrder, current.activationOrder)
          if (comparison < 0) return { activated: false }
          if (comparison === 0) {
            if (current.sourceVersion !== sourceVersion || current.state !== 'active') fail('ACTIVATION_CONFLICT')
            return { activated: true }
          }
        }
        await tx.setById('post_rag_index_state_v2', postId, { schemaVersion: 2, postId, state: 'active', sourceVersion, activationOrder })
        return { activated: true }
      })
    },

    async cleanupOldVersions({ postId, keepSourceVersion, activationOrder }) {
      requireIdentifier(postId); requireIdentifier(keepSourceVersion)
      if (!validOrder(activationOrder)) fail('VALIDATION_FAILED')
      if (!await currentMatches(postId, keepSourceVersion, activationOrder, 'active')) return
      const mirrors = await listMirrors(postId)
      const removable = mirrors.filter((mirror) => comparePostRagActivationOrder(mirror.activationOrder, activationOrder) < 0)
      await deleteMirrorsFromEs(removable)
      if (!await currentMatches(postId, keepSourceVersion, activationOrder, 'active')) return
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
