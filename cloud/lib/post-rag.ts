import { createHash, createHmac } from 'crypto'
import http from 'http'
import https from 'https'
import type { Post, Section } from '../shared/types'
import * as db from './db'
import {
  buildPostSearchChunks,
  buildPostSearchDocument,
  normalizeSearchText,
  type PostSearchResult,
  type PostSearchResultItem,
} from './post-search'

export const POST_RAG_JOBS = 'post_rag_jobs'
export const POST_RAG_INDEX_STATE = 'post_rag_index_state'
export const POST_RAG_CHUNKS = 'post_rag_chunks'
export const POST_RAG_WORKER_STATE = 'post_rag_worker_state'
export const POST_VIDEO_RAG_ASSETS = 'post_video_rag_assets'
export const POST_VIDEO_RAG_JOBS = 'post_video_rag_jobs'

export type RagSearchMode = 'rag' | 'fallback' | 'no_answer'

export interface RagCitation {
  postId: string
  chunkId: string
  communityId: string
  title: string
  sectionId?: string
  sectionName?: string
  fieldLabel: string
  fieldType: string
  preview: string
  score: number
  visibility?: 'public' | 'member'
  sourceUpdatedAt?: string
}

export type ScoredRagCitation = RagCitation & {
  semanticScore?: number
  lexicalScore?: number
  rerankScore?: number
}

export interface RagSearchResult extends PostSearchResult {
  answer: string
  citations: RagCitation[]
  mode: RagSearchMode
  provider?: string
  fallbackReason?: string
}

export interface RagQuery {
  raw: string
  normalized: string
  expansionTerms: string[]
  expandedText: string
}

export interface RagSearchParams {
  communityId: string
  query: string
  sectionId?: string
  skip?: number
  limit?: number
  includeMemberOnly?: boolean
}

export interface RagProviderSearchInput extends RagSearchParams {
  ragQuery: RagQuery
}

export interface TencentRagProvider {
  name: string
  isConfigured(): boolean
  ensureIndex?(): Promise<{ created: boolean; indexName: string; dims?: number }>
  search(input: RagProviderSearchInput): Promise<Omit<RagSearchResult, 'query' | 'communityId' | 'sectionId' | 'skip' | 'limit'>>
  upsertChunks?(chunks: RagChunkDocument[]): Promise<void>
  deletePostChunks?(postId: string): Promise<void>
}

export interface RagChunkDocument {
  chunkId: string
  postId: string
  communityId: string
  sectionId: string
  sectionName: string
  title: string
  fieldLabel: string
  fieldType: string
  text: string
  preview: string
  sourceUpdatedAt: string
  visibility: 'public' | 'member'
  metadata?: Record<string, any>
}

export interface VideoRagAsset {
  _id?: string
  cacheKey: string
  status: 'ready' | 'pending' | 'failed'
  visualSummary?: string
  ocrText?: string
  asrTranscript?: string
  frameSummaries?: Array<{
    timeMs?: number
    timeSeconds?: number
    summary?: string
    ocrText?: string
  }>
  updatedAt?: string
}

export interface VideoRagCostPolicy {
  analysisEnabled: boolean
  maxJobsPerPost: number
  maxCostUnitsPerPost: number
  maxFramesPerVideo: number
  maxAsrSecondsPerVideo: number
  minMetadataTextCharsForAnalysis: number
}

export interface VideoRagAnalysisJobDocument {
  _id: string
  postId: string
  communityId: string
  sectionId: string
  cacheKey: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  attempts: number
  reason: string
  requestedAnalyses: string[]
  frameStrategy: {
    includeCover: boolean
    maxFrames: number
    minSceneGapSeconds: number
  }
  maxAsrSeconds: number
  estimatedCostUnits: number
  budgetDate: string
  video: Record<string, any>
  provider?: string
  providerTaskId?: string
  providerStatus?: string
  errorMessage?: string
  completedAt?: string
  createdAt: string
  updatedAt: string
}

export interface VideoRagAnalyzerPendingResult {
  pending: true
  providerTaskId: string
  providerStatus?: string
}

export type VideoRagAnalyzerResult = Partial<VideoRagAsset> | VideoRagAnalyzerPendingResult

export interface VideoRagAnalyzer {
  name: string
  isConfigured(): boolean
  analyze(job: VideoRagAnalysisJobDocument): Promise<VideoRagAnalyzerResult>
}

export interface TencentRagConfig {
  endpoint: string
  username: string
  password: string
  indexName: string
  vectorField?: string
  embeddingInferenceId?: string
  rerankInferenceId?: string
  llmInferenceId?: string
  atomicSecretId?: string
  atomicSecretKey?: string
  atomicRegion?: string
  embeddingModel?: string
  rerankModel?: string
  llmModel?: string
}

export type TencentRagRequestJson = <T>(
  config: TencentRagConfig,
  method: string,
  path: string,
  body?: unknown
) => Promise<T>

export type TencentRagAtomicRequestJson = <T>(
  config: TencentRagConfig,
  action: string,
  body: unknown
) => Promise<T>

export interface TencentRagProviderOptions {
  requestJson?: TencentRagRequestJson
  requestAtomicJson?: TencentRagAtomicRequestJson
}

export interface TencentLkeapRagConfig {
  secretId: string
  secretKey: string
  region: string
  embeddingModel: string
  rerankModel: string
  chatModel: string
  chunkPageSize: number
  maxCandidateChunks: number
}

export interface TencentCloudBaseAtomicRagConfig extends TencentRagConfig {
  chunkPageSize: number
  maxCandidateChunks: number
}

const THRIFT_FAMILY_EXPANSION = [
  '节俭',
  '勤俭',
  '勤儉',
  '节约',
  '節約',
  '家风',
  '家風',
  '家训',
  '家訓',
  '朱子治家格言',
  '一粥一饭',
  '一粥一飯',
  '半丝半缕',
  '半絲半縷',
  '物力维艰',
  '物力維艱',
  '俭约',
  '儉約',
]
const MIN_LKEAP_RERANK_EVIDENCE_SCORE = 0.7
const MIN_LKEAP_SEMANTIC_EVIDENCE_SCORE = 0.42

function logRagSearchDecision(event: string, payload: Record<string, unknown>) {
  try {
    console.info('[post.rag.search]', JSON.stringify({
      event,
      ...payload,
    }))
  } catch {
    // Logging must never break search.
  }
}

export function buildRagQuery(raw: string): RagQuery {
  const normalized = normalizeSearchText(raw)
  const compact = normalized.replace(/\s+/g, '')
  const expansionTerms = /节俭|勤俭|节约|家风|家训|朱子|治家|一粥一饭|半丝半缕|物力维艰/.test(compact)
    ? THRIFT_FAMILY_EXPANSION
    : []
  return {
    raw,
    normalized,
    expansionTerms,
    expandedText: [raw, ...expansionTerms].filter(Boolean).join(' '),
  }
}

export function buildNoEvidenceRagResult(params: {
  query: string
  communityId: string
  sectionId?: string
  skip?: number
  limit?: number
}): RagSearchResult {
  return {
    query: params.query,
    communityId: params.communityId,
    sectionId: params.sectionId || '',
    total: 0,
    skip: Math.max(0, Math.floor(Number(params.skip || 0))),
    limit: Math.max(1, Math.floor(Number(params.limit || 20))),
    items: [],
    answer: '没有找到足够相关的帖子，暂时不能给出确定回答。',
    citations: [],
    mode: 'no_answer',
  }
}

function buildUnavailableFallbackRagResult(params: {
  query: string
  communityId: string
  sectionId?: string
  skip?: number
  limit?: number
  reason?: string
}): RagSearchResult {
  return {
    query: params.query,
    communityId: params.communityId,
    sectionId: params.sectionId || '',
    total: 0,
    skip: Math.max(0, Math.floor(Number(params.skip || 0))),
    limit: Math.max(1, Math.floor(Number(params.limit || 20))),
    items: [],
    answer: '',
    citations: [],
    mode: 'fallback',
    ...(params.reason ? { fallbackReason: params.reason } : {}),
  }
}

function resultItemsFromCitations(citations: RagCitation[]): PostSearchResultItem[] {
  const byPost = new Map<string, PostSearchResultItem>()
  for (const citation of citations) {
    const existing = byPost.get(citation.postId)
      if (existing) {
        existing.score = Math.max(existing.score, citation.score)
      if (existing.matchedFields.length < 3) {
        existing.matchedFields.push({
          fieldLabel: citation.fieldLabel,
          fieldType: citation.fieldType,
          preview: citation.preview,
        })
      }
      continue
    }
    byPost.set(citation.postId, {
      postId: citation.postId,
      communityId: citation.communityId,
      sectionId: citation.sectionId || '',
      sectionName: citation.sectionName || '',
      title: citation.title,
      score: citation.score,
      matchedFields: [{
        fieldLabel: citation.fieldLabel,
        fieldType: citation.fieldType,
        preview: citation.preview,
      }],
      createdAt: citation.sourceUpdatedAt || '',
      updatedAt: citation.sourceUpdatedAt || '',
    })
  }
  return Array.from(byPost.values()).sort((left, right) => right.score - left.score)
}

function normalizeRagVisibility(value: unknown): 'public' | 'member' {
  return value === 'public' ? 'public' : 'member'
}

function isEvidenceVisible(visibility: unknown, includeMemberOnly: boolean) {
  return includeMemberOnly || normalizeRagVisibility(visibility) === 'public'
}

function filterCitationsForVisibility(citations: RagCitation[], includeMemberOnly: boolean) {
  return citations.filter((citation) => isEvidenceVisible(citation.visibility, includeMemberOnly))
}

function filterProviderResultForVisibility(
  providerResult: Omit<RagSearchResult, 'query' | 'communityId' | 'sectionId' | 'skip' | 'limit'>,
  includeMemberOnly: boolean,
) {
  const originalCitations = providerResult.citations || []
  const citations = filterCitationsForVisibility(originalCitations, includeMemberOnly)
  const droppedCitations = citations.length !== originalCitations.length
  return {
    ...providerResult,
    total: citations.length,
    citations,
    items: resultItemsFromCitations(citations),
    answer: citations.length
      ? (droppedCitations ? deterministicAnswer(citations) : (providerResult.answer || deterministicAnswer(citations)))
      : '',
  }
}

export async function searchPostsWithRag(
  params: RagSearchParams,
  options: {
    provider?: TencentRagProvider | null
    fallbackSearch?: (params: RagSearchParams) => Promise<PostSearchResult>
  } = {}
): Promise<RagSearchResult> {
  const communityId = String(params.communityId || '').trim()
  const sectionId = String(params.sectionId || '').trim()
  const query = String(params.query || '')
  const skip = Math.max(0, Math.floor(Number(params.skip || 0)))
  const limit = Math.max(1, Math.floor(Number(params.limit || 20)))
  const includeMemberOnly = params.includeMemberOnly !== false
  const provider = options.provider === undefined ? createTencentRagProviderFromEnv() : options.provider
  const fallbackParams = { communityId, query, sectionId, skip, limit, includeMemberOnly }

  if (!provider || !provider.isConfigured()) {
    logRagSearchDecision('fallback', {
      reason: 'rag_provider_not_configured',
      communityId,
      sectionId,
      queryLength: query.length,
    })
    return buildUnavailableFallbackRagResult({
      query,
      communityId,
      sectionId,
      skip,
      limit,
      reason: 'rag_provider_not_configured',
    })
  }

  try {
    const ragQuery = buildRagQuery(query)
    const rawProviderResult = await provider.search({ ...fallbackParams, ragQuery })
    const providerResult = filterProviderResultForVisibility(rawProviderResult, includeMemberOnly)
    if (!providerResult.citations.length) {
      logRagSearchDecision('no_answer', {
        provider: provider.name,
        communityId,
        sectionId,
        queryLength: query.length,
      })
      return buildNoEvidenceRagResult({ query, communityId, sectionId, skip, limit })
    }
    logRagSearchDecision('rag', {
      provider: provider.name,
      communityId,
      sectionId,
      citationCount: providerResult.citations.length,
      itemCount: providerResult.items.length,
      queryLength: query.length,
    })
    return {
      query,
      communityId,
      sectionId,
      total: providerResult.total || providerResult.citations.length,
      skip,
      limit,
      items: providerResult.items.length ? providerResult.items : resultItemsFromCitations(providerResult.citations),
      answer: providerResult.answer || deterministicAnswer(providerResult.citations),
      citations: providerResult.citations,
      mode: 'rag',
      provider: provider.name,
    }
  } catch (error: any) {
    logRagSearchDecision('fallback', {
      reason: error?.message || 'rag_provider_failed',
      provider: provider.name,
      communityId,
      sectionId,
      queryLength: query.length,
    })
    return buildUnavailableFallbackRagResult({
      query,
      communityId,
      sectionId,
      skip,
      limit,
      reason: error?.message || 'rag_provider_failed',
    })
  }
}

function normalizeEndpoint(value: string): string {
  return String(value || '').trim().replace(/\/+$/, '')
}

export function readTencentRagConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TencentRagConfig {
  return {
    endpoint: normalizeEndpoint(env.TENCENT_RAG_ES_ENDPOINT || ''),
    username: String(env.TENCENT_RAG_ES_USERNAME || ''),
    password: String(env.TENCENT_RAG_ES_PASSWORD || ''),
    indexName: String(env.TENCENT_RAG_INDEX_NAME || 'happyhome_post_rag_chunks'),
    vectorField: String(env.TENCENT_RAG_VECTOR_FIELD || 'embedding'),
    embeddingInferenceId: String(env.TENCENT_RAG_EMBEDDING_INFERENCE_ID || ''),
    rerankInferenceId: String(env.TENCENT_RAG_RERANK_INFERENCE_ID || ''),
    llmInferenceId: String(env.TENCENT_RAG_LLM_INFERENCE_ID || ''),
    atomicSecretId: String(env.TENCENT_RAG_ATOMIC_SECRET_ID || env.TENCENTCLOUD_SECRETID || ''),
    atomicSecretKey: String(env.TENCENT_RAG_ATOMIC_SECRET_KEY || env.TENCENTCLOUD_SECRETKEY || ''),
    atomicRegion: String(env.TENCENT_RAG_ATOMIC_REGION || 'ap-beijing'),
    embeddingModel: String(env.TENCENT_RAG_EMBEDDING_MODEL || 'bge-base-zh-v1.5'),
    rerankModel: String(env.TENCENT_RAG_RERANK_MODEL || 'bge-reranker-large'),
    llmModel: String(env.TENCENT_RAG_LLM_MODEL || 'deepseek-v3'),
  }
}

export function readTencentCloudBaseAtomicRagConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TencentCloudBaseAtomicRagConfig {
  return {
    ...readTencentRagConfigFromEnv(env),
    chunkPageSize: Math.max(20, Math.min(100, Math.floor(Number(env.TENCENT_RAG_CLOUDBASE_CHUNK_PAGE_SIZE || 100)))),
    maxCandidateChunks: Math.max(20, Math.min(500, Math.floor(Number(env.TENCENT_RAG_CLOUDBASE_MAX_CANDIDATE_CHUNKS || 200)))),
  }
}

export function readTencentLkeapRagConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TencentLkeapRagConfig {
  return {
    secretId: String(env.TENCENT_LKEAP_SECRET_ID || env.TENCENTCLOUD_SECRETID || '').trim(),
    secretKey: String(env.TENCENT_LKEAP_SECRET_KEY || env.TENCENTCLOUD_SECRETKEY || ''),
    region: String(env.TENCENT_LKEAP_REGION || 'ap-guangzhou').trim(),
    embeddingModel: String(env.TENCENT_LKEAP_EMBEDDING_MODEL || 'lke-text-embedding-v2').trim(),
    rerankModel: String(env.TENCENT_LKEAP_RERANK_MODEL || 'lke-reranker-base').trim(),
    chatModel: String(env.TENCENT_LKEAP_CHAT_MODEL || 'deepseek-v3-0324').trim(),
    chunkPageSize: Math.max(20, Math.min(100, Math.floor(Number(env.TENCENT_LKEAP_CHUNK_PAGE_SIZE || 100)))),
    maxCandidateChunks: Math.max(20, Math.min(500, Math.floor(Number(env.TENCENT_LKEAP_MAX_CANDIDATE_CHUNKS || 200)))),
  }
}

export function createTencentRagProviderFromEnv() {
  return createTencentCloudBaseAtomicProvider(readTencentCloudBaseAtomicRagConfigFromEnv())
}

function hasEsIndexConfig(config: TencentRagConfig) {
  return Boolean(
    config.endpoint
    && config.username
    && config.password
    && config.indexName
  )
}

function hasInferenceModelConfig(config: TencentRagConfig) {
  return Boolean(
    config.embeddingInferenceId
    && config.rerankInferenceId
    && config.llmInferenceId
  )
}

function hasAtomicModelConfig(config: TencentRagConfig) {
  return Boolean(
    config.atomicSecretId
    && config.atomicSecretKey
    && config.atomicRegion
    && config.embeddingModel
    && config.rerankModel
    && config.llmModel
  )
}

function isConfigured(config: TencentRagConfig) {
  return hasEsIndexConfig(config) && (hasInferenceModelConfig(config) || hasAtomicModelConfig(config))
}

function authHeader(config: TencentRagConfig) {
  return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`
}

const requestJson: TencentRagRequestJson = async <T>(config: TencentRagConfig, method: string, path: string, body?: unknown): Promise<T> => {
  const url = new URL(`${config.endpoint}/${path.replace(/^\/+/, '')}`)
  const transport = url.protocol === 'http:' ? http : https
  const payload = body === undefined ? '' : JSON.stringify(body)
  return new Promise<T>((resolve, reject) => {
    const req = transport.request(url, {
      method,
      headers: {
        Authorization: authHeader(config),
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if ((res.statusCode || 500) >= 400) {
          reject(new Error(`Tencent RAG request failed: ${res.statusCode} ${text}`))
          return
        }
        try {
          resolve(text ? JSON.parse(text) : {} as T)
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

function tencentEsAtomicHost(action: string) {
  return action === 'ChatCompletions' ? 'es.ai.tencentcloudapi.com' : 'es.tencentcloudapi.com'
}

export const requestTencentEsAtomic: TencentRagAtomicRequestJson = async <T>(
  config: TencentRagConfig,
  action: string,
  body: unknown,
): Promise<T> => {
  if (!config.atomicSecretId || !config.atomicSecretKey) {
    throw new Error('rag_atomic_provider_not_configured')
  }
  const host = tencentEsAtomicHost(action)
  const service = 'es'
  const version = '2025-01-01'
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const payload = JSON.stringify(body)
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`
  const signedHeaders = 'content-type;host'
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, tc3Sha256(payload)].join('\n')
  const credentialScope = `${date}/${service}/tc3_request`
  const stringToSign = ['TC3-HMAC-SHA256', timestamp, credentialScope, tc3Sha256(canonicalRequest)].join('\n')
  const secretDate = tc3HmacBuffer(`TC3${config.atomicSecretKey}`, date)
  const secretService = tc3HmacBuffer(secretDate, service)
  const secretSigning = tc3HmacBuffer(secretService, 'tc3_request')
  const signature = tc3HmacHex(secretSigning, stringToSign)
  const authorization = `TC3-HMAC-SHA256 Credential=${config.atomicSecretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return new Promise<T>((resolve, reject) => {
    const req = https.request({
      hostname: host,
      method: 'POST',
      path: '/',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json; charset=utf-8',
        Host: host,
        'X-TC-Action': action,
        'X-TC-Version': version,
        'X-TC-Timestamp': String(timestamp),
        'X-TC-Region': config.atomicRegion || 'ap-beijing',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let parsed: any
        try {
          parsed = text ? JSON.parse(text) : {}
        } catch (error) {
          reject(error)
          return
        }
        if ((res.statusCode || 500) >= 400 || parsed?.Response?.Error) {
          const error = parsed?.Response?.Error
          reject(new Error(`Tencent ES atomic ${action} failed: ${error?.Code || res.statusCode} ${error?.Message || text}`))
          return
        }
        resolve((parsed?.Response || parsed) as T)
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function buildTencentEsFilters(input: RagProviderSearchInput) {
  const filters: any[] = [{ term: { communityId: input.communityId } }]
  if (input.sectionId) filters.push({ term: { sectionId: input.sectionId } })
  if (input.includeMemberOnly === false) filters.push({ term: { visibility: 'public' } })
  return filters
}

export function buildTencentEsHybridSearchBody(
  input: RagProviderSearchInput,
  config: TencentRagConfig,
  queryVector: number[],
) {
  const filters = buildTencentEsFilters(input)
  const size = Math.max(1, Math.min(50, Number(input.limit || 20)))
  const from = Math.max(0, Math.floor(Number(input.skip || 0)))
  const textQuery = {
    bool: {
      must: [{
        multi_match: {
          query: input.ragQuery.expandedText,
          fields: ['text^4', 'preview^4', 'title^3', 'fieldLabel^2', 'sectionName'],
        },
      }],
      filter: filters,
    },
  }
  const retrievers: any[] = [{
    standard: {
      query: textQuery,
    },
  }]
  if (Array.isArray(queryVector) && queryVector.length > 0 && config.vectorField) {
    retrievers.push({
      knn: {
        field: config.vectorField,
        query_vector: queryVector,
        k: Math.max(size, 20),
        num_candidates: Math.max(100, size * 8),
        filter: { bool: { filter: filters } },
      },
    })
  }
  return {
    from,
    size,
    _source: [
      'postId',
      'chunkId',
      'communityId',
      'sectionId',
      'sectionName',
      'title',
      'fieldLabel',
      'fieldType',
      'preview',
      'text',
      'visibility',
      'sourceUpdatedAt',
    ],
    retriever: {
      rank_fusion: {
        retrievers,
        rank_window_size: Math.max(50, size * 5),
        rank_constant: 60,
      },
    },
  }
}

function evidenceNeedlesForQuery(query?: RagQuery): string[] {
  if (!query) return []
  const candidates = [
    query.raw,
    query.normalized,
    ...query.expansionTerms,
  ]
  const seen = new Set<string>()
  const needles: string[] = []
  for (const candidate of candidates) {
    const text = String(candidate || '').replace(/\s+/g, '').trim()
    if (text.length < 2 || seen.has(text)) continue
    seen.add(text)
    needles.push(text)
  }
  return needles.sort((left, right) => right.length - left.length || left.localeCompare(right))
}

function evidenceSnippetFromText(text: string, fallback: string, query?: RagQuery): string {
  const source = String(text || fallback || '').replace(/\s+/g, ' ').trim()
  if (!source) return ''
  const fallbackText = String(fallback || source).replace(/\s+/g, ' ').trim()
  const sourceLower = source.toLowerCase()
  const matchIndex = evidenceNeedlesForQuery(query)
    .map((needle) => sourceLower.indexOf(needle.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0]
  if (matchIndex === undefined) return fallbackText ? fallbackText.slice(0, 180) : source.slice(0, 180)

  const chars = Array.from(source)
  const prefix = source.slice(0, matchIndex)
  const charIndex = Array.from(prefix).length
  const start = Math.max(0, charIndex - 48)
  const end = Math.min(chars.length, charIndex + 132)
  const snippet = `${start > 0 ? '...' : ''}${chars.slice(start, end).join('')}${end < chars.length ? '...' : ''}`
  return snippet
}

function toCitation(hit: any, query?: RagQuery): RagCitation {
  const source = hit?._source || hit || {}
  const sourceText = String(source.text || source.preview || '')
  const sourcePreview = String(source.preview || source.text || '')
  return {
    postId: String(source.postId || ''),
    chunkId: String(source.chunkId || hit?._id || ''),
    communityId: String(source.communityId || ''),
    title: String(source.title || ''),
    sectionId: String(source.sectionId || ''),
    sectionName: String(source.sectionName || ''),
    fieldLabel: String(source.fieldLabel || ''),
    fieldType: String(source.fieldType || ''),
    preview: evidenceSnippetFromText(sourceText, sourcePreview, query).slice(0, 200),
    score: Number(hit?._score || source.score || 0),
    visibility: normalizeRagVisibility(source.visibility),
    sourceUpdatedAt: String(source.sourceUpdatedAt || ''),
  }
}

function buildAnswerPrompt(query: string, citations: RagCitation[]) {
  const evidence = citations
    .slice(0, 6)
    .map((citation, index) => `${index + 1}. ${citation.title} / ${citation.fieldLabel}: ${citation.preview}`)
    .join('\n')
  return [
    '你是 HappyHome 小程序的帖子搜索助手。',
    '只根据下面的帖子证据回答，不能编造没有证据的内容。',
    '回答要简短，并说明最相关的帖子。',
    `用户问题：${query}`,
    `证据：\n${evidence}`,
  ].join('\n\n')
}

function extractCompletionText(value: any): string {
  const completion = value?.completion?.[0]?.result || value?.completion?.[0]?.text
  const response = value?.Response || value
  const choice = response?.Choices?.[0] || response?.choices?.[0] || {}
  const result = value?.result
    || value?.text
    || value?.choices?.[0]?.message?.content
    || choice?.Message?.Content
    || choice?.message?.content
    || choice?.Content
  return String(completion || result || '').trim()
}

export function extractEmbeddingVector(value: any): number[] {
  const response = value?.Response || value
  const direct = value?.embedding?.[0]?.result
    || value?.embedding?.[0]?.embedding
    || value?.data?.[0]?.embedding
    || response?.Data?.[0]?.Embedding
    || response?.Data?.[0]?.embedding
    || response?.data?.[0]?.embedding
    || value?.result
    || value?.vector
  if (!Array.isArray(direct)) return []
  return direct.map((item) => Number(item)).filter((item) => Number.isFinite(item))
}

export function extractEmbeddingVectors(value: any): number[][] {
  const response = value?.Response || value
  const rows = response?.Data || response?.data || value?.embedding
  if (!Array.isArray(rows)) return []
  return rows.map((row: any) => {
    const vector = row?.Embedding || row?.embedding || row?.result
    return Array.isArray(vector) ? vector.map(Number) : []
  })
}

function isTencentEsNotFoundError(error: any) {
  const text = String(error?.message || error)
  return /\b404\b|not[_ -]?found|index_not_found/i.test(text)
}

function buildTencentEsIndexMapping(config: TencentRagConfig, dims: number) {
  const vectorField = String(config.vectorField || 'embedding')
  return {
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
        [vectorField]: {
          type: 'dense_vector',
          dims,
          index: true,
          similarity: 'cosine',
        },
      },
    },
  }
}

function extractRerankItems(value: any): Array<{ index: number; score: number }> {
  const response = value?.Response || value
  const rawItems = Array.isArray(value?.rerank)
    ? value.rerank
    : (Array.isArray(value?.data)
      ? value.data
      : (Array.isArray(response?.Data) ? response.Data : []))
  return rawItems
    .map((item: any) => ({
      index: Number(item?.index ?? item?.document_index ?? item?.Index ?? item?.DocumentIndex),
      score: Number(item?.relevance_score ?? item?.score ?? item?.RelevanceScore ?? item?.Score),
    }))
    .filter((item: { index: number; score: number }) => Number.isFinite(item.index) && Number.isFinite(item.score))
}

function deterministicAnswer(citations: RagCitation[]) {
  const postCount = new Set(citations.map((citation) => citation.postId)).size
  const top = citations[0]
  return `找到 ${postCount} 篇相关帖子。最相关的是《${top.title}》，命中片段：${top.preview}`
}

function isLkeapConfigured(config: TencentLkeapRagConfig) {
  return Boolean(config.secretId && config.secretKey && config.region && config.embeddingModel && config.rerankModel && config.chatModel)
}

function tc3Sha256(message: string) {
  return createHash('sha256').update(message, 'utf8').digest('hex')
}

function tc3HmacBuffer(key: Buffer | string, message: string) {
  return createHmac('sha256', key).update(message, 'utf8').digest()
}

function tc3HmacHex(key: Buffer | string, message: string) {
  return createHmac('sha256', key).update(message, 'utf8').digest('hex')
}

async function requestTencentLkeap<T>(config: TencentLkeapRagConfig, action: string, body: unknown): Promise<T> {
  const host = 'lkeap.tencentcloudapi.com'
  const service = 'lkeap'
  const version = '2024-05-22'
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const payload = JSON.stringify(body)
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`
  const signedHeaders = 'content-type;host'
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, tc3Sha256(payload)].join('\n')
  const credentialScope = `${date}/${service}/tc3_request`
  const stringToSign = ['TC3-HMAC-SHA256', timestamp, credentialScope, tc3Sha256(canonicalRequest)].join('\n')
  const secretDate = tc3HmacBuffer(`TC3${config.secretKey}`, date)
  const secretService = tc3HmacBuffer(secretDate, service)
  const secretSigning = tc3HmacBuffer(secretService, 'tc3_request')
  const signature = tc3HmacHex(secretSigning, stringToSign)
  const authorization = `TC3-HMAC-SHA256 Credential=${config.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return new Promise<T>((resolve, reject) => {
    const req = https.request({
      hostname: host,
      method: 'POST',
      path: '/',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json; charset=utf-8',
        Host: host,
        'X-TC-Action': action,
        'X-TC-Version': version,
        'X-TC-Timestamp': String(timestamp),
        'X-TC-Region': config.region,
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let parsed: any
        try {
          parsed = text ? JSON.parse(text) : {}
        } catch (error) {
          reject(error)
          return
        }
        if ((res.statusCode || 500) >= 400 || parsed?.Response?.Error) {
          const error = parsed?.Response?.Error
          reject(new Error(`Tencent LKEAP ${action} failed: ${error?.Code || res.statusCode} ${error?.Message || text}`))
          return
        }
        resolve(parsed.Response as T)
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function extractLkeapEmbedding(value: any): number[] {
  const direct = value?.Data?.[0]?.Embedding || value?.data?.[0]?.embedding || value?.Embedding || value?.embedding
  if (!Array.isArray(direct)) return []
  return direct.map((item) => Number(item)).filter((item) => Number.isFinite(item))
}

function extractLkeapAnswer(value: any): string {
  const choice = value?.Choices?.[0] || value?.choices?.[0] || {}
  return String(choice?.Message?.Content || choice?.message?.content || choice?.Content || '').trim()
}

function vectorCosine(left?: number[], right?: number[]) {
  if (!Array.isArray(left) || !Array.isArray(right) || !left.length || !right.length) return 0
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  const len = Math.min(left.length, right.length)
  for (let index = 0; index < len; index += 1) {
    dot += left[index] * right[index]
    leftNorm += left[index] * left[index]
    rightNorm += right[index] * right[index]
  }
  if (!leftNorm || !rightNorm) return 0
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

function lexicalEvidenceScore(query: RagQuery, chunk: Pick<RagChunkDocument, 'text' | 'preview' | 'title' | 'fieldLabel'>) {
  const haystack = normalizeSearchText([chunk.title, chunk.fieldLabel, chunk.preview, chunk.text].filter(Boolean).join(' '))
  const haystackCompact = haystack.replace(/\s+/g, '')
  let score = 0
  if (query.normalized && haystackCompact.includes(query.normalized.replace(/\s+/g, ''))) score += 2
  for (const term of query.expansionTerms) {
    const normalizedTerm = normalizeSearchText(term)
    if (term && (haystack.includes(normalizedTerm) || haystackCompact.includes(normalizedTerm.replace(/\s+/g, '')))) score += 1
  }
  return score
}

export function hasRagEvidenceSignal(citation: {
  semanticScore?: number
  lexicalScore?: number
  rerankScore?: number
}) {
  if (Number(citation.lexicalScore || 0) > 0) return true

  const rerankScore = Number(citation.rerankScore)
  if (Number.isFinite(rerankScore)) {
    return rerankScore >= MIN_LKEAP_RERANK_EVIDENCE_SCORE
  }

  return Number(citation.semanticScore || 0) >= MIN_LKEAP_SEMANTIC_EVIDENCE_SCORE
}

export function selectLkeapCandidateCitations(citations: ScoredRagCitation[], limit?: number): ScoredRagCitation[] {
  const candidateLimit = Math.max(10, Math.min(30, Number(limit || 20) * 3))
  const lexicalCandidates = citations
    .filter((citation) => Number(citation.lexicalScore || 0) > 0)
    .sort((left, right) => (
      Number(right.lexicalScore || 0) - Number(left.lexicalScore || 0) ||
      Number(right.score || 0) - Number(left.score || 0)
    ))
    .slice(0, 50)
  const semanticCandidates = citations
    .slice()
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))

  const selected = new Map<string, ScoredRagCitation>()
  const add = (citation: ScoredRagCitation) => {
    const key = citation.chunkId || `${citation.postId}:${citation.fieldLabel}:${citation.preview}`
    if (!selected.has(key)) selected.set(key, citation)
  }
  lexicalCandidates.forEach(add)

  const targetSize = Math.max(candidateLimit, lexicalCandidates.length)
  for (const citation of semanticCandidates) {
    if (selected.size >= targetSize) break
    add(citation)
  }

  return Array.from(selected.values())
}

export function rankLkeapEvidenceCitations(citations: ScoredRagCitation[], limit?: number): ScoredRagCitation[] {
  const evidenceLimit = Math.max(5, Math.min(20, Number(limit || 20)))
  return citations
    .filter(hasRagEvidenceSignal)
    .sort((left, right) => {
      const leftLexical = Number(left.lexicalScore || 0) > 0 ? 1 : 0
      const rightLexical = Number(right.lexicalScore || 0) > 0 ? 1 : 0
      if (leftLexical !== rightLexical) return rightLexical - leftLexical

      const leftRerank = Number(left.rerankScore)
      const rightRerank = Number(right.rerankScore)
      if (Number.isFinite(leftRerank) && Number.isFinite(rightRerank) && leftRerank !== rightRerank) {
        return rightRerank - leftRerank
      }

      return Number(right.score || 0) - Number(left.score || 0)
    })
    .slice(0, evidenceLimit)
}

async function loadLkeapChunks(input: RagProviderSearchInput, pageSize: number, maxChunks: number) {
  const chunks: Array<RagChunkDocument & { _id?: string; embedding?: number[] }> = []
  let skip = 0
  while (chunks.length < maxChunks) {
    const page = await db.query(POST_RAG_CHUNKS, { communityId: input.communityId }, {
      orderBy: ['sourceUpdatedAt', 'desc'],
      skip,
      limit: pageSize,
    }) as Array<RagChunkDocument & { _id?: string; embedding?: number[] }>
    if (!page.length) break
    for (const chunk of page) {
      if (
        (!input.sectionId || chunk.sectionId === input.sectionId) &&
        isEvidenceVisible(chunk.visibility, input.includeMemberOnly !== false) &&
        Array.isArray(chunk.embedding) &&
        chunk.embedding.length
      ) {
        chunks.push(chunk)
      }
      if (chunks.length >= maxChunks) break
    }
    skip += page.length
    if (page.length < pageSize) break
  }
  return chunks
}

async function upsertCloudBaseRagChunk(chunk: RagChunkDocument & { embedding?: number[] }) {
  const data = {
    ...chunk,
    _id: chunk.chunkId,
    updatedAt: new Date().toISOString(),
  }
  const { _id, ...updateData } = data
  try {
    const result = await db.updateById(POST_RAG_CHUNKS, chunk.chunkId, updateData) as any
    if (result?.stats && Number(result.stats.updated || 0) === 0) {
      await db.create(POST_RAG_CHUNKS, data)
    }
  } catch {
    await db.create(POST_RAG_CHUNKS, data)
  }
}

async function deleteCloudBaseRagChunksByPostId(postId: string) {
  while (true) {
    const chunks = await db.query(POST_RAG_CHUNKS, { postId }, { limit: 100 }) as Array<{ _id?: string; chunkId?: string }>
    if (!chunks.length) break
    await Promise.all(chunks.map((chunk) => db.removeById(POST_RAG_CHUNKS, String(chunk._id || chunk.chunkId))))
    if (chunks.length < 100) break
  }
}

export function createTencentLkeapCloudBaseProvider(config: TencentLkeapRagConfig): TencentRagProvider {
  const embed = async (text: string, textType: 'query' | 'document'): Promise<number[]> => {
    const response = await requestTencentLkeap<any>(config, 'GetEmbedding', {
      Model: config.embeddingModel,
      Inputs: [text],
      TextType: textType,
    })
    return extractLkeapEmbedding(response)
  }

  const rerank = async (query: string, citations: ScoredRagCitation[]): Promise<ScoredRagCitation[]> => {
    if (citations.length <= 1) return citations
    const response = await requestTencentLkeap<any>(config, 'RunRerank', {
      Query: query,
      Docs: citations.map((citation) => [citation.title, citation.fieldLabel, citation.preview].filter(Boolean).join(' / ')),
      Model: config.rerankModel,
    })
    const scores = Array.isArray(response?.ScoreList) ? response.ScoreList.map((score: any) => Number(score)) : []
    if (scores.length !== citations.length || scores.some((score: number) => !Number.isFinite(score))) return citations
    return citations
      .map((citation, index) => ({ ...citation, score: scores[index], rerankScore: scores[index] }))
      .sort((left, right) => right.score - left.score)
  }

  const answer = async (query: string, citations: RagCitation[]) => {
    const response = await requestTencentLkeap<any>(config, 'ChatCompletions', {
      Model: config.chatModel,
      Messages: [{
        Role: 'user',
        Content: buildAnswerPrompt(query, citations),
      }],
      Stream: false,
      MaxTokens: 300,
      Temperature: 0.1,
    })
    return extractLkeapAnswer(response)
  }

  return {
    name: 'tencent-lkeap-cloudbase',
    isConfigured: () => isLkeapConfigured(config),
    async search(input) {
      if (!isLkeapConfigured(config)) throw new Error('rag_provider_not_configured')
      const queryVector = await embed(input.ragQuery.expandedText, 'query')
      const chunks = await loadLkeapChunks(input, config.chunkPageSize, config.maxCandidateChunks)
      let citations: ScoredRagCitation[] = chunks
        .map((chunk) => {
          const semanticScore = vectorCosine(queryVector, chunk.embedding)
          const lexicalScore = lexicalEvidenceScore(input.ragQuery, chunk)
          return {
            ...toCitation({ _id: chunk.chunkId, _source: chunk }, input.ragQuery),
            score: semanticScore + lexicalScore * 0.08,
            semanticScore,
            lexicalScore,
          }
        })
        .filter((citation) => citation.postId && citation.chunkId)
      citations = selectLkeapCandidateCitations(citations, input.limit)

      citations = await rerank(input.ragQuery.raw, citations)
      citations = rankLkeapEvidenceCitations(citations, input.limit)
      const generatedAnswer = citations.length ? await answer(input.query, citations).catch(() => '') : ''
      return {
        total: citations.length,
        answer: generatedAnswer || (citations.length ? deterministicAnswer(citations) : ''),
        citations,
        items: resultItemsFromCitations(citations),
        mode: 'rag' as const,
      }
    },
    async upsertChunks(chunks) {
      if (!isLkeapConfigured(config)) throw new Error('rag_provider_not_configured')
      for (const chunk of chunks) {
        const embedding = await embed([chunk.title, chunk.fieldLabel, chunk.text].filter(Boolean).join('\n'), 'document')
        await upsertCloudBaseRagChunk({ ...chunk, embedding })
      }
    },
    async deletePostChunks(postId) {
      await deleteCloudBaseRagChunksByPostId(postId)
    },
  }
}

export function createTencentCloudBaseAtomicProvider(
  config: TencentCloudBaseAtomicRagConfig,
  options: TencentRagProviderOptions = {},
): TencentRagProvider {
  const sendAtomicJson = options.requestAtomicJson || requestTencentEsAtomic
  const embed = async (text: string) => extractEmbeddingVector(await sendAtomicJson<any>(config, 'GetTextEmbedding', {
    ModelName: config.embeddingModel,
    Texts: [text],
  }))
  const rerank = async (query: string, citations: ScoredRagCitation[]) => {
    if (citations.length <= 1) return citations
    const response = await sendAtomicJson<any>(config, 'RunRerank', {
      ModelName: config.rerankModel,
      Query: query,
      Documents: citations.map((citation) => citation.preview),
      ReturnDocuments: false,
    })
    const scores = new Map<number, number>(extractRerankItems(response).map((item) => [item.index, item.score]))
    return citations.map((citation, index) => ({
      ...citation,
      score: Number(scores.get(index) ?? citation.score),
      rerankScore: scores.get(index),
    })).sort((left, right) => right.score - left.score)
  }
  return {
    name: 'tencent-cloudbase-atomic',
    isConfigured: () => hasAtomicModelConfig(config),
    async search(input) {
      if (!hasAtomicModelConfig(config)) throw new Error('rag_provider_not_configured')
      const queryVector = await embed(input.ragQuery.expandedText)
      const chunks = await loadLkeapChunks(input, config.chunkPageSize, config.maxCandidateChunks)
      let citations: ScoredRagCitation[] = chunks.map((chunk) => {
        const semanticScore = vectorCosine(queryVector, chunk.embedding)
        const lexicalScore = lexicalEvidenceScore(input.ragQuery, chunk)
        return { ...toCitation({ _id: chunk.chunkId, _source: chunk }, input.ragQuery), score: semanticScore + lexicalScore * 0.08, semanticScore, lexicalScore }
      }).filter((citation) => citation.postId && citation.chunkId)
      citations = selectLkeapCandidateCitations(citations, input.limit)
      citations = rankLkeapEvidenceCitations(await rerank(input.ragQuery.raw, citations), input.limit)
      const answerResponse = citations.length ? await sendAtomicJson<any>(config, 'ChatCompletions', {
        ModelName: config.llmModel,
        Messages: [{ Role: 'user', Content: buildAnswerPrompt(input.query, citations) }],
        Stream: false,
        Temperature: 0.1,
      }) : null
      return {
        total: citations.length,
        answer: extractCompletionText(answerResponse) || (citations.length ? deterministicAnswer(citations) : ''),
        citations,
        items: resultItemsFromCitations(citations),
        mode: 'rag' as const,
      }
    },
    async upsertChunks(chunks) {
      if (!hasAtomicModelConfig(config)) throw new Error('rag_provider_not_configured')
      for (const chunk of chunks) {
        const embedding = await embed([chunk.title, chunk.fieldLabel, chunk.text].filter(Boolean).join('\n'))
        await upsertCloudBaseRagChunk({ ...chunk, embedding })
      }
    },
    async deletePostChunks(postId) { await deleteCloudBaseRagChunksByPostId(postId) },
  }
}

export function createTencentRagProvider(
  config: TencentRagConfig,
  options: TencentRagProviderOptions = {},
): TencentRagProvider {
  const sendJson = options.requestJson || requestJson
  const sendAtomicJson = options.requestAtomicJson || requestTencentEsAtomic
  const embedText = async (text: string): Promise<number[]> => {
    const response = config.embeddingInferenceId
      ? await sendJson<any>(config, 'POST', `_inference/text_embedding/${config.embeddingInferenceId}`, {
        input: [text],
      })
      : await sendAtomicJson<any>(config, 'GetTextEmbedding', {
        ModelName: config.embeddingModel,
        Texts: [text],
      })
    return extractEmbeddingVector(response)
  }

  return {
    name: 'tencent-es-ai-search',
    isConfigured: () => isConfigured(config),
    async ensureIndex() {
      if (!isConfigured(config)) throw new Error('rag_provider_not_configured')
      try {
        await sendJson<any>(config, 'HEAD', config.indexName)
        return { created: false, indexName: config.indexName }
      } catch (error) {
        if (!isTencentEsNotFoundError(error)) throw error
      }
      const probeVector = await embedText('HappyHome RAG index mapping dimension probe')
      const dims = probeVector.length
      if (dims <= 0) throw new Error('embedding endpoint returned no vector; cannot create dense_vector mapping')
      await sendJson(config, 'PUT', config.indexName, buildTencentEsIndexMapping(config, dims))
      return { created: true, indexName: config.indexName, dims }
    },
    async search(input) {
      if (!isConfigured(config)) throw new Error('rag_provider_not_configured')
      const queryVector = await embedText(input.ragQuery.expandedText)
      const searchBody = buildTencentEsHybridSearchBody(input, config, queryVector)
      const response = await sendJson<any>(config, 'POST', `${config.indexName}/_search`, searchBody)
      let citations: ScoredRagCitation[] = (response?.hits?.hits || [])
        .map((hit: any) => {
          const citation = toCitation(hit, input.ragQuery)
          const source = hit?._source || hit || {}
          return {
            ...citation,
            lexicalScore: lexicalEvidenceScore(input.ragQuery, {
              title: citation.title,
              fieldLabel: citation.fieldLabel,
              preview: citation.preview,
              text: String(source.text || citation.preview),
            }),
          }
        })
        .filter((citation: RagCitation) => citation.postId && citation.chunkId)
        .filter((citation: RagCitation) => isEvidenceVisible(citation.visibility, input.includeMemberOnly !== false))

      if (citations.length > 0) {
        const documents = citations.map((citation: RagCitation) => citation.preview)
        const reranked = config.rerankInferenceId
          ? await sendJson<any>(config, 'POST', `_inference/rerank/${config.rerankInferenceId}`, {
            query: input.ragQuery.raw,
            input: documents,
          })
          : await sendAtomicJson<any>(config, 'RunRerank', {
            ModelName: config.rerankModel,
            Query: input.ragQuery.raw,
            Documents: documents,
            ReturnDocuments: false,
          })
        const byIndex = new Map<number, number>(extractRerankItems(reranked).map((item) => [item.index, item.score]))
        citations = citations
          .map((citation: ScoredRagCitation, index: number) => ({
            ...citation,
            score: Number(byIndex.get(index) ?? citation.score),
            rerankScore: byIndex.has(index) ? Number(byIndex.get(index)) : citation.rerankScore,
          }))
          .sort((left: ScoredRagCitation, right: ScoredRagCitation) => right.score - left.score)
      }
      citations = rankLkeapEvidenceCitations(citations, input.limit)

      const answerResponse = citations.length
        ? (config.llmInferenceId
          ? await sendJson<any>(config, 'POST', `_inference/completion/${config.llmInferenceId}?timeout=300s`, {
            input: buildAnswerPrompt(input.query, citations),
            task_settings: { temperature: 0.1, max_new_tokens: 300 },
          })
          : await sendAtomicJson<any>(config, 'ChatCompletions', {
            ModelName: config.llmModel,
            Messages: [{ Role: 'user', Content: buildAnswerPrompt(input.query, citations) }],
            Stream: false,
            Temperature: 0.1,
          }))
        : null
      const answer = extractCompletionText(answerResponse) || (citations.length ? deterministicAnswer(citations) : '')
      return {
        total: citations.length,
        answer,
        citations,
        items: resultItemsFromCitations(citations),
        mode: 'rag' as const,
      }
    },
    async upsertChunks(chunks) {
      if (!isConfigured(config)) throw new Error('rag_provider_not_configured')
      for (const chunk of chunks) {
        const embedding = await embedText([chunk.title, chunk.fieldLabel, chunk.text].filter(Boolean).join('\n'))
        await sendJson(config, 'PUT', `${config.indexName}/_doc/${encodeURIComponent(chunk.chunkId)}`, {
          ...chunk,
          ...(embedding.length > 0 && config.vectorField ? { [config.vectorField]: embedding } : {}),
        })
      }
    },
    async deletePostChunks(postId) {
      if (!isConfigured(config)) throw new Error('rag_provider_not_configured')
      try {
        await sendJson(config, 'POST', `${config.indexName}/_delete_by_query`, {
          query: { term: { postId } },
        })
      } catch (error) {
        if (isTencentEsNotFoundError(error)) return
        throw error
      }
    },
  }
}

export async function ensurePostRagIndex(options: { provider?: TencentRagProvider } = {}) {
  const provider = options.provider || createTencentRagProviderFromEnv()
  if (!provider.isConfigured()) throw new Error('rag_provider_not_configured')
  if (!provider.ensureIndex) return { created: false, indexName: '', skipped: true }
  return provider.ensureIndex()
}

function stableId(value: string) {
  return createHash('sha1').update(value).digest('hex')
}

function isPlainRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asCleanText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function basenameFromMediaRef(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const withoutQuery = raw.split(/[?#]/)[0]
  const normalized = withoutQuery.replace(/\\/g, '/')
  const name = normalized.split('/').filter(Boolean).pop() || ''
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

function videoIdentityParts(video: Record<string, any>): string[] {
  return [
    video.source,
    video.fileID,
    video.url,
    video.feedId,
    video.nonceId,
    video.finderUserName,
    video.appId,
    video.path,
    video.itemId,
    video.title,
  ].map(asCleanText).filter(Boolean)
}

export function buildVideoRagCacheKey(video: unknown): string {
  const record = isPlainRecord(video) ? video : {}
  const parts = videoIdentityParts(record)
  return `vrk_${stableId(parts.length ? parts.join('\u0001') : JSON.stringify(record))}`
}

function sourceUpdatedAtForPost(post: Post, fallback: string): string {
  return String((post as any)?.updatedAt || (post as any)?.createdAt || fallback)
}

function extractVideoEntriesForRag(post: Post, section: Section) {
  const content = (post as any)?.content || {}
  const widgets = (section.widgets || [])
    .filter((widget: any) => widget?.type === 'video_group')
    .slice()
    .sort((left: any, right: any) => Number(left.order || 0) - Number(right.order || 0))
  const entries: Array<{
    widget: any
    video: Record<string, any>
    videoIndex: number
    cacheKey: string
  }> = []
  for (const widget of widgets) {
    const value = content[widget.widgetId]
    if (!Array.isArray(value)) continue
    value.forEach((item, index) => {
      if (!isPlainRecord(item)) return
      entries.push({
        widget,
        video: item,
        videoIndex: index,
        cacheKey: buildVideoRagCacheKey(item),
      })
    })
  }
  return entries
}

function videoMetadataLines(video: Record<string, any>): string[] {
  const lines: string[] = []
  const title = asCleanText(video.title)
  const description = asCleanText(video.description)
  const hint = asCleanText(video.hint)
  const source = asCleanText(video.source)
  const duration = Number(video.duration || 0)
  const fileName = basenameFromMediaRef(video.fileID || video.url || video.path)
  const coverName = basenameFromMediaRef(video.cover)
  if (title) lines.push(`视频名称：${title}`)
  if (description) lines.push(`描述：${description}`)
  if (hint) lines.push(`提示：${hint}`)
  if (source) lines.push(`来源：${source}`)
  if (duration > 0) lines.push(`时长：${Math.round(duration)}秒`)
  if (fileName) lines.push(`文件名：${fileName}`)
  if (coverName) lines.push(`封面：${coverName}`)
  return lines
}

function metadataTextLength(video: Record<string, any>): number {
  return [
    video.title,
    video.description,
    video.hint,
  ]
    .map(asCleanText)
    .join('')
    .replace(/\s+/g, '')
    .length
}

function previewForRagText(value: string): string {
  const text = asCleanText(value)
  return Array.from(text).slice(0, 180).join('')
}

function formatFrameTime(frame: { timeMs?: number; timeSeconds?: number }): string {
  const seconds = Number.isFinite(Number(frame.timeSeconds))
    ? Number(frame.timeSeconds)
    : Number(frame.timeMs || 0) / 1000
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(1)}s`
}

function videoAnalysisLines(asset: VideoRagAsset): string[] {
  const lines: string[] = []
  if (asset.visualSummary) lines.push(`视觉摘要：${asCleanText(asset.visualSummary)}`)
  if (asset.ocrText) lines.push(`OCR：${asCleanText(asset.ocrText)}`)
  if (asset.asrTranscript) lines.push(`语音转写：${asCleanText(asset.asrTranscript)}`)
  for (const frame of asset.frameSummaries || []) {
    const parts: string[] = []
    if (frame.summary) parts.push(asCleanText(frame.summary))
    if (frame.ocrText) parts.push(`OCR：${asCleanText(frame.ocrText)}`)
    if (!parts.length) continue
    const time = formatFrameTime(frame)
    lines.push(time ? `关键帧 ${time}：${parts.join(' ')}` : `关键帧：${parts.join(' ')}`)
  }
  return lines
}

function widgetRagVisibility(widget: { visibility?: unknown }): 'public' | 'member' {
  return widget.visibility === 'member' ? 'member' : 'public'
}

export function buildVideoRagChunksForPost(
  post: Post,
  section: Section,
  options: {
    now?: string
    assetsByCacheKey?: Map<string, VideoRagAsset>
  } = {}
): RagChunkDocument[] {
  const now = options.now || new Date().toISOString()
  const sourceUpdatedAt = sourceUpdatedAtForPost(post, now)
  const sectionName = String(section?.name || '')
  const title = asCleanText((post as any)?.content?.title) || 'Untitled'
  const chunks: RagChunkDocument[] = []

  for (const entry of extractVideoEntriesForRag(post, section)) {
    const visibility = widgetRagVisibility(entry.widget)
    const metadataLines = videoMetadataLines(entry.video)
    if (metadataLines.length) {
      const text = metadataLines.join('\n')
      chunks.push({
        chunkId: `prv_${stableId(`${post._id}\u0001${entry.cacheKey}\u0001metadata\u0001${text}`)}`,
        postId: post._id,
        communityId: post.communityId,
        sectionId: post.sectionId,
        sectionName,
        title,
        fieldLabel: String(entry.widget.label || '视频'),
        fieldType: 'video_group',
        text,
        preview: previewForRagText(text),
        sourceUpdatedAt,
        visibility,
        metadata: {
          evidenceSource: 'video_metadata',
          costTier: 'free',
          cacheKey: entry.cacheKey,
          widgetId: entry.widget.widgetId,
          fieldKey: entry.widget.fieldKey,
          videoItemId: asCleanText(entry.video.itemId),
          videoIndex: entry.videoIndex,
          source: asCleanText(entry.video.source),
        },
      })
    }

    const asset = options.assetsByCacheKey?.get(entry.cacheKey)
    if (asset?.status === 'ready') {
      const analysisLines = videoAnalysisLines(asset)
      if (analysisLines.length) {
        const text = analysisLines.join('\n')
        chunks.push({
          chunkId: `prv_${stableId(`${post._id}\u0001${entry.cacheKey}\u0001analysis\u0001${asset.updatedAt || ''}\u0001${text}`)}`,
          postId: post._id,
          communityId: post.communityId,
          sectionId: post.sectionId,
          sectionName,
          title,
          fieldLabel: `${String(entry.widget.label || '视频')}理解`,
          fieldType: 'video_group',
          text,
          preview: previewForRagText(text),
          sourceUpdatedAt: asset.updatedAt || sourceUpdatedAt,
          visibility,
          metadata: {
            evidenceSource: 'video_analysis_cache',
            costTier: 'cached',
            cacheKey: entry.cacheKey,
            widgetId: entry.widget.widgetId,
            fieldKey: entry.widget.fieldKey,
            videoItemId: asCleanText(entry.video.itemId),
            videoIndex: entry.videoIndex,
            source: asCleanText(entry.video.source),
          },
        })
      }
    }
  }

  return chunks
}

export function readVideoRagCostPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): VideoRagCostPolicy {
  return {
    analysisEnabled: /^(1|true|yes|on)$/i.test(String(env.POST_VIDEO_RAG_ANALYSIS_ENABLED || '')),
    maxJobsPerPost: Math.max(0, Math.min(10, Math.floor(Number(env.POST_VIDEO_RAG_MAX_JOBS_PER_POST || 2)))),
    maxCostUnitsPerPost: Math.max(0, Math.min(1000, Math.floor(Number(env.POST_VIDEO_RAG_MAX_COST_UNITS_PER_POST || 16)))),
    maxFramesPerVideo: Math.max(0, Math.min(12, Math.floor(Number(env.POST_VIDEO_RAG_MAX_FRAMES_PER_VIDEO || 4)))),
    maxAsrSecondsPerVideo: Math.max(0, Math.min(7200, Math.floor(Number(env.POST_VIDEO_RAG_MAX_ASR_SECONDS_PER_VIDEO || 120)))),
    minMetadataTextCharsForAnalysis: Math.max(0, Math.min(500, Math.floor(Number(env.POST_VIDEO_RAG_MIN_TEXT_CHARS_FOR_ANALYSIS || 48)))),
  }
}

function estimateVideoAnalysisCostUnits(policy: VideoRagCostPolicy, durationSeconds: number): number {
  const frameUnits = Math.max(0, Number(policy.maxFramesPerVideo || 0))
  const asrSeconds = Math.min(
    Math.max(0, Number(durationSeconds || 0)),
    Math.max(0, Number(policy.maxAsrSecondsPerVideo || 0))
  )
  return frameUnits + Math.ceil(asrSeconds / 30)
}

function canAnalyzeVideoSource(video: Record<string, any>): boolean {
  return asCleanText(video.source) === 'cos' && Boolean(asCleanText(video.fileID))
}

export function planVideoRagAnalysisJobsForPost(
  post: Post,
  section: Section,
  options: {
    now?: string
    assetsByCacheKey?: Map<string, VideoRagAsset>
    policy?: VideoRagCostPolicy
  } = {}
): VideoRagAnalysisJobDocument[] {
  const policy = options.policy || readVideoRagCostPolicyFromEnv()
  if (!policy.analysisEnabled || policy.maxJobsPerPost <= 0 || policy.maxCostUnitsPerPost <= 0) return []

  const now = options.now || new Date().toISOString()
  const jobs: VideoRagAnalysisJobDocument[] = []
  let usedCostUnits = 0
  for (const entry of extractVideoEntriesForRag(post, section)) {
    if (jobs.length >= policy.maxJobsPerPost) break
    if (!canAnalyzeVideoSource(entry.video)) continue
    const existingAsset = options.assetsByCacheKey?.get(entry.cacheKey)
    if (existingAsset && existingAsset.status !== 'failed') continue
    if (metadataTextLength(entry.video) >= policy.minMetadataTextCharsForAnalysis) continue

    const durationSeconds = Math.floor(Number(entry.video.duration || 0))
    const canAnalyzeAsr = policy.maxAsrSecondsPerVideo > 0 && durationSeconds > 0 && durationSeconds <= policy.maxAsrSecondsPerVideo
    if (!canAnalyzeAsr) continue
    const requestedAnalyses = [
      ...(policy.maxFramesPerVideo > 0 ? ['cover_ocr', 'keyframe_vision'] : []),
      'asr',
    ]
    const estimatedCostUnits = estimateVideoAnalysisCostUnits(policy, durationSeconds)
    if (estimatedCostUnits <= 0 || usedCostUnits + estimatedCostUnits > policy.maxCostUnitsPerPost) continue
    usedCostUnits += estimatedCostUnits

    jobs.push({
      _id: `vrj_${stableId(`${post._id}\u0001${entry.cacheKey}`)}`,
      postId: post._id,
      communityId: post.communityId,
      sectionId: post.sectionId,
      cacheKey: entry.cacheKey,
      status: 'pending',
      attempts: 0,
      reason: 'rag.video.low_text_signal',
      requestedAnalyses,
      frameStrategy: {
        includeCover: true,
        maxFrames: policy.maxFramesPerVideo,
        minSceneGapSeconds: 10,
      },
      maxAsrSeconds: policy.maxAsrSecondsPerVideo,
      estimatedCostUnits,
      budgetDate: now.slice(0, 10),
      video: {
        itemId: asCleanText(entry.video.itemId),
        title: asCleanText(entry.video.title),
        source: asCleanText(entry.video.source),
        fileID: asCleanText(entry.video.fileID),
        cover: asCleanText(entry.video.cover),
        duration: durationSeconds,
      },
      createdAt: now,
      updatedAt: now,
    })
  }
  return jobs
}

async function loadVideoRagAssetsByCacheKey(cacheKeys: string[]): Promise<Map<string, VideoRagAsset>> {
  const assets = new Map<string, VideoRagAsset>()
  for (const cacheKey of Array.from(new Set(cacheKeys)).filter(Boolean)) {
    try {
      const rows = await db.query(POST_VIDEO_RAG_ASSETS, { cacheKey }, { limit: 1 }) as VideoRagAsset[]
      if (rows[0]) assets.set(cacheKey, rows[0])
    } catch {
      // Video enrichment is optional; missing state must not block text RAG indexing.
    }
  }
  return assets
}

async function enqueueVideoRagAnalysisJobs(jobs: VideoRagAnalysisJobDocument[]) {
  let queuedCount = 0
  let skippedCount = 0
  for (const job of jobs) {
    try {
      await db.create(POST_VIDEO_RAG_JOBS, job)
      queuedCount += 1
    } catch {
      skippedCount += 1
    }
  }
  return { queuedCount, skippedCount }
}

function normalizeVideoAssetResult(value: Partial<VideoRagAsset>, job: VideoRagAnalysisJobDocument, provider: string, now: string): VideoRagAsset & {
  provider: string
  sourceJobId: string
  costUnits: number
} {
  return {
    _id: job.cacheKey,
    cacheKey: job.cacheKey,
    status: 'ready',
    visualSummary: asCleanText(value.visualSummary),
    ocrText: asCleanText(value.ocrText),
    asrTranscript: asCleanText(value.asrTranscript),
    frameSummaries: Array.isArray(value.frameSummaries)
      ? value.frameSummaries
        .map((frame) => ({
          timeMs: Number(frame.timeMs || 0),
          timeSeconds: Number(frame.timeSeconds || 0),
          summary: asCleanText(frame.summary),
          ocrText: asCleanText(frame.ocrText),
        }))
        .filter((frame) => frame.summary || frame.ocrText)
      : [],
    updatedAt: now,
    provider,
    sourceJobId: job._id,
    costUnits: Number(job.estimatedCostUnits || 0),
  }
}

async function upsertVideoRagAsset(asset: Record<string, any>) {
  const { _id, ...updateData } = asset
  try {
    const result = await db.updateById(POST_VIDEO_RAG_ASSETS, String(_id), updateData) as any
    if (result?.stats && Number(result.stats.updated || 0) === 0) {
      await db.create(POST_VIDEO_RAG_ASSETS, asset)
    }
  } catch {
    await db.create(POST_VIDEO_RAG_ASSETS, asset)
  }
}

function isVideoRagPendingResult(value: VideoRagAnalyzerResult): value is VideoRagAnalyzerPendingResult {
  return Boolean((value as VideoRagAnalyzerPendingResult)?.pending)
}

function parsePositiveInt(value: unknown, fallback: number, min: number, max: number) {
  const number = Math.floor(Number(value))
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, number))
}

function createDisabledVideoRagAnalyzer(): VideoRagAnalyzer {
  return {
    name: 'disabled-video-rag-analyzer',
    isConfigured: () => false,
    async analyze() {
      throw new Error('video_rag_analyzer_not_configured')
    },
  }
}

function requestExternalVideoAnalyzer(config: {
  url: string
  token: string
  timeoutMs: number
}, job: VideoRagAnalysisJobDocument): Promise<VideoRagAnalyzerResult> {
  const target = new URL(config.url)
  const transport = target.protocol === 'http:' ? http : https
  const payload = JSON.stringify({
    jobId: job._id,
    cacheKey: job.cacheKey,
    postId: job.postId,
    communityId: job.communityId,
    sectionId: job.sectionId,
    requestedAnalyses: job.requestedAnalyses,
    frameStrategy: job.frameStrategy,
    maxAsrSeconds: job.maxAsrSeconds,
    video: job.video,
  })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      req.destroy(new Error('video_rag_analyzer_timeout'))
    }, config.timeoutMs)
    const req = transport.request(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on('end', () => {
        clearTimeout(timer)
        const text = Buffer.concat(chunks).toString('utf8')
        if ((res.statusCode || 500) >= 400) {
          reject(new Error(`video_rag_analyzer_http_${res.statusCode}: ${text.slice(0, 300)}`))
          return
        }
        try {
          const parsed = text ? JSON.parse(text) : {}
          resolve(parsed.asset || parsed)
        } catch (error) {
          reject(error)
        }
      })
    })
    req.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    req.write(payload)
    req.end()
  })
}

async function resolveVideoUrlForAnalyzer(video: Record<string, any>): Promise<string> {
  const directUrl = asCleanText(video.url)
  if (directUrl) return directUrl
  const fileID = asCleanText(video.fileID)
  if (!fileID) throw new Error('video_rag_missing_video_url')
  // Lazy require keeps pure post-rag unit tests independent from wx-server-sdk setup.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const storage = require('./storage') as typeof import('./storage')
  return storage.getTempUrl(fileID)
}

interface TencentAsrVideoRagConfig {
  secretId: string
  secretKey: string
  region: string
  engineModelType: string
  channelNum: number
  resTextFormat: number
  timeoutMs: number
}

function isTencentAsrConfigured(config: TencentAsrVideoRagConfig) {
  return Boolean(config.secretId && config.secretKey && config.region && config.engineModelType)
}

async function requestTencentAsr<T>(config: TencentAsrVideoRagConfig, action: string, body: unknown): Promise<T> {
  const host = 'asr.tencentcloudapi.com'
  const service = 'asr'
  const version = '2019-06-14'
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const payload = JSON.stringify(body)
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`
  const signedHeaders = 'content-type;host'
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, tc3Sha256(payload)].join('\n')
  const credentialScope = `${date}/${service}/tc3_request`
  const stringToSign = ['TC3-HMAC-SHA256', timestamp, credentialScope, tc3Sha256(canonicalRequest)].join('\n')
  const secretDate = tc3HmacBuffer(`TC3${config.secretKey}`, date)
  const secretService = tc3HmacBuffer(secretDate, service)
  const secretSigning = tc3HmacBuffer(secretService, 'tc3_request')
  const signature = tc3HmacHex(secretSigning, stringToSign)
  const authorization = `TC3-HMAC-SHA256 Credential=${config.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return new Promise<T>((resolve, reject) => {
    const req = https.request({
      hostname: host,
      method: 'POST',
      path: '/',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json; charset=utf-8',
        Host: host,
        'X-TC-Action': action,
        'X-TC-Version': version,
        'X-TC-Timestamp': String(timestamp),
        'X-TC-Region': config.region,
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let parsed: any
        try {
          parsed = text ? JSON.parse(text) : {}
        } catch (error) {
          reject(error)
          return
        }
        if ((res.statusCode || 500) >= 400 || parsed?.Response?.Error) {
          const error = parsed?.Response?.Error
          reject(new Error(`Tencent ASR ${action} failed: ${error?.Code || res.statusCode} ${error?.Message || text}`))
          return
        }
        resolve(parsed.Response as T)
      })
    })
    req.setTimeout(config.timeoutMs, () => {
      req.destroy(new Error(`Tencent ASR ${action} timeout`))
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function extractTencentAsrTaskId(response: any): string {
  return String(response?.Data?.TaskId || response?.TaskId || '').trim()
}

function extractTencentAsrTaskData(response: any): any {
  return response?.Data || response?.Task || response || {}
}

function normalizeTencentAsrTaskStatus(data: any): string {
  const statusNumber = Number(data?.Status ?? data?.status)
  if (Number.isFinite(statusNumber)) return String(statusNumber)
  return String(data?.StatusStr || data?.statusStr || data?.StatusText || data?.statusText || '').trim()
}

function isTencentAsrProcessingStatus(status: string) {
  const normalized = String(status || '').trim().toLowerCase()
  return normalized === '0' || normalized === '1' || normalized === 'waiting' || normalized === 'doing' || normalized === 'processing'
}

function isTencentAsrSuccessStatus(status: string) {
  const normalized = String(status || '').trim().toLowerCase()
  return normalized === '2' || normalized === 'success' || normalized === 'completed' || normalized === 'finished'
}

function isTencentAsrFailedStatus(status: string) {
  const normalized = String(status || '').trim().toLowerCase()
  return normalized === '3' || normalized === 'failed' || normalized === 'error'
}

function extractTencentAsrTranscript(data: any): string {
  const direct = asCleanText(data?.Result || data?.result || data?.Text || data?.text)
  if (direct) return direct
  const detail = data?.ResultDetail || data?.resultDetail || data?.ResultDetailList || data?.resultDetailList
  if (Array.isArray(detail)) {
    return detail
      .map((item) => asCleanText(item?.FinalSentence || item?.Sentence || item?.Text || item?.text))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

async function requestTencentAsrVideoAnalysis(config: TencentAsrVideoRagConfig, job: VideoRagAnalysisJobDocument): Promise<VideoRagAnalyzerResult> {
  if (job.providerTaskId) {
    const response = await requestTencentAsr<any>(config, 'DescribeTaskStatus', {
      TaskId: Number(job.providerTaskId),
    })
    const data = extractTencentAsrTaskData(response)
    const providerStatus = normalizeTencentAsrTaskStatus(data)
    if (isTencentAsrSuccessStatus(providerStatus)) {
      return {
        asrTranscript: extractTencentAsrTranscript(data),
        visualSummary: '',
        ocrText: '',
        frameSummaries: [],
      }
    }
    if (isTencentAsrFailedStatus(providerStatus)) {
      throw new Error(`tencent_asr_task_failed: ${asCleanText(data?.ErrorMsg || data?.errorMsg || data?.Message || data?.message || providerStatus)}`)
    }
    return {
      pending: true,
      providerTaskId: String(job.providerTaskId),
      providerStatus: providerStatus || 'processing',
    }
  }

  const videoUrl = await resolveVideoUrlForAnalyzer(job.video || {})
  const response = await requestTencentAsr<any>(config, 'CreateRecTask', {
    EngineModelType: config.engineModelType,
    ChannelNum: config.channelNum,
    ResTextFormat: config.resTextFormat,
    SourceType: 0,
    Url: videoUrl,
  })
  const taskId = extractTencentAsrTaskId(response)
  if (!taskId) throw new Error('tencent_asr_missing_task_id')
  return {
    pending: true,
    providerTaskId: taskId,
    providerStatus: 'created',
  }
}

function tokenHubEndpointFromEnv(env: NodeJS.ProcessEnv) {
  const explicitEndpoint = String(env.POST_VIDEO_RAG_TOKENHUB_ENDPOINT || '').trim()
  if (explicitEndpoint) return explicitEndpoint
  const baseUrl = String(env.POST_VIDEO_RAG_TOKENHUB_BASE_URL || 'https://tokenhub.tencentmaas.com/v1')
    .trim()
    .replace(/\/+$/, '')
  return `${baseUrl}/chat/completions`
}

function extractJsonObjectFromText(text: string): any | null {
  const source = String(text || '').trim()
  if (!source) return null
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidates = [fenced, source].filter(Boolean) as string[]
  for (const candidate of candidates) {
    const first = candidate.indexOf('{')
    const last = candidate.lastIndexOf('}')
    if (first < 0 || last <= first) continue
    try {
      return JSON.parse(candidate.slice(first, last + 1))
    } catch {
      // Try the next candidate.
    }
  }
  return null
}

function extractTokenHubAnswer(value: any): string {
  return String(value?.choices?.[0]?.message?.content || value?.choices?.[0]?.text || '').trim()
}

function normalizeTokenHubAssetFromAnswer(answer: string): Partial<VideoRagAsset> {
  const parsed = extractJsonObjectFromText(answer)
  if (parsed && typeof parsed === 'object') {
    return {
      visualSummary: asCleanText(parsed.visualSummary || parsed.visual_summary || parsed.summary),
      ocrText: asCleanText(parsed.ocrText || parsed.ocr_text || parsed.ocr),
      asrTranscript: asCleanText(parsed.asrTranscript || parsed.asr_transcript || parsed.transcript),
      frameSummaries: Array.isArray(parsed.frameSummaries || parsed.frame_summaries)
        ? (parsed.frameSummaries || parsed.frame_summaries)
        : [],
    }
  }
  return { visualSummary: answer }
}

function requestTokenHubVideoAnalysis(config: {
  endpoint: string
  apiKey: string
  model: string
  timeoutMs: number
}, job: VideoRagAnalysisJobDocument): Promise<Partial<VideoRagAsset>> {
  return new Promise(async (resolve, reject) => {
    let videoUrl = ''
    try {
      videoUrl = await resolveVideoUrlForAnalyzer(job.video || {})
    } catch (error) {
      reject(error)
      return
    }
    const target = new URL(config.endpoint)
    const transport = target.protocol === 'http:' ? http : https
    const prompt = [
      '你是 HappyHome 视频 RAG 分析器。',
      '请只分析这个视频中与帖子搜索相关的可检索信息，优先关注画面文字、主题、人物讲解和可作为证据的时间点。',
      '为了控制成本，按抽样思路输出，不要冗长描述。',
      '请严格输出 JSON，不要输出 Markdown：',
      '{"visualSummary":"一句话视觉摘要","ocrText":"画面文字合并","asrTranscript":"语音要点摘要","frameSummaries":[{"timeMs":0,"summary":"关键帧摘要","ocrText":"该帧文字"}]}',
      `视频标题：${asCleanText(job.video?.title)}`,
      `请求分析：${(job.requestedAnalyses || []).join(', ')}`,
      `最多关键帧：${Number(job.frameStrategy?.maxFrames || 0)}；最多语音秒数：${Number(job.maxAsrSeconds || 0)}`,
    ].join('\n')
    const payload = JSON.stringify({
      model: config.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'video_url', video_url: { url: videoUrl } },
        ],
      }],
      temperature: 0.1,
      max_tokens: 900,
    })
    const timer = setTimeout(() => {
      req.destroy(new Error('tokenhub_video_analyzer_timeout'))
    }, config.timeoutMs)
    const req = transport.request(target, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on('end', () => {
        clearTimeout(timer)
        const text = Buffer.concat(chunks).toString('utf8')
        if ((res.statusCode || 500) >= 400) {
          reject(new Error(`tokenhub_video_analyzer_http_${res.statusCode}: ${text.slice(0, 300)}`))
          return
        }
        try {
          const parsed = text ? JSON.parse(text) : {}
          resolve(normalizeTokenHubAssetFromAnswer(extractTokenHubAnswer(parsed)))
        } catch (error) {
          reject(error)
        }
      })
    })
    req.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    req.write(payload)
    req.end()
  })
}

export function createVideoRagAnalyzerFromEnv(env: NodeJS.ProcessEnv = process.env): VideoRagAnalyzer {
  const asrSecretId = String(env.POST_VIDEO_RAG_ASR_SECRET_ID || env.POST_VIDEO_RAG_ASR_SECRETID || '').trim()
  const asrSecretKey = String(env.POST_VIDEO_RAG_ASR_SECRET_KEY || env.POST_VIDEO_RAG_ASR_SECRETKEY || '')
  if (asrSecretId && asrSecretKey) {
    const config: TencentAsrVideoRagConfig = {
      secretId: asrSecretId,
      secretKey: asrSecretKey,
      region: String(env.POST_VIDEO_RAG_ASR_REGION || 'ap-guangzhou').trim(),
      engineModelType: String(env.POST_VIDEO_RAG_ASR_ENGINE_MODEL_TYPE || '16k_zh').trim(),
      channelNum: parsePositiveInt(env.POST_VIDEO_RAG_ASR_CHANNEL_NUM, 1, 1, 16),
      resTextFormat: parsePositiveInt(env.POST_VIDEO_RAG_ASR_RES_TEXT_FORMAT, 0, 0, 3),
      timeoutMs: parsePositiveInt(env.POST_VIDEO_RAG_ASR_TIMEOUT_MS, 30000, 3000, 120000),
    }
    return {
      name: 'tencent-asr-video-rag-analyzer',
      isConfigured: () => isTencentAsrConfigured(config),
      analyze: (job) => requestTencentAsrVideoAnalysis(config, job),
    }
  }

  const tokenHubApiKey = String(env.POST_VIDEO_RAG_TOKENHUB_API_KEY || '').trim()
  if (tokenHubApiKey) {
    const config = {
      endpoint: tokenHubEndpointFromEnv(env),
      apiKey: tokenHubApiKey,
      model: String(env.POST_VIDEO_RAG_TOKENHUB_MODEL || 'youtu-vita').trim(),
      timeoutMs: parsePositiveInt(env.POST_VIDEO_RAG_TOKENHUB_TIMEOUT_MS, 120000, 10000, 300000),
    }
    return {
      name: 'tokenhub-video-rag-analyzer',
      isConfigured: () => Boolean(config.endpoint && config.apiKey && config.model),
      analyze: (job) => requestTokenHubVideoAnalysis(config, job),
    }
  }

  const url = String(env.POST_VIDEO_RAG_ANALYZER_URL || '').trim()
  if (!url) return createDisabledVideoRagAnalyzer()
  const config = {
    url,
    token: String(env.POST_VIDEO_RAG_ANALYZER_TOKEN || ''),
    timeoutMs: parsePositiveInt(env.POST_VIDEO_RAG_ANALYZER_TIMEOUT_MS, 30000, 3000, 180000),
  }
  return {
    name: 'http-video-rag-analyzer',
    isConfigured: () => Boolean(config.url),
    analyze: (job) => requestExternalVideoAnalyzer(config, job),
  }
}

function validatePendingVideoRagJobBudget(job: VideoRagAnalysisJobDocument, policy: VideoRagCostPolicy): string {
  if (!policy.analysisEnabled) return 'video_rag_analysis_disabled'
  const estimatedCostUnits = Number(job.estimatedCostUnits || 0)
  if (!Number.isFinite(estimatedCostUnits) || estimatedCostUnits <= 0) return 'video_rag_cost_unknown'
  if (estimatedCostUnits > policy.maxCostUnitsPerPost) return 'video_rag_job_over_budget'

  const requestedAnalyses = new Set((job.requestedAnalyses || []).map((item) => String(item || '').trim()))
  if (requestedAnalyses.has('asr')) {
    const durationSeconds = Number(job.video?.duration || 0)
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 'video_rag_asr_duration_unknown'
    if (durationSeconds > policy.maxAsrSecondsPerVideo) return 'video_rag_asr_duration_over_budget'
    if (Number(job.maxAsrSeconds || 0) > policy.maxAsrSecondsPerVideo) return 'video_rag_asr_budget_over_limit'
  }

  const maxFrames = Number(job.frameStrategy?.maxFrames || 0)
  if (Number.isFinite(maxFrames) && maxFrames > policy.maxFramesPerVideo) return 'video_rag_frame_budget_over_limit'
  return ''
}

export async function processPostVideoRagJobBatch(options: {
  limit?: number
  postId?: string
  analyzer?: VideoRagAnalyzer
  policy?: VideoRagCostPolicy
} = {}) {
  const analyzer = options.analyzer || createVideoRagAnalyzerFromEnv()
  const policy = options.policy || readVideoRagCostPolicyFromEnv()
  const limit = Math.max(1, Math.min(10, Math.floor(Number(options.limit || 3))))
  const postId = String(options.postId || '').trim()
  const pendingJobs = await db.query(
    POST_VIDEO_RAG_JOBS,
    { status: 'pending', ...(postId ? { postId } : {}) },
    { orderBy: ['createdAt', 'asc'], limit }
  ) as VideoRagAnalysisJobDocument[]
  let jobs = pendingJobs
  if (jobs.length < limit) {
    const processingJobs = await db.query(
      POST_VIDEO_RAG_JOBS,
      { status: 'processing', ...(postId ? { postId } : {}) },
      { orderBy: ['updatedAt', 'asc'], limit: limit - jobs.length }
    ) as VideoRagAnalysisJobDocument[]
    jobs = jobs.concat(processingJobs)
  }
  const results: Array<{ jobId: string; ok: boolean; pending?: boolean; error?: string }> = []
  for (const job of jobs) {
    const now = new Date().toISOString()
    try {
      const budgetError = job.status === 'pending' ? validatePendingVideoRagJobBudget(job, policy) : ''
      if (budgetError) {
        await db.updateById(POST_VIDEO_RAG_JOBS, job._id, {
          status: 'failed',
          attempts: Number((job as any).attempts || 0) + 1,
          errorMessage: budgetError,
          updatedAt: now,
        })
        results.push({ jobId: job._id, ok: false, error: budgetError })
        continue
      }
      if (!analyzer.isConfigured()) throw new Error('video_rag_analyzer_not_configured')
      const rawAsset = await analyzer.analyze(job)
      if (isVideoRagPendingResult(rawAsset)) {
        await db.updateById(POST_VIDEO_RAG_JOBS, job._id, {
          status: 'processing',
          provider: analyzer.name,
          providerTaskId: asCleanText(rawAsset.providerTaskId),
          providerStatus: asCleanText(rawAsset.providerStatus) || 'processing',
          updatedAt: now,
        })
        results.push({ jobId: job._id, ok: true, pending: true })
        continue
      }
      const asset = normalizeVideoAssetResult(rawAsset, job, analyzer.name, now)
      await upsertVideoRagAsset(asset)
      await db.updateById(POST_VIDEO_RAG_JOBS, job._id, {
        status: 'completed',
        completedAt: now,
        updatedAt: now,
        provider: analyzer.name,
      })
      await enqueuePostRagJob({
        postId: job.postId,
        communityId: job.communityId,
        sectionId: job.sectionId,
        action: 'upsert',
        reason: 'rag.video.analysis.ready',
      })
      results.push({ jobId: job._id, ok: true })
    } catch (error: any) {
      await db.updateById(POST_VIDEO_RAG_JOBS, job._id, {
        status: 'failed',
        attempts: Number((job as any).attempts || 0) + 1,
        errorMessage: String(error?.message || error),
        updatedAt: now,
      })
      results.push({ jobId: job._id, ok: false, error: String(error?.message || error) })
    }
  }
  return { scannedCount: jobs.length, results }
}

export async function enqueuePostRagJob(input: {
  postId: string
  communityId?: string
  sectionId?: string
  action?: 'upsert' | 'delete'
  reason?: string
}) {
  const postId = String(input.postId || '').trim()
  if (!postId) return { queued: false, reason: 'empty_post_id' }
  const now = new Date().toISOString()
  const action = input.action || 'upsert'
  const jobId = `prj_${stableId(`${postId}\u0001${action}\u0001${now}`)}`
  await db.create(POST_RAG_JOBS, {
    _id: jobId,
    postId,
    communityId: input.communityId || '',
    sectionId: input.sectionId || '',
    action,
    reason: input.reason || '',
    status: 'pending',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  })
  return { queued: true, jobId }
}

export async function backfillPostRagJobsForSectionBatch(
  sectionId: string,
  options: { skip?: number; limit?: number } = {}
) {
  const normalizedSectionId = String(sectionId || '').trim()
  if (!normalizedSectionId) throw new Error('sectionId is required')
  const skip = Math.max(0, Math.floor(Number(options.skip || 0)))
  const limit = Math.max(1, Math.min(20, Math.floor(Number(options.limit || 5))))
  const posts = await db.query('posts', { sectionId: normalizedSectionId }, {
    orderBy: ['updatedAt', 'desc'],
    skip,
    limit,
  }) as Post[]
  let section: Section | null = null
  try {
    section = await db.getById('sections', normalizedSectionId) as Section
  } catch {
    section = null
  }
  let upsertQueuedCount = 0
  let deleteQueuedCount = 0
  let failedCount = 0

  for (const post of posts) {
    try {
      const action = section && isPostSearchableForRag(post) ? 'upsert' : 'delete'
      await enqueuePostRagJob({
        postId: post._id,
        communityId: post.communityId,
        sectionId: post.sectionId || normalizedSectionId,
        action,
        reason: 'rag.backfill.section',
      })
      if (action === 'upsert') upsertQueuedCount += 1
      else deleteQueuedCount += 1
    } catch {
      failedCount += 1
    }
  }
  const hasMore = posts.length === limit
  return {
    sectionId: normalizedSectionId,
    skip,
    limit,
    scannedCount: posts.length,
    upsertQueuedCount,
    deleteQueuedCount,
    failedCount,
    hasMore,
    nextSkip: hasMore ? skip + posts.length : null,
  }
}

async function getPostRagIndexState(postId: string): Promise<Record<string, any> | null> {
  try {
    return await db.getById(POST_RAG_INDEX_STATE, postId) as Record<string, any>
  } catch (error) {
    if (isMissingDocumentError(error)) return null
    throw error
  }
}

function timestampIsFresh(indexedSourceUpdatedAt: unknown, sourceUpdatedAt: string): boolean {
  const indexedTime = Date.parse(String(indexedSourceUpdatedAt || ''))
  const sourceTime = Date.parse(String(sourceUpdatedAt || ''))
  if (Number.isFinite(indexedTime) && Number.isFinite(sourceTime)) return indexedTime >= sourceTime
  return String(indexedSourceUpdatedAt || '') === sourceUpdatedAt
}

export async function reconcilePostRagJobsForCommunityBatch(
  communityId: string,
  options: { skip?: number; limit?: number } = {}
) {
  const normalizedCommunityId = String(communityId || '').trim()
  if (!normalizedCommunityId) throw new Error('communityId is required')
  const skip = Math.max(0, Math.floor(Number(options.skip || 0)))
  const limit = Math.max(1, Math.min(50, Math.floor(Number(options.limit || 10))))
  const posts = await db.query('posts', { communityId: normalizedCommunityId }, {
    orderBy: ['updatedAt', 'desc'],
    skip,
    limit,
  }) as Post[]
  let upsertQueuedCount = 0
  let deleteQueuedCount = 0
  let skippedCount = 0
  let missingStateCount = 0
  let staleStateCount = 0
  let removableStateCount = 0
  let failedCount = 0

  for (const post of posts) {
    try {
      const sourceUpdatedAt = sourceUpdatedAtForPost(post, '')
      const state = await getPostRagIndexState(post._id)
      if (isPostSearchableForRag(post)) {
        let reason = ''
        if (!state) {
          missingStateCount += 1
          reason = 'rag.reconcile.missing_state'
        } else if (state.status !== 'indexed') {
          staleStateCount += 1
          reason = 'rag.reconcile.not_indexed'
        } else if (!timestampIsFresh(state.sourceUpdatedAt, sourceUpdatedAt)) {
          staleStateCount += 1
          reason = 'rag.reconcile.stale_state'
        }
        if (reason) {
          await enqueuePostRagJob({
            postId: post._id,
            communityId: post.communityId || normalizedCommunityId,
            sectionId: post.sectionId || '',
            action: 'upsert',
            reason,
          })
          upsertQueuedCount += 1
        } else {
          skippedCount += 1
        }
        continue
      }

      if (state && state.status !== 'removed') {
        removableStateCount += 1
        await enqueuePostRagJob({
          postId: post._id,
          communityId: post.communityId || normalizedCommunityId,
          sectionId: post.sectionId || '',
          action: 'delete',
          reason: 'rag.reconcile.removed_source',
        })
        deleteQueuedCount += 1
      } else {
        skippedCount += 1
      }
    } catch {
      failedCount += 1
    }
  }

  const hasMore = posts.length === limit
  return {
    communityId: normalizedCommunityId,
    skip,
    limit,
    scannedCount: posts.length,
    upsertQueuedCount,
    deleteQueuedCount,
    skippedCount,
    missingStateCount,
    staleStateCount,
    removableStateCount,
    failedCount,
    hasMore,
    nextSkip: hasMore ? skip + posts.length : null,
  }
}

export async function getPostRagIndexHealthForCommunity(communityId: string) {
  const normalizedCommunityId = String(communityId || '').trim()
  if (!normalizedCommunityId) throw new Error('communityId is required')
  const [
    activePostCount,
    indexedStateCount,
    removedStateCount,
    failedStateCount,
    pendingJobCount,
    failedJobCount,
  ] = await Promise.all([
    db.count('posts', { communityId: normalizedCommunityId, status: 'active' }),
    db.count(POST_RAG_INDEX_STATE, { communityId: normalizedCommunityId, status: 'indexed' }),
    db.count(POST_RAG_INDEX_STATE, { communityId: normalizedCommunityId, status: 'removed' }),
    db.count(POST_RAG_INDEX_STATE, { communityId: normalizedCommunityId, status: 'failed' }),
    db.count(POST_RAG_JOBS, { communityId: normalizedCommunityId, status: 'pending' }),
    db.count(POST_RAG_JOBS, { communityId: normalizedCommunityId, status: 'failed' }),
  ])
  const [
    latestIndexedRows,
    oldestPendingRows,
    latestFailedRows,
    workerState,
  ] = await Promise.all([
    db.query(POST_RAG_INDEX_STATE, { communityId: normalizedCommunityId, status: 'indexed' }, { orderBy: ['indexedAt', 'desc'], limit: 1 }).catch(() => []),
    db.query(POST_RAG_JOBS, { communityId: normalizedCommunityId, status: 'pending' }, { orderBy: ['createdAt', 'asc'], limit: 1 }).catch(() => []),
    db.query(POST_RAG_JOBS, { communityId: normalizedCommunityId, status: 'failed' }, { orderBy: ['updatedAt', 'desc'], limit: 1 }).catch(() => []),
    getPostRagWorkerState(),
  ])
  const potentialMissingActiveCount = Math.max(0, activePostCount - indexedStateCount)
  const hasBlockingIssues = potentialMissingActiveCount > 0
    || failedStateCount > 0
    || pendingJobCount > 0
    || failedJobCount > 0
  return {
    communityId: normalizedCommunityId,
    activePostCount,
    indexedStateCount,
    removedStateCount,
    failedStateCount,
    pendingJobCount,
    failedJobCount,
    potentialMissingActiveCount,
    coverageRatio: activePostCount > 0 ? indexedStateCount / activePostCount : 1,
    latestIndexedAt: String((latestIndexedRows as any[])?.[0]?.indexedAt || ''),
    oldestPendingJobCreatedAt: String((oldestPendingRows as any[])?.[0]?.createdAt || ''),
    latestFailedJobUpdatedAt: String((latestFailedRows as any[])?.[0]?.updatedAt || ''),
    readyForRag: !hasBlockingIssues,
    hasBlockingIssues,
    worker: workerState,
  }
}

async function getPostRagWorkerState() {
  try {
    const state = await db.getById(POST_RAG_WORKER_STATE, 'post-rag-worker') as Record<string, any>
    if (!state) return null
    return {
      status: String(state.status || ''),
      lastRunAt: String(state.lastRunAt || ''),
      lastCompletedAt: String(state.lastCompletedAt || ''),
      lastScannedCount: Number(state.lastScannedCount || 0),
      lastOkCount: Number(state.lastOkCount || 0),
      lastFailedCount: Number(state.lastFailedCount || 0),
      lastErrorMessage: String(state.lastErrorMessage || ''),
    }
  } catch {
    return null
  }
}

async function updatePostRagWorkerState(data: Record<string, any>) {
  try {
    const updateResult = await db.updateById(POST_RAG_WORKER_STATE, 'post-rag-worker', data) as any
    if (updateResult === undefined || updateMatchedDocument(updateResult)) return
    await db.create(POST_RAG_WORKER_STATE, {
      _id: 'post-rag-worker',
      ...data,
    }).catch(() => null)
  } catch {
    try {
      await db.create(POST_RAG_WORKER_STATE, {
        _id: 'post-rag-worker',
        ...data,
      })
    } catch {
      // Worker health telemetry must not block indexing.
    }
  }
}

function toRagChunkDocuments(post: Post, section: Section): RagChunkDocument[] {
  const document = buildPostSearchDocument(post, section)
  return buildPostSearchChunks(document).map((chunk) => ({
    chunkId: chunk._id,
    postId: chunk.postId,
    communityId: chunk.communityId,
    sectionId: chunk.sectionId,
    sectionName: chunk.sectionName,
    title: chunk.title,
    fieldLabel: chunk.fieldLabel,
    fieldType: chunk.fieldType,
    text: chunk.text,
    preview: chunk.preview,
    sourceUpdatedAt: chunk.sourceUpdatedAt,
    visibility: normalizeRagVisibility((chunk as any).visibility),
  }))
}

async function buildRagChunkDocumentsForPost(post: Post, section: Section, now: string) {
  const baseChunks = toRagChunkDocuments(post, section)
  const cacheKeys = extractVideoEntriesForRag(post, section).map((entry) => entry.cacheKey)
  const videoAssetsByCacheKey = cacheKeys.length
    ? await loadVideoRagAssetsByCacheKey(cacheKeys)
    : new Map<string, VideoRagAsset>()
  const videoChunks = buildVideoRagChunksForPost(post, section, {
    now,
    assetsByCacheKey: videoAssetsByCacheKey,
  })
  return {
    chunks: [...baseChunks, ...videoChunks],
    videoAssetsByCacheKey,
    videoMetadataChunkCount: videoChunks.filter((chunk) => chunk.metadata?.evidenceSource === 'video_metadata').length,
    videoAnalysisChunkCount: videoChunks.filter((chunk) => chunk.metadata?.evidenceSource === 'video_analysis_cache').length,
  }
}

function isPostSearchableForRag(post: any): boolean {
  return Boolean(
    post
    && post.status === 'active'
    && (!post.auditStatus || post.auditStatus === 'pass')
  )
}

function updateMatchedDocument(result: any): boolean {
  const stats = result?.stats || result
  const updated = Number(stats?.updated ?? stats?.updatedCount ?? stats?.ModifiedCount ?? 0)
  return Number.isFinite(updated) && updated > 0
}

async function upsertPostRagIndexState(postId: string, data: Record<string, any>) {
  const state = { postId, ...data }
  const updateResult = await db.updateById(POST_RAG_INDEX_STATE, postId, state).catch(() => null)
  if (updateMatchedDocument(updateResult)) return
  await db.create(POST_RAG_INDEX_STATE, {
    _id: postId,
    ...state,
  })
}

function removedRagIndexState(job: any, now: string, post?: Partial<Post> | null) {
  const state: Record<string, any> = {
    status: 'removed',
    indexedAt: now,
    sourceUpdatedAt: now,
  }
  const communityId = String((post as any)?.communityId || job?.communityId || '').trim()
  const sectionId = String((post as any)?.sectionId || job?.sectionId || '').trim()
  if (communityId) state.communityId = communityId
  if (sectionId) state.sectionId = sectionId
  return state
}

function isMissingDocumentError(error: any): boolean {
  const message = String(error?.message || error || '')
  return /document\.get:fail/i.test(message) && /does not exist|not found/i.test(message)
}

export async function processPostRagJobBatch(options: {
  limit?: number
  postId?: string
  provider?: TencentRagProvider
  videoPolicy?: VideoRagCostPolicy
} = {}) {
  const provider = options.provider || createTencentRagProviderFromEnv()
  const limit = Math.max(1, Math.min(20, Math.floor(Number(options.limit || 5))))
  const postId = String(options.postId || '').trim()
  const startedAt = new Date().toISOString()
  const jobs: any[] = []
  const pageSize = 20
  for (let skip = 0; jobs.length < limit; skip += pageSize) {
    const page = await db.query(
      POST_RAG_JOBS,
      { status: 'pending', ...(postId ? { postId } : {}) },
      { orderBy: ['createdAt', 'asc'], limit: pageSize, skip }
    ) as any[]
    jobs.push(...page.filter((job) => job?.schemaVersion !== 2).slice(0, limit - jobs.length))
    if (page.length < pageSize) break
  }
  const results: Array<{ jobId: string; ok: boolean; error?: string }> = []
  let indexEnsured = false
  let okCount = 0
  let failedCount = 0
  for (const job of jobs) {
    const now = new Date().toISOString()
    try {
      if (!provider.isConfigured()) throw new Error('rag_provider_not_configured')
      if (job.action === 'delete') {
        await provider.deletePostChunks?.(job.postId)
        await upsertPostRagIndexState(job.postId, removedRagIndexState(job, now))
      } else {
        let post: Post | null = null
        try {
          post = await db.getById('posts', job.postId) as Post
        } catch (error) {
          if (!isMissingDocumentError(error)) throw error
          await provider.deletePostChunks?.(job.postId)
          await upsertPostRagIndexState(job.postId, removedRagIndexState(job, now))
          await db.updateById(POST_RAG_JOBS, job._id, { status: 'completed', updatedAt: now })
          results.push({ jobId: job._id, ok: true })
          okCount += 1
          continue
        }
        if (!isPostSearchableForRag(post)) {
          await provider.deletePostChunks?.(job.postId)
          await upsertPostRagIndexState(job.postId, removedRagIndexState(job, now, post))
          await db.updateById(POST_RAG_JOBS, job._id, { status: 'completed', updatedAt: now })
          results.push({ jobId: job._id, ok: true })
          okCount += 1
          continue
        }
        const section = await db.getById('sections', post.sectionId) as Section
        const {
          chunks,
          videoAssetsByCacheKey,
          videoMetadataChunkCount,
          videoAnalysisChunkCount,
        } = await buildRagChunkDocumentsForPost(post, section, now)
        const videoPolicy = options.videoPolicy || readVideoRagCostPolicyFromEnv()
        const videoAnalysisJobs = planVideoRagAnalysisJobsForPost(post, section, {
          now,
          assetsByCacheKey: videoAssetsByCacheKey,
          policy: videoPolicy,
        })
        const videoJobResult = await enqueueVideoRagAnalysisJobs(videoAnalysisJobs)
        if (!indexEnsured) {
          await provider.ensureIndex?.()
          indexEnsured = true
        }
        await provider.deletePostChunks?.(job.postId)
        await provider.upsertChunks?.(chunks)
        await upsertPostRagIndexState(job.postId, {
          status: 'indexed',
          communityId: post.communityId,
          sectionId: post.sectionId,
          sourceUpdatedAt: post.updatedAt || post.createdAt || now,
          indexedAt: now,
          chunkCount: chunks.length,
          videoRag: {
            metadataChunkCount: videoMetadataChunkCount,
            analysisChunkCount: videoAnalysisChunkCount,
            analysisJobQueuedCount: videoJobResult.queuedCount,
            analysisJobSkippedCount: videoJobResult.skippedCount,
            analysisEnabled: videoPolicy.analysisEnabled,
            maxFramesPerVideo: videoPolicy.maxFramesPerVideo,
            maxAsrSecondsPerVideo: videoPolicy.maxAsrSecondsPerVideo,
          },
        })
      }
      await db.updateById(POST_RAG_JOBS, job._id, { status: 'completed', updatedAt: now })
      results.push({ jobId: job._id, ok: true })
      okCount += 1
    } catch (error: any) {
      await db.updateById(POST_RAG_JOBS, job._id, {
        status: 'failed',
        attempts: Number(job.attempts || 0) + 1,
        errorMessage: String(error?.message || error),
        updatedAt: now,
      })
      results.push({ jobId: job._id, ok: false, error: String(error?.message || error) })
      failedCount += 1
    }
  }
  await updatePostRagWorkerState({
    status: failedCount > 0 ? 'completed_with_errors' : 'completed',
    lastRunAt: startedAt,
    lastCompletedAt: new Date().toISOString(),
    lastScannedCount: jobs.length,
    lastOkCount: okCount,
    lastFailedCount: failedCount,
    lastErrorMessage: results.find((result) => !result.ok)?.error || '',
  })
  return { scannedCount: jobs.length, results }
}
