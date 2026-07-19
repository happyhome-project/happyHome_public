import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyPreflightGitAndPlan } from './release-preflight-checks.mjs'

const actualHead = 'a'.repeat(40)
const canonical = { cwd: 'C:\\Project\\Claude\\happyHome_public', originUrl: 'https://github.com/happyhome-project/happyHome_public.git', branch: 'main', headSha: actualHead, originMainSha: actualHead, changedPaths: [] }

test('git and full-current plan validation binds canonical current state and explicit resume mode', () => {
  const plan = verifyPreflightGitAndPlan({ gitState: canonical, expectedHeadSha: actualHead, resumeRequested: false })
  assert.equal(plan.plan.mode, 'full-current')
  assert.throws(() => verifyPreflightGitAndPlan({ gitState: { ...canonical, cwd: 'C:\\feature' }, expectedHeadSha: actualHead, resumeRequested: false }), /canonical main workspace/i)
  assert.throws(() => verifyPreflightGitAndPlan({ gitState: canonical, expectedHeadSha: '', resumeRequested: false }), /expected.*40/i)
  assert.throws(() => verifyPreflightGitAndPlan({ gitState: canonical, expectedHeadSha: 'b'.repeat(40), resumeRequested: false }), /expected HEAD.*workspace HEAD/i)
  assert.throws(() => verifyPreflightGitAndPlan({ gitState: canonical, expectedHeadSha: actualHead, resumeRequested: true }), /resume state is required/i)
  assert.throws(() => verifyPreflightGitAndPlan({ gitState: canonical, expectedHeadSha: actualHead, resumeRequested: true, resumeRunState: { context: { gitSha: 'deadbee', releaseStrategy: 'full-current' } } }), /resume context mismatch/i)
})

test('git preflight binds matching main resume and rejects strategy mismatches', () => {
  const mainResume = { context: { gitSha: actualHead, releaseStrategy: 'main' } }
  const result = verifyPreflightGitAndPlan({ gitState: canonical, expectedHeadSha: actualHead, resumeRequested: true, resumeRunState: mainResume, releaseStrategy: 'main', fullCurrentExplicit: false })
  assert.equal(result.plan.mode, 'main')
  assert.throws(() => verifyPreflightGitAndPlan({ gitState: canonical, expectedHeadSha: actualHead, resumeRequested: true, resumeRunState: mainResume, releaseStrategy: 'full-current', fullCurrentExplicit: true }), /resume context mismatch.*releaseStrategy/i)
})

test('preflight binds force-redeploy-current to explicit full-current resume identity', () => {
  const resumeRunState = { context: { gitSha: actualHead, releaseStrategy: 'full-current', forceRedeployCurrent: true } }
  const result = verifyPreflightGitAndPlan({ gitState: canonical, expectedHeadSha: actualHead, resumeRequested: true, resumeRunState, releaseStrategy: 'full-current', fullCurrentExplicit: true, forceRedeployCurrent: true })
  assert.equal(result.plan.forceRedeployCurrent, true)
  assert.throws(() => verifyPreflightGitAndPlan({ gitState: canonical, expectedHeadSha: actualHead, resumeRequested: true, resumeRunState, releaseStrategy: 'full-current', fullCurrentExplicit: true, forceRedeployCurrent: false }), /forceRedeployCurrent/i)
  assert.throws(() => verifyPreflightGitAndPlan({ gitState: canonical, expectedHeadSha: actualHead, resumeRequested: false, releaseStrategy: 'main', fullCurrentExplicit: false, forceRedeployCurrent: true }), /force-redeploy-current.*full-current/i)
})

test('publish resume permits only matching generated build-info', () => {
  const dirty = { ...canonical, changedPaths: ['miniprogram/src/generated/build-info.ts'] }
  const resumeRunState = { context: { gitSha: actualHead, releaseStrategy: 'full-current' } }
  assert.doesNotThrow(() => verifyPreflightGitAndPlan({ gitState: dirty, expectedHeadSha: actualHead, resumeRequested: true, resumeRunState, releaseStrategy: 'full-current', fullCurrentExplicit: true, publishOnly: true, generatedBuildInfoMatches: true }))
  assert.throws(() => verifyPreflightGitAndPlan({ gitState: dirty, expectedHeadSha: actualHead, resumeRequested: true, resumeRunState, releaseStrategy: 'full-current', fullCurrentExplicit: true, publishOnly: true, generatedBuildInfoMatches: false }), /build-info does not match/i)
  assert.throws(() => verifyPreflightGitAndPlan({ gitState: { ...dirty, changedPaths: [...dirty.changedPaths, 'cloud/functions/post/index.js'] }, expectedHeadSha: actualHead, resumeRequested: true, resumeRunState, releaseStrategy: 'full-current', fullCurrentExplicit: true, publishOnly: true, generatedBuildInfoMatches: true }), /unexpected worktree changes/i)
})
