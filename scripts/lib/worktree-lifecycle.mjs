import { createHash, randomUUID } from 'node:crypto'
import { posix, win32 } from 'node:path'

const RETIREMENT_MANIFEST_FIELDS = [
  'branch',
  'confirmNoOwner',
  'expiresAt',
  'head',
  'main',
  'manifestId',
  'path',
  'preparedAt',
  'provider',
  'schemaVersion',
]

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

export function githubRepositoryFromRemote(remote) {
  const value = String(remote || '').trim()
  const match = value.match(/^(?:git@github\.com:|https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i)
  return match ? `${match[1]}/${match[2]}` : null
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
  ownerState,
  activeOwner,
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
      candidateStale: false,
      eligible: false,
      reasons: ['not_work_tree'],
      checks: {},
    }
  }
  if (probeError) {
    return {
      classification: 'unprobeable',
      candidateStale: false,
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
    owner: ownerState === 'active' || ownerState === 'inactive'
      ? { known: true, value: ownerState }
      : { known: false, value: 'unknown' },
    activeOwner: booleanCheck(activeOwner),
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
  if (!checks.owner.known) reasons.push('unknown_owner')
  else if (checks.owner.value === 'active') reasons.push('active_owner')
  if (!checks.activeOwner.known) reasons.push('active_owner_unknown')
  else if (checks.activeOwner.value && !reasons.includes('active_owner')) reasons.push('active_owner')
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

  const candidateStale = reasons.length === 1
    && reasons[0] === 'unknown_owner'
    && checks.activeOwner.known
    && checks.activeOwner.value === false
  const eligible = reasons.length === 0
  return {
    classification: eligible ? 'eligible' : candidateStale ? 'candidate_stale' : 'blocked',
    candidateStale,
    eligible,
    reasons,
    checks,
  }
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

export function decideSync({ activeOwner = false, ownerState = 'unknown', isDirty = false, behind = 0, ahead = 0, detached = false } = {}) {
  if (activeOwner) return { action: 'blocked', reason: 'active_owner' }
  if (ownerState !== 'inactive') return { action: 'blocked', reason: 'unknown_owner' }
  if (isDirty) return { action: 'blocked', reason: 'dirty' }
  if (Number(behind) === 0) return { action: 'none' }
  if (Number(ahead) > 0) return { action: 'manual_merge' }
  return { action: detached ? 'reset_detached' : 'fast_forward' }
}

function normalizedControlledPath(value) {
  const raw = String(value || '')
  const resolved = win32.isAbsolute(raw) ? win32.resolve(raw) : posix.resolve(raw)
  return resolved.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function retirementManifestPayload(manifest) {
  return Object.fromEntries(RETIREMENT_MANIFEST_FIELDS.map((field) => [field, manifest?.[field]]))
}

function retirementManifestDigest(manifest) {
  return createHash('sha256').update(JSON.stringify(retirementManifestPayload(manifest))).digest('hex')
}

export function createRetirementManifest({
  path,
  branch,
  head,
  main,
  provider = 'manual',
  preparedAt = new Date().toISOString(),
  expiresAt,
  manifestId = randomUUID(),
  confirmNoOwner = false,
} = {}) {
  if (!path || !head || !main) throw new Error('Retirement manifest requires path, head, and main')
  const preparedTime = Date.parse(preparedAt)
  const expiry = expiresAt || new Date(preparedTime + 15 * 60 * 1000).toISOString()
  return {
    schemaVersion: 2,
    manifestId,
    provider,
    path: String(path),
    branch: normalizedBranch(branch),
    head: String(head),
    main: String(main),
    preparedAt,
    expiresAt: expiry,
    confirmNoOwner: confirmNoOwner === true,
  }
}

export function createRetirementRecord({ manifest, manifestPath } = {}) {
  if (!manifest?.manifestId || !manifestPath) throw new Error('Retirement record requires manifest and path')
  return {
    schemaVersion: 1,
    manifestId: manifest.manifestId,
    manifestPath: normalizedControlledPath(manifestPath),
    digest: retirementManifestDigest(manifest),
    expiresAt: manifest.expiresAt,
    consumedAt: null,
  }
}

export function verifyRetirementManifest(manifest, live, {
  manifestPath,
  managedDirectory,
  record,
  now = Date.now(),
} = {}) {
  if (!manifest || manifest.schemaVersion !== 2) throw new Error('Retirement manifest schema is invalid')
  const fields = Object.keys(manifest).sort()
  if (JSON.stringify(fields) !== JSON.stringify(RETIREMENT_MANIFEST_FIELDS)) throw new Error('Retirement manifest schema fields are invalid')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(manifest.manifestId)) {
    throw new Error('Retirement manifest id is invalid')
  }
  if (typeof manifest.confirmNoOwner !== 'boolean') throw new Error('Retirement manifest confirmation is invalid')
  const preparedAt = Date.parse(manifest.preparedAt)
  const expiresAt = Date.parse(manifest.expiresAt)
  if (!Number.isFinite(preparedAt) || !Number.isFinite(expiresAt) || expiresAt <= preparedAt || expiresAt - preparedAt > 30 * 60 * 1000) {
    throw new Error('Retirement manifest timestamps are invalid')
  }
  if (now > expiresAt) throw new Error('Retirement manifest expired')
  if (preparedAt - now > 60 * 1000) throw new Error('Retirement manifest preparedAt is in the future')

  const controlledPath = normalizedControlledPath(manifestPath)
  const controlledDirectory = normalizedControlledPath(managedDirectory)
  if (!controlledPath.startsWith(`${controlledDirectory}/`)) throw new Error('Retirement manifest path is outside the managed directory')
  if (!record || record.schemaVersion !== 1 || record.manifestId !== manifest.manifestId) throw new Error('Retirement manifest has no trusted prepare record')
  if (record.consumedAt) throw new Error('Retirement manifest prepare record is already consumed')
  if (record.manifestPath !== controlledPath || record.expiresAt !== manifest.expiresAt || record.digest !== retirementManifestDigest(manifest)) {
    throw new Error('Retirement manifest does not match its trusted prepare record')
  }
  for (const field of ['path', 'branch', 'head', 'main']) {
    const expected = field === 'branch' ? normalizedBranch(manifest?.[field]) : String(manifest?.[field] || '')
    const actual = field === 'branch' ? normalizedBranch(live?.[field]) : String(live?.[field] || '')
    if (!expected || expected !== actual) throw new Error(`Retirement manifest ${field} does not match live worktree`)
  }
}

export function executeRetirementCriticalSection({ withLeaseLock, probe, verify, remove }) {
  return withLeaseLock(() => {
    const live = probe()
    verify(live)
    remove(live)
    return live
  })
}

export function executeHeartbeatCriticalSection({ withLeaseLock, readIdentity, writeLease }) {
  return withLeaseLock(() => {
    const identity = readIdentity()
    writeLease(identity)
    return identity
  })
}
