const TRANSIENT_CLEANUP_PATTERN = /ResourceUnavailable\.TransactionBusy|\bECONNRESET\b|socket hang up|connection reset|\btime(?:d)?\s*out\b/i
const SECRET_VALUE_PATTERN = /\b(token|openid)\s*[:=]\s*[^\s,;]+/gi

function errorMessage(error) {
  return String(error?.message || error?.errMsg || error || 'unknown cleanup error')
}

function sanitizedError(error) {
  const firstLine = errorMessage(error).split(/\r?\n/, 1)[0]
  return firstLine.replace(SECRET_VALUE_PATTERN, '$1=[REDACTED]').slice(0, 500)
}

export function isTransientReleaseUiCleanupError(error) {
  return TRANSIENT_CLEANUP_PATTERN.test(errorMessage(error))
}

export async function cleanupReleaseFixtureWithRetry({
  actions = [],
  invoke,
  sleep = (delayMs) => new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs)),
  retryDelayMs = 250,
} = {}) {
  if (typeof invoke !== 'function') throw new Error('release UI fixture cleanup invoke is required')
  const steps = []
  for (const action of actions) {
    let finalError = null
    let attempts = 0
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      attempts = attempt
      try {
        const result = await invoke(action)
        if (result?.ok === false || result?.success === false) {
          throw new Error(result.message || result.errMsg || result.error || `${action} returned ok=false`)
        }
        finalError = null
        break
      } catch (error) {
        finalError = error
        if (attempt === 2 || !isTransientReleaseUiCleanupError(error)) break
        await sleep(retryDelayMs)
      }
    }
    steps.push(finalError
      ? { action, ok: false, attempts, error: sanitizedError(finalError) }
      : { action, ok: true, attempts })
  }
  return {
    ok: steps.every((step) => step.ok),
    steps,
  }
}
