import cloud from 'wx-server-sdk'
import { processPostRagJobBatch } from '../../lib/post-rag'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function readWorkerToken(event: any): string {
  const headerToken = event?.headers?.authorization || event?.headers?.Authorization || event?.authorization
  return String(event?.workerToken || event?.token || headerToken || '')
    .replace(/^Bearer\s+/i, '')
    .trim()
}

function assertWorkerAuthorized(event: any) {
  const expected = String(process.env.POST_RAG_WORKER_TOKEN || '').trim()
  if (!expected || readWorkerToken(event) !== expected) {
    throw new Error('Unauthorized')
  }
}

export const main = async (event: any = {}) => {
  assertWorkerAuthorized(event)
  const limit = Number.isFinite(Number(event.limit))
    ? Math.max(1, Math.min(20, Math.floor(Number(event.limit))))
    : 5
  const postId = String(event.postId || '').trim()
  return processPostRagJobBatch({ limit, ...(postId ? { postId } : {}) })
}
