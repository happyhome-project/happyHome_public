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
  await governance.recover({ runId: lock.runId, fencingToken: lock.fencingToken, reason: 'confirmed stopped' })
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
