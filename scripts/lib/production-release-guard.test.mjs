import assert from 'node:assert/strict'
import test from 'node:test'

import { InMemoryReleaseStore, ReleaseGovernance } from './release-governance.mjs'
import { ProductionReleaseGuard } from './production-release-guard.mjs'

test('ProductionReleaseGuard fences every remote mutation and only completes after all evidence is present', async () => {
  const governance = new ReleaseGovernance({ store: new InMemoryReleaseStore(), now: () => 1000 })
  const guard = new ProductionReleaseGuard({
    governance,
    gitSha: 'abc',
    owner: 'release-host',
    runId: 'run-1',
  })
  await guard.acquire()
  await guard.beforeRemoteMutation('cloud:post')
  await guard.recordStage('cloud:post', { evidence: { probe: 'passed' } })
  await guard.complete({ components: { cloud: { functions: { post: { sourceSha: 'abc' } } } }, evidence: { smoke: 'passed' } })

  const production = await governance.getProductionState()
  assert.equal(production.gitSha, 'abc')
  assert.equal(production.lastSuccessfulRunId, 'run-1')
  const run = (await governance.inspect({ runId: 'run-1' })).run
  assert.deepEqual(run.stages.map(({ stage, status }) => ({ stage, status })), [
    { stage: 'cloud:post', status: 'mutation-started' },
    { stage: 'cloud:post', status: 'passed' },
  ])
})

test('ProductionReleaseGuard leaves an unresolved lock after a failure following a remote mutation', async () => {
  const governance = new ReleaseGovernance({ store: new InMemoryReleaseStore(), now: () => 1000 })
  const guard = new ProductionReleaseGuard({ governance, gitSha: 'abc', owner: 'release-host', runId: 'run-1' })
  await guard.acquire()
  await guard.beforeRemoteMutation('cloud:post')
  await guard.fail(new Error('network timeout'), { stage: 'cloud:post' })

  const inspection = await governance.inspect({ runId: 'run-1' })
  assert.equal(inspection.lock.status, 'unresolved')
  assert.equal(inspection.run.status, 'unresolved')
  await assert.rejects(() => new ProductionReleaseGuard({
    governance, gitSha: 'def', owner: 'release-host-2', runId: 'run-2',
  }).acquire(), /unresolved/i)
})

test('ProductionReleaseGuard serializes concurrent mutation fences so every deploy sees the current token', async () => {
  const governance = new ReleaseGovernance({ store: new InMemoryReleaseStore(), now: () => 1000 })
  const guard = new ProductionReleaseGuard({ governance, gitSha: 'abc', owner: 'release-host', runId: 'run-1' })
  await guard.acquire()
  await Promise.all([
    guard.beforeRemoteMutation('cloud:post'),
    guard.beforeRemoteMutation('cloud:admin'),
  ])
  const run = (await governance.inspect({ runId: 'run-1' })).run
  assert.deepEqual(run.stages.map(({ stage }) => stage), ['cloud:post', 'cloud:admin'])
  await guard.fail(new Error('stop for test'))
})

test('ProductionReleaseGuard serializes a scheduled heartbeat with a stage renewal', async () => {
  const lock = { fencingToken: 1, runId: 'run-1', status: 'active' }
  const events = []
  let concurrentHeartbeats = 0
  let maxConcurrentHeartbeats = 0
  let triggerHeartbeat
  const governance = {
    async acquire() { return { ...lock } },
    async heartbeat(current) {
      concurrentHeartbeats += 1
      maxConcurrentHeartbeats = Math.max(maxConcurrentHeartbeats, concurrentHeartbeats)
      await Promise.resolve()
      concurrentHeartbeats -= 1
      events.push('heartbeat')
      return { ...current }
    },
    async markMutationStarted() {},
    async recordStage() { events.push('record-stage') },
  }
  const guard = new ProductionReleaseGuard({
    governance,
    gitSha: 'abc',
    owner: 'release-host',
    runId: 'run-1',
    createHeartbeat: ({ renew }) => {
      triggerHeartbeat = renew
      return { stopped: false, async stop() {} }
    },
  })

  await guard.acquire()
  await Promise.all([
    triggerHeartbeat(lock),
    guard.recordStage('action:update-rag-env'),
  ])

  assert.equal(maxConcurrentHeartbeats, 1)
  assert.deepEqual(events, ['heartbeat', 'heartbeat', 'record-stage'])
})
