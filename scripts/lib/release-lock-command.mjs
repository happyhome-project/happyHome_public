function option(args, name) {
  const equals = args.find((arg) => arg.startsWith(`--${name}=`))
  if (equals) return equals.slice(name.length + 3)
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] || '' : ''
}

function publicFields(value, fields) {
  return Object.fromEntries(fields.filter((field) => value?.[field] !== undefined).map((field) => [field, value[field]]))
}

export function parseReleaseLockCommand(args = []) {
  const command = args[0] || 'status'
  if (command === 'status') return { command }
  if (command !== 'recover') throw new Error('release lock command must be status or recover')
  const runId = option(args, 'run-id')
  const fencingToken = Number(option(args, 'fencing-token'))
  const reason = option(args, 'reason')
  const evidenceFile = option(args, 'evidence-file')
  if (!runId) throw new Error('recover requires --run-id')
  if (!Number.isInteger(fencingToken) || fencingToken < 1) throw new Error('recover requires a positive --fencing-token')
  if (!reason.trim()) throw new Error('recover requires --reason')
  if (!evidenceFile) throw new Error('recover requires --evidence-file')
  return { command, evidenceFile, fencingToken, reason, runId }
}

export function summarizeReleaseLockInspection({ lock, state }) {
  return JSON.stringify({
    lock: lock ? publicFields(lock, ['runId', 'gitSha', 'owner', 'host', 'pid', 'fencingToken', 'heartbeat', 'leaseUntil', 'status', 'mutationStarted']) : null,
    state: state ? publicFields(state, ['gitSha', 'lastSuccessfulRunId', 'releasedAt', 'nextFencingToken']) : null,
  }, null, 2)
}
