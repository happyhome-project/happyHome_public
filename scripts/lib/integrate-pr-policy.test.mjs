import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  REQUIRED_PR_CHECK,
  acquireIntegrationLock,
  assertPullRequestReady,
  integratePullRequest,
  parsePrNumber,
  resolveSpawnInvocation,
} from './integrate-pr-policy.mjs'

const CANONICAL_MAIN = 'C:\\Project\\Claude\\happyHome'

function readyPullRequest(overrides = {}) {
  return {
    number: 42,
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    headRefOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    statusCheckRollup: [{
      name: 'offline',
      workflowName: 'pr-ci',
      status: 'COMPLETED',
      conclusion: 'SUCCESS',
    }],
    url: 'https://github.com/angrybirddd/happyHome/pull/42',
    ...overrides,
  }
}

function createCommandRunner({ pullRequest = readyPullRequest(), failMerge = false } = {}) {
  const calls = []
  const runCommand = async (command, args, options = {}) => {
    calls.push({ command, args, options })
    const signature = [command, ...args].join(' ')
    if (signature === 'git rev-parse --show-toplevel') return `${CANONICAL_MAIN}\n`
    if (signature === 'git branch --show-current') return 'main\n'
    if (signature === 'git status --porcelain=v1 --untracked-files=all') return ''
    if (signature === 'git rev-parse --git-common-dir') return '.git\n'
    if (signature.startsWith('gh pr view ')) return JSON.stringify(pullRequest)
    if (signature.startsWith('gh pr merge ') && failMerge) throw new Error('merge failed')
    return ''
  }
  return { calls, runCommand }
}

test('required PR check has the stable workflow and job name', () => {
  assert.equal(REQUIRED_PR_CHECK, 'pr-ci / offline')
  assert.doesNotThrow(() => assertPullRequestReady(readyPullRequest()))
})

test('PR readiness rejects closed, draft, and non-main pull requests', () => {
  assert.throws(() => assertPullRequestReady(readyPullRequest({ state: 'MERGED' })), /open/i)
  assert.throws(() => assertPullRequestReady(readyPullRequest({ isDraft: true })), /draft/i)
  assert.throws(() => assertPullRequestReady(readyPullRequest({ baseRefName: 'release' })), /base.*main/i)
})

test('PR readiness requires the exact successful stable check', () => {
  assert.throws(() => assertPullRequestReady(readyPullRequest({ statusCheckRollup: [] })), /pr-ci \/ offline/)
  assert.throws(() => assertPullRequestReady(readyPullRequest({
    statusCheckRollup: [{
      name: 'offline',
      workflowName: 'other-workflow',
      status: 'COMPLETED',
      conclusion: 'SUCCESS',
    }],
  })), /pr-ci \/ offline/)
  assert.throws(() => assertPullRequestReady(readyPullRequest({
    statusCheckRollup: [{
      name: 'offline',
      workflowName: 'pr-ci',
      status: 'IN_PROGRESS',
      conclusion: null,
    }],
  })), /not successful/i)
  assert.throws(() => assertPullRequestReady(readyPullRequest({
    statusCheckRollup: [{
      name: 'offline',
      workflowName: 'pr-ci',
      status: 'COMPLETED',
      conclusion: 'FAILURE',
    }],
  })), /not successful/i)
})

test('PR number parser accepts positive integers only', () => {
  assert.equal(parsePrNumber('42'), 42)
  assert.throws(() => parsePrNumber('0'), /PR number/)
  assert.throws(() => parsePrNumber('42-extra'), /PR number/)
})

test('Windows batch commands are launched through cmd.exe', () => {
  assert.deepEqual(resolveSpawnInvocation(
    'npm.cmd',
    ['run', 'release:plan', '--', '--mode=main'],
    'win32',
  ), {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', 'npm.cmd run release:plan -- --mode=main'],
  })
  assert.deepEqual(resolveSpawnInvocation('git', ['status'], 'win32'), {
    command: 'git',
    args: ['status'],
  })
})

test('integration lock acquisition is atomic and releasable', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'happyhome-integrate-pr-'))
  const lockPath = join(directory, 'integrate.lock')
  t.after(() => rmSync(directory, { recursive: true, force: true }))

  const release = acquireIntegrationLock(lockPath, { prNumber: 42, pid: 123, now: () => '2026-07-10T00:00:00.000Z' })
  assert.equal(existsSync(lockPath), true)
  assert.throws(() => acquireIntegrationLock(lockPath, { prNumber: 43 }), /already in progress/i)

  release()
  assert.equal(existsSync(lockPath), false)
  assert.doesNotThrow(() => {
    const releaseAgain = acquireIntegrationLock(lockPath, { prNumber: 43 })
    releaseAgain()
  })
})

test('integration validates, merges the checked head, pulls main, and plans release when available', async () => {
  const { calls, runCommand } = createCommandRunner()
  const lockEvents = []

  const result = await integratePullRequest({
    cwd: CANONICAL_MAIN,
    prNumber: 42,
    runCommand,
    acquireLock: async (details) => {
      lockEvents.push({ type: 'acquire', details })
      return async () => lockEvents.push({ type: 'release' })
    },
    packageScripts: { 'release:plan': 'node scripts/release-plan.mjs' },
    platform: 'win32',
    canonicalMainPath: CANONICAL_MAIN,
  })

  assert.deepEqual(result, {
    headRefOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    prNumber: 42,
    releasePlanInvoked: true,
    url: 'https://github.com/angrybirddd/happyHome/pull/42',
  })
  assert.deepEqual(lockEvents.map((event) => event.type), ['acquire', 'release'])
  assert.deepEqual(calls.map(({ command, args }) => [command, ...args]), [
    ['git', 'rev-parse', '--show-toplevel'],
    ['git', 'branch', '--show-current'],
    ['git', 'status', '--porcelain=v1', '--untracked-files=all'],
    ['git', 'rev-parse', '--git-common-dir'],
    ['gh', 'pr', 'view', '42', '--json', 'number,state,isDraft,baseRefName,headRefOid,statusCheckRollup,url'],
    ['gh', 'pr', 'merge', '42', '--merge', '--match-head-commit', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    ['git', 'pull', '--ff-only', 'origin', 'main'],
    ['npm.cmd', 'run', 'release:plan', '--', '--mode=main'],
  ])
})

test('integration skips release planning when the package script is absent', async () => {
  const { calls, runCommand } = createCommandRunner()

  const result = await integratePullRequest({
    cwd: CANONICAL_MAIN,
    prNumber: 42,
    runCommand,
    acquireLock: async () => async () => {},
    packageScripts: {},
    platform: 'win32',
    canonicalMainPath: CANONICAL_MAIN,
  })

  assert.equal(result.releasePlanInvoked, false)
  assert.equal(calls.some(({ command }) => command === 'npm.cmd'), false)
})

test('integration rejects non-canonical, non-main, and dirty workspaces before GitHub calls', async () => {
  for (const [signature, output, expected] of [
    ['git rev-parse --show-toplevel', 'X:\\worktrees\\happyHome\n', /canonical/i],
    ['git branch --show-current', 'codex/topic\n', /main/i],
    ['git status --porcelain=v1 --untracked-files=all', ' M package.json\n', /clean/i],
  ]) {
    const { calls, runCommand: baseRunner } = createCommandRunner()
    const runCommand = async (command, args, options) => {
      if ([command, ...args].join(' ') === signature) return output
      return baseRunner(command, args, options)
    }

    await assert.rejects(() => integratePullRequest({
      cwd: CANONICAL_MAIN,
      prNumber: 42,
      runCommand,
      acquireLock: async () => async () => {},
      packageScripts: {},
      canonicalMainPath: CANONICAL_MAIN,
    }), expected)
    assert.equal(calls.some(({ command }) => command === 'gh'), false)
  }
})

test('integration releases its lock when merge fails', async () => {
  const { runCommand } = createCommandRunner({ failMerge: true })
  let released = false

  await assert.rejects(() => integratePullRequest({
    cwd: CANONICAL_MAIN,
    prNumber: 42,
    runCommand,
    acquireLock: async () => async () => { released = true },
    packageScripts: {},
    canonicalMainPath: CANONICAL_MAIN,
  }), /merge failed/)

  assert.equal(released, true)
})
