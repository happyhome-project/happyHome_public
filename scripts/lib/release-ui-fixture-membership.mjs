const TRANSIENT_MEMBERSHIP_PATTERN = /ResourceUnavailable\.TransactionBusy|\bDATABASE_TRANSACTION_FAIL\b|Transaction is busy/i

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

export async function applyReleaseFixtureMembership({
  apply,
  attempts = 3,
  retryDelayMs = 750,
} = {}) {
  if (typeof apply !== 'function') throw new Error('release fixture membership apply is required')
  const maxAttempts = Math.max(1, Math.min(5, Math.floor(Number(attempts) || 1)))
  const delayMs = Math.max(0, Math.floor(Number(retryDelayMs) || 0))
  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await apply()
    } catch (error) {
      lastError = error
      const transient = TRANSIENT_MEMBERSHIP_PATTERN.test(String(error?.message || error))
      if (!transient || attempt >= maxAttempts) throw error
      if (delayMs > 0) await sleep(delayMs * attempt)
    }
  }

  throw lastError || new Error('release fixture membership apply failed')
}
