import { posix, win32 } from 'node:path'

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

export function confirmNoOwner(owner = {}, confirmed = false) {
  if (owner.activeOwner) return owner
  if (confirmed && owner.ownerState === 'unknown') {
    return { ...owner, activeOwner: false, ownerState: 'inactive' }
  }
  return owner
}

export function evaluateLeaseOwner(lease, { now = Date.now(), maxAgeMs = 12 * 60 * 60 * 1000 } = {}) {
  if (!lease) return { activeOwner: false, ownerState: 'unknown', stale: false }
  if (lease.state === 'inactive') return { activeOwner: false, ownerState: 'inactive', stale: false }
  const lastSeenAt = Date.parse(lease.lastSeenAt || '')
  if (!Number.isFinite(lastSeenAt) || now - lastSeenAt > maxAgeMs) {
    return { activeOwner: false, ownerState: 'unknown', stale: true }
  }
  return { activeOwner: true, ownerState: 'active', stale: false }
}

export function evaluateRetirement({
  activeOwner = false,
  ownerState = 'unknown',
  hasOperation = false,
  isCanonicalMain = false,
  isDirty = false,
  openPr = false,
  uniqueCommits = 0,
  headInMain = false,
  pathIsReparsePoint = false,
} = {}) {
  const reasons = []
  if (isCanonicalMain) reasons.push('canonical_main')
  if (ownerState !== 'inactive') reasons.push('unknown_owner')
  if (activeOwner) reasons.push('active_owner')
  if (hasOperation) reasons.push('git_operation')
  if (isDirty) reasons.push('dirty')
  if (openPr) reasons.push('open_pr')
  if (Number(uniqueCommits) > 0) reasons.push('unique_commits')
  if (!headInMain) reasons.push('head_not_in_main')
  if (pathIsReparsePoint) reasons.push('reparse_point')
  return { eligible: reasons.length === 0, reasons }
}

export function decideSync({ activeOwner = false, isDirty = false, behind = 0, ahead = 0, detached = false } = {}) {
  if (activeOwner) return { action: 'blocked', reason: 'active_owner' }
  if (isDirty) return { action: 'blocked', reason: 'dirty' }
  if (Number(behind) === 0) return { action: 'none' }
  if (Number(ahead) > 0) return { action: 'manual_merge' }
  return { action: detached ? 'reset_detached' : 'fast_forward' }
}

export function createRetirementManifest({ path, branch, head, main, provider = 'manual', preparedAt = new Date().toISOString() } = {}) {
  if (!path || !head || !main) throw new Error('Retirement manifest requires path, head, and main')
  return {
    schemaVersion: 1,
    provider,
    path: String(path),
    branch: normalizedBranch(branch),
    head: String(head),
    main: String(main),
    preparedAt,
  }
}

export function verifyRetirementManifest(manifest, live) {
  for (const field of ['path', 'branch', 'head', 'main']) {
    const expected = field === 'branch' ? normalizedBranch(manifest?.[field]) : String(manifest?.[field] || '')
    const actual = field === 'branch' ? normalizedBranch(live?.[field]) : String(live?.[field] || '')
    if (!expected || expected !== actual) throw new Error(`Retirement manifest ${field} does not match live worktree`)
  }
}
