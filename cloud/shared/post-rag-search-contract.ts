export const POST_RAG_PROTOCOL_VERSION = 2 as const

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[2-9]|\.[1-9][0-9]+)?$/
const CONTROL_OR_SURROGATE_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ud800-\udfff]/u

type RecordValue = Record<string, unknown>

export interface PostRagSearchRequest {
  communityId: string
  sectionId?: string
  query: string
  skip: number
  limit: number
}

export interface PostRagProtocolV2Item {
  schemaVersion: 2
  postId: string
  communityId: string
  sectionId: string
  sourceVersion: string
  chunkId: string
  visibility: 'public' | 'member'
  widgetId: string
  fieldKey: string
  title: string
  text: string
  preview: string
  fieldLabel: string
  sectionName: string
}

export interface PostRagEsHit {
  _index: string
  _id: string
  _score: number | null
  _rank?: number
  _source: PostRagProtocolV2Item
}

export interface PostRagEsResponse {
  took: number
  timed_out: false
  hits: {
    total: { value: number; relation: 'eq' | 'gte' }
    max_score: number | null
    hits: PostRagEsHit[]
  }
}

export type PublicPostRagMode = 'rag' | 'no_answer'

export interface PublicPostRagItem {
  postId: string
  sectionId: string
  sectionName: string
  title: string
  matchedSnippet: string
  matchedField: string
  score: number
  coverImage?: string
  authorName?: string
}

export interface PublicPostRagSearchResponse {
  protocolVersion: 2
  answer: ''
  citations: []
  mode: PublicPostRagMode
  query: string
  communityId: string
  sectionId?: string
  skip: number
  limit: number
  total: number
  tookMs: number
  items: PublicPostRagItem[]
}

function objectValue(value: unknown, error: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(error)
  return value as RecordValue
}

function exactKeys(value: RecordValue, keys: readonly string[], error: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(error)
  }
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`invalid ${field}`)
  return value
}

function idValue(value: unknown, field: string): string {
  const id = stringValue(value, field)
  if (!ID_PATTERN.test(id)) throw new Error(`invalid ${field}`)
  return id
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`invalid ${field}`)
  return value as number
}

export function normalizePostRagQuery(value: unknown): string {
  if (typeof value !== 'string' || CONTROL_OR_SURROGATE_PATTERN.test(value)) throw new Error('invalid query')
  const query = value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
  const length = Array.from(query).length
  if (length < 1 || length > 80) throw new Error('invalid query')
  return query
}

export function parsePostRagSearchRequest(value: unknown): PostRagSearchRequest {
  const raw = objectValue(value, 'invalid request')
  const communityId = idValue(raw.communityId, 'communityId')
  const sectionId = raw.sectionId === undefined ? undefined : idValue(raw.sectionId, 'sectionId')
  const query = normalizePostRagQuery(raw.query)
  const skip = raw.skip === undefined ? 0 : raw.skip
  const limit = raw.limit === undefined ? 10 : raw.limit
  if (!Number.isInteger(skip) || !Number.isInteger(limit) || (skip as number) < 0 ||
      (skip as number) > 10 || (limit as number) < 1 || (limit as number) > 10 ||
      (skip as number) + (limit as number) > 20) {
    throw new Error('invalid pagination')
  }
  return { communityId, ...(sectionId ? { sectionId } : {}), query, skip: skip as number, limit: limit as number }
}

export function parsePostRagProtocolV2Item(value: unknown): PostRagProtocolV2Item {
  const raw = objectValue(value, 'invalid protocol item')
  exactKeys(raw, [
    'schemaVersion', 'postId', 'communityId', 'sectionId', 'sourceVersion', 'chunkId', 'visibility',
    'widgetId', 'fieldKey', 'title', 'text', 'preview', 'fieldLabel', 'sectionName',
  ], 'invalid protocol item')
  if (raw.schemaVersion !== 2) throw new Error('invalid schemaVersion')
  const fieldKey = stringValue(raw.fieldKey, 'fieldKey')
  if (!FIELD_KEY_PATTERN.test(fieldKey)) throw new Error('invalid fieldKey')
  if (raw.visibility !== 'public' && raw.visibility !== 'member') throw new Error('invalid visibility')
  return {
    schemaVersion: 2,
    postId: idValue(raw.postId, 'postId'), communityId: idValue(raw.communityId, 'communityId'),
    sectionId: idValue(raw.sectionId, 'sectionId'), sourceVersion: idValue(raw.sourceVersion, 'sourceVersion'),
    chunkId: idValue(raw.chunkId, 'chunkId'), visibility: raw.visibility,
    widgetId: idValue(raw.widgetId, 'widgetId'), fieldKey,
    title: stringValue(raw.title, 'title'), text: stringValue(raw.text, 'text'),
    preview: stringValue(raw.preview, 'preview'), fieldLabel: stringValue(raw.fieldLabel, 'fieldLabel'),
    sectionName: stringValue(raw.sectionName, 'sectionName'),
  }
}

function parseEsHit(value: unknown): PostRagEsHit {
  const raw = objectValue(value, 'invalid Elasticsearch hit')
  const keys = raw._rank === undefined
    ? ['_index', '_id', '_score', '_source']
    : ['_index', '_id', '_score', '_rank', '_source']
  exactKeys(raw, keys, 'invalid Elasticsearch hit')
  if (raw._score !== null && (typeof raw._score !== 'number' || !Number.isFinite(raw._score))) {
    throw new Error('invalid Elasticsearch hit')
  }
  if (raw._rank !== undefined && (!Number.isInteger(raw._rank) || (raw._rank as number) < 1)) {
    throw new Error('invalid Elasticsearch hit')
  }
  return {
    _index: idValue(raw._index, 'Elasticsearch hit'), _id: idValue(raw._id, 'Elasticsearch hit'),
    _score: raw._score as number | null, ...(raw._rank === undefined ? {} : { _rank: raw._rank as number }),
    _source: parsePostRagProtocolV2Item(raw._source),
  }
}

export function parsePostRagEsResponse(value: unknown): PostRagEsResponse {
  const raw = objectValue(value, 'invalid Elasticsearch response')
  exactKeys(raw, ['took', 'timed_out', 'hits'], 'invalid Elasticsearch response')
  if (!Number.isInteger(raw.took) || (raw.took as number) < 0 || raw.timed_out !== false) {
    throw new Error('invalid Elasticsearch response')
  }
  const hits = objectValue(raw.hits, 'invalid Elasticsearch response')
  exactKeys(hits, ['total', 'max_score', 'hits'], 'invalid Elasticsearch response')
  const total = objectValue(hits.total, 'invalid Elasticsearch response')
  exactKeys(total, ['value', 'relation'], 'invalid Elasticsearch response')
  if (!Number.isInteger(total.value) || (total.value as number) < 0 ||
      (total.relation !== 'eq' && total.relation !== 'gte') ||
      (hits.max_score !== null && (typeof hits.max_score !== 'number' || !Number.isFinite(hits.max_score))) ||
      !Array.isArray(hits.hits)) {
    throw new Error('invalid Elasticsearch response')
  }
  return {
    took: raw.took as number, timed_out: false,
    hits: {
      total: { value: total.value as number, relation: total.relation },
      max_score: hits.max_score as number | null,
      hits: hits.hits.map(parseEsHit),
    },
  }
}

export function toPublicPostRagSearchResponse(value: unknown): PublicPostRagSearchResponse {
  const raw = objectValue(value, 'invalid public response')
  if (raw.mode !== 'rag' && raw.mode !== 'no_answer') throw new Error('invalid mode')
  const request = parsePostRagSearchRequest(raw)
  const total = nonNegativeInteger(raw.total, 'total')
  const tookMs = nonNegativeInteger(raw.tookMs, 'tookMs')
  if (!Array.isArray(raw.items)) throw new Error('invalid items')
  const items = raw.items.map((value): PublicPostRagItem => {
    const item = objectValue(value, 'invalid public item')
    const score = item.score
    if (typeof score !== 'number' || !Number.isFinite(score)) throw new Error('invalid score')
    const optional = (field: 'coverImage' | 'authorName') =>
      item[field] === undefined ? {} : { [field]: stringValue(item[field], field) }
    return {
      postId: idValue(item.postId, 'postId'), sectionId: idValue(item.sectionId, 'sectionId'),
      sectionName: stringValue(item.sectionName, 'sectionName'), title: stringValue(item.title, 'title'),
      matchedSnippet: stringValue(item.matchedSnippet, 'matchedSnippet'),
      matchedField: stringValue(item.matchedField, 'matchedField'), score,
      ...optional('coverImage'), ...optional('authorName'),
    }
  })
  return {
    protocolVersion: POST_RAG_PROTOCOL_VERSION, answer: '', citations: [], mode: raw.mode,
    ...request, total, tookMs, items,
  }
}
