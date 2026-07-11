import { startReleaseHeartbeat } from './release-governance.mjs'
import {
  confirmReleaseLedgerAgainstProductionInspection,
  productionInspectionProvesReleaseCompletion,
} from './release-run-ledger.mjs'

export const DEFAULT_RELEASE_COMPLETION_TIMEOUT_MS = 30 * 1000

function hostname() {
  return process.env.COMPUTERNAME || process.env.HOSTNAME || ''
}

export class ProductionReleaseGuard {
  constructor({
    governance,
    gitSha,
    heartbeatIntervalMs,
    createHeartbeat = startReleaseHeartbeat,
    host = hostname(),
    owner,
    pid = process.pid,
    plan = null,
    runId,
  }) {
    if (!governance) throw new Error('production release guard requires governance')
    if (!gitSha || !owner || !runId) throw new Error('production release guard requires gitSha, owner, and runId')
    this.governance = governance
    this.context = { gitSha, host, owner, pid, plan, runId }
    this.heartbeatIntervalMs = heartbeatIntervalMs
    this.createHeartbeat = createHeartbeat
    this.lock = null
    this.heartbeat = null
    this.finished = false
    this.mutationQueue = Promise.resolve()
  }

  async acquire() {
    this.assertNotFinished()
    if (this.lock) throw new Error('production release guard is already acquired')
    this.lock = await this.governance.acquire(this.context)
    this.heartbeat = this.createHeartbeat({
      governance: this.governance,
      intervalMs: this.heartbeatIntervalMs,
      lock: this.lock,
      renew: async (lock) => await this.renewScheduledHeartbeat(lock),
      onError: () => { this.finished = true },
    })
    return this.lock
  }

  async beforeRemoteMutation(stage, evidence = null) {
    return await this.serialize(async () => {
      await this.renew()
      await this.governance.markMutationStarted(this.lock, stage)
      if (evidence) await this.governance.recordStage(this.lock, { evidence, stage, status: 'mutation-planned' })
    })
  }

  async recordStage(stage, { evidence = null, status = 'passed' } = {}) {
    return await this.serialize(async () => {
      await this.renew()
      return await this.governance.recordStage(this.lock, { evidence, stage, status })
    })
  }

  async recordMigration(migrationId) {
    return await this.serialize(async () => {
      await this.renew()
      return await this.governance.recordMigration(this.lock, migrationId)
    })
  }

  async getProductionState() {
    return await this.governance.getProductionState()
  }

  async getReleaseInspection() {
    return await this.governance.inspect({ runId: this.context.runId })
  }

  async complete({ components = {}, evidence = {} } = {}) {
    return await this.serialize(async () => {
      await this.renew()
      const result = await this.governance.complete(this.lock, { components, evidence })
      await this.stopHeartbeat()
      this.finished = true
      return result
    })
  }

  async fail(error, evidence = null) {
    return await this.serialize(async () => {
      this.assertAcquired()
      try {
        return await this.governance.fail(this.lock, error, evidence)
      } finally {
        await this.stopHeartbeat()
        this.finished = true
      }
    })
  }

  async renew() {
    this.assertAcquired()
    if (this.finished || this.heartbeat?.stopped) throw new Error('production release lock heartbeat stopped')
    this.lock = await this.governance.heartbeat(this.lock)
    return this.lock
  }

  async renewScheduledHeartbeat(lock) {
    return await this.serialize(async () => {
      if (this.finished || !this.lock) throw new Error('production release lock heartbeat stopped')
      this.lock = await this.governance.heartbeat(this.lock || lock)
      return this.lock
    })
  }

  async stopHeartbeat() {
    if (this.heartbeat) await this.heartbeat.stop()
  }

  markRemotelyCompleted() {
    this.finished = true
    const stop = this.heartbeat?.stop?.()
    if (stop?.catch) void stop.catch(() => {})
  }

  async serialize(operation) {
    const next = this.mutationQueue.then(operation)
    this.mutationQueue = next.catch(() => {})
    return await next
  }

  assertAcquired() {
    if (!this.lock) throw new Error('production release guard is not acquired')
  }

  assertNotFinished() {
    if (this.finished) throw new Error('production release guard is already finished')
  }
}

function validateCompletionTimeout(timeoutMs) {
  const parsed = Number(timeoutMs)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('release completion timeout must be a non-negative number')
  return parsed
}

async function awaitGuardCompletion(guard, payload, { clearTimer = clearTimeout, setTimer = setTimeout, timeoutMs }) {
  const completion = Promise.resolve().then(async () => await guard.complete(payload))
  // A timeout can leave the SDK promise pending forever. Keep a rejection from becoming unhandled later.
  void completion.catch(() => {})
  let timer = null
  const timeout = new Promise((resolve) => {
    timer = setTimer(() => resolve({ kind: 'timeout' }), timeoutMs)
  })
  const outcome = await Promise.race([
    completion.then(
      (value) => ({ kind: 'completed', value }),
      (error) => ({ kind: 'failed', error }),
    ),
    timeout,
  ])
  if (timer != null) clearTimer(timer)
  return outcome
}

export async function completeProductionReleaseWithRemoteConfirmation({
  clearTimer = clearTimeout,
  components = {},
  evidence = {},
  guard,
  ledger,
  setTimer = setTimeout,
  timeoutMs = DEFAULT_RELEASE_COMPLETION_TIMEOUT_MS,
} = {}) {
  if (!guard?.complete || !guard?.getReleaseInspection || !ledger?.complete || !ledger?.appendEvent) {
    throw new Error('release completion requires guard and ledger interfaces')
  }
  const normalizedTimeoutMs = validateCompletionTimeout(timeoutMs)
  const outcome = await awaitGuardCompletion(guard, { components, evidence }, {
    clearTimer,
    setTimer,
    timeoutMs: normalizedTimeoutMs,
  })
  if (outcome.kind === 'completed') {
    await ledger.complete('passed')
    return { mode: 'direct' }
  }

  const productionInspection = await guard.getReleaseInspection()
  if (!productionInspectionProvesReleaseCompletion(ledger, productionInspection)) {
    if (outcome.kind === 'failed') throw outcome.error
    const gitSha = String(ledger?.state?.context?.gitSha || '')
    const runId = String(ledger?.runId || '')
    throw new Error(`Production state does not prove completion for run ${runId} at ${gitSha}`)
  }
  guard.markRemotelyCompleted?.()
  try {
    const confirmation = await confirmReleaseLedgerAgainstProductionInspection({ ledger, productionInspection })
    return { mode: 'remote-state-confirmed', productionState: confirmation }
  } catch (confirmationError) {
    const error = confirmationError instanceof Error
      ? confirmationError
      : new Error(String(confirmationError))
    error.releaseRemotelyCompleted = true
    throw error
  }
}
