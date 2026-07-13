const SAFE_BRANCHES = new Set(['timer', 'cloud', 'release'])
const SAFE_PHASES = new Set(['create', 'wait', 'cleanup', 'deploy', 'smoke', 'parallel', 'preflight'])
const SAFE_ACTIONS = new Set([
  'post.ragTimerProbeCreateAdmin',
  'post.ragTimerEvidenceAdmin',
  'post.ragTimerProbeStatusAdmin',
  'post.ragTimerProbeCleanupAdmin',
  'unknown',
])
const SAFE_CODES = new Set(['ABORTED', 'TIMEOUT', 'REMOTE_CALL_FAILED', 'INVALID_RESPONSE', 'BRANCH_FAILED'])
const SAFE_CLASSIFICATIONS = new Set(['aborted', 'timeout', 'remote-call-failed', 'invalid-response', 'branch-failed'])

export function normalizeReleaseFailureCause(input = {}, defaults = {}) {
  return {
    branch: SAFE_BRANCHES.has(input.branch) ? input.branch : (SAFE_BRANCHES.has(defaults.branch) ? defaults.branch : 'release'),
    phase: SAFE_PHASES.has(input.phase) ? input.phase : (SAFE_PHASES.has(defaults.phase) ? defaults.phase : 'parallel'),
    action: SAFE_ACTIONS.has(input.action) ? input.action : 'unknown',
    code: SAFE_CODES.has(input.code) ? input.code : 'BRANCH_FAILED',
    classification: SAFE_CLASSIFICATIONS.has(input.classification) ? input.classification : 'branch-failed',
    cleanup: input.cleanup === true || defaults.cleanup === true,
  }
}

export function createSafeReleaseError(message, causes) {
  const failureCauses = (Array.isArray(causes) ? causes : [causes]).map((cause) => normalizeReleaseFailureCause(cause))
  const error = new Error(message)
  error.name = 'ReleaseFailure'
  error.reason = message
  error.result = { failureCauses }
  error.evidence = { failureCauses }
  return error
}

export function createSafeAggregateError(message, causes) {
  const safe = createSafeReleaseError(message, causes)
  const aggregate = new AggregateError(
    safe.result.failureCauses.map((cause) => createSafeReleaseError(`${cause.branch} ${cause.phase} failed`, cause)),
    message,
  )
  aggregate.reason = safe.reason
  aggregate.result = safe.result
  aggregate.evidence = safe.evidence
  return aggregate
}

export function releaseFailureCauses(error, defaults = {}) {
  const supplied = error?.result?.failureCauses
  if (Array.isArray(supplied) && supplied.length) return supplied.map((cause) => normalizeReleaseFailureCause(cause, defaults))
  return [normalizeReleaseFailureCause({}, defaults)]
}
