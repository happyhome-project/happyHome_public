import { randomUUID } from 'node:crypto'

import {
  claimPostRagOutboxEvent,
  failPostRagOutboxEvent,
  listPostRagOutboxCandidates,
  materializeClaimedPostRagOutboxEvent,
  isPostRagOutboxMaterializationError,
  type PostRagOutboxDocument,
} from './post-rag-outbox-materializer'

type SafeErrorCode = 'UNSUPPORTED_EVENT' | 'VALIDATION_FAILED' | 'INTERNAL_ERROR'

type Dependencies = {
  listCandidates: typeof listPostRagOutboxCandidates
  claim: typeof claimPostRagOutboxEvent
  materialize: typeof materializeClaimedPostRagOutboxEvent
  fail: typeof failPostRagOutboxEvent
}

type BatchOptions = {
  limit?: number
  workerId?: string
  now?: () => string
}

const defaultDependencies: Dependencies = {
  listCandidates: listPostRagOutboxCandidates,
  claim: claimPostRagOutboxEvent,
  materialize: materializeClaimedPostRagOutboxEvent,
  fail: failPostRagOutboxEvent,
}

function boundedLimit(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(20, Math.floor(parsed))) : 5
}

function safeWorkerId(value: unknown) {
  const workerId = String(value || '').trim()
  if (!workerId) return `post-rag-outbox-${randomUUID()}`
  if (workerId.length > 256 || /[\u0000-\u001f\u007f]/.test(workerId)) throw new Error('workerId must be a safe identifier')
  return workerId
}

function freshNow(clock: () => string) {
  const value = clock()
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error('RAG outbox worker clock must return an ISO timestamp')
  }
  return value
}

function classifyMaterializeFailure(error: unknown): SafeErrorCode {
  return isPostRagOutboxMaterializationError(error) ? error.code : 'INTERNAL_ERROR'
}

export async function processPostRagOutboxBatch(options: BatchOptions = {}, dependencies: Dependencies = defaultDependencies) {
  const limit = boundedLimit(options.limit)
  const workerId = safeWorkerId(options.workerId)
  const now = options.now || (() => new Date().toISOString())
  const scanNow = freshNow(now)
  const candidateIds = await dependencies.listCandidates(scanNow, limit)
  const results: Array<Record<string, string>> = []
  let processedCount = 0
  let skippedCount = 0
  let failedCount = 0

  for (const outboxId of candidateIds) {
    const claimNow = freshNow(now)
    let claimed: PostRagOutboxDocument | null
    try {
      claimed = await dependencies.claim(outboxId, { workerId, now: claimNow })
    } catch {
      failedCount += 1
      results.push({ outboxId, status: 'failed', errorCode: 'INTERNAL_ERROR' })
      console.warn('[post-rag-outbox-worker] event failed', { outboxId, errorCode: 'INTERNAL_ERROR' })
      continue
    }
    if (!claimed) {
      skippedCount += 1
      results.push({ outboxId, status: 'skipped' })
      continue
    }

    const materializeNow = freshNow(now)
    if (claimed.leaseExpiresAt && claimed.leaseExpiresAt <= materializeNow) {
      skippedCount += 1
      results.push({ outboxId, status: 'skipped' })
      continue
    }

    try {
      const materialized = await dependencies.materialize(outboxId, {
        workerId,
        leaseToken: claimed.leaseToken!,
        now: materializeNow,
      })
      processedCount += 1
      results.push({ outboxId, status: materialized.outbox?.status === 'retry_wait' ? 'continued' : 'completed', ...(materialized.job?._id ? { jobId: materialized.job._id } : {}) } as any)
    } catch (error) {
      let safeCode: SafeErrorCode = classifyMaterializeFailure(error)
      try {
        const failNow = freshNow(now)
        await dependencies.fail(outboxId, {
          workerId,
          leaseToken: claimed.leaseToken!,
          now: failNow,
          error: { code: safeCode },
        })
      } catch {
        safeCode = 'INTERNAL_ERROR'
      }
      failedCount += 1
      results.push({ outboxId, status: 'failed', errorCode: safeCode })
      console.warn('[post-rag-outbox-worker] event failed', { outboxId, errorCode: safeCode })
    }
  }

  return { candidateCount: candidateIds.length, processedCount, skippedCount, failedCount, results }
}
