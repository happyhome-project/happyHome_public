jest.mock('../db', () => ({
  query: jest.fn(),
  setById: jest.fn(),
}))

import * as db from '../db'
import { recordPostRagTimerEvidence } from '../rag-worker-timer-evidence'

beforeEach(() => jest.clearAllMocks())

test('timer evidence persists only bounded IDs, counts, hashes, versions and timestamps', async () => {
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([{ activationOrder: { contentVersion: 7 } }])
    .mockResolvedValueOnce([{ contentVersion: 8 }])
  ;(db.setById as jest.Mock).mockResolvedValue(undefined)
  await recordPostRagTimerEvidence({
    triggerName: 'post-rag-worker-every-minute',
    eventTime: '2026-07-12T00:00:00Z',
    invokedAt: '2026-07-12T00:00:01.000Z',
    outbox: { processedCount: 1, results: [{ outboxId: 'outbox-1', status: 'completed', rawText: 'private post body' }] },
    v2: { candidateCount: 2, results: [{ jobId: 'job-1', status: 'completed', error: 'provider credential secret' }] },
  } as any)
  expect(db.setById).toHaveBeenCalledWith('post_rag_worker_timer_evidence', expect.stringMatching(/^[a-f0-9]{64}$/), expect.any(Object))
  const evidence = (db.setById as jest.Mock).mock.calls[0][2]
  expect(Object.keys(evidence).sort()).toEqual([
    'eventTime', 'invocationId', 'invokedAt', 'observedContentVersion', 'outboxCompletedCapturedCount', 'outboxCompletedCount', 'outboxContinuedCapturedCount', 'outboxContinuedCount', 'outboxContinuedIds', 'outboxIds', 'outboxProcessedCount',
    'requiredContentVersion', 'schemaVersion', 'triggerIdHash', 'v2CandidateCount', 'v2CapturedCount', 'v2CompletedCount', 'v2JobIds',
  ].sort())
  expect(evidence).toMatchObject({ schemaVersion: 2, eventTime: '2026-07-12T00:00:00.000Z', outboxIds: ['outbox-1'], outboxContinuedIds: [], v2JobIds: ['job-1'], outboxProcessedCount: 1, outboxCompletedCount: 1, outboxCompletedCapturedCount: 1, outboxContinuedCount: 0, outboxContinuedCapturedCount: 0, v2CandidateCount: 2, v2CompletedCount: 1, v2CapturedCount: 1, observedContentVersion: 7, requiredContentVersion: 8 })
  expect(JSON.stringify(evidence)).not.toMatch(/private post body|provider credential secret/)
})

test('mixed timer results record only successfully materialized or completed IDs', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([]).mockResolvedValueOnce([])
  ;(db.setById as jest.Mock).mockResolvedValue(undefined)
  await recordPostRagTimerEvidence({
    triggerName: 'post-rag-worker-every-minute', eventTime: '2026-07-12T00:00:00.000Z', invokedAt: '2026-07-12T00:00:01.000Z',
    outbox: { processedCount: 2, skippedCount: 1, failedCount: 2, results: [
      { outboxId: 'outbox-completed', status: 'completed' },
      { outboxId: 'outbox-continued', status: 'continued' },
      { outboxId: 'probe-skipped', status: 'skipped' },
      { outboxId: 'outbox-failed', status: 'failed' },
      { outboxId: 'outbox-retry', status: 'retry_wait' },
    ] },
    v2: { candidateCount: 4, results: [
      { jobId: 'job-completed', status: 'completed' },
      { jobId: 'job-failed', status: 'failed' },
      { jobId: 'job-skipped', status: 'skipped' },
      { jobId: 'job-lease-lost', status: 'lease_lost' },
    ] },
  } as any)
  const evidence = (db.setById as jest.Mock).mock.calls[0][2]
  expect(evidence).toMatchObject({
    outboxProcessedCount: 2, outboxCompletedCount: 1, outboxCompletedCapturedCount: 1, outboxIds: ['outbox-completed'],
    outboxContinuedCount: 1, outboxContinuedCapturedCount: 1, outboxContinuedIds: ['outbox-continued'],
    v2CompletedCount: 1, v2CapturedCount: 1, v2JobIds: ['job-completed'],
  })
  expect(JSON.stringify(evidence)).not.toMatch(/probe-skipped|outbox-failed|outbox-retry|job-failed|job-skipped|job-lease-lost/)
})

test('bounded captured IDs cannot masquerade as the total successful count', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([]).mockResolvedValueOnce([])
  const results = Array.from({ length: 101 }, (_, index) => ({ outboxId: `outbox-${index}`, status: 'completed' }))
  await recordPostRagTimerEvidence({
    triggerName: 'post-rag-worker-every-minute', eventTime: '2026-07-12T00:00:00.000Z', invokedAt: '2026-07-12T00:00:01.000Z',
    outbox: { processedCount: 101, results }, v2: { candidateCount: 0, results: [] },
  } as any)
  const evidence = (db.setById as jest.Mock).mock.calls[0][2]
  expect(evidence).toMatchObject({ outboxProcessedCount: 101, outboxCompletedCount: 101, outboxCompletedCapturedCount: 100, outboxContinuedCount: 0, outboxContinuedCapturedCount: 0 })
  expect(evidence.outboxIds).toHaveLength(100)
})
