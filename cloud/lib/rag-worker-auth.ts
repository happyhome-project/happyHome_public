import { timingSafeEqual } from 'crypto'

function configuredWorkerToken(env: NodeJS.ProcessEnv = process.env) {
  return String(env.POST_RAG_WORKER_TOKEN || env.HH_POST_RAG_WORKER_TOKEN || '').trim()
}

function eventWorkerToken(event: any = {}) {
  if (event.Type === 'Timer') {
    if (typeof event.Message !== 'string') return ''
    try {
      const message = JSON.parse(event.Message)
      return String(message && typeof message === 'object' ? message.workerToken || '' : '').trim()
    } catch { return '' }
  }
  const direct = event.workerToken || event.postRagWorkerToken || event.POST_RAG_WORKER_TOKEN
  if (direct) return String(direct).trim()

  const headers = event.headers || event.header || {}
  const authorization = headers.Authorization || headers.authorization || event.authorization
  const match = String(authorization || '').match(/^Bearer\s+(.+)$/i)
  return String(match ? match[1] : authorization || '').trim()
}

function secureTokenEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

export function assertPostRagWorkerAuthorized(event: any = {}, env: NodeJS.ProcessEnv = process.env) {
  const expected = configuredWorkerToken(env)
  if (!expected) throw new Error('post RAG worker token is not configured')
  const actual = eventWorkerToken(event)
  if (!actual || !secureTokenEqual(actual, expected)) throw new Error('Unauthorized')
  return { source: event.Type === 'Timer' ? 'timer' as const : 'manual' as const }
}
