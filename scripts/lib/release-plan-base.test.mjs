import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveMainReleasePlanBase } from './release-plan-base.mjs'

test('main release planning prefers an explicit base for offline reproducibility', async () => {
  let reads = 0
  const result = await resolveMainReleasePlanBase({
    explicitBase: 'explicit-sha',
    readProductionState: async () => { reads += 1; return { gitSha: 'abcdef0123456' } },
  })
  assert.deepEqual(result, { baseSha: 'explicit-sha', source: 'explicit' })
  assert.equal(reads, 0)
})

test('main release planning uses the last successful production SHA and bootstraps only with no state', async () => {
  const production = await resolveMainReleasePlanBase({
    readProductionState: async () => ({ gitSha: 'abcdef0123456', lastSuccessfulRunId: 'run-1' }),
  })
  assert.deepEqual(production, { baseSha: 'abcdef0123456', source: 'production-state' })

  const bootstrap = await resolveMainReleasePlanBase({ readProductionState: async () => null })
  assert.deepEqual(bootstrap, { baseSha: '', source: 'bootstrap' })
})

test('main release planning rejects malformed production release state rather than silently redeploying all functions', async () => {
  await assert.rejects(
    () => resolveMainReleasePlanBase({ readProductionState: async () => ({ gitSha: 'not a sha' }) }),
    /invalid gitSha/i,
  )
})
