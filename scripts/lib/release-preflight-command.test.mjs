import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createReleasePreflightChecks } from '../release-preflight.mjs'
import { runReleasePreflight } from './release-preflight.mjs'

test('preflight command builds every read/probe check without mutation entrypoints', () => {
  const checks = createReleasePreflightChecks({ app: null, env: {}, cwd: 'C:\\x', adminOptions: {} })
  assert.deepEqual(checks.map(check => check.name), ['rag-collections', 'rag-index', 'worker-timers', 'full-current-plan-resume', 'timer-probe-document'])
  const source = readFileSync(new URL('../release-preflight.mjs', import.meta.url), 'utf8')
  for (const forbidden of ['updateFunctionConfig', 'createCollection', 'deploy.mjs', 'release-lock', 'miniprogram-upload', 'ensure-indexes', 'configure-rag-network']) assert.doesNotMatch(source, new RegExp(forbidden))
  assert.match(source, /verifyPreflightCollections/)
  assert.match(source, /verifyPreflightIndex/)
  assert.match(source, /verifyPreflightTimers/)
  assert.match(source, /verifyPreflightGitAndPlan/)
  assert.match(source, /evaluateProbeEvidence/)
})

test('invalid canonical git state blocks probe creation while pure reads remain aggregated', async () => {
  let mutations = 0
  const checks = createReleasePreflightChecks({ app: null, env: {}, cwd: 'C:\\feature', adminOptions: { adminInternalToken: 'present' },
    readGitState: () => ({ cwd: 'C:\\feature', originUrl: 'https://github.com/happyhome-project/happyHome_public.git', branch: 'main', headSha: 'abcdef1', originMainSha: 'abcdef1', changedPaths: [] }),
    invoke: async () => { mutations += 1; return { functionResult: {} } },
  })
  const result = await runReleasePreflight({ checks })
  assert.equal(mutations, 0)
  assert.equal(result.checks.find(item => item.name === 'rag-collections').status, 'indeterminate')
  assert.equal(result.checks.find(item => item.name === 'full-current-plan-resume').status, 'indeterminate')
  assert.equal(result.checks.find(item => item.name === 'timer-probe-document').status, 'failed')
})
