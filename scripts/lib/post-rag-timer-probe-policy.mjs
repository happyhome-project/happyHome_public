const DEFAULT_TIMEOUT_MS = 12 * 60 * 1000
const MIN_TIMEOUT_MS = 5 * 60 * 1000
const MAX_TIMEOUT_MS = 20 * 60 * 1000

export function resolveTimerProbeTimeoutMs(env = process.env) {
  const raw = String(env.HH_POST_RAG_TIMER_PROBE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw new Error(`HH_POST_RAG_TIMER_PROBE_TIMEOUT_MS must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`)
  }
  return value
}

export function createTimerProbeDeadline(nowMs = Date.now(), env = process.env) {
  if (!Number.isFinite(nowMs)) throw new Error('timer probe clock is invalid')
  return nowMs + resolveTimerProbeTimeoutMs(env)
}
