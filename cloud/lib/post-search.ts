import type { Post, Section, Widget } from '../shared/types'
import { createHash } from 'crypto'
import { normalizeGuideNoteSection } from '../shared/guide-note-widgets'

export interface PostSearchField {
  widgetId: string
  fieldKey: string
  fieldLabel: string
  fieldType: string
  text: string
  preview: string
}

export interface PostSearchDocument {
  _id: string
  postId: string
  communityId: string
  sectionId: string
  sectionName: string
  title: string
  fields: PostSearchField[]
  searchText: string
  compactText: string
  terms: string[]
  chunkCount: number
  createdAt: string
  updatedAt: string
  sourceUpdatedAt: string
}

export interface SparseVectorTerm {
  term: string
  weight: number
}

export interface PostSearchChunk {
  _id: string
  collection: string
  postId: string
  communityId: string
  sectionId: string
  sectionName: string
  title: string
  fieldKey: string
  fieldLabel: string
  fieldType: string
  chunkIndex: number
  text: string
  preview: string
  searchText: string
  compactText: string
  terms: string[]
  sparseVector: SparseVectorTerm[]
  createdAt: string
  updatedAt: string
  sourceUpdatedAt: string
}

export interface PostSearchIndexState {
  _id: string
  postId: string
  communityId: string
  sectionId: string
  status: 'indexed' | 'removed' | 'failed'
  sourceUpdatedAt: string
  indexedAt: string
  chunkCount: number
  termCount: number
  vectorTermCount: number
  errorMessage?: string
}

export interface SearchQuery {
  raw: string
  normalized: string
  compact: string
  terms: string[]
}

export interface PostSearchResultItem {
  postId: string
  communityId: string
  sectionId: string
  sectionName: string
  title: string
  score: number
  matchedFields: Array<{
    fieldLabel: string
    fieldType: string
    preview: string
  }>
  createdAt: string
  updatedAt: string
}

export interface PostSearchResult {
  query: string
  communityId: string
  sectionId: string
  total: number
  skip: number
  limit: number
  items: PostSearchResultItem[]
}

export const POST_SEARCH_DOCUMENTS = 'post_search_documents'
export const POST_SEARCH_TERMS = 'post_search_terms'
export const POST_SEARCH_CHUNKS = 'post_search_chunks'
export const POST_SEARCH_VECTOR_TERMS = 'post_search_vector_terms'
export const POST_SEARCH_INDEX_STATE = 'post_search_index_state'

const MAX_FIELD_PREVIEW_CHARS = 120
const MAX_TERMS_PER_DOCUMENT = 300
const MAX_TERMS_PER_CHUNK = 160
const MAX_VECTOR_TERMS_PER_CHUNK = 80
const MAX_CHUNK_CHARS = 260
const CHUNK_OVERLAP_CHARS = 40
const DEFAULT_SEARCH_LIMIT = 20
const MAX_SEARCH_LIMIT = 50
const MAX_QUERY_TERMS = 18
const MAX_QUERY_VECTOR_TERMS = 24
const DB_PAGE_LIMIT = 100

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function stripHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

export function normalizeSearchText(value: unknown): string {
  return normalizeWhitespace(
    String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
  )
}

export function compactSearchText(value: unknown): string {
  return normalizeSearchText(value).replace(/\s+/g, '')
}

function previewText(value: string): string {
  const chars = Array.from(normalizeWhitespace(value))
  return chars.length > MAX_FIELD_PREVIEW_CHARS
    ? `${chars.slice(0, MAX_FIELD_PREVIEW_CHARS).join('')}...`
    : chars.join('')
}

function pushField(fields: PostSearchField[], widget: Widget, text: unknown, suffix = '') {
  const normalized = normalizeWhitespace(String(text || ''))
  if (!normalized) return
  fields.push({
    widgetId: widget.widgetId,
    fieldKey: suffix ? `${widget.fieldKey}.${suffix}` : widget.fieldKey,
    fieldLabel: widget.label,
    fieldType: widget.type,
    text: normalized,
    preview: previewText(normalized),
  })
}

function pushUniqueTexts(target: string[], values: unknown[]) {
  const seen = new Set(target)
  for (const value of values) {
    const text = normalizeWhitespace(String(value || ''))
    if (!text || seen.has(text)) continue
    seen.add(text)
    target.push(text)
  }
}

function extractFromRichNote(value: unknown): string[] {
  if (!isRecord(value)) return []
  const texts: string[] = []
  pushUniqueTexts(texts, [
    value.text,
    value.markdown,
    typeof value.html === 'string' ? stripHtml(value.html) : '',
  ])
  return texts
}

function extractFromArrayItems(value: unknown, keys: string[]): string[] {
  if (!Array.isArray(value)) return []
  const texts: string[] = []
  for (const item of value) {
    if (typeof item === 'string' || typeof item === 'number') {
      pushUniqueTexts(texts, [item])
      continue
    }
    if (!isRecord(item)) continue
    pushUniqueTexts(texts, keys.map((key) => item[key]))
  }
  return texts
}

function extractFromRecord(value: unknown, keys: string[]): string[] {
  if (!isRecord(value)) return []
  const texts: string[] = []
  pushUniqueTexts(texts, keys.map((key) => value[key]))
  return texts
}

function extractWidgetTexts(value: unknown, widget: Widget): string[] {
  if (value === undefined || value === null || value === '') return []
  if (['short_text', 'summary', 'number', 'datetime', 'rich_text'].includes(widget.type)) {
    const text = widget.type === 'rich_text' ? stripHtml(String(value || '')) : String(value || '')
    return text.trim() ? [text] : []
  }
  if (widget.type === 'rich_note') return extractFromRichNote(value)
  if (widget.type === 'note_blocks') return extractFromArrayItems(value, ['text'])
  if (widget.type === 'video_group') return extractFromArrayItems(value, ['title', 'hint'])
  if (widget.type === 'audio_group') return extractFromArrayItems(value, ['title'])
  if (widget.type === 'location') return extractFromRecord(value, ['name', 'address'])
  if (widget.type === 'image_group') return []
  if (Array.isArray(value)) return extractFromArrayItems(value, ['title', 'text', 'name', 'address'])
  if (isRecord(value)) return extractFromRecord(value, ['title', 'text', 'markdown', 'name', 'address'])
  return [String(value)]
}

export function extractPostSearchFields(post: Post, section: Section): PostSearchField[] {
  const fields: PostSearchField[] = []
  const content = post.content || {}
  for (const widget of (section.widgets || []).slice().sort((a, b) => a.order - b.order)) {
    const value = content[widget.widgetId]
    const texts = extractWidgetTexts(value, widget)
    texts.forEach((text, index) => pushField(fields, widget, text, index > 0 ? String(index + 1) : ''))
  }
  return fields
}

function segmentTerms(segment: string): string[] {
  const terms: string[] = []
  const chars = Array.from(segment)
  if (chars.length < 2) return terms
  if (chars.length <= 32) terms.push(segment)
  const maxGram = Math.min(6, chars.length)
  for (let size = 2; size <= maxGram; size++) {
    for (let i = 0; i <= chars.length - size; i++) {
      terms.push(chars.slice(i, i + size).join(''))
    }
  }
  return terms
}

export function buildSearchTerms(values: unknown[]): string[] {
  const terms: string[] = []
  const seen = new Set<string>()
  const add = (term: string) => {
    if (term.length < 2 || seen.has(term)) return
    seen.add(term)
    terms.push(term)
  }

  for (const value of values) {
    const normalized = normalizeSearchText(value)
    if (!normalized) continue
    for (const segment of normalized.split(' ')) {
      for (const term of segmentTerms(segment)) add(term)
    }
    const compact = normalized.replace(/\s+/g, '')
    if (compact !== normalized) {
      for (const term of segmentTerms(compact)) add(term)
    }
    if (terms.length >= MAX_TERMS_PER_DOCUMENT) break
  }

  return terms.slice(0, MAX_TERMS_PER_DOCUMENT)
}

function collectWeightedTerms(values: unknown[]): Map<string, number> {
  const weights = new Map<string, number>()
  for (const value of values) {
    const normalized = normalizeSearchText(value)
    if (!normalized) continue
    const segments = normalized.split(' ').filter(Boolean)
    const compact = normalized.replace(/\s+/g, '')
    if (compact && compact !== normalized) segments.push(compact)

    for (const segment of segments) {
      for (const term of segmentTerms(segment)) {
        const lengthBoost = 1 + Math.min(Array.from(term).length, 6) / 6
        weights.set(term, (weights.get(term) || 0) + lengthBoost)
      }
    }
  }
  return weights
}

export function buildSparseVectorTerms(values: unknown[], maxTerms = MAX_VECTOR_TERMS_PER_CHUNK): SparseVectorTerm[] {
  const rawWeights = collectWeightedTerms(values)
  const entries = Array.from(rawWeights.entries())
    .filter(([term, weight]) => term.length >= 2 && weight > 0)
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length || left[0].localeCompare(right[0]))
    .slice(0, maxTerms)
  const norm = Math.sqrt(entries.reduce((sum, [, weight]) => sum + weight * weight, 0)) || 1
  return entries.map(([term, weight]) => ({
    term,
    weight: Number((weight / norm).toFixed(6)),
  }))
}

function splitChunkText(value: string): string[] {
  const chars = Array.from(normalizeWhitespace(value))
  if (chars.length === 0) return []
  if (chars.length <= MAX_CHUNK_CHARS) return [chars.join('')]

  const chunks: string[] = []
  let start = 0
  while (start < chars.length) {
    const end = Math.min(chars.length, start + MAX_CHUNK_CHARS)
    chunks.push(chars.slice(start, end).join(''))
    if (end >= chars.length) break
    start = Math.max(end - CHUNK_OVERLAP_CHARS, start + 1)
  }
  return chunks
}

function countChunksForFields(fields: PostSearchField[]): number {
  return fields.reduce((sum, field) => sum + splitChunkText(field.text).length, 0)
}

export function buildSearchQuery(raw: string): SearchQuery {
  const normalized = normalizeSearchText(raw)
  const compact = normalized.replace(/\s+/g, '')
  return {
    raw,
    normalized,
    compact,
    terms: buildSearchTerms([raw]),
  }
}

function chooseTitle(fields: PostSearchField[]): string {
  return (
    fields.find((field) => ['short_text', 'summary'].includes(field.fieldType))?.text ||
    fields[0]?.text ||
    'Untitled'
  )
}

function makeChunkDocumentId(postId: string, fieldKey: string, chunkIndex: number, text: string): string {
  return `psc_${stableHash(`${postId}\u0001${fieldKey}\u0001${chunkIndex}\u0001${text}`)}`
}

export function buildPostSearchChunks(document: PostSearchDocument): PostSearchChunk[] {
  const chunks: PostSearchChunk[] = []
  let chunkIndex = 0
  for (const field of document.fields) {
    for (const text of splitChunkText(field.text)) {
      const sourceTexts = [document.sectionName, document.title, field.fieldLabel, text]
      const searchText = normalizeSearchText(sourceTexts.join('\n'))
      const terms = buildSearchTerms(sourceTexts).slice(0, MAX_TERMS_PER_CHUNK)
      const sparseVector = buildSparseVectorTerms(sourceTexts)
      chunks.push({
        _id: makeChunkDocumentId(document.postId, field.fieldKey, chunkIndex, text),
        collection: POST_SEARCH_CHUNKS,
        postId: document.postId,
        communityId: document.communityId,
        sectionId: document.sectionId,
        sectionName: document.sectionName,
        title: document.title,
        fieldKey: field.fieldKey,
        fieldLabel: field.fieldLabel,
        fieldType: field.fieldType,
        chunkIndex,
        text,
        preview: previewText(text),
        searchText,
        compactText: searchText.replace(/\s+/g, ''),
        terms,
        sparseVector,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
        sourceUpdatedAt: document.sourceUpdatedAt,
      })
      chunkIndex += 1
    }
  }
  return chunks
}

export function buildPostSearchDocument(post: Post, section: Section, now = new Date().toISOString()): PostSearchDocument {
  const normalizedSection = normalizeSectionForSearch(section)
  const fields = extractPostSearchFields(post, normalizedSection)
  const title = chooseTitle(fields)
  const sourceTexts = [normalizedSection.name, title, ...fields.map((field) => field.text)]
  const searchText = normalizeSearchText(sourceTexts.join('\n'))
  return {
    _id: post._id,
    postId: post._id,
    communityId: post.communityId,
    sectionId: post.sectionId,
    sectionName: normalizedSection.name,
    title,
    fields,
    searchText,
    compactText: searchText.replace(/\s+/g, ''),
    terms: buildSearchTerms(sourceTexts),
    chunkCount: countChunksForFields(fields),
    createdAt: now,
    updatedAt: now,
    sourceUpdatedAt: post.updatedAt || post.createdAt || now,
  }
}

function getDb() {
  // Lazy require keeps pure extractor tests independent from wx-server-sdk setup.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('./db') as typeof import('./db')
}

function normalizeSectionForSearch(section: Section): Section {
  return normalizeGuideNoteSection({
    ...section,
    type: section?.type || 'evergreen',
    status: section?.status || 'active',
    enableComment: section?.enableComment !== false,
    enableLike: section?.enableLike !== false,
  } as Section) as Section
}

function isSearchVisiblePost(post: any): boolean {
  return post?.status === 'active' && (!post.auditStatus || post.auditStatus === 'pass')
}

function stableHash(value: string): string {
  return createHash('sha1').update(value).digest('hex')
}

function makeTermDocumentId(communityId: string, term: string, postId: string, chunkId = 'document'): string {
  return `pst_${stableHash(`${communityId}\u0001${term}\u0001${postId}\u0001${chunkId}`)}`
}

function makeVectorTermDocumentId(communityId: string, term: string, chunkId: string): string {
  return `psv_${stableHash(`${communityId}\u0001${term}\u0001${chunkId}`)}`
}

async function removeByIdIfExists(collectionName: string, id: string): Promise<number> {
  const db = getDb()
  try {
    const result = await db.removeById(collectionName, id) as any
    if (result?.stats && Number.isFinite(Number(result.stats.removed))) {
      return Number(result.stats.removed)
    }
    return 1
  } catch (_error) {
    // Removing an already-missing derived row is idempotent.
    return 0
  }
}

async function upsertById(collectionName: string, id: string, data: Record<string, any>) {
  const db = getDb()
  const { _id: _ignoredId, ...updateData } = data
  try {
    const result = await db.updateById(collectionName, id, updateData) as any
    if (result?.stats && Number(result.stats.updated || 0) === 0) {
      await db.create(collectionName, { _id: id, ...data })
    }
  } catch (_error) {
    await db.create(collectionName, { _id: id, ...data })
  }
}

async function queryAll<T = any>(
  collectionName: string,
  where: Record<string, any>,
  orderBy?: [string, 'asc' | 'desc']
): Promise<T[]> {
  const db = getDb()
  const rows: T[] = []
  let skip = 0
  while (true) {
    const batch = await db.query(collectionName, where, {
      ...(orderBy ? { orderBy } : {}),
      skip,
      limit: DB_PAGE_LIMIT,
    }) as T[]
    if (!Array.isArray(batch) || batch.length === 0) break
    rows.push(...batch)
    if (batch.length < DB_PAGE_LIMIT) break
    skip += batch.length
  }
  return rows
}

async function getByIdOrNull<T = any>(collectionName: string, id: string): Promise<T | null> {
  const db = getDb()
  try {
    if (typeof db.getById !== 'function') return null
    return await db.getById(collectionName, id) as T
  } catch {
    return null
  }
}

async function removeRowsByPostId(collectionName: string, postId: string): Promise<number> {
  let removedCount = 0
  while (true) {
    const rows = await queryAll<any>(collectionName, { postId })
    if (rows.length === 0) break
    await Promise.all(rows.map((row) => row?._id ? removeByIdIfExists(collectionName, row._id) : Promise.resolve(0)))
    removedCount += rows.length
    if (rows.length < DB_PAGE_LIMIT) break
  }
  return removedCount
}

async function upsertIndexState(state: PostSearchIndexState) {
  await upsertById(POST_SEARCH_INDEX_STATE, state.postId, state as unknown as Record<string, any>)
}

export async function removePostSearchIndex(postId: string) {
  const normalizedPostId = String(postId || '').trim()
  if (!normalizedPostId) {
    return { removedDocumentCount: 0, removedTermCount: 0, removedChunkCount: 0, removedVectorTermCount: 0 }
  }
  const existingDocument = await getByIdOrNull<PostSearchDocument>(POST_SEARCH_DOCUMENTS, normalizedPostId)
  const removedTermCount = await removeRowsByPostId(POST_SEARCH_TERMS, normalizedPostId)
  const removedVectorTermCount = await removeRowsByPostId(POST_SEARCH_VECTOR_TERMS, normalizedPostId)
  const removedChunkCount = await removeRowsByPostId(POST_SEARCH_CHUNKS, normalizedPostId)
  const removedDocumentCount = await removeByIdIfExists(POST_SEARCH_DOCUMENTS, normalizedPostId)
  const now = new Date().toISOString()
  await upsertIndexState({
    _id: normalizedPostId,
    postId: normalizedPostId,
    communityId: existingDocument?.communityId || '',
    sectionId: existingDocument?.sectionId || '',
    status: 'removed',
    sourceUpdatedAt: existingDocument?.sourceUpdatedAt || now,
    indexedAt: now,
    chunkCount: 0,
    termCount: 0,
    vectorTermCount: 0,
  })
  return {
    removedDocumentCount,
    removedTermCount,
    removedChunkCount,
    removedVectorTermCount,
  }
}

export async function indexPostForSearch(post: Post, section: Section, now = new Date().toISOString()) {
  const postId = String(post?._id || '').trim()
  if (!postId) throw new Error('post search index requires post._id')
  await removePostSearchIndex(postId)
  if (!isSearchVisiblePost(post)) {
    return { indexed: false, postId, termCount: 0, chunkCount: 0, vectorTermCount: 0 }
  }

  const document = buildPostSearchDocument(post, normalizeSectionForSearch(section), now)
  const chunks = buildPostSearchChunks(document)
  await upsertById(POST_SEARCH_DOCUMENTS, document.postId, document as unknown as Record<string, any>)
  await Promise.all(chunks.map((chunk) =>
    upsertById(POST_SEARCH_CHUNKS, chunk._id, chunk as unknown as Record<string, any>)
  ))

  let termCount = 0
  let vectorTermCount = 0
  const termWrites: Array<Promise<void>> = []
  const vectorWrites: Array<Promise<void>> = []
  for (const chunk of chunks) {
    for (const term of chunk.terms) {
      const termId = makeTermDocumentId(document.communityId, term, document.postId, chunk._id)
      termCount += 1
      termWrites.push(upsertById(POST_SEARCH_TERMS, termId, {
        _id: termId,
        communityId: document.communityId,
        sectionId: document.sectionId,
        postId: document.postId,
        chunkId: chunk._id,
        fieldKey: chunk.fieldKey,
        term,
        updatedAt: now,
      }))
    }
    for (const item of chunk.sparseVector) {
      const vectorTermId = makeVectorTermDocumentId(document.communityId, item.term, chunk._id)
      vectorTermCount += 1
      vectorWrites.push(upsertById(POST_SEARCH_VECTOR_TERMS, vectorTermId, {
        _id: vectorTermId,
        communityId: document.communityId,
        sectionId: document.sectionId,
        postId: document.postId,
        chunkId: chunk._id,
        fieldKey: chunk.fieldKey,
        term: item.term,
        weight: item.weight,
        updatedAt: now,
      }))
    }
  }
  await Promise.all([...termWrites, ...vectorWrites])
  await upsertIndexState({
    _id: document.postId,
    postId: document.postId,
    communityId: document.communityId,
    sectionId: document.sectionId,
    status: 'indexed',
    sourceUpdatedAt: document.sourceUpdatedAt,
    indexedAt: now,
    chunkCount: chunks.length,
    termCount,
    vectorTermCount,
  })

  return { indexed: true, postId, termCount, chunkCount: chunks.length, vectorTermCount }
}

export async function refreshPostSearchIndexById(postId: string) {
  const db = getDb()
  const normalizedPostId = String(postId || '').trim()
  if (!normalizedPostId) return { indexed: false, postId: '', termCount: 0, reason: 'empty_post_id' }

  let post: Post | null = null
  try {
    post = await db.getById('posts', normalizedPostId) as Post
  } catch {
    post = null
  }
  if (!post) {
    await removePostSearchIndex(normalizedPostId)
    return { indexed: false, postId: normalizedPostId, termCount: 0, reason: 'post_missing' }
  }

  let section: Section | null = null
  try {
    section = await db.getById('sections', post.sectionId) as Section
  } catch {
    section = null
  }
  if (!section) {
    await removePostSearchIndex(normalizedPostId)
    return { indexed: false, postId: normalizedPostId, termCount: 0, reason: 'section_missing' }
  }

  return indexPostForSearch(post, section)
}

export async function backfillPostSearchIndexesForCommunity(communityId: string) {
  const normalizedCommunityId = String(communityId || '').trim()
  if (!normalizedCommunityId) throw new Error('communityId is required')
  const posts = await queryAll<Post>('posts', { communityId: normalizedCommunityId }, ['updatedAt', 'desc'])
  const sectionById = new Map<string, Section | null>()
  let indexedCount = 0
  let removedCount = 0
  let failedCount = 0

  for (const post of posts) {
    try {
      if (!sectionById.has(post.sectionId)) {
        let section: Section | null = null
        try {
          section = await getDb().getById('sections', post.sectionId) as Section
        } catch {
          section = null
        }
        sectionById.set(post.sectionId, section)
      }
      const section = sectionById.get(post.sectionId)
      if (!section) {
        await removePostSearchIndex(post._id)
        removedCount += 1
        continue
      }
      const result = await indexPostForSearch(post, section)
      if (result.indexed) indexedCount += 1
      else removedCount += 1
    } catch {
      failedCount += 1
    }
  }

  return {
    communityId: normalizedCommunityId,
    scannedCount: posts.length,
    indexedCount,
    removedCount,
    failedCount,
  }
}

export async function backfillPostSearchIndexesForSection(sectionId: string) {
  const normalizedSectionId = String(sectionId || '').trim()
  if (!normalizedSectionId) throw new Error('sectionId is required')

  let section: Section | null = null
  try {
    section = await getDb().getById('sections', normalizedSectionId) as Section
  } catch {
    section = null
  }
  if (!section) {
    return removePostSearchIndexesForSection(normalizedSectionId)
  }

  const posts = await queryAll<Post>('posts', { sectionId: normalizedSectionId }, ['updatedAt', 'desc'])
  let indexedCount = 0
  let removedCount = 0
  let failedCount = 0
  for (const post of posts) {
    try {
      const result = await indexPostForSearch(post, section)
      if (result.indexed) indexedCount += 1
      else removedCount += 1
    } catch {
      failedCount += 1
    }
  }

  return {
    sectionId: normalizedSectionId,
    scannedCount: posts.length,
    indexedCount,
    removedCount,
    failedCount,
  }
}

export async function removePostSearchIndexesForSection(sectionId: string) {
  const normalizedSectionId = String(sectionId || '').trim()
  if (!normalizedSectionId) {
    return {
      sectionId: '',
      removedDocumentCount: 0,
      removedTermCount: 0,
      removedChunkCount: 0,
      removedVectorTermCount: 0,
    }
  }
  const postIds = new Set<string>()
  for (const document of await queryAll<PostSearchDocument>(POST_SEARCH_DOCUMENTS, { sectionId: normalizedSectionId })) {
    if (document?.postId) postIds.add(document.postId)
  }
  for (const chunk of await queryAll<PostSearchChunk>(POST_SEARCH_CHUNKS, { sectionId: normalizedSectionId })) {
    if (chunk?.postId) postIds.add(chunk.postId)
  }

  let removedDocumentCount = 0
  let removedTermCount = 0
  let removedChunkCount = 0
  let removedVectorTermCount = 0
  for (const postId of postIds) {
    const result = await removePostSearchIndex(postId)
    removedDocumentCount += result.removedDocumentCount
    removedTermCount += result.removedTermCount
    removedChunkCount += result.removedChunkCount
    removedVectorTermCount += result.removedVectorTermCount
  }
  return {
    sectionId: normalizedSectionId,
    removedDocumentCount,
    removedTermCount,
    removedChunkCount,
    removedVectorTermCount,
  }
}

function normalizeLimit(value: unknown): number {
  const n = Math.floor(Number(value || DEFAULT_SEARCH_LIMIT))
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SEARCH_LIMIT
  return Math.min(MAX_SEARCH_LIMIT, n)
}

function normalizeSkip(value: unknown): number {
  const n = Math.floor(Number(value || 0))
  return Number.isFinite(n) && n > 0 ? n : 0
}

function orderedQueryTerms(query: SearchQuery): string[] {
  return Array.from(new Set(query.terms))
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .slice(0, MAX_QUERY_TERMS)
}

function orderedQueryVectorTerms(query: SearchQuery): SparseVectorTerm[] {
  return buildSparseVectorTerms([query.raw], MAX_QUERY_VECTOR_TERMS)
}

function documentMatchesQuery(document: PostSearchDocument, query: SearchQuery): boolean {
  if (!query.normalized || !query.compact) return false
  return document.searchText.includes(query.normalized) || document.compactText.includes(query.compact)
}

function chunkMatchesQuery(chunk: PostSearchChunk, query: SearchQuery): boolean {
  if (!query.normalized || !query.compact) return false
  const normalized = chunk.searchText || normalizeSearchText(chunk.text)
  const compact = chunk.compactText || normalized.replace(/\s+/g, '')
  return normalized.includes(query.normalized) || compact.includes(query.compact)
}

function fieldMatchesQuery(field: PostSearchField, query: SearchQuery): boolean {
  const normalized = normalizeSearchText(field.text)
  const compact = normalized.replace(/\s+/g, '')
  return normalized.includes(query.normalized) || compact.includes(query.compact)
}

function scoreDocument(document: PostSearchDocument, query: SearchQuery, termScore: number, matchedFieldCount: number): number {
  let score = termScore
  if (compactSearchText(document.title).includes(query.compact)) score += 80
  if (document.compactText.includes(query.compact)) score += 50
  score += matchedFieldCount * 20
  return score
}

function toResultItem(document: PostSearchDocument, query: SearchQuery, termScore: number): PostSearchResultItem {
  const matchedFields = document.fields
    .filter((field) => fieldMatchesQuery(field, query))
    .slice(0, 3)
    .map((field) => ({
      fieldLabel: field.fieldLabel,
      fieldType: field.fieldType,
      preview: field.preview,
    }))
  const fallbackFields = matchedFields.length > 0
    ? matchedFields
    : document.fields.slice(0, 1).map((field) => ({
      fieldLabel: field.fieldLabel,
      fieldType: field.fieldType,
      preview: field.preview,
    }))
  return {
    postId: document.postId,
    communityId: document.communityId,
    sectionId: document.sectionId,
    sectionName: document.sectionName,
    title: document.title,
    score: scoreDocument(document, query, termScore, matchedFields.length),
    matchedFields: fallbackFields,
    createdAt: document.createdAt,
    updatedAt: document.sourceUpdatedAt || document.updatedAt,
  }
}

function toResultItemFromChunks(
  document: PostSearchDocument,
  chunks: Array<{ chunk: PostSearchChunk; score: number }>,
  query: SearchQuery,
  legacyTermScore: number
): PostSearchResultItem {
  const matchedByField = new Map<string, { fieldLabel: string; fieldType: string; preview: string; exact: boolean; score: number }>()
  for (const { chunk, score } of chunks.sort((left, right) => right.score - left.score || left.chunk.chunkIndex - right.chunk.chunkIndex)) {
    const key = `${chunk.fieldKey}\u0001${chunk.preview}`
    const exact = chunkMatchesQuery(chunk, query)
    const previous = matchedByField.get(key)
    if (previous && previous.score >= score) continue
    matchedByField.set(key, {
      fieldLabel: chunk.fieldLabel,
      fieldType: chunk.fieldType,
      preview: chunk.preview,
      exact,
      score,
    })
  }

  const matchedFields = Array.from(matchedByField.values())
    .sort((left, right) => Number(right.exact) - Number(left.exact) || right.score - left.score)
    .slice(0, 3)
    .map(({ fieldLabel, fieldType, preview }) => ({ fieldLabel, fieldType, preview }))

  const fallbackFields = matchedFields.length > 0
    ? matchedFields
    : document.fields.slice(0, 1).map((field) => ({
      fieldLabel: field.fieldLabel,
      fieldType: field.fieldType,
      preview: field.preview,
    }))

  const exactChunkMatches = chunks.filter(({ chunk }) => chunkMatchesQuery(chunk, query)).length
  const chunkScore = chunks.reduce((sum, item) => sum + item.score, 0)
  return {
    postId: document.postId,
    communityId: document.communityId,
    sectionId: document.sectionId,
    sectionName: document.sectionName,
    title: document.title,
    score: scoreDocument(document, query, legacyTermScore + chunkScore, exactChunkMatches),
    matchedFields: fallbackFields,
    createdAt: document.createdAt,
    updatedAt: document.sourceUpdatedAt || document.updatedAt,
  }
}

export async function searchPostIndex(params: {
  communityId: string
  query: string
  sectionId?: string
  skip?: number
  limit?: number
}): Promise<PostSearchResult> {
  const communityId = String(params.communityId || '').trim()
  const sectionId = String(params.sectionId || '').trim()
  const searchQuery = buildSearchQuery(String(params.query || ''))
  const skip = normalizeSkip(params.skip)
  const limit = normalizeLimit(params.limit)
  if (!communityId) throw new Error('post search requires communityId')
  if (searchQuery.compact.length < 2) {
    return { query: searchQuery.raw, communityId, sectionId, total: 0, skip, limit, items: [] }
  }

  const candidateChunkScores = new Map<string, number>()
  const legacyPostScores = new Map<string, number>()
  for (const term of orderedQueryTerms(searchQuery)) {
    const rows = await queryAll<any>(POST_SEARCH_TERMS, { communityId, term })
    for (const row of rows) {
      if (sectionId && row.sectionId !== sectionId) continue
      if (row.chunkId) {
        const previous = candidateChunkScores.get(row.chunkId) || 0
        candidateChunkScores.set(row.chunkId, previous + Math.max(4, Array.from(term).length * 2))
      } else if (row.postId) {
        const previous = legacyPostScores.get(row.postId) || 0
        legacyPostScores.set(row.postId, previous + Math.max(2, Array.from(term).length))
      }
    }
  }

  for (const item of orderedQueryVectorTerms(searchQuery)) {
    const rows = await queryAll<any>(POST_SEARCH_VECTOR_TERMS, { communityId, term: item.term })
    for (const row of rows) {
      if (!row.chunkId) continue
      if (sectionId && row.sectionId !== sectionId) continue
      const previous = candidateChunkScores.get(row.chunkId) || 0
      const rowWeight = Number(row.weight || 0)
      candidateChunkScores.set(row.chunkId, previous + item.weight * rowWeight * 60)
    }
  }

  const chunksByPostId = new Map<string, Array<{ chunk: PostSearchChunk; score: number }>>()
  for (const [chunkId, score] of candidateChunkScores) {
    const chunk = await getByIdOrNull<PostSearchChunk>(POST_SEARCH_CHUNKS, chunkId)
    if (!chunk) continue
    if (chunk.communityId !== communityId) continue
    if (sectionId && chunk.sectionId !== sectionId) continue
    if (!chunkMatchesQuery(chunk, searchQuery) && score <= 0) continue
    const list = chunksByPostId.get(chunk.postId) || []
    list.push({ chunk, score })
    chunksByPostId.set(chunk.postId, list)
  }

  const candidatePostIds = new Set<string>([
    ...chunksByPostId.keys(),
    ...legacyPostScores.keys(),
  ])
  const items: PostSearchResultItem[] = []
  for (const postId of candidatePostIds) {
    const document = await getByIdOrNull<PostSearchDocument>(POST_SEARCH_DOCUMENTS, postId)
    if (!document) continue
    if (document.communityId !== communityId) continue
    if (sectionId && document.sectionId !== sectionId) continue
    const chunks = chunksByPostId.get(postId) || []
    const legacyScore = legacyPostScores.get(postId) || 0
    const hasChunkMatch = chunks.some(({ chunk }) => chunkMatchesQuery(chunk, searchQuery))
    if (!hasChunkMatch && !documentMatchesQuery(document, searchQuery)) continue
    items.push(chunks.length > 0
      ? toResultItemFromChunks(document, chunks, searchQuery, legacyScore)
      : toResultItem(document, searchQuery, legacyScore)
    )
  }

  items.sort((left, right) =>
    right.score - left.score ||
    String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')) ||
    left.postId.localeCompare(right.postId)
  )

  return {
    query: searchQuery.raw,
    communityId,
    sectionId,
    total: items.length,
    skip,
    limit,
    items: items.slice(skip, skip + limit),
  }
}
