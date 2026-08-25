import crypto from 'crypto'
import https from 'https'
import { URL } from 'url'
import { isDeepStrictEqual } from 'util'
import * as db from './db'
import * as storage from './storage'
import { postWxJson } from './wx-openapi'
import { refreshPostSearchIndexById } from './post-search'
import { schedulePostRagSyncInTransaction } from './post-rag-sync'
import {
  prepareArchivePostTopicReconciliation,
  reconcileArchivePostTopicsInTransaction,
  type ArchivePostTopicSource,
} from './archive-topic-index'
import type { WechatMediaAuditResult } from './wechat-callback'
import { assertOwnedFinalizedMemberAudioFile } from './member-audio-upload'
import type {
  AuditProvider,
  AuditTargetType,
  ContentAuditTask,
  Post,
  PostAuditStatus,
  PostContent,
  Section,
  Widget,
} from '../shared/types'

export const AUDIT_TASKS = 'content_audit_tasks'
export const POST_MEDIA_CLEANUP_RETRIES = 'post_media_cleanup_retries'
const AUDIT_SCENE_FOR_POST = 3
const TEXT_CHUNK_LIMIT = 2400
const AUDIT_TARGET_CONCURRENCY = 4
const CALLBACK_INBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const CALLBACK_INBOX_PRUNE_LIMIT = 20

type ContentSlot = 'content' | 'pendingContent'
export type MemberAudioCleanupCandidate = { kind: 'audio' | 'cover'; fileID: string }

type MemberAudioCleanupRetry = {
  _id?: string
  postId: string
  communityId: string
  authorId: string
  kind: 'audio' | 'cover'
  fileID: string
  expectedRevision: string
  status: 'pending'
  attempts: number
  lastError: string
  createdAt: string
  updatedAt: string
  lastAttemptAt?: string
}

interface AuditTarget {
  widgetId?: string
  type: AuditTargetType
  label: string
  text?: string
  fileID?: string
  url?: string
  forceManual?: boolean
  reason?: string
}

interface AuditSubmitResult {
  status: PostAuditStatus
  provider: AuditProvider
  traceId?: string
  jobId?: string
  suggest?: string
  label?: string | number
  reason?: string
  raw?: any
}

type AuditCallbackRecord = {
  _id?: string
  recordType: 'callback_result'
  callbackKeyType: 'traceId' | 'jobId'
  callbackKey: string
  status: PostAuditStatus
  suggest: string
  label: string | number
  reason: string
  raw: any
  createdAt: string
  updatedAt: string
}

export function isPostVisibleToMembers(post: any): boolean {
  return post?.status === 'active' && (!post.auditStatus || post.auditStatus === 'pass')
}

export function isPostUnderAudit(post: any): boolean {
  return post?.auditStatus === 'pending' || post?.auditStatus === 'review' || Boolean(post?.pendingContent)
}

function nowIso() {
  return new Date().toISOString()
}

function callbackRecordId(keyType: 'traceId' | 'jobId', key: string): string {
  return `callback_${crypto.createHash('sha256').update(`${keyType}\u0000${key}`, 'utf8').digest('hex')}`
}

async function persistAuditCallbackRecord(params: {
  keyType: 'traceId' | 'jobId'
  key: string
  status: PostAuditStatus
  suggest: unknown
  label: unknown
  reason: string
  raw: any
}): Promise<AuditCallbackRecord> {
  const id = callbackRecordId(params.keyType, params.key)
  return db.runTransaction(async transaction => {
    const existing = await db.transactionGetByIdOrNull<AuditCallbackRecord>(transaction, AUDIT_TASKS, id)
    if (existing?.recordType === 'callback_result') return existing
    const now = nowIso()
    const record: AuditCallbackRecord = {
      recordType: 'callback_result',
      callbackKeyType: params.keyType,
      callbackKey: params.key,
      status: params.status,
      suggest: String(params.suggest || ''),
      label: typeof params.label === 'number' ? params.label : String(params.label || ''),
      reason: params.reason,
      raw: params.raw,
      createdAt: now,
      updatedAt: now,
    }
    await transaction.collection(AUDIT_TASKS).doc(id).set({ data: record })
    return { _id: id, ...record }
  })
}

function callbackPatch(record: AuditCallbackRecord) {
  return {
    status: record.status,
    suggest: record.suggest,
    label: record.label,
    reason: record.reason,
    raw: db.replaceValue(sanitizeAuditCallbackRaw(record.raw)),
    updatedAt: record.updatedAt,
  }
}

function sanitizeAuditCallbackRaw(params: any) {
  const raw = params && typeof params === 'object' ? { ...params } : {}
  delete raw.callbackToken
  delete raw.token
  return raw
}

function callbackLookupForTask(task: Partial<ContentAuditTask>) {
  const traceId = String(task.traceId || '').trim()
  const jobId = String(task.jobId || '').trim()
  return traceId
    ? ['traceId', traceId] as const
    : jobId
      ? ['jobId', jobId] as const
      : null
}

async function reconcileTaskFromCallbackRecord(task: ContentAuditTask): Promise<ContentAuditTask> {
  const lookup = callbackLookupForTask(task)
  if (!task._id || !lookup) return task
  const recordId = callbackRecordId(lookup[0], lookup[1])
  return db.runTransaction(async transaction => {
    const storedTask = await db.transactionGetByIdOrNull<ContentAuditTask>(transaction, AUDIT_TASKS, task._id)
    const record = await db.transactionGetByIdOrNull<AuditCallbackRecord>(transaction, AUDIT_TASKS, recordId)
    if (record?.recordType !== 'callback_result') return task
    const currentTask = storedTask?.postId && storedTask._id === task._id ? storedTask : task
    const patch = callbackPatch(record)
    if (currentTask.status === 'pending') {
      await transaction.collection(AUDIT_TASKS).doc(task._id).update({ data: patch })
    }
    await transaction.collection(AUDIT_TASKS).doc(recordId).remove()
    return currentTask.status === 'pending' ? { ...currentTask, ...patch } : currentTask
  })
}

async function reconcileTasksForCallbackRecord(
  tasks: ContentAuditTask[],
  record: AuditCallbackRecord,
): Promise<ContentAuditTask[]> {
  const recordId = String(record._id || callbackRecordId(record.callbackKeyType, record.callbackKey))
  return db.runTransaction(async transaction => {
    const durableRecord = await db.transactionGetByIdOrNull<AuditCallbackRecord>(transaction, AUDIT_TASKS, recordId)
    const effectiveRecord = durableRecord?.recordType === 'callback_result' ? durableRecord : record
    const patch = callbackPatch(effectiveRecord)
    const reconciled: ContentAuditTask[] = []
    for (const task of tasks) {
      const storedTask = await db.transactionGetByIdOrNull<ContentAuditTask>(transaction, AUDIT_TASKS, task._id)
      const currentTask = storedTask?.postId && storedTask._id === task._id ? storedTask : task
      if (currentTask.status === 'pending') {
        await transaction.collection(AUDIT_TASKS).doc(task._id).update({ data: patch })
        reconciled.push({ ...currentTask, ...patch })
      } else {
        reconciled.push(currentTask)
      }
    }
    if (durableRecord?.recordType === 'callback_result') {
      await transaction.collection(AUDIT_TASKS).doc(recordId).remove()
    }
    return reconciled
  })
}

async function pruneExpiredCallbackRecords(): Promise<void> {
  const cutoff = new Date(Date.now() - CALLBACK_INBOX_RETENTION_MS).toISOString()
  const rows = await Promise.resolve(db.queryBefore(
    AUDIT_TASKS,
    { recordType: 'callback_result' },
    'updatedAt',
    cutoff,
    CALLBACK_INBOX_PRUNE_LIMIT,
  )).catch(() => []) as Array<AuditCallbackRecord & { _id: string }>
  const expired = Array.isArray(rows)
    ? rows.filter((row) => row?.recordType === 'callback_result' && row._id)
    : []
  await Promise.all(expired.map((row) => db.removeById(AUDIT_TASKS, row._id).catch(() => undefined)))
}

export function createContentRevision(): string {
  return crypto.randomBytes(16).toString('hex')
}

function revisionField(slot: ContentSlot): 'contentRevision' | 'pendingContentRevision' {
  return slot === 'pendingContent' ? 'pendingContentRevision' : 'contentRevision'
}

function revisionDigestField(slot: ContentSlot): 'contentRevisionDigest' | 'pendingContentRevisionDigest' {
  return slot === 'pendingContent' ? 'pendingContentRevisionDigest' : 'contentRevisionDigest'
}

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function computeContentRevisionDigest(content: PostContent): string {
  return crypto.createHash('sha256').update(stableSerialize(content), 'utf8').digest('hex')
}

function contentForSlot(post: Partial<Post> | null | undefined, slot: ContentSlot): PostContent | null {
  const value = slot === 'pendingContent' ? post?.pendingContent : post?.content
  return value && typeof value === 'object' ? value as PostContent : null
}

function revisionForSlot(post: Partial<Post> | null | undefined, slot: ContentSlot): string {
  return String(post?.[revisionField(slot)] || '').trim()
}

function revisionDigestForSlot(post: Partial<Post> | null | undefined, slot: ContentSlot): string {
  return String(post?.[revisionDigestField(slot)] || '').trim()
}

function containsExactFileID(value: unknown, fileID: string): boolean {
  if (value === fileID) return true
  if (Array.isArray(value)) return value.some((item) => containsExactFileID(item, fileID))
  if (!value || typeof value !== 'object') return false
  return Object.values(value as Record<string, unknown>).some((item) => containsExactFileID(item, fileID))
}

function isNativeArchiveAudioPost(post: Partial<Post> | null | undefined): boolean {
  return post?.area === 'archive' && post?.format === 'audio'
}

export function collectMemberAudioCleanupCandidates(
  post: Partial<Post> | null | undefined,
  content: unknown,
): MemberAudioCleanupCandidate[] {
  if (!isNativeArchiveAudioPost(post) || !content || typeof content !== 'object') return []
  const audios = Array.isArray((content as any).audios) ? (content as any).audios : []
  const candidates: MemberAudioCleanupCandidate[] = []
  for (const track of audios) {
    if (typeof track?.fileID === 'string' && track.fileID.trim()) {
      candidates.push({ kind: 'audio', fileID: track.fileID.trim() })
    }
    if (typeof track?.cover === 'string' && track.cover.trim()) {
      candidates.push({ kind: 'cover', fileID: track.cover.trim() })
    }
  }
  return Array.from(new Map(candidates.map((candidate) => [`${candidate.kind}\u0000${candidate.fileID}`, candidate])).values())
}

function cleanupRetryId(postId: string, candidate: MemberAudioCleanupCandidate): string {
  return crypto.createHash('sha256')
    .update(`${postId}\u0000${candidate.kind}\u0000${candidate.fileID}`, 'utf8')
    .digest('hex')
}

function cleanupRetryData(
  existing: Partial<MemberAudioCleanupRetry> | null,
  params: {
    postId: string
    communityId: string
    authorId: string
    candidate: MemberAudioCleanupCandidate
    expectedRevision: string
    now: string
    attempts?: number
    lastError?: string
    lastAttemptAt?: string
  },
): MemberAudioCleanupRetry {
  return {
    postId: params.postId,
    communityId: params.communityId,
    authorId: params.authorId,
    kind: params.candidate.kind,
    fileID: params.candidate.fileID,
    expectedRevision: params.expectedRevision,
    status: 'pending',
    attempts: params.attempts ?? Math.max(0, Number(existing?.attempts) || 0),
    lastError: params.lastError ?? String(existing?.lastError || ''),
    createdAt: String(existing?.createdAt || params.now),
    updatedAt: params.now,
    ...(params.lastAttemptAt || existing?.lastAttemptAt
      ? { lastAttemptAt: String(params.lastAttemptAt || existing?.lastAttemptAt) }
      : {}),
  }
}

export async function queueMemberAudioCleanupJobsInTransaction(
  transaction: db.DbTransaction,
  params: {
    post: Partial<Post>
    candidates: MemberAudioCleanupCandidate[]
    expectedRevision: string
    now?: string
  },
): Promise<MemberAudioCleanupCandidate[]> {
  const postId = String(params.post?._id || '').trim()
  const communityId = String(params.post?.communityId || '').trim()
  const authorId = String(params.post?.authorId || '').trim()
  const expectedRevision = String(params.expectedRevision || '').trim()
  if (!postId || !communityId || !authorId || !expectedRevision || !isNativeArchiveAudioPost(params.post)) return []
  const now = params.now || nowIso()
  const queued: MemberAudioCleanupCandidate[] = []
  const unique = Array.from(new Map(params.candidates.map((candidate) => [`${candidate.kind}\u0000${candidate.fileID}`, candidate])).values())
  for (const candidate of unique) {
    try {
      assertOwnedFinalizedMemberAudioFile(candidate.fileID, authorId, communityId, candidate.kind)
    } catch {
      continue
    }
    const id = cleanupRetryId(postId, candidate)
    const existing = await db.transactionGetByIdOrNull<MemberAudioCleanupRetry>(transaction, POST_MEDIA_CLEANUP_RETRIES, id)
    await transaction.collection(POST_MEDIA_CLEANUP_RETRIES).doc(id).set({
      data: cleanupRetryData(existing, { postId, communityId, authorId, candidate, expectedRevision, now }),
    })
    queued.push(candidate)
  }
  return queued
}

async function isReferencedByAnotherPost(
  postId: string,
  communityId: string,
  fileID: string,
): Promise<boolean> {
  let afterId: string | null = null
  for (;;) {
    const page = await db.queryAfterId('posts', { communityId }, afterId, 100) as any[]
    if (!Array.isArray(page)) throw new Error('无法确认固化文件引用状态')
    for (const post of page) {
      if (String(post?._id || '') === postId) continue
      if (post?.status === 'deleted') continue
      if (containsExactFileID(post?.content, fileID) || containsExactFileID(post?.pendingContent, fileID)) return true
    }
    if (page.length < 100) return false
    afterId = String(page[page.length - 1]?._id || '')
    if (!afterId) throw new Error('无法确认固化文件引用状态')
  }
}

async function beginCleanupAttempt(
  postId: string,
  candidate: MemberAudioCleanupCandidate,
): Promise<MemberAudioCleanupRetry | null> {
  const id = cleanupRetryId(postId, candidate)
  const now = nowIso()
  return db.runTransaction(async transaction => {
    const existing = await db.transactionGetByIdOrNull<MemberAudioCleanupRetry>(transaction, POST_MEDIA_CLEANUP_RETRIES, id)
    if (!existing) return null
    const next = cleanupRetryData(existing, {
      postId: existing.postId,
      communityId: existing.communityId,
      authorId: existing.authorId,
      candidate,
      expectedRevision: existing.expectedRevision,
      now,
      attempts: Math.max(0, Number(existing.attempts) || 0) + 1,
      lastError: '',
      lastAttemptAt: now,
    })
    await transaction.collection(POST_MEDIA_CLEANUP_RETRIES).doc(id).set({ data: next })
    return next
  })
}

export async function processMemberAudioCleanupJobs(params: {
  postId: string
  candidates: MemberAudioCleanupCandidate[]
}): Promise<void> {
  const postId = String(params.postId || '').trim()
  if (!postId || params.candidates.length === 0) return
  const unique = Array.from(new Map(params.candidates.map((candidate) => [`${candidate.kind}\u0000${candidate.fileID}`, candidate])).values())
  for (const candidate of unique) {
    const id = cleanupRetryId(postId, candidate)
    try {
      const post = await db.getById('posts', postId) as Post
      if (!post || String(post._id || '') !== postId || !isNativeArchiveAudioPost(post)) continue
      if (containsExactFileID(post.content, candidate.fileID) || containsExactFileID(post.pendingContent, candidate.fileID)) continue
      let owned: { cloudPath: string }
      try {
        owned = assertOwnedFinalizedMemberAudioFile(candidate.fileID, post.authorId, post.communityId, candidate.kind)
      } catch {
        continue
      }
      const attempt = await beginCleanupAttempt(postId, candidate)
      if (!attempt) continue
      try {
        if (await isReferencedByAnotherPost(postId, post.communityId, candidate.fileID)) {
          throw new Error('file is still referenced by another post')
        }
        const expected = await storage.requestUploadMetadata(owned.cloudPath)
        if (String(expected?.fileId || '') !== candidate.fileID) throw new Error('finalized file application authority mismatch')
        await storage.deleteFile([candidate.fileID])
        await db.removeById(POST_MEDIA_CLEANUP_RETRIES, id)
      } catch (error: any) {
        const failedAt = nowIso()
        await db.setById(POST_MEDIA_CLEANUP_RETRIES, id, cleanupRetryData(attempt, {
          postId: attempt.postId,
          communityId: attempt.communityId,
          authorId: attempt.authorId,
          candidate,
          expectedRevision: attempt.expectedRevision,
          now: failedAt,
          attempts: attempt.attempts,
          lastError: String(error?.message || error).slice(0, 500),
          lastAttemptAt: attempt.lastAttemptAt || failedAt,
        })).catch(() => undefined)
      }
    } catch {
      // The deterministic job was stored in the displacement transaction.
      // Leaving it pending is safer than deleting without authoritative checks.
    }
  }
}

export async function recoverMemberAudioCleanupJobs(params: {
  postId: string
  excludeCandidates?: MemberAudioCleanupCandidate[]
}): Promise<number> {
  const postId = String(params.postId || '').trim()
  if (!postId) return 0
  const excluded = new Set((params.excludeCandidates || []).map((candidate) => `${candidate.kind}\u0000${candidate.fileID}`))
  const queried = await Promise.resolve(db.query(
    POST_MEDIA_CLEANUP_RETRIES,
    { postId, status: 'pending' },
    { orderBy: ['updatedAt', 'asc'], limit: 20 },
  )).catch(() => []) as MemberAudioCleanupRetry[]
  const candidates = Array.from(new Map((Array.isArray(queried) ? queried : [])
    .filter((job) => (
      job?.postId === postId
      && job.status === 'pending'
      && (job.kind === 'audio' || job.kind === 'cover')
      && typeof job.fileID === 'string'
      && job.fileID.trim()
      && !excluded.has(`${job.kind}\u0000${job.fileID.trim()}`)
    ))
    .map((job) => {
      const candidate = { kind: job.kind, fileID: job.fileID.trim() } as MemberAudioCleanupCandidate
      return [`${candidate.kind}\u0000${candidate.fileID}`, candidate]
    })).values())
  await processMemberAudioCleanupJobs({ postId, candidates })
  return candidates.length
}

function normalizeSuggest(value: unknown): PostAuditStatus {
  const suggest = String(value || '').trim().toLowerCase()
  if (['pass', 'normal', 'ok', '0'].includes(suggest)) return 'pass'
  if (['risky', 'block', 'blocked', 'reject', 'rejected', 'fail', 'failed', '1'].includes(suggest)) return 'rejected'
  if (['review', 'suspect', 'suspected', '2'].includes(suggest)) return 'review'
  return 'review'
}

function summarizeResults(results: AuditSubmitResult[]): { status: PostAuditStatus; reason: string } {
  if (results.length === 0) return { status: 'pass', reason: '' }
  const rejected = results.find((item) => item.status === 'rejected')
  if (rejected) return { status: 'rejected', reason: rejected.reason || rejected.suggest || 'content rejected by audit' }
  const review = results.find((item) => item.status === 'review')
  if (review) return { status: 'review', reason: review.reason || review.suggest || 'content needs manual review' }
  const pending = results.find((item) => item.status === 'pending')
  if (pending) return { status: 'pending', reason: 'media audit is pending' }
  return { status: 'pass', reason: '' }
}

function pushUnique(targets: AuditTarget[], next: AuditTarget) {
  const key = [next.type, next.widgetId || '', next.text || '', next.fileID || '', next.url || '', next.reason || ''].join('\u0001')
  if (!targets.some((item) => [item.type, item.widgetId || '', item.text || '', item.fileID || '', item.url || '', item.reason || ''].join('\u0001') === key)) {
    targets.push(next)
  }
}

function splitText(value: string): string[] {
  const text = value.trim()
  if (!text) return []
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += TEXT_CHUNK_LIMIT) chunks.push(text.slice(i, i + TEXT_CHUNK_LIMIT))
  return chunks
}

function addTextTargets(targets: AuditTarget[], widget: Widget | undefined, label: string, value: unknown) {
  if (typeof value !== 'string') return
  for (const chunk of splitText(value)) {
    pushUnique(targets, { widgetId: widget?.widgetId, type: 'text', label, text: chunk })
  }
}

function addCloudMediaTarget(targets: AuditTarget[], widget: Widget | undefined, type: AuditTargetType, label: string, value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return
  const ref = value.trim()
  if (ref.startsWith('cloud://')) {
    pushUnique(targets, { widgetId: widget?.widgetId, type, label, fileID: ref })
  } else if (/^https?:\/\//i.test(ref)) {
    pushUnique(targets, { widgetId: widget?.widgetId, type, label, url: ref })
  }
}

export function extractAuditTargets(section: Section, content: PostContent): AuditTarget[] {
  const targets: AuditTarget[] = []
  const widgets = section.widgets || []
  for (const widget of widgets) {
    const value = content?.[widget.widgetId]
    if (value === undefined || value === null || value === '') continue
    const label = widget.label || widget.fieldKey || widget.widgetId

    if (['short_text', 'summary', 'rich_text'].includes(widget.type)) {
      addTextTargets(targets, widget, label, value)
      continue
    }

    if (widget.type === 'location' && value && typeof value === 'object') {
      addTextTargets(targets, widget, `${label} address`, (value as any).address)
      continue
    }

    if (widget.type === 'note_blocks' && Array.isArray(value)) {
      for (const block of value as any[]) {
        if (block?.type === 'text') addTextTargets(targets, widget, label, block.text)
        if (block?.type === 'image') addCloudMediaTarget(targets, widget, 'image', label, block.fileID)
      }
      continue
    }

    if (widget.type === 'rich_note' && value && typeof value === 'object') {
      const note = value as any
      addTextTargets(targets, widget, `${label} text`, note.text)
      addTextTargets(targets, widget, `${label} markdown`, note.markdown)
      if (Array.isArray(note.imageFileIDs)) {
        for (const fileID of note.imageFileIDs) addCloudMediaTarget(targets, widget, 'image', label, fileID)
      }
      continue
    }

    if (widget.type === 'image_group' && Array.isArray(value)) {
      for (const fileID of value) addCloudMediaTarget(targets, widget, 'image', label, fileID)
      continue
    }

    if (widget.type === 'audio_group' && Array.isArray(value)) {
      for (const item of value as any[]) {
        addTextTargets(targets, widget, `${label} title`, item?.title)
        addCloudMediaTarget(targets, widget, 'audio', label, item?.fileID)
        addCloudMediaTarget(targets, widget, 'image', `${label} cover`, item?.cover)
      }
      continue
    }

    if (widget.type === 'video_group' && Array.isArray(value)) {
      for (const item of value as any[]) {
        addTextTargets(targets, widget, `${label} title`, item?.title)
        addTextTargets(targets, widget, `${label} description`, item?.description)
        addCloudMediaTarget(targets, widget, 'image', `${label} cover`, item?.cover)
        if (item?.source === 'cos') {
          addCloudMediaTarget(targets, widget, 'video', label, item?.fileID)
        } else if (item?.source === 'h5' || item?.source === 'app_link') {
          addCloudMediaTarget(targets, widget, 'video', label, item?.url)
        } else {
          pushUnique(targets, {
            widgetId: widget.widgetId,
            type: 'video',
            label,
            forceManual: true,
            reason: `video source ${String(item?.source || 'unknown')} cannot be machine-audited from stored media`,
          })
        }
      }
    }
  }
  return targets
}

async function resolveTargetUrl(target: AuditTarget): Promise<string> {
  if (target.url) return target.url
  if (target.fileID) return storage.getTempUrl(target.fileID)
  return ''
}

async function submitWechatTarget(target: AuditTarget, openid: string): Promise<AuditSubmitResult> {
  if (!openid) {
    return { status: 'review', provider: 'manual', reason: 'missing openid for WeChat audit' }
  }
  try {
    if (target.type === 'text') {
      const payload = await postWxJson<any>('/wxa/msg_sec_check', {
        openid,
        scene: AUDIT_SCENE_FOR_POST,
        version: 2,
        content: target.text || '',
        title: target.label,
      })
      const status = normalizeSuggest(payload?.result?.suggest)
      return {
        status,
        provider: 'wechat',
        traceId: payload?.trace_id,
        suggest: payload?.result?.suggest,
        label: payload?.result?.label,
        raw: payload,
      }
    }

    if (target.type === 'image' || target.type === 'audio') {
      const mediaUrl = await resolveTargetUrl(target)
      if (!mediaUrl) return { status: 'review', provider: 'manual', reason: 'media url is empty' }
      const payload = await postWxJson<any>('/wxa/media_check_async', {
        openid,
        scene: AUDIT_SCENE_FOR_POST,
        version: 2,
        media_url: mediaUrl,
        media_type: target.type === 'audio' ? 1 : 2,
      })
      return {
        status: 'pending',
        provider: 'wechat',
        traceId: payload?.trace_id,
        raw: payload,
      }
    }
  } catch (error: any) {
    return {
      status: 'review',
      provider: 'manual',
      reason: `wechat audit unavailable: ${String(error?.message || error).slice(0, 200)}`,
    }
  }
  return { status: 'review', provider: 'manual', reason: `WeChat does not support ${target.type} audit` }
}

function ciConfig() {
  const secretId = String(process.env.TENCENT_SECRET_ID || process.env.TC_SECRET_ID || '').trim()
  const secretKey = String(process.env.TENCENT_SECRET_KEY || process.env.TC_SECRET_KEY || '').trim()
  const bucket = String(process.env.TENCENT_CI_BUCKET || '').trim()
  const region = String(process.env.TENCENT_CI_REGION || '').trim()
  return { secretId, secretKey, bucket, region, enabled: Boolean(secretId && secretKey && bucket && region) }
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function sha1Hex(value: string) {
  return crypto.createHash('sha1').update(value).digest('hex')
}

function hmacSha1Hex(key: string | Buffer, value: string) {
  return crypto.createHmac('sha1', key).update(value).digest('hex')
}

export function buildCiHttpString(method: 'POST', pathname: string, headers: Record<string, string>): string {
  const headerPairs = Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), value] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')
  return `${method.toLowerCase()}\n${pathname}\n\n${headerPairs}\n`
}

function detectTypeForTencentCi(type: AuditTargetType): string | null {
  if (type === 'image') return null
  return 'Porn,Terrorism,Politics,Ads,Illegal,Abuse'
}

export function buildTencentCiAuditRequestBody(type: AuditTargetType, inputXml: string): string {
  const imageBizType = String(process.env.TENCENT_CI_IMAGE_BIZ_TYPE || '').trim()
  const normalizedInputXml = type === 'image'
    ? `${inputXml}<LargeImageDetect>1</LargeImageDetect>`
    : inputXml
  const confXml = type === 'image' && imageBizType
    ? `<BizType>${xmlEscape(imageBizType)}</BizType>`
    : (detectTypeForTencentCi(type) ? `<DetectType>${detectTypeForTencentCi(type)}</DetectType>` : '')
  return `<Request><Input>${normalizedInputXml}</Input><Conf>${confXml}</Conf></Request>`
}

function ciAuthorization(method: 'POST', pathname: string, host: string, secretId: string, secretKey: string): string {
  const start = Math.floor(Date.now() / 1000)
  const end = start + 900
  const time = `${start};${end}`
  const httpString = buildCiHttpString(method, pathname, { host })
  const signKey = hmacSha1Hex(secretKey, time)
  const stringToSign = `sha1\n${time}\n${sha1Hex(httpString)}\n`
  const signature = hmacSha1Hex(signKey, stringToSign)
  return [
    'q-sign-algorithm=sha1',
    `q-ak=${secretId}`,
    `q-sign-time=${time}`,
    `q-key-time=${time}`,
    'q-header-list=host',
    'q-url-param-list=',
    `q-signature=${signature}`,
  ].join('&')
}

function postXml(urlStr: string, body: string, authorization: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr)
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        Host: url.hostname,
        Authorization: authorization,
        'Content-Type': 'application/xml',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: any) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') }))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function xmlTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match ? match[1].trim() : ''
}

export function parseTencentCiAuditResponse(type: AuditTargetType, body: string): AuditSubmitResult {
  const suggestion = xmlTag(body, 'Suggestion') || xmlTag(body, 'Result')
  const state = xmlTag(body, 'State')
  const code = xmlTag(body, 'Code')
  if (!suggestion && code && code !== '0') {
    const message = xmlTag(body, 'Message')
    return {
      status: 'review',
      provider: 'tencent_ci',
      reason: `Tencent CI ${code}: ${message || 'audit failed'}`,
      raw: body,
    }
  }
  const status = suggestion ? normalizeSuggest(suggestion) : (type === 'audio' || type === 'video' || state === 'Submitted' ? 'pending' : 'review')
  return {
    status,
    provider: 'tencent_ci',
    jobId: xmlTag(body, 'JobId'),
    suggest: suggestion,
    label: xmlTag(body, 'Label'),
    raw: body,
  }
}

async function submitTencentTarget(target: AuditTarget): Promise<AuditSubmitResult> {
  const cfg = ciConfig()
  if (!cfg.enabled) {
    return { status: 'review', provider: 'manual', reason: 'Tencent CI audit is not configured' }
  }
  try {
    const pathByType: Record<AuditTargetType, string> = {
      text: '/text/auditing',
      image: '/image/auditing',
      audio: '/audio/auditing',
      video: '/video/auditing',
    }
    const pathname = pathByType[target.type]
    const host = `${cfg.bucket}.ci.${cfg.region}.myqcloud.com`
    const url = `https://${host}${pathname}`
    const inputXml = target.type === 'text'
      ? `<Content>${Buffer.from(target.text || '', 'utf-8').toString('base64')}</Content>`
      : `<Url>${xmlEscape(await resolveTargetUrl(target))}</Url>`
    const body = buildTencentCiAuditRequestBody(target.type, inputXml)
    const res = await postXml(url, body, ciAuthorization('POST', pathname, host, cfg.secretId, cfg.secretKey))
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return { status: 'review', provider: 'manual', reason: `Tencent CI HTTP ${res.statusCode}: ${res.body.slice(0, 200)}` }
    }
    return parseTencentCiAuditResponse(target.type, res.body)
  } catch (error: any) {
    return {
      status: 'review',
      provider: 'manual',
      reason: `Tencent CI audit unavailable: ${String(error?.message || error).slice(0, 200)}`,
    }
  }
}

async function submitTarget(target: AuditTarget, source: 'user' | 'admin', openid: string): Promise<AuditSubmitResult> {
  if (target.forceManual) return { status: 'review', provider: 'manual', reason: target.reason || 'manual review required' }
  if (source === 'user' && (target.type === 'text' || target.type === 'image' || target.type === 'audio')) {
    return submitWechatTarget(target, openid)
  }
  return submitTencentTarget(target)
}

async function createAuditTask(params: {
  postId: string
  communityId: string
  sectionId: string
  contentSlot: 'content' | 'pendingContent'
  contentRevision: string
  contentDigest: string
  expectedTargetCount: number
  targetIndex: number
  target: AuditTarget
  result: AuditSubmitResult
}) {
  const now = nowIso()
  const taskData = {
    postId: params.postId,
    communityId: params.communityId,
    sectionId: params.sectionId,
    widgetId: params.target.widgetId || '',
    contentSlot: params.contentSlot,
    contentRevision: params.contentRevision,
    contentDigest: params.contentDigest,
    expectedTargetCount: params.expectedTargetCount,
    targetIndex: params.targetIndex,
    targetType: params.target.type,
    provider: params.result.provider,
    status: params.result.status,
    targetLabel: params.target.label,
    targetRef: params.target.fileID || params.target.url || '',
    traceId: params.result.traceId || '',
    jobId: params.result.jobId || '',
    suggest: params.result.suggest || '',
    label: params.result.label || '',
    reason: params.result.reason || '',
    raw: params.result.raw || null,
    createdAt: now,
    updatedAt: now,
  }
  const taskId = await db.create(AUDIT_TASKS, taskData)
  await reconcileTaskFromCallbackRecord({ _id: taskId, ...taskData } as ContentAuditTask)
}

async function auditTargetsConcurrently(params: {
  targets: AuditTarget[]
  postId: string
  communityId: string
  sectionId: string
  source: 'user' | 'admin'
  authorId: string
  contentSlot: 'content' | 'pendingContent'
  contentRevision: string
  contentDigest: string
}): Promise<AuditSubmitResult[]> {
  const results: AuditSubmitResult[] = new Array(params.targets.length)
  let nextIndex = 0
  const workerCount = Math.min(AUDIT_TARGET_CONCURRENCY, params.targets.length)

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < params.targets.length) {
      const index = nextIndex
      nextIndex += 1
      const target = params.targets[index]
      const result = await submitTarget(target, params.source, params.authorId)
      results[index] = result
      await createAuditTask({
        postId: params.postId,
        communityId: params.communityId,
        sectionId: params.sectionId,
        contentSlot: params.contentSlot,
        contentRevision: params.contentRevision,
        contentDigest: params.contentDigest,
        expectedTargetCount: params.targets.length,
        targetIndex: index,
        target,
        result,
      })
    }
  }))

  return results
}

export async function auditPostContent(params: {
  postId: string
  communityId: string
  sectionId: string
  section: Section
  content: PostContent
  authorId: string
  source: 'user' | 'admin'
  contentSlot?: 'content' | 'pendingContent'
  contentRevision?: string
  contentDigest?: string
}): Promise<{ status: PostAuditStatus; reason: string }> {
  const contentRevision = String(params.contentRevision || '').trim()
  if (!contentRevision) throw new Error('contentRevision is required for content audit')
  const contentDigest = String(params.contentDigest || computeContentRevisionDigest(params.content)).trim()
  const targets = extractAuditTargets(params.section, params.content)
  const results = await auditTargetsConcurrently({
    targets,
    postId: params.postId,
    communityId: params.communityId,
    sectionId: params.sectionId,
    source: params.source,
    authorId: params.authorId,
    contentSlot: params.contentSlot || 'content',
    contentRevision,
    contentDigest,
  })
  return summarizeResults(results)
}

function cleanupCandidatesFromTasks(tasks: ContentAuditTask[]): MemberAudioCleanupCandidate[] {
  const candidates: MemberAudioCleanupCandidate[] = []
  for (const task of tasks) {
    const fileID = String(task.targetRef || '').trim()
    if (task.widgetId !== 'audios' || !fileID.startsWith('cloud://')) continue
    if (task.targetType === 'audio') candidates.push({ kind: 'audio', fileID })
    if (task.targetType === 'image') candidates.push({ kind: 'cover', fileID })
  }
  return Array.from(new Map(candidates.map((candidate) => [`${candidate.kind}\u0000${candidate.fileID}`, candidate])).values())
}

async function claimSlotRevision(params: {
  postId: string
  slot: ContentSlot
  content: PostContent
  recoverDisplacedAuditTargets?: boolean
  observedPost?: Post
}): Promise<{
  revision: string
  digest: string
  candidates: MemberAudioCleanupCandidate[]
  post: Post
} | null> {
  const observedPost = params.observedPost || await db.getById('posts', params.postId) as Post
  if (!observedPost) throw new Error('post not found')
  const previousRevision = revisionForSlot(observedPost, params.slot)
  const previousDigest = revisionDigestForSlot(observedPost, params.slot)
  let candidates: MemberAudioCleanupCandidate[] = []
  if (params.recoverDisplacedAuditTargets && previousRevision && isNativeArchiveAudioPost(observedPost)) {
    const tasks = await db.query(AUDIT_TASKS, { contentRevision: previousRevision }, { limit: 100 }) as ContentAuditTask[]
    candidates = cleanupCandidatesFromTasks(tasks.filter((task) => (
      task.postId === params.postId
      && task.contentSlot === params.slot
      && String(task.contentRevision || '') === previousRevision
      && (!previousDigest || !task.contentDigest || task.contentDigest === previousDigest)
    )))
  }
  const revision = createContentRevision()
  const digest = computeContentRevisionDigest(params.content)
  return db.runTransaction(async transaction => {
    const currentPost = await db.transactionGetByIdOrNull<Post>(transaction, 'posts', params.postId)
    if (!currentPost) throw new Error('post not found')
    if (
      revisionForSlot(currentPost, params.slot) !== previousRevision
      || !isDeepStrictEqual(contentForSlot(currentPost, params.slot), params.content)
    ) return null
    const queued = await queueMemberAudioCleanupJobsInTransaction(transaction, {
      post: currentPost,
      candidates,
      expectedRevision: revision,
    })
    await transaction.collection('posts').doc(params.postId).update({ data: {
      [revisionField(params.slot)]: revision,
      [revisionDigestField(params.slot)]: digest,
    } })
    return {
      revision,
      digest,
      candidates: queued,
      post: {
        ...currentPost,
        [revisionField(params.slot)]: revision,
        [revisionDigestField(params.slot)]: digest,
      } as Post,
    }
  })
}

export async function applyAuditSummary(
  postId: string,
  slot: ContentSlot,
  status: PostAuditStatus,
  reason = '',
  trustedPost?: Post,
  expectedRevision?: string,
  expectedDigest?: string,
  nextRevision?: string,
): Promise<{ applied: boolean; stale: boolean; contentRevision: string }> {
  let post = trustedPost || await db.getById('posts', postId) as Post
  if (!post) throw new Error('post not found')
  let revision = String(expectedRevision || revisionForSlot(post, slot)).trim()
  let digest = String(expectedDigest || revisionDigestForSlot(post, slot)).trim()
  if (!revision) {
    const content = contentForSlot(post, slot)
    if (!content) return { applied: false, stale: true, contentRevision: '' }
    const claimed = await claimSlotRevision({ postId, slot, content, observedPost: post })
    if (!claimed) return { applied: false, stale: true, contentRevision: '' }
    revision = claimed.revision
    digest = claimed.digest
    post = claimed.post
  }
  if (!digest) {
    const content = contentForSlot(post, slot)
    if (!content) return { applied: false, stale: true, contentRevision: revision }
    digest = computeContentRevisionDigest(content)
  }
  const terminalRevision = String(nextRevision || '').trim()

  const now = nowIso()
  const updatePostWithV2 = async (
    dataForPost: Record<string, any> | ((currentPost: Post) => Record<string, any>),
    postSnapshot?: Post,
    projectionOverride?: ArchivePostTopicSource,
    displacesPublishedContent = false,
  ): Promise<{ applied: boolean; candidates: MemberAudioCleanupCandidate[] }> => {
    const resolvedPost = postSnapshot || await db.getById('posts', postId) as Post
    if (!resolvedPost) throw new Error('post not found')
    const previewData = typeof dataForPost === 'function' ? dataForPost(resolvedPost) : dataForPost
    const projectionPost = projectionOverride || (
      resolvedPost.area === 'archive' && Object.prototype.hasOwnProperty.call(previewData, 'auditStatus')
        ? {
            _id: postId,
            communityId: resolvedPost.communityId,
            topics: resolvedPost.topics || [],
            createdAt: String(resolvedPost.createdAt || now),
            status: String(resolvedPost.status || 'active'),
            auditStatus: String(previewData.auditStatus),
          }
        : null
    )
    const prepared = projectionPost
      ? await prepareArchivePostTopicReconciliation(projectionPost)
      : null
    return db.runTransaction(async transaction => {
      const currentPost = await db.transactionGetByIdOrNull<Post>(transaction, 'posts', postId)
      if (!currentPost) throw new Error('post not found')
      const currentContent = contentForSlot(currentPost, slot)
      const currentStoredDigest = revisionDigestForSlot(currentPost, slot)
      if (
        revisionForSlot(currentPost, slot) !== revision
        || (currentStoredDigest && currentStoredDigest !== digest)
        || !currentContent
        || computeContentRevisionDigest(currentContent) !== digest
      ) return { applied: false, candidates: [] }
      const candidates = displacesPublishedContent
        ? collectMemberAudioCleanupCandidates(currentPost, currentPost.content)
        : []
      const queued = await queueMemberAudioCleanupJobsInTransaction(transaction, {
        post: currentPost,
        candidates,
        expectedRevision: revision,
        now,
      })
      const data = typeof dataForPost === 'function' ? dataForPost(currentPost) : dataForPost
      await transaction.collection('posts').doc(postId).update({ data })
      if (projectionPost && prepared) {
        const stagedTopics = slot === 'pendingContent'
          ? currentPost.pendingTopics
          : currentPost.contentAuditTopics
        const currentTopics = projectionOverride && Array.isArray(stagedTopics)
          ? stagedTopics.map(String)
          : (currentPost.topics || []).map(String)
        if (JSON.stringify(currentTopics) !== JSON.stringify((projectionPost.topics || []).map(String))) {
          throw new Error('post topics changed during audit; retry required')
        }
        await reconcileArchivePostTopicsInTransaction(transaction, {
          ...projectionPost,
          communityId: currentPost.communityId,
          topics: currentTopics,
          createdAt: String(currentPost.createdAt || projectionPost.createdAt || now),
          status: String(currentPost.status || 'active'),
        }, prepared, now)
      }
      await schedulePostRagSyncInTransaction(transaction, {
        postId,
        communityId: currentPost.communityId,
        sectionId: currentPost.sectionId || '',
        reason: 'post.audit_changed',
        now,
      })
      return { applied: true, candidates: queued }
    })
  }

  let transition: { applied: boolean; candidates: MemberAudioCleanupCandidate[] }
  if (slot === 'pendingContent') {
    if (status === 'pass' && post.pendingContent) {
      const pendingTopics = Array.isArray((post as any).pendingTopics)
        ? (post as any).pendingTopics.map(String)
        : null
      const pendingPresentation = (post as any).pendingPresentation
      transition = await updatePostWithV2((currentPost) => ({
        content: db.replaceValue(currentPost.pendingContent as PostContent),
        contentRevision: terminalRevision || revision,
        contentRevisionDigest: digest,
        pendingContent: db.removeField(),
        pendingContentRevision: db.removeField(),
        pendingContentRevisionDigest: db.removeField(),
        ...(pendingTopics ? {
          topics: db.replaceValue(pendingTopics),
          pendingTopics: db.removeField(),
        } : {}),
        ...(pendingPresentation ? {
          presentation: db.replaceValue(pendingPresentation),
          pendingPresentation: db.removeField(),
        } : {}),
        pendingAuditStatus: 'pass',
        pendingAuditReason: '',
        auditStatus: 'pass',
        auditReason: '',
        auditUpdatedAt: now,
        updatedAt: now,
      }), post, post.area === 'archive' && pendingTopics ? {
        _id: postId,
        communityId: post.communityId,
        topics: pendingTopics,
        createdAt: String(post.createdAt || now),
        status: String(post.status || 'active'),
        auditStatus: 'pass',
      } : undefined, true)
    } else {
      transition = await updatePostWithV2({
        pendingAuditStatus: status,
        pendingAuditReason: status === 'pass' ? '' : reason,
        ...(terminalRevision ? {
          pendingContentRevision: terminalRevision,
          pendingContentRevisionDigest: digest,
        } : {}),
        auditUpdatedAt: now,
      }, post)
    }
  } else {
    const stagedTopics = Array.isArray(post.contentAuditTopics)
      ? post.contentAuditTopics.map(String)
      : null
    const stagedPresentation = post.contentAuditPresentation
    if (status === 'pass' && (stagedTopics || stagedPresentation)) {
      transition = await updatePostWithV2({
        ...(stagedTopics ? {
          topics: db.replaceValue(stagedTopics),
          contentAuditTopics: db.removeField(),
        } : {}),
        ...(stagedPresentation ? {
          presentation: db.replaceValue(stagedPresentation),
          contentAuditPresentation: db.removeField(),
        } : {}),
        auditStatus: status,
        auditReason: reason,
        ...(terminalRevision ? {
          contentRevision: terminalRevision,
          contentRevisionDigest: digest,
          contentAuditTopics: db.removeField(),
          contentAuditPresentation: db.removeField(),
        } : {}),
        auditUpdatedAt: now,
      }, post, post.area === 'archive' && stagedTopics ? {
        _id: postId,
        communityId: post.communityId,
        topics: stagedTopics,
        createdAt: String(post.createdAt || now),
        status: String(post.status || 'active'),
        auditStatus: 'pass',
      } : undefined)
    } else {
      transition = await updatePostWithV2({
        auditStatus: status,
        auditReason: reason,
        ...(terminalRevision ? {
          contentRevision: terminalRevision,
          contentRevisionDigest: digest,
          contentAuditTopics: db.removeField(),
          contentAuditPresentation: db.removeField(),
        } : {}),
        auditUpdatedAt: now,
      }, post)
    }
  }

  if (!transition.applied) return { applied: false, stale: true, contentRevision: revision }
  await processMemberAudioCleanupJobs({ postId, candidates: transition.candidates })
  await recoverMemberAudioCleanupJobs({ postId, excludeCandidates: transition.candidates })
  await refreshPostSearchIndexById(postId)
  return { applied: true, stale: false, contentRevision: terminalRevision || revision }
}

export async function auditAndApply(params: {
  postId: string
  communityId: string
  sectionId: string
  section: Section
  content: PostContent
  authorId: string
  source: 'user' | 'admin'
  contentSlot?: ContentSlot
  contentRevision?: string
  contentDigest?: string
  postSnapshot?: Post
}) {
  const slot = params.contentSlot || 'content'
  let revision = String(params.contentRevision || '').trim()
  let digest = String(params.contentDigest || '').trim()
  let claimedCandidates: MemberAudioCleanupCandidate[] = []
  let postSnapshot = params.postSnapshot
  if (!revision) {
    const claimed = await claimSlotRevision({
      postId: params.postId,
      slot,
      content: params.content,
      recoverDisplacedAuditTargets: true,
    })
    if (!claimed) {
      return {
        status: 'pending' as PostAuditStatus,
        reason: 'content changed before audit started',
        applied: false,
        stale: true,
        contentRevision: '',
      }
    }
    revision = claimed.revision
    digest = claimed.digest
    claimedCandidates = claimed.candidates
    postSnapshot = claimed.post
  }
  if (!digest) digest = computeContentRevisionDigest(params.content)

  try {
    const summary = await auditPostContent({ ...params, contentSlot: slot, contentRevision: revision, contentDigest: digest })
    const barrier = await refreshPostAuditFromTasks(params.postId, slot, revision, digest)
    if (barrier.foundTasks > 0) return barrier
    const applied = await applyAuditSummary(params.postId, slot, summary.status, summary.reason, postSnapshot, revision, digest)
    return { ...summary, ...applied }
  } finally {
    await processMemberAudioCleanupJobs({ postId: params.postId, candidates: claimedCandidates })
  }
}

async function refreshPostAuditFromTasks(
  postId: string,
  slot: ContentSlot,
  revision: string,
  digest: string,
) {
  if (!revision || !digest) {
    await recoverMemberAudioCleanupJobs({ postId })
    return { status: 'pending' as PostAuditStatus, reason: '', applied: false, stale: true, foundTasks: 0 }
  }
  const queriedTasks = await db.query(AUDIT_TASKS, { contentRevision: revision }, { limit: 100 }) as ContentAuditTask[]
  const allTasks = Array.isArray(queriedTasks) ? queriedTasks : []
  const revisionTasks = allTasks.filter((task: any) => (
    task.recordType !== 'callback_result'
    && task.postId === postId
    && task.contentSlot === slot
    && String(task.contentRevision || '') === revision
    && String(task.contentDigest || '') === digest
  ))
  const tasks = await Promise.all(revisionTasks.map(reconcileTaskFromCallbackRecord))
  if (tasks.length === 0) {
    await recoverMemberAudioCleanupJobs({ postId })
    return { status: 'pending' as PostAuditStatus, reason: '', applied: false, stale: true, foundTasks: 0 }
  }
  const expectedCounts = new Set(tasks.map((task) => Number(task.expectedTargetCount)))
  const expectedTargetCount = expectedCounts.size === 1 ? [...expectedCounts][0] : 0
  const targetIndexes = new Set(tasks.map((task) => Number(task.targetIndex)))
  const hasEveryTarget = (
    Number.isInteger(expectedTargetCount)
    && expectedTargetCount > 0
    && expectedTargetCount <= 100
    && tasks.length === expectedTargetCount
    && targetIndexes.size === expectedTargetCount
    && [...targetIndexes].every((index) => Number.isInteger(index) && index >= 0 && index < expectedTargetCount)
  )
  if (!hasEveryTarget) {
    await recoverMemberAudioCleanupJobs({ postId })
    return { status: 'pending' as PostAuditStatus, reason: 'audit targets incomplete', applied: false, stale: false, foundTasks: tasks.length }
  }
  const summary = summarizeResults(tasks.map((task) => ({
    status: task.status,
    provider: task.provider,
    suggest: task.suggest,
    label: task.label,
    reason: task.reason,
  })))
  const post = await db.getById('posts', postId) as Post
  if (!post) throw new Error('post not found')
  const currentDigest = revisionDigestForSlot(post, slot)
  if (revisionForSlot(post, slot) !== revision || (currentDigest && currentDigest !== digest)) {
    await recoverMemberAudioCleanupJobs({ postId })
    return { ...summary, applied: false, stale: true, foundTasks: tasks.length }
  }
  const currentStatus = slot === 'pendingContent' ? post.pendingAuditStatus : post.auditStatus
  const currentReason = slot === 'pendingContent' ? post.pendingAuditReason : post.auditReason
  if (currentStatus !== summary.status || String(currentReason || '') !== summary.reason) {
    const applied = await applyAuditSummary(postId, slot, summary.status, summary.reason, post, revision, digest)
    return { ...summary, ...applied, foundTasks: tasks.length }
  }
  await recoverMemberAudioCleanupJobs({ postId })
  return { ...summary, applied: false, stale: false, foundTasks: tasks.length }
}

export async function applyWechatMediaAuditResult(result: WechatMediaAuditResult) {
  const traceId = String(result.traceId || '').trim()
  if (!traceId) throw new Error('wechat media audit traceId is required')
  const reason = result.suggest === 'rejected'
    ? 'wechat media rejected'
    : result.suggest === 'review'
      ? 'wechat media needs manual review'
      : ''
  const record = await persistAuditCallbackRecord({
    keyType: 'traceId',
    key: traceId,
    status: result.suggest,
    suggest: result.suggest,
    label: result.label,
    reason,
    raw: {
      source: 'wechat_callback',
      suggest: result.suggest,
      label: result.label ?? '',
    },
  })
  const queriedRows = await db.query(AUDIT_TASKS, { traceId }) as Array<ContentAuditTask & { recordType?: string }>
  const rows = Array.isArray(queriedRows) ? queriedRows : []
  const tasks = rows.filter((task) => task.recordType !== 'callback_result' && task._id && task.postId)
  if (tasks.length === 0) {
    await pruneExpiredCallbackRecords()
    return { success: true, matched: 0, status: record.status, refreshed: 0 }
  }

  const reconciledTasks = await reconcileTasksForCallbackRecord(tasks, record)

  const pairs = Array.from(new Set(reconciledTasks
    .filter((task) => String(task.contentRevision || '').trim() && String(task.contentDigest || '').trim())
    .map((task) => JSON.stringify([task.postId, task.contentSlot, task.contentRevision, task.contentDigest]))))
  for (const pair of pairs) {
    const [postId, slot, revision, digest] = JSON.parse(pair) as [string, ContentSlot, string, string]
    await refreshPostAuditFromTasks(postId, slot, revision, digest)
  }
  await pruneExpiredCallbackRecords()
  return { success: true, matched: reconciledTasks.length, status: record.status, refreshed: pairs.length }
}

export async function handleAuditCallback(params: any) {
  const expectedToken = String(process.env.AUDIT_CALLBACK_TOKEN || '').trim()
  const token = String(params.callbackToken || params.token || '').trim()
  if (!expectedToken) throw new Error('audit callback token is not configured')
  if (token !== expectedToken) throw new Error('invalid audit callback token')

  const traceId = String(params.traceId || params.trace_id || '').trim()
  const jobId = String(params.jobId || params.JobId || '').trim()
  const suggest = params.suggest || params.Suggestion || params?.result?.suggest || params?.Result
  const label = params.label || params.Label || params?.result?.label
  const status = normalizeSuggest(suggest)
  const reason = status === 'rejected'
    ? 'content rejected by audit provider'
    : status === 'review'
      ? 'content needs manual review'
      : ''

  const keyType = traceId ? 'traceId' as const : 'jobId' as const
  const callbackKey = traceId || jobId
  if (!callbackKey) return { success: true, matched: 0 }
  const record = await persistAuditCallbackRecord({
    keyType,
    key: callbackKey,
    status,
    suggest,
    label,
    reason,
    raw: sanitizeAuditCallbackRaw(params),
  })

  let tasks: ContentAuditTask[] = []
  if (traceId) tasks = (await db.query(AUDIT_TASKS, { traceId }) || []) as ContentAuditTask[]
  if (tasks.length === 0 && jobId) tasks = (await db.query(AUDIT_TASKS, { jobId }) || []) as ContentAuditTask[]
  tasks = (tasks as Array<ContentAuditTask & { recordType?: string }>)
    .filter((task) => task.recordType !== 'callback_result' && task._id && task.postId)
  if (tasks.length === 0) {
    await pruneExpiredCallbackRecords()
    return { success: true, matched: 0 }
  }

  const reconciledTasks = await reconcileTasksForCallbackRecord(tasks, record)

  const pairs = Array.from(new Set(reconciledTasks
    .filter((task) => String(task.contentRevision || '').trim() && String(task.contentDigest || '').trim())
    .map((task) => JSON.stringify([task.postId, task.contentSlot, task.contentRevision, task.contentDigest]))))
  for (const pair of pairs) {
    const [postId, slot, revision, digest] = JSON.parse(pair) as [string, ContentSlot, string, string]
    await refreshPostAuditFromTasks(postId, slot, revision, digest)
  }
  await pruneExpiredCallbackRecords()
  return { success: true, matched: reconciledTasks.length, status: record.status }
}

export async function approvePostAudit(postId: string) {
  const post = await db.getById('posts', postId) as Post
  if (!post) throw new Error('post not found')
  const terminalRevision = createContentRevision()
  if (post.pendingContent) await applyAuditSummary(postId, 'pendingContent', 'pass', '', post, undefined, undefined, terminalRevision)
  else await applyAuditSummary(postId, 'content', 'pass', '', post, undefined, undefined, terminalRevision)
  return { success: true }
}

export async function rejectPostAudit(postId: string, reason: string) {
  const post = await db.getById('posts', postId) as Post
  if (!post) throw new Error('post not found')
  const terminalRevision = createContentRevision()
  if (post.pendingContent) {
    await applyAuditSummary(postId, 'pendingContent', 'rejected', reason || 'rejected by superAdmin', post, undefined, undefined, terminalRevision)
  } else {
    await applyAuditSummary(postId, 'content', 'rejected', reason || 'rejected by superAdmin', post, undefined, undefined, terminalRevision)
  }
  return { success: true }
}
