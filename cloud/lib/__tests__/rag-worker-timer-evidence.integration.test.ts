import * as db from '../db.local'
import { recordPostRagTimerEvidence } from '../rag-worker-timer-evidence'

beforeEach(() => db._resetAll())

test('authenticated timer evidence persists through the local database adapter without raw payloads', async () => {
  await db.create('post_rag_index_state_v2', { _id: 'post-1', state: 'active', activationOrder: { contentVersion: 4 } })
  await db.create('rag_community_versions', { _id: 'community-1', contentVersion: 5 })
  await recordPostRagTimerEvidence({
    triggerName: 'post-rag-worker-every-minute',
    eventTime: '2026-07-12T00:00:00.000Z',
    invokedAt: '2026-07-12T00:00:01.000Z',
    outbox: { results: [{ outboxId: 'outbox-1', hidden: 'private text' }] },
    v2: { candidateCount: 1, results: [{ jobId: 'job-1', status: 'completed', hidden: 'credential secret' }] },
  })
  const rows = db._dump('post_rag_worker_timer_evidence')
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ _id: rows[0].invocationId, observedContentVersion: 4, requiredContentVersion: 5, outboxIds: ['outbox-1'], v2JobIds: ['job-1'] })
  expect(JSON.stringify(rows[0])).not.toMatch(/private text|credential secret/)
})
