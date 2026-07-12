import * as db from './db'
import { POST_RAG_RETRIEVAL_INDEX_VERSION } from './post-rag-indexing'
import { createRawEsRequest, createTencentAtomicEmbeddingRequester } from './post-rag-v2-runtime'
import { extractEmbeddingVectors, readTencentRagConfigFromEnv, type TencentRagAtomicRequestJson } from './post-rag'

type JsonRecord = Record<string, any>
type RequestJson = (method: string, path: string, body?: unknown, options?: { contentType?: string }) => Promise<any>
type SearchDatabase = {
  getById(collection: string, id: string): Promise<JsonRecord>
  getByIds(collection: string, ids: string[]): Promise<JsonRecord[]>
  query?(collection: string, where: JsonRecord, options?: JsonRecord): Promise<JsonRecord[]>
}

export type PostSemanticSearchRequest = {
  communityId: string
  sectionId?: string
  query: string
  skip?: number
  limit?: number
  includeMemberOnly: boolean
  viewerId?: string
}

export type PostSemanticSearchItem = {
  postId: string; communityId: string; sectionId: string; sectionName: string; title: string
  matchedSnippet: string; matchedField: string; coverImage?: string; authorName?: string
  authorAvatarUrl?: string; createdAt: string; updatedAt: string
}

export type PostSemanticSearchResponse = {
  protocolVersion: 2; query: string; communityId: string; sectionId?: string
  total: number; skip: number; limit: number; tookMs: number; items: PostSemanticSearchItem[]
}

const authenticatedErrors = new WeakSet<object>()
export class PostSemanticSearchError extends Error {
  readonly code: 'INVALID_REQUEST' | 'UNAVAILABLE'
  constructor(code: 'INVALID_REQUEST' | 'UNAVAILABLE') {
    super('Semantic post search failed'); this.name = 'PostSemanticSearchError'; this.code = code
    authenticatedErrors.add(this)
  }
}
export function isPostSemanticSearchError(value: unknown): value is PostSemanticSearchError {
  return Boolean(value && typeof value === 'object' && authenticatedErrors.has(value as object))
}

class BoundedTtlLru<T> {
  private values = new Map<string, { expiresAt: number; value: T }>()
  constructor(private readonly maxEntries: number, private readonly ttlMs: number, private readonly now: () => number) {}
  get(key: string): T | undefined {
    const entry = this.values.get(key)
    if (!entry || entry.expiresAt <= this.now()) { if (entry) this.values.delete(key); return undefined }
    this.values.delete(key); this.values.set(key, entry); return entry.value
  }
  set(key: string, value: T) {
    this.values.delete(key); this.values.set(key, { expiresAt: this.now() + this.ttlMs, value })
    while (this.values.size > this.maxEntries) this.values.delete(this.values.keys().next().value as string)
  }
}

type Candidate = {
  score: number; postId: string; communityId: string; sectionId: string; sourceVersion: string; chunkId: string
  visibility: 'public' | 'member'; widgetId: string; fieldKey: string; title: string; text: string; preview: string; fieldLabel: string; sectionName: string
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 256 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value)
}
function validVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'number' && Number.isFinite(item))
}
function hasInvalidText(value: string) {
  if (/[\u0000-\u001f\u007f]/.test(value)) return true
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return true
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return true
      index++
    } else if (code >= 0xdc00 && code <= 0xdfff) return true
  }
  return false
}
function parseCandidate(value: any): Candidate | null {
  const source = value?._source
  const score = Number.isFinite(value?._score) ? Number(value._score)
    : (Number.isSafeInteger(value?._rank) && value._rank > 0 ? -Number(value._rank) : null)
  if (!value || typeof value !== 'object' || score === null || !source || typeof source !== 'object'
    || ![source.postId, source.communityId, source.sectionId, source.sourceVersion, source.chunkId, source.widgetId, source.fieldKey].every(safeId)
    || (source.visibility !== 'public' && source.visibility !== 'member')
    || ![source.title, source.text, source.preview, source.fieldLabel, source.sectionName].every(item => typeof item === 'string')) return null
  return { score, postId: source.postId, communityId: source.communityId, sectionId: source.sectionId,
    sourceVersion: source.sourceVersion, chunkId: source.chunkId, visibility: source.visibility, widgetId: source.widgetId, fieldKey: source.fieldKey, title: source.title,
    text: source.text, preview: source.preview, fieldLabel: source.fieldLabel, sectionName: source.sectionName }
}
function unique(values: string[]) { return [...new Set(values)] }
function versionNumber(value: unknown) { return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null }
function matchesWidgetFieldKey(candidateFieldKey: string, widgetFieldKey: unknown) {
  if (!safeId(widgetFieldKey)) return false
  if (candidateFieldKey === widgetFieldKey) return true
  const prefix = `${widgetFieldKey}.`
  if (!candidateFieldKey.startsWith(prefix)) return false
  const suffix = candidateFieldKey.slice(prefix.length)
  return /^[2-9]\d*$/.test(suffix) && Number.isSafeInteger(Number(suffix))
}

export function createPostSemanticSearchService(options: {
  database: SearchDatabase; requestJson: RequestJson; embedTexts(texts: string[]): Promise<number[][]>
  indexName: string; vectorField: string; embeddingModel: string; retrievalIndexVersion?: string; now?: () => number
  embeddingCacheSize?: number; candidateCacheSize?: number; operationTimeoutMs?: number
  resolveFinalMembership?: (input: { communityId: string; viewerId: string }) => Promise<{ active: boolean; aclVersion: number }>
}) {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(options.indexName) || !safeId(options.vectorField)
    || !safeId(options.embeddingModel) || !safeId(options.retrievalIndexVersion || POST_RAG_RETRIEVAL_INDEX_VERSION)) throw new PostSemanticSearchError('INVALID_REQUEST')
  const now = options.now || Date.now
  const retrievalIndexVersion = options.retrievalIndexVersion || POST_RAG_RETRIEVAL_INDEX_VERSION
  const embeddingCache = new BoundedTtlLru<number[]>(options.embeddingCacheSize || 500, 24 * 60 * 60_000, now)
  const candidateCache = new BoundedTtlLru<Candidate[]>(options.candidateCacheSize || 500, 10 * 60_000, now)
  const operationTimeoutMs = options.operationTimeoutMs ?? 1_900
  if (!Number.isSafeInteger(operationTimeoutMs) || operationTimeoutMs < 1 || operationTimeoutMs > 10_000) throw new PostSemanticSearchError('INVALID_REQUEST')

  type Deadline = { expired: boolean }
  const assertDeadline = (deadline: Deadline) => { if (deadline.expired) throw new PostSemanticSearchError('UNAVAILABLE') }

  async function executeSearch(input: PostSemanticSearchRequest, deadline: Deadline): Promise<PostSemanticSearchResponse> {
    const startedAt = now()
    const query = typeof input?.query === 'string' ? input.query.trim() : ''
    const skip = input?.skip ?? 0; const limit = input?.limit ?? 10
    if (!safeId(input?.communityId) || (input.sectionId !== undefined && !safeId(input.sectionId))
      || [...query].length < 1 || [...query].length > 80 || hasInvalidText(query) || !Number.isSafeInteger(skip) || skip < 0 || skip > 19
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 20 || skip + limit > 20 || typeof input.includeMemberOnly !== 'boolean') throw new PostSemanticSearchError('INVALID_REQUEST')
    try {
      const version = await options.database.getById('rag_community_versions', input.communityId)
      assertDeadline(deadline)
      if (version?.communityId !== input.communityId) throw new Error('invalid version')
      const contentVersion = versionNumber(version.contentVersion); const aclVersion = versionNumber(version.aclVersion)
      if (contentVersion === null || aclVersion === null) throw new Error('invalid version')
      const embeddingKey = JSON.stringify([options.embeddingModel, query])
      let vector = embeddingCache.get(embeddingKey)
      if (!vector) {
        const vectors = await options.embedTexts([query]); vector = vectors?.[0]
        assertDeadline(deadline)
        if (vectors?.length !== 1 || !validVector(vector)) throw new Error('invalid embedding')
        embeddingCache.set(embeddingKey, vector)
      }
      const candidateKey = JSON.stringify([options.embeddingModel, options.indexName, retrievalIndexVersion, query,
        input.communityId, input.sectionId || '', input.includeMemberOnly, contentVersion, aclVersion])
      let candidates = candidateCache.get(candidateKey)
      if (!candidates) {
        const filters: JsonRecord[] = [{ term: { communityId: input.communityId } }]
        if (input.sectionId) filters.push({ term: { sectionId: input.sectionId } })
        if (!input.includeMemberOnly) filters.push({ term: { visibility: 'public' } })
        const response = await options.requestJson('POST', `${options.indexName}/_search`, {
          size: 40,
          _source: ['postId', 'communityId', 'sectionId', 'sourceVersion', 'chunkId', 'visibility', 'widgetId', 'fieldKey', 'title', 'text', 'preview', 'fieldLabel', 'sectionName'],
          query: { bool: { must: [{ multi_match: { query, fields: ['text^3', 'preview^2', 'title^4', 'fieldLabel', 'sectionName'], type: 'best_fields' } }], filter: filters } },
          knn: { field: options.vectorField, query_vector: vector, k: 40, num_candidates: 100, filter: { bool: { filter: filters } } },
          rank: { rrf: { rank_window_size: 40, rank_constant: 60 } },
        })
        assertDeadline(deadline)
        const hits = response?.hits?.hits
        if (!Array.isArray(hits)) throw new Error('invalid hits')
        const boundedHits = hits.slice(0, 40)
        const parsed = boundedHits.map(parseCandidate)
        if (parsed.some(candidate => candidate === null)) throw new Error('invalid hits')
        candidates = parsed as Candidate[]
        candidateCache.set(candidateKey, candidates)
      }

      const scoped = candidates.filter(candidate => candidate.communityId === input.communityId
        && (!input.sectionId || candidate.sectionId === input.sectionId)
        && (input.includeMemberOnly || candidate.visibility === 'public'))
      const [posts, sections, states] = await Promise.all([
        options.database.getByIds('posts', unique(scoped.map(item => item.postId))),
        options.database.getByIds('sections', unique(scoped.map(item => item.sectionId))),
        options.database.getByIds('post_rag_index_state_v2', unique(scoped.map(item => item.postId))),
      ])
      assertDeadline(deadline)
      let finalMemberAuthorized = false
      if (input.includeMemberOnly && safeId(input.viewerId) && options.resolveFinalMembership) {
        const membership = await options.resolveFinalMembership({ communityId: input.communityId, viewerId: input.viewerId })
        assertDeadline(deadline)
        finalMemberAuthorized = membership?.active === true && versionNumber(membership.aclVersion) === aclVersion
      }
      const postMap = new Map<string, JsonRecord>(posts.map((item: JsonRecord) => [item._id, item])); const sectionMap = new Map<string, JsonRecord>(sections.map((item: JsonRecord) => [item._id, item])); const stateMap = new Map<string, JsonRecord>(states.map((item: JsonRecord) => [item._id, item]))
      const valid = scoped.filter(candidate => {
        const post = postMap.get(candidate.postId); const section = sectionMap.get(candidate.sectionId); const state = stateMap.get(candidate.postId)
        const widget = Array.isArray(section?.widgets) ? section.widgets.find((item: any) => item?.widgetId === candidate.widgetId) : undefined
        return post?.status === 'active' && (!post.auditStatus || post.auditStatus === 'pass')
          && post.communityId === input.communityId && post.sectionId === candidate.sectionId
          && section?.status === 'active' && section.communityId === input.communityId
          && matchesWidgetFieldKey(candidate.fieldKey, widget?.fieldKey)
          && (candidate.visibility === 'public' || finalMemberAuthorized)
          && (widget.visibility !== 'member' || finalMemberAuthorized)
          && state?.schemaVersion === 2 && state.postId === candidate.postId && state.state === 'active' && state.sourceVersion === candidate.sourceVersion
      }).sort((a, b) => b.score - a.score)
      const grouped = new Map<string, Candidate[]>()
      for (const candidate of valid) { const chunks = grouped.get(candidate.postId) || []; if (chunks.length < 2) { chunks.push(candidate); grouped.set(candidate.postId, chunks) } }
      const ranked = [...grouped.values()].sort((left, right) => right[0].score - left[0].score)
      const items = ranked.slice(skip, skip + limit).map(chunks => {
        const best = chunks[0]; const post = postMap.get(best.postId); const activeSection = sectionMap.get(best.sectionId)
        return { postId: best.postId, communityId: input.communityId, sectionId: best.sectionId, sectionName: String(activeSection?.name || best.sectionName),
          title: best.title, matchedSnippet: String(best.preview || best.text).slice(0, 300), matchedField: best.fieldLabel,
          ...(typeof post?.coverImage === 'string' ? { coverImage: post.coverImage } : {}),
          ...(typeof post?.authorNickname === 'string' ? { authorName: post.authorNickname } : {}),
          ...(typeof post?.authorAvatarUrl === 'string' ? { authorAvatarUrl: post.authorAvatarUrl } : {}),
          createdAt: String(post?.createdAt || ''), updatedAt: String(post?.updatedAt || '') }
      })
      return { protocolVersion: 2, query, communityId: input.communityId, ...(input.sectionId ? { sectionId: input.sectionId } : {}),
        total: ranked.length, skip, limit, tookMs: Math.max(0, now() - startedAt), items }
    } catch (error) {
      if (isPostSemanticSearchError(error)) throw error
      throw new PostSemanticSearchError('UNAVAILABLE')
    }
  }
  function search(input: PostSemanticSearchRequest): Promise<PostSemanticSearchResponse> {
    return new Promise((resolve, reject) => {
      const deadline = { expired: false }
      const timer = setTimeout(() => { deadline.expired = true; reject(new PostSemanticSearchError('UNAVAILABLE')) }, operationTimeoutMs)
      timer.unref?.()
      executeSearch(input, deadline).then(resolve, reject).finally(() => clearTimeout(timer))
    })
  }
  return { search }
}

export function createPostSemanticSearchServiceFromEnv(options: {
  env?: NodeJS.ProcessEnv; database?: SearchDatabase; requestJson?: RequestJson; requestAtomicJson?: TencentRagAtomicRequestJson
} = {}) {
  const env = options.env || process.env
  const config = readTencentRagConfigFromEnv(env)
  if (config.vectorField !== 'embedding') throw new PostSemanticSearchError('UNAVAILABLE')
  if (![config.endpoint, config.username, config.password, config.indexName, config.atomicSecretId, config.atomicSecretKey, config.atomicRegion, config.embeddingModel, config.vectorField]
    .every(value => typeof value === 'string' && value.trim())) throw new PostSemanticSearchError('UNAVAILABLE')
  let endpoint: URL
  try { endpoint = new URL(config.endpoint) } catch { throw new PostSemanticSearchError('UNAVAILABLE') }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new PostSemanticSearchError('UNAVAILABLE')
  const requestJson = options.requestJson || createRawEsRequest({ endpoint: config.endpoint, username: config.username, password: config.password })
  const atomic = options.requestAtomicJson || createTencentAtomicEmbeddingRequester()
  const embedTexts = async (texts: string[]) => {
    const response = await atomic(config, 'GetTextEmbedding', { ModelName: config.embeddingModel, Texts: texts })
    const vectors = extractEmbeddingVectors(response)
    if (vectors.length !== texts.length || vectors.some(vector => !validVector(vector))) throw new PostSemanticSearchError('UNAVAILABLE')
    return vectors
  }
  const database = (options.database || db) as SearchDatabase
  const resolveFinalMembership = async ({ communityId, viewerId }: { communityId: string; viewerId: string }) => {
    if (!database.query) return { active: false, aclVersion: -1 }
    const [version, memberships] = await Promise.all([
      database.getById('rag_community_versions', communityId),
      database.query('community_members', { communityId, userId: viewerId, status: 'active' }, { limit: 1 }),
    ])
    return { active: memberships.length > 0, aclVersion: versionNumber(version?.aclVersion) ?? -1 }
  }
  return createPostSemanticSearchService({ database, requestJson, embedTexts, resolveFinalMembership, indexName: config.indexName,
    vectorField: config.vectorField!, embeddingModel: config.embeddingModel!, retrievalIndexVersion: POST_RAG_RETRIEVAL_INDEX_VERSION })
}
