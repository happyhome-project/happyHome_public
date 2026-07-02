import { timingSafeEqual } from 'crypto'

function configuredWorkerToken(env: NodeJS.ProcessEnv = process.env) {
  return String(env.POST_RAG_WORKER_TOKEN || env.HH_POST_RAG_WORKER_TOKEN || '').trim()
}

function eventWorkerToken(event: any = {}) {
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
}
