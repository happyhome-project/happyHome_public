import { createHash, createHmac } from 'crypto'
import http from 'http'
import https from 'https'
import type { Post, Section } from '../shared/types'
import * as db from './db'
import {
  buildPostSearchChunks,
  buildPostSearchDocument,
  normalizeSearchText,
  searchPostIndex,
  type PostSearchResult,
  type PostSearchResultItem,
} from './post-search'

export const POST_RAG_JOBS = 'post_rag_jobs'
export const POST_RAG_INDEX_STATE = 'post_rag_index_state'
export const POST_RAG_CHUNKS = 'post_rag_chunks'

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
  sourceUpdatedAt?: string
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
}

export interface RagProviderSearchInput extends RagSearchParams {
  ragQuery: RagQuery
}

export interface TencentRagProvider {
  name: string
  isConfigured(): boolean
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

const THRIFT_FAMILY_EXPANSION = [
  '节俭',
  '勤俭',
  '节约',
  '家风',
  '家训',
  '朱子治家格言',
  '一粥一饭',
  '半丝半缕',
  '物力维艰',
]
const MIN_LKEAP_RERANK_EVIDENCE_SCORE = 0
const MIN_LKEAP_SEMANTIC_EVIDENCE_SCORE = 0.42

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

function withFallbackFields(result: PostSearchResult, reason?: string): RagSearchResult {
  return {
    ...result,
    answer: '',
    citations: [],
    mode: 'fallback',
    ...(reason ? { fallbackReason: reason } : {}),
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
  const fallbackSearch = options.fallbackSearch || searchPostIndex
  const provider = options.provider === undefined ? createTencentRagProviderFromEnv() : options.provider

  if (!provider || !provider.isConfigured()) {
    return withFallbackFields(await fallbackSearch({ communityId, query, sectionId, skip, limit }), 'rag_provider_not_configured')
  }

  try {
    const ragQuery = buildRagQuery(query)
    const providerResult = await provider.search({ communityId, query, sectionId, skip, limit, ragQuery })
    if (!providerResult.citations.length) {
      return buildNoEvidenceRagResult({ query, communityId, sectionId, skip, limit })
    }
    return {
      query,
      communityId,
      sectionId,
      total: providerResult.total || providerResult.items.length,
      skip,
      limit,
      items: providerResult.items.length ? providerResult.items : resultItemsFromCitations(providerResult.citations),
      answer: providerResult.answer,
      citations: providerResult.citations,
      mode: 'rag',
      provider: provider.name,
    }
  } catch (error: any) {
    return withFallbackFields(
      await fallbackSearch({ communityId, query, sectionId, skip, limit }),
      error?.message || 'rag_provider_failed'
    )
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
  if (String(process.env.TENCENT_RAG_PROVIDER || '').trim().toLowerCase() === 'lkeap') {
    return createTencentLkeapCloudBaseProvider(readTencentLkeapRagConfigFromEnv())
  }
  return createTencentRagProvider(readTencentRagConfigFromEnv())
}

function isConfigured(config: TencentRagConfig) {
  return Boolean(
    config.endpoint
    && config.username
    && config.password
    && config.indexName
    && config.embeddingInferenceId
    && config.rerankInferenceId
    && config.llmInferenceId
  )
}

function authHeader(config: TencentRagConfig) {
  return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`
}

async function requestJson<T>(config: TencentRagConfig, method: string, path: string, body?: unknown): Promise<T> {
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

function toCitation(hit: any): RagCitation {
  const source = hit?._source || hit || {}
  return {
    postId: String(source.postId || ''),
    chunkId: String(source.chunkId || hit?._id || ''),
    communityId: String(source.communityId || ''),
    title: String(source.title || ''),
    sectionId: String(source.sectionId || ''),
    sectionName: String(source.sectionName || ''),
    fieldLabel: String(source.fieldLabel || ''),
    fieldType: String(source.fieldType || ''),
    preview: String(source.preview || source.text || '').slice(0, 180),
    score: Number(hit?._score || source.score || 0),
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
  const result = value?.result || value?.text || value?.choices?.[0]?.message?.content
  return String(completion || result || '').trim()
}

function extractEmbeddingVector(value: any): number[] {
  const direct = value?.embedding?.[0]?.result
    || value?.embedding?.[0]?.embedding
    || value?.data?.[0]?.embedding
    || value?.result
    || value?.vector
  if (!Array.isArray(direct)) return []
  return direct.map((item) => Number(item)).filter((item) => Number.isFinite(item))
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
  return (
    Number(citation.lexicalScore || 0) > 0 ||
    Number(citation.rerankScore ?? Number.NEGATIVE_INFINITY) >= MIN_LKEAP_RERANK_EVIDENCE_SCORE ||
    Number(citation.semanticScore || 0) >= MIN_LKEAP_SEMANTIC_EVIDENCE_SCORE
  )
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
      if ((!input.sectionId || chunk.sectionId === input.sectionId) && Array.isArray(chunk.embedding) && chunk.embedding.length) {
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
  type ScoredRagCitation = RagCitation & { semanticScore?: number; lexicalScore?: number; rerankScore?: number }

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
            ...toCitation({ _id: chunk.chunkId, _source: chunk }),
            score: semanticScore + lexicalScore * 0.08,
            semanticScore,
            lexicalScore,
          }
        })
        .filter((citation) => citation.postId && citation.chunkId)
        .sort((left, right) => right.score - left.score)
        .slice(0, Math.max(10, Math.min(30, Number(input.limit || 20) * 3)))

      citations = await rerank(input.ragQuery.raw, citations)
      citations = citations
        .filter((citation: any, index) => (
          index < Math.max(5, Math.min(20, Number(input.limit || 20))) &&
          hasRagEvidenceSignal(citation)
        ))
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

export function createTencentRagProvider(config: TencentRagConfig): TencentRagProvider {
  const embedText = async (text: string): Promise<number[]> => {
    if (!config.embeddingInferenceId) return []
    const response = await requestJson<any>(config, 'POST', `_inference/text_embedding/${config.embeddingInferenceId}`, {
      input: [text],
    })
    return extractEmbeddingVector(response)
  }

  return {
    name: 'tencent-es-ai-search',
    isConfigured: () => isConfigured(config),
    async search(input) {
      if (!isConfigured(config)) throw new Error('rag_provider_not_configured')
      const filters: any[] = [{ term: { communityId: input.communityId } }]
      if (input.sectionId) filters.push({ term: { sectionId: input.sectionId } })
      const size = Math.max(1, Math.min(50, Number(input.limit || 20)))
      const from = Math.max(0, Math.floor(Number(input.skip || 0)))
      const queryVector = await embedText(input.ragQuery.expandedText)
      const searchBody: any = {
        from,
        size,
        query: {
          bool: {
            must: [{
              multi_match: {
                query: input.ragQuery.expandedText,
                fields: ['text^4', 'title^3', 'fieldLabel^2', 'sectionName'],
              },
            }],
            filter: filters,
          },
        },
      }
      if (queryVector.length > 0 && config.vectorField) {
        searchBody.knn = {
          field: config.vectorField,
          query_vector: queryVector,
          k: size,
          num_candidates: Math.max(100, size * 8),
          filter: filters,
        }
      }
      const response = await requestJson<any>(config, 'POST', `${config.indexName}/_search`, {
        ...searchBody,
      })
      let citations = (response?.hits?.hits || []).map(toCitation).filter((citation: RagCitation) => citation.postId && citation.chunkId)

      if (config.rerankInferenceId && citations.length > 1) {
        const reranked = await requestJson<any>(config, 'POST', `_inference/rerank/${config.rerankInferenceId}`, {
          query: input.ragQuery.raw,
          input: citations.map((citation: RagCitation) => citation.preview),
        })
        const byIndex = new Map<number, any>((reranked?.rerank || []).map((item: any) => [Number(item.index), item]))
        citations = citations
          .map((citation: RagCitation, index: number) => ({
            ...citation,
            score: Number(byIndex.get(index)?.relevance_score ?? citation.score),
          }))
          .sort((left: RagCitation, right: RagCitation) => right.score - left.score)
      }

      const answerResponse = citations.length && config.llmInferenceId
        ? await requestJson<any>(config, 'POST', `_inference/completion/${config.llmInferenceId}?timeout=300s`, {
          input: buildAnswerPrompt(input.query, citations),
          task_settings: { temperature: 0.1, max_new_tokens: 300 },
        })
        : null
      const answer = extractCompletionText(answerResponse) || (citations.length ? deterministicAnswer(citations) : '')
      return {
        total: Number(response?.hits?.total?.value ?? citations.length),
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
        await requestJson(config, 'PUT', `${config.indexName}/_doc/${encodeURIComponent(chunk.chunkId)}`, {
          ...chunk,
          ...(embedding.length > 0 && config.vectorField ? { [config.vectorField]: embedding } : {}),
        })
      }
    },
    async deletePostChunks(postId) {
      if (!isConfigured(config)) throw new Error('rag_provider_not_configured')
      await requestJson(config, 'POST', `${config.indexName}/_delete_by_query`, {
        query: { term: { postId } },
      })
    },
  }
}

function stableId(value: string) {
  return createHash('sha1').update(value).digest('hex')
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
    visibility: 'member',
  }))
}

function isPostSearchableForRag(post: any): boolean {
  return Boolean(
    post
    && post.status === 'active'
    && (!post.auditStatus || post.auditStatus === 'pass')
  )
}

export async function processPostRagJobBatch(options: {
  limit?: number
  postId?: string
  provider?: TencentRagProvider
} = {}) {
  const provider = options.provider || createTencentRagProviderFromEnv()
  const limit = Math.max(1, Math.min(20, Math.floor(Number(options.limit || 5))))
  const postId = String(options.postId || '').trim()
  const jobs = await db.query(
    POST_RAG_JOBS,
    { status: 'pending', ...(postId ? { postId } : {}) },
    { orderBy: ['createdAt', 'asc'], limit }
  ) as any[]
  const results: Array<{ jobId: string; ok: boolean; error?: string }> = []
  for (const job of jobs) {
    const now = new Date().toISOString()
    try {
      if (!provider.isConfigured()) throw new Error('rag_provider_not_configured')
      if (job.action === 'delete') {
        await provider.deletePostChunks?.(job.postId)
        await db.updateById(POST_RAG_INDEX_STATE, job.postId, {
          status: 'removed',
          indexedAt: now,
          sourceUpdatedAt: now,
        }).catch(() => db.create(POST_RAG_INDEX_STATE, {
          _id: job.postId,
          postId: job.postId,
          status: 'removed',
          indexedAt: now,
          sourceUpdatedAt: now,
        }))
      } else {
        const post = await db.getById('posts', job.postId) as Post
        if (!isPostSearchableForRag(post)) {
          await provider.deletePostChunks?.(job.postId)
          await db.updateById(POST_RAG_INDEX_STATE, job.postId, {
            status: 'removed',
            indexedAt: now,
            sourceUpdatedAt: now,
          }).catch(() => db.create(POST_RAG_INDEX_STATE, {
            _id: job.postId,
            postId: job.postId,
            status: 'removed',
            indexedAt: now,
            sourceUpdatedAt: now,
          }))
          await db.updateById(POST_RAG_JOBS, job._id, { status: 'completed', updatedAt: now })
          results.push({ jobId: job._id, ok: true })
          continue
        }
        const section = await db.getById('sections', post.sectionId) as Section
        const chunks = toRagChunkDocuments(post, section)
        await provider.deletePostChunks?.(job.postId)
        await provider.upsertChunks?.(chunks)
        await db.updateById(POST_RAG_INDEX_STATE, job.postId, {
          status: 'indexed',
          communityId: post.communityId,
          sectionId: post.sectionId,
          sourceUpdatedAt: post.updatedAt || post.createdAt || now,
          indexedAt: now,
          chunkCount: chunks.length,
        }).catch(() => db.create(POST_RAG_INDEX_STATE, {
          _id: job.postId,
          postId: job.postId,
          status: 'indexed',
          communityId: post.communityId,
          sectionId: post.sectionId,
          sourceUpdatedAt: post.updatedAt || post.createdAt || now,
          indexedAt: now,
          chunkCount: chunks.length,
        }))
      }
      await db.updateById(POST_RAG_JOBS, job._id, { status: 'completed', updatedAt: now })
      results.push({ jobId: job._id, ok: true })
    } catch (error: any) {
      await db.updateById(POST_RAG_JOBS, job._id, {
        status: 'failed',
        attempts: Number(job.attempts || 0) + 1,
        errorMessage: String(error?.message || error),
        updatedAt: now,
      })
      results.push({ jobId: job._id, ok: false, error: String(error?.message || error) })
    }
  }
  return { scannedCount: jobs.length, results }
}
