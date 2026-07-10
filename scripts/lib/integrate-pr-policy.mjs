import {
  closeSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'

import { CANONICAL_MAIN_WORKSPACE } from './worktree-policy.mjs'

export const REQUIRED_PR_CHECK = 'pr-ci / offline'

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
} = {}) {
  let descriptor
  try {
    descriptor = openSync(lockPath, 'wx')
    writeFileSync(descriptor, `${JSON.stringify({ pid, prNumber, acquiredAt: now() })}\n`, 'utf8')
    closeSync(descriptor)
    descriptor = undefined
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor)
    if (error?.code === 'EEXIST') {
      throw new Error(`A PR integration is already in progress; lock exists at ${lockPath}`)
    }
    throw error
  }

  let released = false
  return () => {
    if (released) return
    released = true
    unlinkSync(lockPath)
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

  try {
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
  } finally {
    await releaseLock()
  }
}
