import { randomUUID } from 'node:crypto'
import cloud from 'wx-server-sdk'
import { ensurePostRagIndex, processPostRagJobBatch } from '../../lib/post-rag'
import { processPostRagOutboxBatch } from '../../lib/post-rag-outbox-worker'
import { processPostRagJobV2Batch } from '../../lib/post-rag-job-processor'
import { createPostRagV2RuntimeFromEnv } from '../../lib/post-rag-v2-runtime'
import { assertPostRagWorkerAuthorized } from '../../lib/rag-worker-auth'
import { recordPostRagTimerEvidence } from '../../lib/rag-worker-timer-evidence'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

export const main = async (event: any = {}) => {
  const authorization = assertPostRagWorkerAuthorized(event)
  if (event.action === 'ensureIndex') return ensurePostRagIndex()
  const limit = Number.isFinite(Number(event.limit))
    ? Math.max(1, Math.min(20, Math.floor(Number(event.limit))))
    : 5
  const postId = String(event.postId || '').trim()
  if (event.action === 'materializeOutbox') return processPostRagOutboxBatch({ limit })
  const runV2 = () => {
    const { sink } = createPostRagV2RuntimeFromEnv()
    return processPostRagJobV2Batch({ limit, workerId: `post-rag-worker:${randomUUID()}`, sink })
  }
  if (event.action === 'indexV2') {
    try { return await runV2() } catch { throw new Error('RAG worker stages failed') }
  }

  let outbox: Awaited<ReturnType<typeof processPostRagOutboxBatch>> | null = null
  let v2: Awaited<ReturnType<typeof processPostRagJobV2Batch>> | null = null
  let legacy: Awaited<ReturnType<typeof processPostRagJobBatch>> | null = null
  const errors: Array<{ stage: 'outbox' | 'v2' | 'legacy'; code: 'INTERNAL_ERROR' }> = []
  try { outbox = await processPostRagOutboxBatch({ limit }) }
  catch { errors.push({ stage: 'outbox', code: 'INTERNAL_ERROR' }); console.warn('[post-rag-worker] stage failed', { stage: 'outbox', code: 'INTERNAL_ERROR' }) }
  try { v2 = await runV2() }
  catch { errors.push({ stage: 'v2', code: 'INTERNAL_ERROR' }); console.warn('[post-rag-worker] stage failed', { stage: 'v2', code: 'INTERNAL_ERROR' }) }
  try { legacy = await processPostRagJobBatch({ limit, ...(postId ? { postId } : {}) }) }
  catch { errors.push({ stage: 'legacy', code: 'INTERNAL_ERROR' }); console.warn('[post-rag-worker] stage failed', { stage: 'legacy', code: 'INTERNAL_ERROR' }) }
  if (!outbox && !v2 && !legacy) throw new Error('RAG worker stages failed')
  if (authorization.source === 'timer') {
    try {
      await recordPostRagTimerEvidence({
        triggerName: String(event.TriggerName || ''), eventTime: String(event.Time || ''), invokedAt: new Date().toISOString(), outbox, v2,
      })
    } catch { throw new Error('RAG worker timer evidence failed') }
  }
  return { outbox, v2, legacy, errors }
}
