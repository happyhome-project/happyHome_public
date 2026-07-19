import { randomUUID } from 'node:crypto'
import cloud from 'wx-server-sdk'
import { processPostRagSyncBatch } from '../../lib/post-rag-sync-worker'
import { assertPostRagWorkerAuthorized } from '../../lib/rag-worker-auth'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

export const main = async (event: any = {}) => {
  assertPostRagWorkerAuthorized(event)
  const limit = Number.isFinite(Number(event.limit))
    ? Math.max(1, Math.min(20, Math.floor(Number(event.limit))))
    : 5
  const postId = String(event.postId || '').trim()
  return processPostRagSyncBatch({
    limit,
    ...(postId ? { postId } : {}),
    workerId: `post-rag-worker:${randomUUID()}`,
  })
}
