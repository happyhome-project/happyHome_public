import { assertFormalReleaseGitState } from './release-policy.mjs'
import { createReleasePlan } from './release-plan.mjs'
import { createReleasePlanAfterResumeIdentityCheck } from './release-run-ledger.mjs'

export function verifyPreflightGitAndPlan({
  gitState,
  expectedHeadSha,
  resumeRequested,
  resumeRunState,
  releaseStrategy = 'full-current',
  fullCurrentExplicit = releaseStrategy === 'full-current',
  forceRedeployCurrent = false,
  publishOnly = false,
  generatedBuildInfoMatches = false,
}) {
  if (!/^[0-9a-f]{40}$/i.test(String(expectedHeadSha || ''))) throw new Error('expected release HEAD must be a full 40-hex SHA')
  if (!['main', 'full-current'].includes(releaseStrategy)) throw new Error(`unsupported release strategy: ${releaseStrategy}`)
  if (forceRedeployCurrent && (releaseStrategy !== 'full-current' || !fullCurrentExplicit)) throw new Error('force-redeploy-current requires explicit full-current mode')
  assertFormalReleaseGitState({ ...gitState, releaseStrategy, fullCurrentExplicit, publishOnly, generatedBuildInfoMatches })
  if (expectedHeadSha !== gitState.headSha) throw new Error(`expected HEAD ${expectedHeadSha} does not equal workspace HEAD ${gitState.headSha}`)
  if (resumeRequested && !resumeRunState) throw new Error('resume state is required when resume is requested')
  if (!resumeRequested && resumeRunState) throw new Error('resume state is forbidden without explicit resume mode')
  const plan = createReleasePlanAfterResumeIdentityCheck({
    resumeRunState, gitSha: gitState.headSha, releaseStrategy, forceRedeployCurrent,
    createPlan: (headSha, mode, force) => createReleasePlan({ headSha, mode, forceRedeployCurrent: force }),
  })
  return { status: 'passed', plan }
}
