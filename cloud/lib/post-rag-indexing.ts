
import { createHash } from 'crypto'
import type { Post, Section } from '../shared/types'
import { buildPostSearchChunks, buildPostSearchDocument } from './post-search'
import type { PostSearchChunk } from './post-search'

export const POST_RAG_RETRIEVAL_INDEX_VERSION = 'post-rag-v2-c260-o40'

const authenticatedProjectionValidationErrors = new WeakSet<object>()

export class PostRagSourceProjectionValidationError extends Error {
  declare readonly code: 'VALIDATION_FAILED'
  declare readonly retryable: false

  constructor() {
    super('Canonical RAG source projection input is invalid')
    this.name = 'PostRagSourceProjectionValidationError'
    Object.defineProperties(this, {
      code: { value: 'VALIDATION_FAILED', enumerable: true, writable: false, configurable: false },
      retryable: { value: false, enumerable: true, writable: false, configurable: false },
    })
    authenticatedProjectionValidationErrors.add(this)
  }
}

export function isPostRagSourceProjectionValidationError(value: unknown): value is PostRagSourceProjectionValidationError {
  return Boolean(value && typeof value === 'object' && authenticatedProjectionValidationErrors.has(value as object))
}

function invalidProjection(): never { throw new PostRagSourceProjectionValidationError() }

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue }

function ownDataDescriptors(value: object, allowedPrototype: object | null): PropertyDescriptorMap {
  let prototype: object | null
  let descriptors: PropertyDescriptorMap
  try {
    prototype = Object.getPrototypeOf(value)
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    invalidProjection()
  }
  if (prototype !== allowedPrototype) invalidProjection()
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key === 'symbol') invalidProjection()
    const descriptor = descriptors[key]
    if (!descriptor || !('value' in descriptor)) invalidProjection()
    if (key === '__proto__') invalidProjection()
  }
  return descriptors
}

function assertPlainRootShape(value: object) {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    invalidProjection()
  }
  ownDataDescriptors(value, prototype)
}

export interface PostRagSourceChunk extends Omit<PostSearchChunk, '_id' | 'sourceUpdatedAt'> {
  widgetId: string
  sourceVersion: string
  retrievalIndexVersion: string
  fieldKey: string
  fieldLabel: string
  fieldType: string
  visibility: 'public' | 'member'
  title: string
  sectionName: string
  text: string
  preview: string
  sourceUpdatedAt: string
  chunkIndex: number
  chunkId: string
  chunkChecksum: string
}

export interface PostRagSourceProjection {
  eligible: boolean
  sourceVersion: string
  retrievalIndexVersion: string
  chunks: PostRagSourceChunk[]
  chunkCount: number
  chunkChecksum: string
}

function canonicalize(value: unknown, ancestors = new Set<object>()): CanonicalValue | undefined {
  if (value === undefined) return undefined
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalidProjection()
    return Object.is(value, -0) ? 0 : value
  }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    invalidProjection()
  }
  if (value instanceof Date) {
    ownDataDescriptors(value, Date.prototype)
    if (!Number.isFinite(value.getTime())) invalidProjection()
    return value.toISOString()
  }
  if (typeof value !== 'object') invalidProjection()
  if (ancestors.has(value)) invalidProjection()

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const descriptors = ownDataDescriptors(value, Array.prototype)
      for (const key of Object.keys(descriptors)) {
        if (key !== 'length' && !/^(0|[1-9]\d*)$/.test(key)) {
          invalidProjection()
        }
      }
      return Array.from({ length: value.length }, (_, index) => {
        const descriptor = descriptors[String(index)]
        if (!descriptor || !('value' in descriptor)) invalidProjection()
        const normalized = canonicalize(descriptor.value, ancestors)
        if (normalized === undefined) invalidProjection()
        return normalized
      })
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      invalidProjection()
    }
    const descriptors = ownDataDescriptors(value, prototype)
    const normalized = Object.create(null) as { [key: string]: CanonicalValue }
    for (const key of Object.keys(descriptors).filter((key) => descriptors[key].enumerable).sort()) {
      const child = canonicalize(descriptors[key].value, ancestors)
      if (child !== undefined) normalized[key] = child
    }
    return normalized
  } finally {
    ancestors.delete(value)
  }
}

function canonicalJson(value: unknown): string {
  const normalized = canonicalize(value)
  if (normalized === undefined) invalidProjection()
  return JSON.stringify(normalized)
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

function normalizedSourceUpdatedAt(post: Post): string {
  const raw: unknown = post.updatedAt || post.createdAt
  if (raw instanceof Date) {
    if (!Number.isFinite(raw.getTime())) invalidProjection()
    return raw.toISOString()
  }
  return String(raw || '')
}

function widgetSchema(section: Section) {
  return [...(section.widgets || [])]
    .sort((left, right) => left.order - right.order || left.widgetId.localeCompare(right.widgetId))
    .map((widget) => ({
      widgetId: widget.widgetId,
      fieldKey: widget.fieldKey,
      label: widget.label,
      type: widget.type,
      visibility: widget.visibility === 'member' ? 'member' : 'public',
      order: widget.order,
    }))
}

function validateSearchableInputs(post: Post, section: Section | null | undefined) {
  if (!section) return
  canonicalJson({
    widgets: section.widgets,
    content: post.content,
    sourceUpdatedAt: post.updatedAt || post.createdAt,
  })
}

export function resolvePostRagProjectionInputs(post: Post, section: Section | null | undefined): { post: Post; section: Section | null } {
  if (section || post.area !== 'archive' || String(post.sectionId || '').trim()) return { post, section: section || null }
  const topicText = Array.isArray(post.topics) ? post.topics.map(String).filter(Boolean).join(' ') : ''
  return {
    post: {
      ...post,
      sectionId: '',
      content: { ...post.content, __archive_topics: topicText },
    },
    section: {
      _id: '',
      communityId: post.communityId,
      name: '沉淀区',
      icon: '',
      order: 0,
      enableComment: true,
      enableLike: true,
      createdAt: String(post.createdAt || ''),
      type: 'evergreen',
      status: 'active',
      widgets: [
        { widgetId: 'title', fieldKey: 'title', type: 'short_text', label: '标题', required: false, order: 0, showInList: true, visibility: 'public' },
        { widgetId: 'body', fieldKey: 'body', type: 'rich_note', label: '正文', required: false, order: 1, showInList: true, visibility: 'public' },
        { widgetId: '__archive_topics', fieldKey: '__archive_topics', type: 'topic', label: '话题', required: false, order: 2, showInList: true, visibility: 'public' },
      ],
    },
  }
}

export function isPostEligibleForTrustedRag(post: Post | null | undefined, section: Section | null | undefined): boolean {
  if (!post) return false
  if (post.area === 'archive' && !String(post.sectionId || '').trim()) {
    return Boolean(
      String(post._id || '').trim() &&
      String(post.communityId || '').trim() &&
      post.status === 'active' &&
      (!post.auditStatus || post.auditStatus === 'pass')
    )
  }
  if (post.area === 'collaboration' && !String(post.sectionId || '').trim()) {
    const templateId = String(post.collaborationTemplateId || '').trim()
    return Boolean(
      section &&
      String(post._id || '').trim() &&
      String(post.communityId || '').trim() &&
      templateId &&
      post.status === 'active' &&
      (!post.auditStatus || post.auditStatus === 'pass') &&
      section.status === 'active' &&
      section._id === templateId &&
      section.communityId === post.communityId
    )
  }
  if (!section) return false
  return Boolean(
    String(post._id || '').trim() &&
    String(post.communityId || '').trim() &&
    String(post.sectionId || '').trim() &&
    post.status === 'active' &&
    (!post.auditStatus || post.auditStatus === 'pass') &&
    section.status === 'active' &&
    post.sectionId === section._id &&
    post.communityId === section.communityId
  )
}

export function buildPostRagSourceProjection(
  post: Post,
  section: Section | null | undefined,
  options: { retrievalIndexVersion?: string } = {}
): PostRagSourceProjection {
  if (!post || typeof post !== 'object') invalidProjection()
  assertPlainRootShape(post)
  if (section) assertPlainRootShape(section)
  const retrievalIndexVersion = String(options.retrievalIndexVersion || POST_RAG_RETRIEVAL_INDEX_VERSION)

  if (!isPostEligibleForTrustedRag(post, section)) {
    const removalFacts = {
      postId: post._id,
      postCommunityId: post.communityId,
      postSectionId: post.sectionId,
      postStatus: post.status,
      auditStatus: post.auditStatus || null,
      sourceUpdatedAt: post.updatedAt || post.createdAt,
      sectionExists: Boolean(section),
      sectionId: section?._id || null,
      sectionCommunityId: section?.communityId || null,
      sectionStatus: section?.status || null,
    }
    return {
      eligible: false,
      sourceVersion: `removed-${sha256(removalFacts)}`,
      retrievalIndexVersion,
      chunks: [],
      chunkCount: 0,
      chunkChecksum: sha256([]),
    }
  }

  const resolved = resolvePostRagProjectionInputs(post, section)
  const activeSection = resolved.section as Section
  const searchablePost = resolved.post
  validateSearchableInputs(searchablePost, activeSection)
  const sourceUpdatedAt = normalizedSourceUpdatedAt(searchablePost)
  const document = buildPostSearchDocument(searchablePost, activeSection, sourceUpdatedAt)
  const searchChunks = buildPostSearchChunks(document)
  const sourceFacts = {
    postId: document.postId,
    communityId: document.communityId,
    sectionId: document.sectionId,
    sectionName: document.sectionName,
    sectionStatus: activeSection.status,
    area: post.area || null,
    topics: post.topics || [],
    title: document.title,
    sourceUpdatedAt,
    retrievalIndexVersion,
    widgets: widgetSchema(activeSection),
    fields: document.fields.map(({ widgetId, fieldKey, fieldLabel, fieldType, visibility, text, preview }) => ({
      widgetId, fieldKey, fieldLabel, fieldType, visibility, text, preview,
    })),
  }
  const sourceVersion = sha256(sourceFacts)
  const chunks = searchChunks.map((chunk): PostRagSourceChunk => {
    const sourceField = document.fields.find((field) =>
      field.fieldKey === chunk.fieldKey
      && field.fieldLabel === chunk.fieldLabel
      && field.fieldType === chunk.fieldType
      && field.visibility === chunk.visibility
      && field.text.includes(chunk.text)
    )
    if (!sourceField) invalidProjection()
    const { _id: _legacyChunkId, ...baseChunk } = chunk
    const metadata = {
      ...baseChunk,
      widgetId: sourceField.widgetId,
      sourceUpdatedAt,
      sourceVersion,
      retrievalIndexVersion,
    }
    return {
      ...metadata,
      chunkId: `prc_${sha256({
        postId: post._id,
        sourceVersion,
        widgetId: sourceField.widgetId,
        fieldKey: chunk.fieldKey,
        chunkIndex: chunk.chunkIndex,
      })}`,
      chunkChecksum: sha256(metadata),
    }
  })

  return {
    eligible: true,
    sourceVersion,
    retrievalIndexVersion,
    chunks,
    chunkCount: chunks.length,
    chunkChecksum: sha256(chunks.map(({ chunkId, chunkChecksum }) => ({ chunkId, chunkChecksum }))),
  }
}
