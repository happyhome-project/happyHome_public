import cloud from 'wx-server-sdk'
import { processPostVideoRagJobBatch } from '../../lib/post-rag'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

export const main = async (event: any = {}) => {
  const limit = Number.isFinite(Number(event.limit))
    ? Math.max(1, Math.min(10, Math.floor(Number(event.limit))))
    : 3
  const postId = String(event.postId || '').trim()
  return processPostVideoRagJobBatch({ limit, ...(postId ? { postId } : {}) })
}
