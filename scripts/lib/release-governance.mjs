const LEASE_MS = 5 * 60 * 1000
const HEARTBEAT_MS = 30 * 1000

function clone(value) {
  return value == null ? value : structuredClone(value)
}

function asErrorMessage(error) {
  return String(error?.message || error || 'unknown release error')
}

function hasEvidence(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
}

export class InMemoryReleaseStore {
  constructor() {
    this.state = {
      lock: null,
      nextFence: 1,
      production: { nextFencingToken: 1 },
      runs: new Map(),
    }
  }

  async transact({ runId }, callback) {
    const model = {
      lock: clone(this.state.lock),
      run: clone(this.state.runs.get(runId) || null),
      state: clone(this.state.production),
    }
    const result = await callback(model)
    this.state.lock = clone(model.lock)
    this.state.production = clone(model.state)
    this.state.nextFence = Number(model.state?.nextFencingToken || this.state.nextFence)
    if (model.run == null) this.state.runs.delete(runId)
    else this.state.runs.set(runId, clone(model.run))
    return result
  }

  async readProductionState() {
    return clone(this.state.production)
  }

  async inspect({ runId } = {}) {
    return {
      lock: clone(this.state.lock),
      run: runId ? clone(this.state.runs.get(runId) || null) : null,
      runs: [...this.state.runs.values()].map(clone),
      state: clone(this.state.production),
    }
  }
}

export class ReleaseGovernance {
  constructor({ store, now = Date.now, leaseMs = LEASE_MS }) {
    if (!store?.transact || !store?.readProductionState) throw new Error('ReleaseGovernance requires a transactional release store')
    this.store = store
    this.now = now
    this.leaseMs = leaseMs
  }

  async acquire({ gitSha, host = '', owner, pid = 0, plan = null, runId }) {
    if (!gitSha || !owner || !runId) throw new Error('release lock requires gitSha, owner, and runId')
    const result = await this.store.transact({ runId }, (model) => {
      const now = this.now()
      if (model.lock) {
        if (model.lock.status === 'active' && Number(model.lock.leaseUntil) <= now) {
          model.lock.status = 'stale'
          model.lock.staleAt = now
        }
        return { rejection: `Production release lock is already held (${model.lock.status || 'active'}) by ${model.lock.runId}` }
      }
      const nextFencingToken = Math.max(1, Number(model.state?.nextFencingToken || 1))
      const lock = {
        fencingToken: nextFencingToken,
        gitSha,
        heartbeat: now,
        host,
        leaseUntil: now + this.leaseMs,
        mutationStarted: false,
        owner,
        pid,
        runId,
        status: 'active',
      }
      model.lock = lock
      model.run = {
        ...lock,
        plan: clone(plan),
        startedAt: now,
        stages: [],
        status: 'active',
        updatedAt: now,
      }
      model.state = { ...model.state, nextFencingToken: nextFencingToken + 1 }
      return { lock: clone(lock) }
    })
    if (result?.rejection) throw new Error(result.rejection)
    return result.lock
  }

  async heartbeat(lock) {
    return await this.store.transact({ runId: lock?.runId }, (model) => {
      this.assertOwner(model, lock)
      const now = this.now()
      model.lock.heartbeat = now
      model.lock.leaseUntil = now + this.leaseMs
      model.run = { ...model.run, heartbeat: now, leaseUntil: model.lock.leaseUntil, updatedAt: now }
      return clone(model.lock)
    })
  }

  async markMutationStarted(lock, stage) {
    return await this.recordStage(lock, { stage, status: 'mutation-started', mutationStarted: true })
  }

  async recordStage(lock, { evidence = null, stage, status = 'passed', mutationStarted = false }) {
    if (!stage) throw new Error('release stage name is required')
    return await this.store.transact({ runId: lock?.runId }, (model) => {
      this.assertOwner(model, lock)
      const now = this.now()
      if (mutationStarted) model.lock.mutationStarted = true
      model.run = {
        ...model.run,
        mutationStarted: model.lock.mutationStarted === true,
        stages: [...(model.run?.stages || []), { evidence: clone(evidence), stage, status, at: now }],
        updatedAt: now,
      }
      return clone(model.lock)
    })
  }

  async recordMigration(lock, migrationId) {
    if (!migrationId) throw new Error('migration id is required')
    return await this.store.transact({ runId: lock?.runId }, (model) => {
      this.assertOwner(model, lock)
      const appliedMigrations = { ...(model.state?.appliedMigrations || {}) }
      if (!appliedMigrations[migrationId]) {
        appliedMigrations[migrationId] = { appliedAt: this.now(), runId: lock.runId }
      }
      model.state = { ...model.state, appliedMigrations }
      return clone(model.state.appliedMigrations[migrationId])
    })
  }

  async fail(lock, error, evidence = null) {
    return await this.store.transact({ runId: lock?.runId }, (model) => {
      this.assertOwner(model, lock)
      const now = this.now()
      const unresolved = model.lock.mutationStarted === true
      model.run = {
        ...model.run,
        error: asErrorMessage(error),
        failureEvidence: clone(evidence),
        finishedAt: now,
        status: unresolved ? 'unresolved' : 'aborted',
        updatedAt: now,
      }
      if (unresolved) {
        model.lock = { ...model.lock, failureAt: now, status: 'unresolved' }
      } else {
        model.lock = null
      }
    })
  }

  async complete(lock, { components = {}, evidence = {} } = {}) {
    return await this.store.transact({ runId: lock?.runId }, (model) => {
      this.assertOwner(model, lock)
      const now = this.now()
      model.run = {
        ...model.run,
        completionEvidence: clone(evidence),
        components: clone(components),
        finishedAt: now,
        status: 'passed',
        updatedAt: now,
      }
      model.state = {
        ...model.state,
        components: clone(components),
        evidence: clone(evidence),
        gitSha: lock.gitSha,
        lastSuccessfulRunId: lock.runId,
        releasedAt: now,
      }
      model.lock = null
      return clone(model.state)
    })
  }

  async recover({ evidence, fencingToken, reason, runId }) {
    if (!String(reason || '').trim()) throw new Error('release recovery requires a reason')
    if (!hasEvidence(evidence)) throw new Error('release recovery requires verification evidence')
    return await this.store.transact({ runId }, (model) => {
      if (!model.lock || model.lock.runId !== runId || model.lock.fencingToken !== fencingToken) {
        throw new Error('Recovery fencing token does not match current lock')
      }
      if (!['stale', 'unresolved'].includes(model.lock.status)) {
        throw new Error(`Only stale or unresolved releases can recover; got ${model.lock.status}`)
      }
      const now = this.now()
      model.run = {
        ...model.run,
        recovery: { evidence: clone(evidence), reason: String(reason).trim(), recoveredAt: now },
        status: 'recovered',
        updatedAt: now,
      }
      model.lock = null
    })
  }

  async inspect({ runId } = {}) {
    return await this.store.inspect({ runId })
  }

  async getProductionState() {
    return await this.store.readProductionState()
  }

  assertOwner(model, lock) {
    if (!model.lock || model.lock.runId !== lock?.runId || model.lock.fencingToken !== lock?.fencingToken || model.lock.status !== 'active') {
      throw new Error('Release lock fencing token is invalid or no longer active')
    }
  }
}

export function startReleaseHeartbeat({ governance, intervalMs = HEARTBEAT_MS, lock, onError = () => {} }) {
  if (!governance || !lock) throw new Error('release heartbeat requires governance and lock')
  let currentLock = lock
  let stopped = false
  let pending = Promise.resolve()
  const tick = () => {
    pending = pending.then(async () => {
      if (stopped) return
      try {
        currentLock = await governance.heartbeat(currentLock)
      } catch (error) {
        stopped = true
        onError(error)
      }
    })
  }
  const timer = setInterval(tick, intervalMs)
  timer.unref?.()
  return {
    get lock() { return currentLock },
    get stopped() { return stopped },
    async stop() {
      stopped = true
      clearInterval(timer)
      await pending
    },
  }
}

export const DEFAULT_RELEASE_HEARTBEAT_MS = HEARTBEAT_MS
export const DEFAULT_RELEASE_LEASE_MS = LEASE_MS
