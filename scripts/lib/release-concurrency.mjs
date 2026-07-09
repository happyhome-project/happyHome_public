export function parsePositiveIntOption(value, fallback, options = {}) {
  const min = Number.isFinite(options.min) ? Math.floor(options.min) : 1
  const max = Number.isFinite(options.max) ? Math.floor(options.max) : Number.MAX_SAFE_INTEGER
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const normalized = Math.floor(parsed)
  if (normalized < min) return fallback
  return Math.min(normalized, max)
}

export async function runBounded(tasks, concurrency) {
  const limit = parsePositiveIntOption(concurrency, 1, { min: 1, max: tasks.length || 1 })
  const results = new Array(tasks.length)
  let nextIndex = 0
  let firstError = null

  async function worker() {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= tasks.length) return
      try {
        results[index] = await tasks[index]()
      } catch (error) {
        firstError = firstError || error
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()))
  if (firstError) throw firstError
  return results
}
