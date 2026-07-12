import { timingSafeEqual } from 'node:crypto'

const DEFAULT_TIMER_TRIGGER_NAME = 'post-rag-worker-every-minute'
const TIMER_SKEW_MS = 2 * 60 * 1000

function configuredWorkerToken(env: NodeJS.ProcessEnv) {
  return String(env.POST_RAG_WORKER_TOKEN || env.HH_POST_RAG_WORKER_TOKEN || '').trim()
}

function configuredTimerToken(env: NodeJS.ProcessEnv) {
  return String(env.POST_RAG_TIMER_TOKEN || '').trim()
}

function eventWorkerToken(event: any = {}) {
  const direct = event.workerToken || event.postRagWorkerToken || event.POST_RAG_WORKER_TOKEN
  if (direct) return String(direct).trim()
  const headers = event.headers || event.header || {}
  const authorization = headers.Authorization || headers.authorization || event.authorization
  const match = String(authorization || '').match(/^Bearer\s+(.+)$/i)
  return String(match ? match[1] : authorization || '').trim()
}

function timerTokenFromMessage(event: any) {
  if (typeof event?.Message !== 'string' || event.Message.length > 4096) return ''
  try {
    const message = JSON.parse(event.Message)
    if (!message || typeof message !== 'object' || Array.isArray(message)
      || Object.prototype.hasOwnProperty.call(message, 'workerToken')) return ''
    return String(message.timerToken || '').trim()
  } catch { return '' }
}

function secureTokenEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

function validTimerEvent(event: any, env: NodeJS.ProcessEnv, now: () => string | number | Date) {
  const expectedTrigger = String(env.POST_RAG_TIMER_TRIGGER_NAME || DEFAULT_TIMER_TRIGGER_NAME).trim()
  if (!expectedTrigger || event?.TriggerName !== expectedTrigger) return false
  const time = event?.Time
  if (typeof time !== 'string' || time.length > 24
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(time)) return false
  const eventMs = Date.parse(time)
  const nowValue = now()
  const nowMs = nowValue instanceof Date ? nowValue.getTime() : typeof nowValue === 'number' ? nowValue : Date.parse(nowValue)
  return Number.isFinite(eventMs) && Number.isFinite(nowMs) && Math.abs(eventMs - nowMs) <= TIMER_SKEW_MS
}

export function assertPostRagWorkerAuthorized(
  event: any = {},
  env: NodeJS.ProcessEnv = process.env,
  options: { now?: () => string | number | Date } = {},
) {
  if (event?.Type === 'Timer') {
    const expected = configuredTimerToken(env)
    if (!expected) throw new Error('post RAG timer token is not configured')
    const actual = timerTokenFromMessage(event)
    if (!validTimerEvent(event, env, options.now || Date.now) || !actual || !secureTokenEqual(actual, expected)) throw new Error('Unauthorized')
    return { source: 'timer' as const }
  }
  const expected = configuredWorkerToken(env)
  if (!expected) throw new Error('post RAG worker token is not configured')
  const actual = eventWorkerToken(event)
  if (!actual || !secureTokenEqual(actual, expected)) throw new Error('Unauthorized')
  return { source: 'manual' as const }
}
