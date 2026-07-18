import { createHash } from 'node:crypto'
import type { Post, Section } from '../shared/types'
import * as db from './db'
import { buildPostRagSourceProjection, isPostRagSourceProjectionValidationError, type PostRagSourceProjection } from './post-rag-indexing'
import { loadPostContentSection } from './post-content-contract'
import {
  claimPostRagJob,
  completePostRagJob,
  failPostRagJob,
  getPostRagJob,
  isPostRagJobLeaseError,
  listPostRagJobCandidates,
  renewPostRagJobLease,
  PostRagJobLeaseError,
  validateStoredPostRagJob,
  type PostRagJobDocument,
  type PostRagJobErrorCode,
  type PostRagJobErrorStage,
  type PostRagJobOutcome,
} from './post-rag-jobs'
import {
  type PostRagActivationOrder,
  type PostRagVersionedIndexSink,
} from './post-rag-versioned-index-sink'
import { safeErrorDiagnostic } from './safe-error-diagnostic'
export { type PostRagActivationOrder, type PostRagVersionedIndexSink } from './post-rag-versioned-index-sink'

function requireSafeIdentifier(label: string, value: unknown, maxLength = 256): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || value !== value.trim()
    || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label} must be a safe identifier`)
}

export function comparePostRagActivationOrder(left: PostRagActivationOrder, right: PostRagActivationOrder): -1 | 0 | 1 {
  for (const [label, order] of [['left', left], ['right', right]] as const) {
    if (!Number.isSafeInteger(order?.contentVersion) || order.contentVersion < 0) throw new Error(`${label}.contentVersion is invalid`)
    requireSafeIdentifier(`${label}.jobId`, order?.jobId)
  }
  if (left.contentVersion !== right.contentVersion) return left.contentVersion < right.contentVersion ? -1 : 1
  if (left.jobId === right.jobId) return 0
  return left.jobId < right.jobId ? -1 : 1
}


const authenticatedProcessorErrors = new WeakSet<object>()
const authenticatedClockErrors = new WeakSet<object>()
const validatedClocks = new WeakSet<object>()

class PostRagProcessorClockError extends Error {
  constructor() { super('RAG processor clock must be canonical ISO and non-decreasing'); authenticatedClockErrors.add(this) }
}

type ValidatedClock = (() => string) & object

function validatedMonotonicClock(source: () => string): ValidatedClock {
  if (validatedClocks.has(source as object)) return source as ValidatedClock
  let previous: string | null = null
  const clock = (() => {
    const value = source()
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
      || !Number.isFinite(new Date(value).getTime()) || new Date(value).toISOString() !== value
      || (previous !== null && value < previous)) throw new PostRagProcessorClockError()
    previous = value
    return value
  }) as ValidatedClock
  validatedClocks.add(clock)
  return clock
}

function isClockError(value: unknown) { return Boolean(value && typeof value === 'object' && authenticatedClockErrors.has(value as object)) }

function deepFrozenClone<T>(value: T, ancestors = new Set<object>()): T {
  if (value === undefined) return value
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('snapshot number is invalid'); return value }
  if (typeof value !== 'object') throw new Error('snapshot value is invalid')
  if (ancestors.has(value)) throw new Error('snapshot contains a cycle')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) throw new Error('snapshot prototype is invalid')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(descriptors).some((key) => typeof key === 'symbol' || !('value' in descriptors[key as string]))) throw new Error('snapshot descriptor is invalid')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) return Object.freeze(value.map((item) => deepFrozenClone(item, ancestors))) as T
    const clone: Record<string, unknown> = Object.create(null)
    for (const key of Object.keys(descriptors)) clone[key] = deepFrozenClone(descriptors[key].value, ancestors)
    return Object.freeze(clone) as T
  } finally { ancestors.delete(value) }
}

function trustedJobSnapshot(input: PostRagJobDocument): Readonly<PostRagJobDocument> {
  validateStoredPostRagJob(input, input?._id)
  return deepFrozenClone(input)
}

export class PostRagJobProcessorError extends Error {
  constructor(readonly code: PostRagJobErrorCode, readonly stage: PostRagJobErrorStage) {
    super('RAG job processing failed')
    this.name = 'PostRagJobProcessorError'
    authenticatedProcessorErrors.add(this)
  }
}

export function isPostRagJobProcessorError(value: unknown): value is PostRagJobProcessorError {
  return Boolean(value && typeof value === 'object' && authenticatedProcessorErrors.has(value as object))
}

type ProcessorResult =
  | { jobId: string; status: 'completed'; outcome: PostRagJobOutcome }
  | { jobId: string; status: 'already_completed'; outcome: PostRagJobOutcome }
  | { jobId: string; status: 'failed'; errorCode: PostRagJobErrorCode; errorStage: PostRagJobErrorStage }
  | { jobId: string; status: 'lease_lost' }

type ProcessorDependencies = {
  sink: PostRagVersionedIndexSink
  loadPost(postId: string): Promise<Post | null>
  loadSection(sectionId: string): Promise<Section | null>
  loadCollaborationTemplate?(templateId: string): Promise<unknown | null>
  buildProjection: typeof buildPostRagSourceProjection
  readJob: typeof getPostRagJob
  complete: typeof completePostRagJob
  fail: typeof failPostRagJob
  renew: typeof renewPostRagJobLease
}

type BatchDependencies = ProcessorDependencies & {
  listCandidates: typeof listPostRagJobCandidates
  claim: typeof claimPostRagJob
}

function safeClaimJobIdDiagnostic(jobId: unknown): { jobId: string; jobIdFingerprint?: string } {
  if (typeof jobId === 'string' && /^[a-f0-9]{64}$/.test(jobId)) return { jobId }
  const fingerprintInput = typeof jobId === 'string' ? jobId : `[${typeof jobId}]`
  return {
    jobId: 'INVALID',
    jobIdFingerprint: createHash('sha256').update(fingerprintInput).digest('hex').slice(0, 16),
  }
}

function leaseIsCurrent(job: PostRagJobDocument, workerId: string, now: string) {
  return job.status === 'processing' && job.leaseOwner === workerId && Boolean(job.leaseToken)
    && Boolean(job.leaseExpiresAt) && job.leaseExpiresAt! > now
}

async function hasCurrentLease(
  claimed: PostRagJobDocument,
  workerId: string,
  now: string,
  readJob: typeof getPostRagJob,
  stage: PostRagJobErrorStage,
) {
  // This DB read is intentionally a best-effort preflight, not an atomic lock
  // across the external sink. The sink activationOrder CAS remains the final
  // fence against an older worker winning after this check.
  let current: PostRagJobDocument
  try { current = await readJob(claimed._id) } catch (error) {
    if (isPostRagJobLeaseError(error)) return false
    throw new PostRagJobProcessorError('INTERNAL_ERROR', stage)
  }
  return current.status === 'processing'
    && current.leaseOwner === workerId
    && current.leaseToken === claimed.leaseToken
    && Boolean(current.leaseExpiresAt)
    && current.leaseExpiresAt! > now
}

async function sinkStep<T>(stage: PostRagJobErrorStage, operation: () => Promise<T>): Promise<T> {
  try { return await operation() } catch { throw new PostRagJobProcessorError('ES_WRITE_FAILED', stage) }
}

async function withLeaseHeartbeat<T>(
  job: PostRagJobDocument, workerId: string, leaseToken: string, now: ValidatedClock,
  renew: typeof renewPostRagJobLease, operation: () => Promise<T>,
): Promise<T> {
  const renewOnce = async () => {
    try { await renew(job._id, { workerId, leaseToken, now: now(), leaseSeconds: 120 }) }
    catch { throw new PostRagJobLeaseError() }
  }
  await renewOnce()
  let rejectLost!: (error: Error) => void
  const lost = new Promise<never>((_resolve, reject) => { rejectLost = reject })
  void lost.catch(() => undefined)
  let stopped = false
  let renewal = Promise.resolve()
  const timer = setInterval(() => {
    renewal = renewal.then(renewOnce).catch(() => {
      if (!stopped) { stopped = true; clearInterval(timer); rejectLost(new PostRagJobLeaseError()) }
    })
  }, 40_000)
  timer.unref?.()
  try { return await Promise.race([operation(), lost]) }
  finally { stopped = true; clearInterval(timer) }
}

function activationOrder(job: PostRagJobDocument): PostRagActivationOrder {
  return { contentVersion: job.contentVersion, jobId: job._id }
}

export async function processClaimedPostRagJob(
  inputJob: PostRagJobDocument,
  options: { workerId: string; now: () => string },
  dependencies: ProcessorDependencies,
): Promise<ProcessorResult> {
  requireSafeIdentifier('workerId', options?.workerId)
  if (!options || typeof options.now !== 'function') throw new Error('clock is required')
  const now = validatedMonotonicClock(options.now)
  const job = trustedJobSnapshot(inputJob) as PostRagJobDocument
  const startedAt = now()
  if (job.status === 'completed' && job.outcome) {
    return { jobId: job._id, status: 'already_completed', outcome: job.outcome }
  }
  const leaseToken = job.leaseToken
  if (!leaseToken || !leaseIsCurrent(job, options.workerId, startedAt)) return { jobId: job._id, status: 'lease_lost' }

  let failureStage: PostRagJobErrorStage = 'load_source'
  try {
    let storedPost: Post | null
    try { storedPost = await dependencies.loadPost(job.postId) } catch { throw new PostRagJobProcessorError('INTERNAL_ERROR', 'load_source') }
    if (!storedPost) {
      if (!await hasCurrentLease(job, options.workerId, now(), dependencies.readJob, 'es_write')) return { jobId: job._id, status: 'lease_lost' }
      failureStage = 'es_write'
      const removal = await withLeaseHeartbeat(job, options.workerId, leaseToken, now, dependencies.renew, () => sinkStep('es_write', () => dependencies.sink.remove({
        postId: job.postId, sourceVersion: job.sourceVersion, activationOrder: activationOrder(job),
      })))
      if (!await hasCurrentLease(job, options.workerId, now(), dependencies.readJob, 'es_write')) return { jobId: job._id, status: 'lease_lost' }
      const outcome = removal.removed ? 'removed' : 'superseded'
      try {
        await dependencies.complete(job._id, { workerId: options.workerId, leaseToken, now: now(), outcome })
      } catch (error) {
        if (isPostRagJobLeaseError(error)) return { jobId: job._id, status: 'lease_lost' }
        throw error
      }
      return { jobId: job._id, status: 'completed', outcome }
    }
    const post = storedPost
    let section: Section | null = null
    try {
      section = await loadPostContentSection(post, (collectionName, id) => (
        collectionName === 'sections'
          ? dependencies.loadSection(id)
          : (dependencies.loadCollaborationTemplate?.(id) || Promise.resolve(null))
      ))
    } catch { throw new PostRagJobProcessorError('INTERNAL_ERROR', 'load_source') }

    failureStage = 'chunk'
    let projection: PostRagSourceProjection
    try { projection = deepFrozenClone(dependencies.buildProjection(post, section)) } catch (error) {
      if (isPostRagSourceProjectionValidationError(error)) throw new PostRagJobProcessorError('VALIDATION_FAILED', 'chunk')
      throw error
    }

    if (projection.sourceVersion !== job.sourceVersion) {
      if (!await hasCurrentLease(job, options.workerId, now(), dependencies.readJob, 'chunk')) return { jobId: job._id, status: 'lease_lost' }
      try {
        await dependencies.complete(job._id, { workerId: options.workerId, leaseToken, now: now(), outcome: 'superseded' })
      } catch (error) {
        if (isPostRagJobLeaseError(error)) return { jobId: job._id, status: 'lease_lost' }
        throw error
      }
      return { jobId: job._id, status: 'completed', outcome: 'superseded' }
    }

    if (job.action === 'delete') {
      if (projection.eligible) throw new PostRagJobProcessorError('VALIDATION_FAILED', 'chunk')
      if (!await hasCurrentLease(job, options.workerId, now(), dependencies.readJob, 'es_write')) return { jobId: job._id, status: 'lease_lost' }
      failureStage = 'es_write'
      const removal = await withLeaseHeartbeat(job, options.workerId, leaseToken, now, dependencies.renew, () => sinkStep('es_write', () => dependencies.sink.remove({ postId: job.postId, sourceVersion: job.sourceVersion, activationOrder: activationOrder(job) })))
      if (!await hasCurrentLease(job, options.workerId, now(), dependencies.readJob, 'es_write')) return { jobId: job._id, status: 'lease_lost' }
      const outcome = removal.removed ? 'removed' : 'superseded'
      try {
        await dependencies.complete(job._id, { workerId: options.workerId, leaseToken, now: now(), outcome })
      } catch (error) {
        if (isPostRagJobLeaseError(error)) return { jobId: job._id, status: 'lease_lost' }
        throw error
      }
      return { jobId: job._id, status: 'completed', outcome }
    }
    if (!projection.eligible) throw new PostRagJobProcessorError('VALIDATION_FAILED', 'chunk')

    if (!await hasCurrentLease(job, options.workerId, now(), dependencies.readJob, 'es_write')) return { jobId: job._id, status: 'lease_lost' }
    failureStage = 'es_write'
    await withLeaseHeartbeat(job, options.workerId, leaseToken, now, dependencies.renew, () => sinkStep('es_write', () => dependencies.sink.stageUpsert({ projection, job, jobId: job._id, leaseToken })))
    if (!await hasCurrentLease(job, options.workerId, now(), dependencies.readJob, 'es_write')) return { jobId: job._id, status: 'lease_lost' }
    const inspected = await withLeaseHeartbeat(job, options.workerId, leaseToken, now, dependencies.renew, () => sinkStep('es_write', () => dependencies.sink.inspectStaged({ postId: job.postId, sourceVersion: job.sourceVersion, jobId: job._id, leaseToken })))
    if (inspected.chunkCount !== projection.chunkCount || inspected.chunkChecksum !== projection.chunkChecksum) {
      throw new PostRagJobProcessorError('ES_WRITE_FAILED', 'es_write')
    }
    if (!await hasCurrentLease(job, options.workerId, now(), dependencies.readJob, 'activate')) return { jobId: job._id, status: 'lease_lost' }
    failureStage = 'activate'
    const activation = await withLeaseHeartbeat(job, options.workerId, leaseToken, now, dependencies.renew, () => sinkStep('activate', () => dependencies.sink.activate({ postId: job.postId, sourceVersion: job.sourceVersion, activationOrder: activationOrder(job), jobId: job._id, leaseToken })))
    if (!activation.activated) {
      if (!await hasCurrentLease(job, options.workerId, now(), dependencies.readJob, 'activate')) return { jobId: job._id, status: 'lease_lost' }
      try {
        await dependencies.complete(job._id, { workerId: options.workerId, leaseToken, now: now(), outcome: 'superseded' })
      } catch (error) {
        if (isPostRagJobLeaseError(error)) return { jobId: job._id, status: 'lease_lost' }
        throw error
      }
      return { jobId: job._id, status: 'completed', outcome: 'superseded' }
    }
    if (!await hasCurrentLease(job, options.workerId, now(), dependencies.readJob, 'cleanup')) return { jobId: job._id, status: 'lease_lost' }
    failureStage = 'cleanup'
    await withLeaseHeartbeat(job, options.workerId, leaseToken, now, dependencies.renew, () => sinkStep('cleanup', () => dependencies.sink.cleanupOldVersions({
      postId: job.postId, keepSourceVersion: job.sourceVersion, activationOrder: activationOrder(job), jobId: job._id, leaseToken,
    })))
    if (!await hasCurrentLease(job, options.workerId, now(), dependencies.readJob, 'cleanup')) return { jobId: job._id, status: 'lease_lost' }
    try {
      await dependencies.complete(job._id, { workerId: options.workerId, leaseToken, now: now(), outcome: 'indexed' })
    } catch (error) {
      if (isPostRagJobLeaseError(error)) return { jobId: job._id, status: 'lease_lost' }
      throw error
    }
    return { jobId: job._id, status: 'completed', outcome: 'indexed' }
  } catch (error) {
    if (isClockError(error)) return { jobId: job._id, status: 'failed', errorCode: 'INTERNAL_ERROR', errorStage: failureStage }
    const normalized = isPostRagJobProcessorError(error)
      ? error
      : new PostRagJobProcessorError('INTERNAL_ERROR', failureStage)
    if (isPostRagJobLeaseError(error)) return { jobId: job._id, status: 'lease_lost' }
    let canPersistFailure: boolean
    try {
      canPersistFailure = await hasCurrentLease(job, options.workerId, now(), dependencies.readJob, normalized.stage)
    } catch {
      return { jobId: job._id, status: 'failed', errorCode: 'INTERNAL_ERROR', errorStage: normalized.stage }
    }
    if (!canPersistFailure) return { jobId: job._id, status: 'lease_lost' }
    try {
      await dependencies.fail(job._id, { workerId: options.workerId, leaseToken, now: now(), error: { code: normalized.code, stage: normalized.stage } })
      return { jobId: job._id, status: 'failed', errorCode: normalized.code, errorStage: normalized.stage }
    } catch (failureError) {
      if (isPostRagJobLeaseError(failureError)) return { jobId: job._id, status: 'lease_lost' }
      return { jobId: job._id, status: 'failed', errorCode: 'INTERNAL_ERROR', errorStage: normalized.stage }
    }
  }
}

const unavailableSink: PostRagVersionedIndexSink = {
  async stageUpsert() { throw new Error('index sink is not configured') },
  async inspectStaged() { throw new Error('index sink is not configured') },
  async activate() { throw new Error('index sink is not configured') },
  async cleanupOldVersions() { throw new Error('index sink is not configured') },
  async remove() { throw new Error('index sink is not configured') },
}

const defaultDependencies: BatchDependencies = {
  sink: unavailableSink,
  loadPost: (postId) => db.getByIdOrNull('posts', postId),
  loadSection: (sectionId) => db.getByIdOrNull('sections', sectionId),
  loadCollaborationTemplate: (templateId) => db.getByIdOrNull('collaboration_templates', templateId),
  buildProjection: buildPostRagSourceProjection,
  readJob: getPostRagJob,
  complete: completePostRagJob,
  fail: failPostRagJob,
  renew: renewPostRagJobLease,
  listCandidates: listPostRagJobCandidates,
  claim: claimPostRagJob,
}

export async function processPostRagJobV2Batch(
  options: { workerId: string; now?: () => string; limit?: number; sink?: PostRagVersionedIndexSink },
  injectedDependencies?: BatchDependencies,
) {
  requireSafeIdentifier('workerId', options?.workerId)
  if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 20)) {
    throw new Error('limit must be a safe integer between 1 and 20')
  }
  const now = validatedMonotonicClock(options.now || (() => new Date().toISOString()))
  const limit = options.limit ?? 5
  const dependencies: BatchDependencies = injectedDependencies
    ? { ...injectedDependencies, ...(options.sink ? { sink: options.sink } : {}) }
    : { ...defaultDependencies, ...(options.sink ? { sink: options.sink } : {}) }
  const candidateIds = await dependencies.listCandidates(now(), Math.min(100, limit * 3))
  const results: Array<ProcessorResult | { jobId: string; status: 'skipped' }> = []
  let claimedCount = 0
  for (const jobId of candidateIds) {
    if (claimedCount >= limit) break
    let claimed: PostRagJobDocument | null
    try {
      claimed = await dependencies.claim(jobId, { workerId: options.workerId, now: now() })
    } catch (error) {
      console.warn('[post-rag-job-processor] claim failed', {
        ...safeClaimJobIdDiagnostic(jobId),
        ...safeErrorDiagnostic(error),
      })
      results.push({ jobId, status: 'failed', errorCode: 'INTERNAL_ERROR', errorStage: 'claim' })
      continue
    }
    if (!claimed) { results.push({ jobId, status: 'skipped' }); continue }
    claimedCount += 1
    try {
      results.push(await processClaimedPostRagJob(claimed, { workerId: options.workerId, now }, dependencies))
    } catch (error) {
      results.push({
        jobId,
        status: 'failed',
        errorCode: isClockError(error) ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED',
        errorStage: 'claim',
      })
    }
  }
  return { candidateCount: candidateIds.length, results }
}
