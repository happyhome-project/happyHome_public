jest.mock('../db', () => ({
  query: jest.fn(),
  setById: jest.fn(),
}))

import * as db from '../db'
import { recordPostRagTimerEvidence } from '../rag-worker-timer-evidence'

test('timer evidence persists only bounded IDs, counts, hashes, versions and timestamps', async () => {
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([{ activationOrder: { contentVersion: 7 } }])
    .mockResolvedValueOnce([{ contentVersion: 8 }])
  ;(db.setById as jest.Mock).mockResolvedValue(undefined)
  await recordPostRagTimerEvidence({
    triggerName: 'post-rag-worker-every-minute',
    eventTime: '2026-07-12T00:00:00Z',
    invokedAt: '2026-07-12T00:00:01.000Z',
    outbox: { results: [{ outboxId: 'outbox-1', rawText: 'private post body' }] },
    v2: { candidateCount: 2, results: [{ jobId: 'job-1', status: 'completed', error: 'provider credential secret' }] },
  } as any)
  expect(db.setById).toHaveBeenCalledWith('post_rag_worker_timer_evidence', expect.stringMatching(/^[a-f0-9]{64}$/), expect.any(Object))
  const evidence = (db.setById as jest.Mock).mock.calls[0][2]
  expect(Object.keys(evidence).sort()).toEqual([
    'eventTime', 'invocationId', 'invokedAt', 'observedContentVersion', 'outboxIds', 'outboxProcessedCount',
    'requiredContentVersion', 'schemaVersion', 'triggerIdHash', 'v2CandidateCount', 'v2CompletedCount', 'v2JobIds',
  ].sort())
  expect(evidence).toMatchObject({ schemaVersion: 2, eventTime: '2026-07-12T00:00:00.000Z', outboxIds: ['outbox-1'], v2JobIds: ['job-1'], outboxProcessedCount: 1, v2CandidateCount: 2, v2CompletedCount: 1, observedContentVersion: 7, requiredContentVersion: 8 })
  expect(JSON.stringify(evidence)).not.toMatch(/private post body|provider credential secret/)
})
