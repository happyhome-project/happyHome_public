import { createHash } from 'node:crypto'
import * as db from './db'

type StageResult = { results?: Array<Record<string, unknown>>; candidateCount?: number }
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

function idsFrom(result: StageResult | null, key: 'outboxId' | 'jobId', completedOnly = false) {
  const ids: string[] = []
  for (const item of Array.isArray(result?.results) ? result.results : []) {
    if (completedOnly && item.status !== 'completed') continue
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
  const outboxIds = idsFrom(input.outbox, 'outboxId')
  const v2JobIds = idsFrom(input.v2, 'jobId', true)
  await db.setById('post_rag_worker_timer_evidence', invocationId, {
    schemaVersion: 2,
    invocationId,
    triggerIdHash,
    eventTime,
    invokedAt,
    outboxProcessedCount: outboxIds.length,
    outboxIds,
    v2CandidateCount: Number.isSafeInteger(input.v2?.candidateCount) && Number(input.v2?.candidateCount) >= 0 ? Number(input.v2?.candidateCount) : 0,
    v2CompletedCount: v2JobIds.length,
    v2JobIds,
    observedContentVersion,
    requiredContentVersion,
  })
}
