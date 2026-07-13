import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createReleasePreflightChecks } from '../release-preflight.mjs'

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
