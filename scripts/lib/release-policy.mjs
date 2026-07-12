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
export const CANONICAL_MAIN_WORKSPACE = 'C:\\Project\\Claude\\happyHome_public'
export const CANONICAL_ORIGIN_URL = 'https://github.com/happyhome-project/happyHome_public.git'

function normalizeWorkspacePath(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/^\\\\\?\\/, '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized
}

export function mustRevalidateRemoteReleaseStage(stageName) {
  return REMOTE_REVALIDATE_STAGES.has(String(stageName || ''))
}

export function assertFormalReleaseGitState({
  cwd,
  originUrl,
  releaseStrategy,
  fullCurrentExplicit = false,
  branch,
  headSha,
  originMainSha,
  changedPaths = [],
  publishOnly = false,
  allowReleaseBuildInfo = false,
  generatedBuildInfoMatches = false,
}) {
  if (normalizeWorkspacePath(cwd) !== normalizeWorkspacePath(CANONICAL_MAIN_WORKSPACE)) {
    throw new Error(`Formal release must run in the canonical main workspace ${CANONICAL_MAIN_WORKSPACE}; got ${cwd || '(missing)'}`)
  }
  if (originUrl !== CANONICAL_ORIGIN_URL) {
    throw new Error(`Formal release requires origin ${CANONICAL_ORIGIN_URL}; got ${originUrl || '(missing)'}`)
  }
  if (!['main', 'full-current'].includes(releaseStrategy)) {
    throw new Error(`Formal release strategy must be main or full-current; got ${releaseStrategy || '(missing)'}`)
  }
  if (releaseStrategy === 'full-current' && !fullCurrentExplicit) {
    throw new Error('Formal full-current release requires explicit intent')
  }
  if (branch !== 'main') throw new Error(`Formal release must run on main; got ${branch || '(detached)'}`)
  if (!headSha || !originMainSha || headSha !== originMainSha) {
    throw new Error(`Formal release requires HEAD to equal origin/main; got HEAD=${headSha || 'missing'} origin/main=${originMainSha || 'missing'}`)
  }

  const changed = [...new Set(changedPaths.map((value) => String(value || '').replace(/\\/g, '/')).filter(Boolean))]
  if (!publishOnly && !allowReleaseBuildInfo) {
    if (changed.length > 0) throw new Error(`Formal release requires a clean worktree; changed: ${changed.join(', ')}`)
    return
  }

  const unexpected = changed.filter((path) => path !== GENERATED_BUILD_INFO_PATH)
  if (unexpected.length > 0) throw new Error(`Formal release has unexpected worktree changes: ${unexpected.join(', ')}`)
  if (changed.includes(GENERATED_BUILD_INFO_PATH) && !generatedBuildInfoMatches) {
    throw new Error('Formal release build-info does not match the prepared version/desc')
  }
}

export function createFormalReleaseMutationRevalidator({
  fetchOriginMain,
  readGitState,
  releaseStrategy,
  fullCurrentExplicit = false,
  beforeRemoteMutation,
}) {
  if (typeof fetchOriginMain !== 'function' || typeof readGitState !== 'function' || typeof beforeRemoteMutation !== 'function') {
    throw new Error('Formal release mutation revalidation requires fetch, Git state, and production fence callbacks')
  }
  let pending = Promise.resolve()
  return (stage) => {
    const check = pending.then(async () => {
      await fetchOriginMain()
      assertFormalReleaseGitState({
        ...readGitState(),
        releaseStrategy,
        fullCurrentExplicit,
      })
      await beforeRemoteMutation(stage)
    })
    pending = check.catch(() => {})
    return check
  }
}
