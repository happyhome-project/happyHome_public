import assert from 'node:assert/strict'
import test from 'node:test'

import { InMemoryReleaseStore, ReleaseGovernance } from './release-governance.mjs'

test('only one release run can acquire production lock and its fencing token controls heartbeats', async () => {
  const store = new InMemoryReleaseStore()
  const governance = new ReleaseGovernance({ store, now: () => 1000 })
  const lock = await governance.acquire({ gitSha: 'a', owner: 'one', runId: 'run-1' })
  assert.equal(lock.fencingToken, 1)
  await assert.rejects(() => governance.acquire({ gitSha: 'b', owner: 'two', runId: 'run-2' }), /already held/i)
  await assert.rejects(() => governance.heartbeat({ ...lock, fencingToken: 2 }), /fencing/i)
  await governance.heartbeat(lock)
})

test('expired locks become stale but cannot be auto-taken over; recovery is explicit', async () => {
  let now = 1000
  const store = new InMemoryReleaseStore()
  const governance = new ReleaseGovernance({ store, now: () => now })
  const lock = await governance.acquire({ gitSha: 'a', owner: 'one', runId: 'run-1' })
  now += 301000
  await assert.rejects(() => governance.acquire({ gitSha: 'b', owner: 'two', runId: 'run-2' }), /stale/i)
  await governance.recover({
    runId: lock.runId,
    fencingToken: lock.fencingToken,
    reason: 'confirmed stopped',
    evidence: { checkedAt: '2026-07-11T00:00:00.000Z', functionVersions: ['post:a'] },
  })
  const next = await governance.acquire({ gitSha: 'b', owner: 'two', runId: 'run-2' })
  assert.equal(next.fencingToken, 2)
})

test('a failure after remote mutation stays unresolved and blocks later releases', async () => {
  const governance = new ReleaseGovernance({ store: new InMemoryReleaseStore(), now: () => 1000 })
  const lock = await governance.acquire({ gitSha: 'a', owner: 'one', runId: 'run-1' })
  await governance.markMutationStarted(lock, 'cloud-deploy')
  await governance.fail(lock, new Error('network timeout'))
  const state = await governance.inspect()
  assert.equal(state.lock.status, 'unresolved')
  await assert.rejects(() => governance.acquire({ gitSha: 'b', owner: 'two', runId: 'run-2' }), /unresolved/i)
})

test('only a successful locked release can prove the production version', async () => {
  const governance = new ReleaseGovernance({ store: new InMemoryReleaseStore(), now: () => 1000 })
  const lock = await governance.acquire({ gitSha: 'a', owner: 'one', runId: 'run-1' })
  await governance.markMutationStarted(lock, 'cloud-deploy')
  await governance.complete(lock, {
    components: { cloud: { functions: { post: { sourceSha: 'a', buildId: 'build-1' } } } },
    evidence: { smokeRunId: 'run-1' },
  })

  const state = await governance.getProductionState()
  assert.equal(state.gitSha, 'a')
  assert.equal(state.lastSuccessfulRunId, 'run-1')
  assert.deepEqual(state.components.cloud.functions.post, { sourceSha: 'a', buildId: 'build-1' })
  const inspection = await governance.inspect({ runId: 'run-1' })
  assert.equal(inspection.lock, null)
  assert.equal(inspection.run.status, 'passed')
})

test('recovery records explicit verification evidence before a stale lock can be released', async () => {
  let now = 1000
  const governance = new ReleaseGovernance({ store: new InMemoryReleaseStore(), now: () => now })
  const lock = await governance.acquire({ gitSha: 'a', owner: 'one', runId: 'run-1' })
  now += 301000
  await assert.rejects(() => governance.acquire({ gitSha: 'b', owner: 'two', runId: 'run-2' }), /stale/i)
  await assert.rejects(
    () => governance.recover({ runId: lock.runId, fencingToken: lock.fencingToken, reason: 'confirmed stopped' }),
    /evidence/i,
  )
  await governance.recover({
    runId: lock.runId,
    fencingToken: lock.fencingToken,
    reason: 'confirmed stopped',
    evidence: { checkedAt: '2026-07-11T00:00:00.000Z', functionVersions: ['post:a'] },
  })
  const inspection = await governance.inspect({ runId: 'run-1' })
  assert.equal(inspection.lock, null)
  assert.equal(inspection.run.status, 'recovered')
  assert.deepEqual(inspection.run.recovery.evidence.functionVersions, ['post:a'])
})
