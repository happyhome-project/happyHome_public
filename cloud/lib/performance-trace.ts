export type PerformanceTrace = {
  requestId: string
  stage: string
  sample: 'cold' | 'warm'
  counts?: Record<string, number>
}

const TRACE_KEYS = new Set(['requestId', 'stage', 'sample', 'counts'])
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/
const MAX_LABEL_LENGTH = 64
const MAX_COUNT_KEYS = 12
const MAX_COUNT_VALUE = 1_000_000
const SENSITIVE_KEY = /openid|avatar|nick(?:name)?|location|token|secret|credential|password/i

function parseCounts(value: unknown): Record<string, number> | null | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value)
  if (entries.length > MAX_COUNT_KEYS) return null
  const output: Record<string, number> = {}
  for (const [key, count] of entries) {
    if (!SAFE_LABEL.test(key) || key.length > 32 || SENSITIVE_KEY.test(key)) return null
    if (!Number.isInteger(count) || Number(count) < 0 || Number(count) > MAX_COUNT_VALUE) return null
    output[key] = Number(count)
  }
  return output
}

export function parsePerformanceTrace(value: unknown): PerformanceTrace | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (Object.keys(input).some((key) => !TRACE_KEYS.has(key))) return null
  const requestId = typeof input.requestId === 'string' ? input.requestId : ''
  const stage = typeof input.stage === 'string' ? input.stage : ''
  if (!requestId || requestId.length > MAX_LABEL_LENGTH || !SAFE_LABEL.test(requestId)) return null
  if (!stage || stage.length > MAX_LABEL_LENGTH || !SAFE_LABEL.test(stage)) return null
  if (input.sample !== 'cold' && input.sample !== 'warm') return null
  const counts = parseCounts(input.counts)
  if (counts === null) return null
  return {
    requestId,
    stage,
    sample: input.sample,
    ...(counts !== undefined ? { counts } : {}),
  }
}

export function recordDatabaseStage(
  trace: PerformanceTrace | null,
  operation: string,
  dbStage: string,
  startedAt: number,
  counts?: Record<string, number>,
) {
  if (!trace) return
  const safeCounts = parseCounts(counts)
  const elapsedMs = Math.max(0, Math.min(600_000, Math.round(Date.now() - startedAt)))
  console.info('[performance.trace]', JSON.stringify({
    requestId: trace.requestId,
    stage: trace.stage,
    sample: trace.sample,
    ...(trace.counts ? { clientCounts: trace.counts } : {}),
    operation,
    dbStage,
    elapsedMs,
    ...(safeCounts && Object.keys(safeCounts).length > 0 ? { counts: safeCounts } : {}),
  }))
}
