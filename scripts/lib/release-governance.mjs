const LEASE_MS = 5 * 60 * 1000

export class InMemoryReleaseStore {
  constructor() { this.state = { nextFence: 1, lock: null, runs: new Map() } }
  async transact(callback) { return callback(this.state) }
  async read() { return this.state }
}

export class ReleaseGovernance {
  constructor({ store, now = Date.now, leaseMs = LEASE_MS }) {
    this.store = store
    this.now = now
    this.leaseMs = leaseMs
  }

  async acquire({ gitSha, owner, runId }) {
    return this.store.transact((state) => {
      const now = this.now()
      if (state.lock) {
        if (state.lock.status === 'active' && state.lock.leaseUntil <= now) state.lock.status = 'stale'
        throw new Error(`Production release lock is already held (${state.lock.status || 'active'}) by ${state.lock.runId}`)
      }
      const lock = { fencingToken: state.nextFence++, gitSha, leaseUntil: now + this.leaseMs, owner, runId, status: 'active', mutationStarted: false }
      state.lock = lock
      state.runs.set(runId, { ...lock, stages: [], status: 'active' })
      return { ...lock }
    })
  }

  async heartbeat(lock) {
    return this.store.transact((state) => {
      this.assertOwner(state, lock)
      state.lock.leaseUntil = this.now() + this.leaseMs
      return { ...state.lock }
    })
  }

  async markMutationStarted(lock, stage) {
    return this.store.transact((state) => {
      this.assertOwner(state, lock)
      state.lock.mutationStarted = true
      state.runs.get(lock.runId).stages.push({ stage, status: 'mutation-started' })
    })
  }

  async fail(lock, error) {
    return this.store.transact((state) => {
      this.assertOwner(state, lock)
      const run = state.runs.get(lock.runId)
      run.error = String(error?.message || error)
      if (state.lock.mutationStarted) {
        state.lock.status = 'unresolved'
        run.status = 'unresolved'
      } else {
        state.lock = null
        run.status = 'aborted'
      }
    })
  }

  async recover({ runId, fencingToken, reason }) {
    return this.store.transact((state) => {
      if (!state.lock || state.lock.runId !== runId || state.lock.fencingToken !== fencingToken) throw new Error('Recovery fencing token does not match current lock')
      if (!['stale', 'unresolved'].includes(state.lock.status)) throw new Error(`Only stale or unresolved releases can recover; got ${state.lock.status}`)
      const run = state.runs.get(runId)
      run.recovery = reason
      run.status = 'recovered'
      state.lock = null
    })
  }

  async inspect() {
    const state = await this.store.read()
    return { lock: state.lock ? { ...state.lock } : null, runs: [...state.runs.values()].map((run) => ({ ...run })) }
  }

  assertOwner(state, lock) {
    if (!state.lock || state.lock.runId !== lock.runId || state.lock.fencingToken !== lock.fencingToken || state.lock.status !== 'active') {
      throw new Error('Release lock fencing token is invalid or no longer active')
    }
  }
}
