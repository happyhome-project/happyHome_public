import { posix, win32 } from 'node:path'

const PUBLIC_INTEGRATION_REPOSITORY = 'happyhome-project/happyHome_public'

export function normalizeExternalCommandResult(result = {}, { allowFailure = false } = {}) {
  if (result.error && !allowFailure) throw result.error
  return {
    ok: !result.error && result.status === 0,
    status: result.status ?? null,
    stdout: String(result.stdout || '').trim(),
    stderr: result.error?.message || String(result.stderr || '').trim(),
  }
}

function normalizedBranch(value) {
  return String(value || '').trim() || '(detached)'
}

export function createWorktreePlan({ name, path } = {}) {
  const normalizedName = String(name || '').trim()
  const normalizedPath = String(path || '').trim()
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalizedName)) {
    throw new Error('Worktree name must use safe lowercase letters, numbers, and hyphens')
  }
  if (!normalizedPath) throw new Error('Worktree path is required')
  if (!win32.isAbsolute(normalizedPath) && !posix.isAbsolute(normalizedPath)) {
    throw new Error('Worktree path must be absolute')
  }
  return { branch: `codex/${normalizedName}`, path: normalizedPath }
}

export function verifyCreateTargetBoundary(before, after) {
  if (after?.targetExists) throw new Error('Worktree target already exists')
  if (after?.hasReparseAncestor) throw new Error('Worktree target acquired a reparse-point ancestor')
  for (const field of ['anchorPath', 'anchorRealPath', 'anchorDevice', 'anchorInode']) {
    if (!before?.[field] || before[field] !== after?.[field]) {
      throw new Error(`Worktree target ancestor changed during origin/main refresh: ${field}`)
    }
  }
}

export function githubRepositoryFromRemote(remote) {
  const value = String(remote || '').trim()
  const match = value.match(/^(?:git@github\.com:|https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i)
  return match ? `${match[1]}/${match[2]}` : null
}

export function verifiedPublicOriginUrl(remote) {
  const value = String(remote || '').trim()
  if (githubRepositoryFromRemote(value) !== PUBLIC_INTEGRATION_REPOSITORY) {
    throw new Error(`Untrusted origin; expected ${PUBLIC_INTEGRATION_REPOSITORY}`)
  }
  return value
}

export function assessRetirementTargetBoundary({
  registered,
  operatorCommonDirectory,
  targetCommonDirectory,
  hasReparseAncestor,
} = {}) {
  const reasons = []
  if (hasReparseAncestor !== false) reasons.push(hasReparseAncestor === true ? 'reparse_ancestor' : 'reparse_ancestor_unknown')
  if (registered !== true) reasons.push(registered === false ? 'not_registered' : 'registration_unknown')
  if (!operatorCommonDirectory || !targetCommonDirectory) reasons.push('common_directory_unknown')
  else if (operatorCommonDirectory !== targetCommonDirectory) reasons.push('common_directory_mismatch')
  return { eligible: reasons.length === 0, reasons }
}

export function assessPublicIntegrationMain({
  root,
  commonDirectory,
  repository,
  branch,
  head,
  main,
  behind,
  ahead,
  isDirty,
  hasOperation,
  pathIsReparsePoint,
  expected,
} = {}) {
  const reasons = []
  if (expected && (
    root !== expected.root
    || commonDirectory !== expected.commonDirectory
    || head !== expected.head
    || main !== expected.main
  )) reasons.push('operator_changed')
  if (repository !== PUBLIC_INTEGRATION_REPOSITORY) reasons.push('untrusted_origin')
  if (branch !== 'main') reasons.push('not_main_branch')
  if (isDirty !== false) reasons.push(isDirty === true ? 'dirty' : 'dirty_unknown')
  if (hasOperation !== false) reasons.push(hasOperation === true ? 'git_operation' : 'git_operation_unknown')
  if (pathIsReparsePoint !== false) reasons.push(pathIsReparsePoint === true ? 'reparse_point' : 'reparse_point_unknown')
  if (!head || !main || head !== main) reasons.push('head_not_origin_main')
  if (behind !== 0 || ahead !== 0) reasons.push('diverged_from_origin_main')
  return { eligible: reasons.length === 0, reasons }
}

function requireExactCommitSha(value, label) {
  const sha = String(value || '')
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error(`Operation requires an exact ${label} SHA`)
  return sha
}

export function executePinnedWorktreeCreation({
  operator,
  branch,
  path,
  addWorktree,
  readCreated,
} = {}) {
  const mainSha = requireExactCommitSha(operator?.main, 'main')
  addWorktree({ root: operator.root, branch, path, startPoint: mainSha })
  const created = readCreated(path, mainSha)
  if (created?.branch !== branch || created?.head !== mainSha || created?.main !== mainSha) {
    throw new Error('Worktree creation did not match its pinned main SHA')
  }
  return created
}

export function collectPinnedRetirementEvidence({
  mainSha,
  readIdentity,
  readUniqueCommitCount,
  readHeadInMain,
} = {}) {
  const pinnedMain = requireExactCommitSha(mainSha, 'main')
  const identity = readIdentity(pinnedMain)
  const pinnedHead = requireExactCommitSha(identity?.head, 'head')
  return {
    identity,
    uniqueCommits: readUniqueCommitCount(pinnedHead, pinnedMain),
    headInMain: readHeadInMain(pinnedHead, pinnedMain),
  }
}

export function findOpenPullRequest(pullRequests, { branch, head } = {}, { error = null } = {}) {
  if (!Array.isArray(pullRequests)) {
    return { known: false, open: null, number: null, url: null, error: error || 'open PR inventory unavailable' }
  }
  const match = pullRequests.find((pull) => (
    (branch && branch !== '(detached)' && pull?.headRefName === branch)
    || (head && pull?.headRefOid === head)
  ))
  return match
    ? { known: true, open: true, number: match.number ?? null, url: match.url ?? null, error: null }
    : { known: true, open: false, number: null, url: null, error: null }
}

export function interpretAncestorExitStatus(status) {
  if (status === 0) return true
  if (status === 1) return false
  return null
}

export function validateOpenPullRequestInventory(value, limit) {
  if (!Array.isArray(value)) return { pulls: null, error: 'gh returned a non-array open PR inventory' }
  if (value.length >= limit) return { pulls: null, error: `open PR inventory may be truncated at ${limit} entries` }
  return { pulls: value, error: null }
}

function booleanCheck(value) {
  return typeof value === 'boolean'
    ? { known: true, value }
    : { known: false, value: null }
}

function numberCheck(value) {
  return Number.isFinite(value) && Number(value) >= 0
    ? { known: true, value: Number(value) }
    : { known: false, value: null }
}

export function classifyWorktreeRetirement({
  kind = 'worktree',
  branch,
  hasOperation,
  isDirty,
  openPr,
  uniqueCommits,
  headInMain,
  pathIsReparsePoint,
  probeError,
} = {}) {
  if (kind !== 'worktree') {
    return {
      classification: 'unprobeable',
      eligible: false,
      reasons: ['not_work_tree'],
      checks: {},
    }
  }
  if (probeError) {
    return {
      classification: 'unprobeable',
      eligible: false,
      reasons: ['probe_error'],
      checks: {},
    }
  }

  const normalizedOpenPr = openPr?.known === true && typeof openPr?.open === 'boolean'
    ? {
        known: true,
        value: openPr.open,
        number: openPr.number ?? null,
        url: openPr.url ?? null,
        error: null,
      }
    : {
        known: false,
        value: null,
        number: openPr?.number ?? null,
        url: openPr?.url ?? null,
        error: openPr?.error || null,
      }
  const checks = {
    mainBranch: typeof branch === 'string'
      ? { known: true, value: branch === 'main' }
      : { known: false, value: null },
    gitOperation: booleanCheck(hasOperation),
    dirty: booleanCheck(isDirty),
    openPr: normalizedOpenPr,
    uniqueCommits: numberCheck(uniqueCommits),
    headInMain: booleanCheck(headInMain),
    reparsePoint: booleanCheck(pathIsReparsePoint),
  }
  const reasons = []
  if (!checks.mainBranch.known) reasons.push('branch_unknown')
  else if (checks.mainBranch.value) reasons.push('main_branch')
  if (!checks.gitOperation.known) reasons.push('git_operation_unknown')
  else if (checks.gitOperation.value) reasons.push('git_operation')
  if (!checks.dirty.known) reasons.push('dirty_unknown')
  else if (checks.dirty.value) reasons.push('dirty')
  if (!checks.openPr.known) reasons.push('open_pr_unknown')
  else if (checks.openPr.value) reasons.push('open_pr')
  if (!checks.uniqueCommits.known) reasons.push('unique_commits_unknown')
  else if (checks.uniqueCommits.value > 0) reasons.push('unique_commits')
  if (!checks.headInMain.known) reasons.push('head_in_main_unknown')
  else if (!checks.headInMain.value) reasons.push('head_not_in_main')
  if (!checks.reparsePoint.known) reasons.push('reparse_point_unknown')
  else if (checks.reparsePoint.value) reasons.push('reparse_point')

  const eligible = reasons.length === 0
  return {
    classification: eligible ? 'eligible' : 'blocked',
    eligible,
    reasons,
    checks,
  }
}

export function decideBootstrap({ fingerprint, marker, nodeModulesPresent } = {}) {
  if (!nodeModulesPresent) return { action: 'install', reason: 'node_modules_missing' }
  if (marker?.schemaVersion !== 2 || JSON.stringify(marker.fingerprint) !== JSON.stringify(fingerprint)) {
    return { action: 'install', reason: 'fingerprint_changed' }
  }
  return { action: 'skip' }
}

export function executeBootstrap({ fingerprint, marker, nodeModulesPresent, install, writeMarker }) {
  const decision = decideBootstrap({ fingerprint, marker, nodeModulesPresent })
  if (decision.action === 'install') {
    install()
    writeMarker(fingerprint)
  }
  return decision
}

export function collectStatusMode({ fresh = false, refresh, readPullRequests, collectLocal }) {
  if (!fresh) return { status: 'local', refresh: { status: 'not_evaluated' }, pullRequests: { status: 'not_evaluated' }, entries: collectLocal() }
  const refreshed = refresh()
  if (!refreshed.ok) return { status: 'stale', refresh: refreshed, pullRequests: { status: 'not_evaluated' }, entries: collectLocal(), failed: true }
  return { status: 'fresh', refresh: refreshed, pullRequests: readPullRequests(), entries: collectLocal() }
}

export function executeRetirement({ probe, remove }) {
  const evidence = probe()
  const decision = classifyWorktreeRetirement(evidence)
  if (!decision.eligible) return { status: 'blocked', decision }
  remove(['worktree', 'remove', evidence.path])
  return { status: 'retired', branch: evidence.branch }
}

export function decideSync({ isDirty = false, hasOperation = false, behind = 0, ahead = 0, main = null } = {}) {
  if (isDirty) return { action: 'blocked', reason: 'dirty' }
  if (hasOperation) return { action: 'blocked', reason: 'git_operation' }
  if (Number(behind) === 0) return { action: 'noop' }
  if (!/^[0-9a-f]{40}$/i.test(String(main || ''))) throw new Error('sync requires an exact main SHA')
  if (Number(ahead) > 0) return { action: 'merge', args: ['merge', '--no-edit', main] }
  return { action: 'fast_forward', args: ['merge', '--ff-only', main] }
}

export function verifySyncSnapshot(expected, live, hasOperation = false) {
  const changed = ['root', 'branch', 'head', 'main', 'dirty', 'behind', 'ahead'].some((field) => live?.[field] !== expected?.[field])
    || hasOperation
  if (changed) throw new Error('sync state changed before merge; rerun worktree:sync-main')
}

export function executeWorktreeMutation({ withOperationLock, probe, verify, remove }) {
  return withOperationLock(() => {
    const live = probe()
    verify(live)
    remove(live)
    return live
  })
}
