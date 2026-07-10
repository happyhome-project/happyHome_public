import { startReleaseHeartbeat } from './release-governance.mjs'

function hostname() {
  return process.env.COMPUTERNAME || process.env.HOSTNAME || ''
}

export class ProductionReleaseGuard {
  constructor({
    governance,
    gitSha,
    heartbeatIntervalMs,
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
    this.lock = null
    this.heartbeat = null
    this.finished = false
    this.mutationQueue = Promise.resolve()
  }

  async acquire() {
    this.assertNotFinished()
    if (this.lock) throw new Error('production release guard is already acquired')
    this.lock = await this.governance.acquire(this.context)
    this.heartbeat = startReleaseHeartbeat({
      governance: this.governance,
      intervalMs: this.heartbeatIntervalMs,
      lock: this.lock,
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

  async stopHeartbeat() {
    if (this.heartbeat) await this.heartbeat.stop()
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
