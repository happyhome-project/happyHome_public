import { createHash } from 'node:crypto'
import * as db from './db'

type StageResult = { results?: Array<Record<string, unknown>>; candidateCount?: number; processedCount?: number }
type EvidenceInput = { triggerName: string; eventTime: string; invokedAt: string; outbox: StageResult | null; v2: StageResult | null }

const MAX_IDS = 100
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/

function safeIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value)
}

function timestamp(value: unknown) {
  if (typeof value !== 'string' || value.length > 24 || !ISO_TIMESTAMP.test(value)) {
    throw new Error('RAG worker timer evidence is invalid')
  }
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw new Error('RAG worker timer evidence is invalid')
  return parsed.toISOString()
}

function itemsWithStatus(result: StageResult | null, status: 'completed' | 'continued') {
  return (Array.isArray(result?.results) ? result.results : []).filter((item) => item.status === status)
}

function idsFrom(items: Array<Record<string, unknown>>, key: 'outboxId' | 'jobId') {
  const ids: string[] = []
  for (const item of items) {
    const value = item[key]
    if (safeIdentifier(value) && !ids.includes(value)) ids.push(value)
    if (ids.length >= MAX_IDS) break
  }
  return ids
}

export async function recordPostRagTimerEvidence(input: EvidenceInput) {
  if (!safeIdentifier(input?.triggerName)) throw new Error('RAG worker timer evidence is invalid')
  const eventTime = timestamp(input.eventTime)
  const invokedAt = timestamp(input.invokedAt)
  const [states, versions] = await Promise.all([
    db.query('post_rag_index_state_v2', { state: 'active' }, { orderBy: ['activationOrder.contentVersion', 'desc'], limit: 1 }),
    db.query('rag_community_versions', {}, { orderBy: ['contentVersion', 'desc'], limit: 1 }),
  ]) as any
  const observedContentVersion = Number(states?.[0]?.activationOrder?.contentVersion || 0)
  const requiredContentVersion = Number(versions?.[0]?.contentVersion || 0)
  if (!Number.isSafeInteger(observedContentVersion) || observedContentVersion < 0
    || !Number.isSafeInteger(requiredContentVersion) || requiredContentVersion < 0) throw new Error('RAG worker timer evidence is invalid')
  const triggerIdHash = createHash('sha256').update(input.triggerName).digest('hex')
  const invocationId = createHash('sha256').update(JSON.stringify([triggerIdHash, eventTime, invokedAt])).digest('hex')
  const completedOutboxItems = itemsWithStatus(input.outbox, 'completed')
  const continuedOutboxItems = itemsWithStatus(input.outbox, 'continued')
  const completedV2Items = itemsWithStatus(input.v2, 'completed')
  const outboxProcessedCount = Number(input.outbox?.processedCount)
  if (!Number.isSafeInteger(outboxProcessedCount) || outboxProcessedCount < 0
    || outboxProcessedCount !== completedOutboxItems.length + continuedOutboxItems.length) throw new Error('RAG worker timer evidence is invalid')
  const outboxIds = idsFrom(completedOutboxItems, 'outboxId')
  const outboxContinuedIds = idsFrom(continuedOutboxItems, 'outboxId')
  const v2JobIds = idsFrom(completedV2Items, 'jobId')
  await db.setById('post_rag_worker_timer_evidence', invocationId, {
    schemaVersion: 2,
    invocationId,
    triggerIdHash,
    eventTime,
    invokedAt,
    outboxProcessedCount,
    outboxCompletedCount: completedOutboxItems.length,
    outboxCompletedCapturedCount: outboxIds.length,
    outboxIds,
    outboxContinuedCount: continuedOutboxItems.length,
    outboxContinuedCapturedCount: outboxContinuedIds.length,
    outboxContinuedIds,
    v2CandidateCount: Number.isSafeInteger(input.v2?.candidateCount) && Number(input.v2?.candidateCount) >= 0 ? Number(input.v2?.candidateCount) : 0,
    v2CompletedCount: completedV2Items.length,
    v2CapturedCount: v2JobIds.length,
    v2JobIds,
    observedContentVersion,
    requiredContentVersion,
  })
}
