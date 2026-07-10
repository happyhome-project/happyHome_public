export function isDevtoolsLoginSigningFailure(reason) {
  return /signed-header|login\/signing|not logged in|not login|未登录|登录失败|getCloudAPISignedHeader/i.test(String(reason || ''))
}

export function shouldFallbackAfterDevtoolsFailure({ target, reason, forceCi = false }) {
  if (forceCi) return true
  if (isDevtoolsLoginSigningFailure(reason)) return false
  if (target === 'miniprogram-upload') return false
  return true
}

const GENERATED_BUILD_INFO_PATH = 'miniprogram/src/generated/build-info.ts'
const REMOTE_REVALIDATE_STAGES = new Set(['cloud-deploy', 'cloud-smoke', 'admin-web-deploy'])

export function mustRevalidateRemoteReleaseStage(stageName) {
  return REMOTE_REVALIDATE_STAGES.has(String(stageName || ''))
}

export function assertFormalReleaseGitState({
  branch,
  headSha,
  originMainSha,
  changedPaths = [],
  publishOnly = false,
  generatedBuildInfoMatches = false,
}) {
  if (branch !== 'main') throw new Error(`Formal release must run on main; got ${branch || '(detached)'}`)
  if (!headSha || !originMainSha || headSha !== originMainSha) {
    throw new Error(`Formal release requires HEAD to equal origin/main; got HEAD=${headSha || 'missing'} origin/main=${originMainSha || 'missing'}`)
  }

  const changed = [...new Set(changedPaths.map((value) => String(value || '').replace(/\\/g, '/')).filter(Boolean))]
  if (!publishOnly) {
    if (changed.length > 0) throw new Error(`Formal release requires a clean worktree; changed: ${changed.join(', ')}`)
    return
  }

  const unexpected = changed.filter((path) => path !== GENERATED_BUILD_INFO_PATH)
  if (unexpected.length > 0) throw new Error(`Formal release resume has unexpected worktree changes: ${unexpected.join(', ')}`)
  if (changed.includes(GENERATED_BUILD_INFO_PATH) && !generatedBuildInfoMatches) {
    throw new Error('Formal release resume build-info does not match the prepared version/desc')
  }
}
