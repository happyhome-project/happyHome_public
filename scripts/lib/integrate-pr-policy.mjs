import {
  closeSync,
  linkSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'

import { CANONICAL_MAIN_WORKSPACE } from './worktree-policy.mjs'

export const REQUIRED_PR_CHECK = 'pr-ci / offline'

const releaseLockErrors = new WeakMap()

const defaultFileSystem = {
  closeSync,
  linkSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
}

export function getReleaseLockError(error) {
  return error && typeof error === 'object' ? releaseLockErrors.get(error) : undefined
}

function recordReleaseLockError(primaryError, releaseLockError) {
  releaseLockErrors.set(primaryError, releaseLockError)
  try {
    Object.defineProperty(primaryError, 'releaseLockError', {
      configurable: true,
      value: releaseLockError,
    })
  } catch {
    // Frozen errors retain their identity; callers can use getReleaseLockError(error).
  }
}

function quoteWindowsCmdArgument(value) {
  const stringValue = String(value)
  if (!/[ \t&()^|<>"]/.test(stringValue)) return stringValue
  return `"${stringValue.replace(/"/g, '\\"')}"`
}

export function resolveSpawnInvocation(command, args, platform = process.platform) {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', [command, ...args].map(quoteWindowsCmdArgument).join(' ')],
    }
  }
  return { command, args }
}

function normalizeWorkspacePath(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/^\\\\\?\\/, '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')

  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized
}

function checkName(check) {
  if (check?.workflowName && check?.name) return `${check.workflowName} / ${check.name}`
  return String(check?.context || check?.name || '')
}

function checkResult(check) {
  return String(check?.conclusion || check?.state || '').toUpperCase()
}

export function parsePrNumber(value) {
  if (!/^\d+$/.test(String(value || '')) || Number(value) < 1) {
    throw new Error(`A positive PR number is required; got ${value || '(missing)'}`)
  }
  return Number(value)
}

export function assertPullRequestReady(pullRequest) {
  if (pullRequest?.state !== 'OPEN') throw new Error(`PR must be open; got ${pullRequest?.state || '(missing)'}`)
  if (pullRequest?.isDraft) throw new Error('PR must not be a draft')
  if (pullRequest?.baseRefName !== 'main') {
    throw new Error(`PR base must be main; got ${pullRequest?.baseRefName || '(missing)'}`)
  }
  if (!pullRequest?.headRefOid) throw new Error('PR head commit is missing')

  const requiredCheck = (pullRequest.statusCheckRollup || []).find((check) => checkName(check) === REQUIRED_PR_CHECK)
  if (!requiredCheck) throw new Error(`Required check ${REQUIRED_PR_CHECK} is missing`)
  if (checkResult(requiredCheck) !== 'SUCCESS') {
    throw new Error(`Required check ${REQUIRED_PR_CHECK} is not successful; got ${checkResult(requiredCheck) || 'PENDING'}`)
  }
}

export function acquireIntegrationLock(lockPath, {
  prNumber,
  pid = process.pid,
  now = () => new Date().toISOString(),
  createOwnerToken = randomUUID,
  fileSystem = defaultFileSystem,
} = {}) {
  const ownerToken = createOwnerToken()
  const {
    closeSync: close,
    linkSync: link,
    openSync: open,
    readFileSync: read,
    renameSync: rename,
    unlinkSync: unlink,
    writeFileSync: write,
  } = fileSystem
  let descriptor
  let createdLock = false
  try {
    descriptor = open(lockPath, 'wx')
    createdLock = true
    write(descriptor, `${JSON.stringify({ ownerToken, pid, prNumber, acquiredAt: now() })}\n`, 'utf8')
    close(descriptor)
    descriptor = undefined
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        close(descriptor)
      } catch {
        // The original initialization failure remains the actionable error.
      }
    }
    if (createdLock) {
      try {
        unlink(lockPath)
      } catch {
        // A failed cleanup is intentionally left visible through the original error path.
      }
    }
    if (error?.code === 'EEXIST') {
      throw new Error(`A PR integration is already in progress; lock exists at ${lockPath}`)
    }
    throw error
  }

  let released = false
  return () => {
    if (released) return
    const releasePath = `${lockPath}.${ownerToken}.releasing`
    try {
      rename(lockPath, releasePath)
    } catch (error) {
      throw new Error(`Unable to atomically claim PR integration lock at ${lockPath}: ${error?.message || error}`)
    }
    let currentLock
    try {
      currentLock = JSON.parse(read(releasePath, 'utf8'))
    } catch (error) {
      throw new Error(`Unable to verify PR integration lock ownership at ${releasePath}: ${error?.message || error}`)
    }
    if (currentLock?.ownerToken !== ownerToken) {
      try {
        link(releasePath, lockPath)
        unlink(releasePath)
      } catch (restoreError) {
        throw new Error(`PR integration lock ownership changed at ${lockPath}; refusing to release another owner's lock and could not restore it: ${restoreError?.message || restoreError}`)
      }
      throw new Error(`PR integration lock ownership changed at ${lockPath}; refusing to release another owner's lock`)
    }
    unlink(releasePath)
    released = true
  }
}

async function commandOutput(runCommand, command, args, cwd) {
  return String(await runCommand(command, args, { cwd }) || '').trim()
}

export async function integratePullRequest({
  cwd,
  prNumber,
  runCommand,
  acquireLock,
  packageScripts = {},
  platform = process.platform,
  canonicalMainPath = CANONICAL_MAIN_WORKSPACE,
}) {
  const parsedPrNumber = parsePrNumber(prNumber)
  const root = await commandOutput(runCommand, 'git', ['rev-parse', '--show-toplevel'], cwd)
  if (normalizeWorkspacePath(root) !== normalizeWorkspacePath(canonicalMainPath)) {
    throw new Error(`PR integration must run in the canonical main workspace ${canonicalMainPath}; got ${root || cwd}`)
  }

  const branch = await commandOutput(runCommand, 'git', ['branch', '--show-current'], root)
  if (branch !== 'main') throw new Error(`PR integration must run on main; got ${branch || '(detached)'}`)

  const status = await commandOutput(runCommand, 'git', ['status', '--porcelain=v1', '--untracked-files=all'], root)
  if (status) throw new Error(`PR integration requires a clean worktree; changed: ${status.replace(/\r?\n/g, ', ')}`)

  const gitCommonDir = await commandOutput(runCommand, 'git', ['rev-parse', '--git-common-dir'], root)
  const releaseLock = await acquireLock({ root, gitCommonDir, prNumber: parsedPrNumber })

  let primaryError
  try {
    await runCommand('git', ['fetch', 'origin', 'main'], { cwd: root })
    await runCommand('git', ['fetch', 'origin', `pull/${parsedPrNumber}/head`], { cwd: root })
    const prJson = await commandOutput(runCommand, 'gh', [
      'pr',
      'view',
      String(parsedPrNumber),
      '--json',
      'number,state,isDraft,baseRefName,headRefOid,statusCheckRollup,url',
    ], root)
    let pullRequest
    try {
      pullRequest = JSON.parse(prJson)
    } catch (error) {
      throw new Error(`Unable to parse gh pr view output: ${error?.message || error}`)
    }
    assertPullRequestReady(pullRequest)
    try {
      await runCommand('git', ['merge-base', '--is-ancestor', 'origin/main', pullRequest.headRefOid], { cwd: root })
    } catch {
      throw new Error(`PR head ${pullRequest.headRefOid} does not include the latest origin/main; sync and rerun PR CI before integration`)
    }
    try {
      await runCommand('git', ['diff', '--quiet', 'origin/main', pullRequest.headRefOid, '--', '.github/workflows/pr-ci.yml'], { cwd: root })
    } catch {
      throw new Error('PR changes the trusted CI definition .github/workflows/pr-ci.yml; it cannot use its own modified check as an integration gate')
    }

    await runCommand('gh', [
      'pr',
      'merge',
      String(parsedPrNumber),
      '--merge',
      '--match-head-commit',
      pullRequest.headRefOid,
    ], { cwd: root })
    await runCommand('git', ['pull', '--ff-only', 'origin', 'main'], { cwd: root })

    const releasePlanInvoked = Boolean(packageScripts['release:plan'])
    if (releasePlanInvoked) {
      const npmCommand = platform === 'win32' ? 'npm.cmd' : 'npm'
      await runCommand(npmCommand, ['run', 'release:plan', '--', '--mode=main'], { cwd: root })
    }

    return {
      headRefOid: pullRequest.headRefOid,
      prNumber: parsedPrNumber,
      releasePlanInvoked,
      url: pullRequest.url,
    }
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    try {
      await releaseLock()
    } catch (releaseLockError) {
      if (primaryError) recordReleaseLockError(primaryError, releaseLockError)
      else throw releaseLockError
    }
  }
}
