import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createReleasePreflightChecks } from '../release-preflight.mjs'
import { runReleasePreflight } from './release-preflight.mjs'

test('preflight command verifies only immutable git and release-plan identity', () => {
  const checks = createReleasePreflightChecks({ app: null, env: {}, cwd: 'C:\\x', adminOptions: {} })
  assert.deepEqual(checks.map(check => check.name), ['full-current-plan-resume'])
  const source = readFileSync(new URL('../release-preflight.mjs', import.meta.url), 'utf8')
  for (const forbidden of ['updateFunctionConfig', 'createCollection', 'deploy.mjs', 'release-lock', 'miniprogram-upload', 'ensure-indexes', 'configure-rag-network', 'ragTimer', 'readTencentServerlessIndexMappings']) assert.doesNotMatch(source, new RegExp(forbidden))
  assert.match(source, /verifyPreflightGitAndPlan/)
})

test('legacy delegation flag cannot add RAG preflight checks back', () => {
  const checks = createReleasePreflightChecks({ app: null, env: {}, cwd: 'C:\\x', adminOptions: {}, delegateRagVerification: true })
  assert.deepEqual(checks.map(check => check.name), ['full-current-plan-resume'])
})

test('invalid canonical git state fails without remote mutation', async () => {
  const checks = createReleasePreflightChecks({ app: null, env: {}, cwd: 'C:\\feature', adminOptions: { adminInternalToken: 'present' },
    readGitState: () => ({ cwd: 'C:\\feature', originUrl: 'https://github.com/happyhome-project/happyHome_public.git', branch: 'main', headSha: 'abcdef1', originMainSha: 'abcdef1', changedPaths: [] }),
  })
  const result = await runReleasePreflight({ checks })
  assert.equal(result.checks.find(item => item.name === 'full-current-plan-resume').status, 'indeterminate')
})

test('intended HEAD mismatch fails while an exact 40-hex match passes the git gate', async () => {
  const actual = 'a'.repeat(40)
  const state = { cwd: 'C:\\Project\\Claude\\happyHome_public', originUrl: 'https://github.com/happyhome-project/happyHome_public.git', branch: 'main', headSha: actual, originMainSha: actual, changedPaths: [] }
  const mismatch = createReleasePreflightChecks({ app: null, env: { HH_RELEASE_HEAD_SHA: 'b'.repeat(40) }, cwd: state.cwd, adminOptions: { adminInternalToken: 'x' }, readGitState: () => state })
  const bad = await runReleasePreflight({ checks: mismatch })
  assert.equal(bad.checks.find(item => item.name === 'full-current-plan-resume').status, 'indeterminate')
  const matching = createReleasePreflightChecks({ app: null, env: { HH_RELEASE_HEAD_SHA: actual }, cwd: state.cwd, adminOptions: {}, readGitState: () => state })
  const gitCheck = matching.find(item => item.name === 'full-current-plan-resume')
  assert.equal((await gitCheck.run()).status, 'passed')
})
