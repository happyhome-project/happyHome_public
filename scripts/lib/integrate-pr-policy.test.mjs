import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  REQUIRED_PR_CHECK,
  acquireIntegrationLock,
  assertPullRequestReady,
  getReleaseLockError,
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

function createCommandRunner({ pullRequest = readyPullRequest(), failMerge = false, mergeError = new Error('merge failed') } = {}) {
  const calls = []
  const runCommand = async (command, args, options = {}) => {
    calls.push({ command, args, options })
    const signature = [command, ...args].join(' ')
    if (signature === 'git rev-parse --show-toplevel') return `${CANONICAL_MAIN}\n`
    if (signature === 'git branch --show-current') return 'main\n'
    if (signature === 'git status --porcelain=v1 --untracked-files=all') return ''
    if (signature === 'git rev-parse --git-common-dir') return '.git\n'
    if (signature === 'git fetch origin main') return ''
    if (signature === 'git fetch origin pull/42/head') return ''
    if (signature === `git merge-base --is-ancestor origin/main ${pullRequest.headRefOid}`) return ''
    if (signature.startsWith('gh pr view ')) return JSON.stringify(pullRequest)
    if (signature.startsWith('gh pr merge ') && failMerge) throw mergeError
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

test('integration lock cannot release a lock replaced by another owner', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'happyhome-integrate-pr-'))
  const lockPath = join(directory, 'integrate.lock')
  t.after(() => rmSync(directory, { recursive: true, force: true }))

  const release = acquireIntegrationLock(lockPath, {
    prNumber: 42,
    pid: 123,
    now: () => '2026-07-10T00:00:00.000Z',
    createOwnerToken: () => 'first-owner',
  })
  writeFileSync(lockPath, `${JSON.stringify({ ownerToken: 'second-owner' })}\n`, 'utf8')

  assert.throws(() => release(), /owner/i)
  assert.equal(existsSync(lockPath), true)
})

test('integration lock release preserves a lock reacquired after it claims the old lock', () => {
  const lockPath = 'in-memory.lock'
  const files = new Map()
  const secondOwner = JSON.stringify({ ownerToken: 'second-owner' })
  const fileSystem = {
    closeSync() {},
    openSync(path) {
      if (files.has(path)) {
        const error = new Error('exists')
        error.code = 'EEXIST'
        throw error
      }
      files.set(path, '')
      return path
    },
    readFileSync(path) {
      if (path === lockPath) {
        const previous = files.get(path)
        files.set(path, secondOwner)
        return previous
      }
      return files.get(path)
    },
    renameSync(from, to) {
      const previous = files.get(from)
      files.delete(from)
      files.set(to, previous)
      files.set(lockPath, secondOwner)
    },
    unlinkSync(path) { files.delete(path) },
    writeFileSync(path, content) { files.set(path, content) },
  }
  const release = acquireIntegrationLock(lockPath, {
    prNumber: 42,
    createOwnerToken: () => 'first-owner',
    fileSystem,
  })

  release()
  assert.equal(files.get(lockPath), secondOwner)
})

test('integration lock release never overwrites a new lock while restoring an owner mismatch', () => {
  const lockPath = 'in-memory.lock'
  const files = new Map()
  const replacementLock = JSON.stringify({ ownerToken: 'replacement-owner' })
  const foreignLock = JSON.stringify({ ownerToken: 'foreign-owner' })
  const fileSystem = {
    closeSync() {},
    linkSync(from, to) {
      if (files.has(to)) {
        const error = new Error('exists')
        error.code = 'EEXIST'
        throw error
      }
      files.set(to, files.get(from))
    },
    openSync(path) { files.set(path, ''); return path },
    readFileSync(path) { return files.get(path) },
    renameSync(from, to) {
      files.set(from, foreignLock)
      files.set(to, files.get(from))
      files.delete(from)
      files.set(lockPath, replacementLock)
    },
    unlinkSync(path) { files.delete(path) },
    writeFileSync(path, content) { files.set(path, content) },
  }
  const release = acquireIntegrationLock(lockPath, {
    prNumber: 42,
    createOwnerToken: () => 'first-owner',
    fileSystem,
  })

  assert.throws(() => release(), /could not restore/i)
  assert.equal(files.get(lockPath), replacementLock)
})

test('integration lock cleans up its own file when initialization fails', () => {
  let removed = false

  assert.throws(() => acquireIntegrationLock('in-memory.lock', {
    prNumber: 42,
    fileSystem: {
      closeSync() {},
      openSync() { return 1 },
      readFileSync() { return '' },
      unlinkSync() { removed = true },
      writeFileSync() { throw new Error('disk full') },
    },
  }), /disk full/i)
  assert.equal(removed, true)
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
    ['git', 'fetch', 'origin', 'main'],
    ['git', 'fetch', 'origin', 'pull/42/head'],
    ['gh', 'pr', 'view', '42', '--json', 'number,state,isDraft,baseRefName,headRefOid,statusCheckRollup,url'],
    ['git', 'merge-base', '--is-ancestor', 'origin/main', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    ['git', 'diff', '--quiet', 'origin/main', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '--', '.github/workflows/pr-ci.yml'],
    ['gh', 'pr', 'merge', '42', '--merge', '--match-head-commit', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    ['git', 'pull', '--ff-only', 'origin', 'main'],
    ['npm.cmd', 'run', 'release:plan', '--', '--mode=main'],
  ])
})

test('integration rejects a PR that changes the trusted CI definition', async () => {
  const { calls, runCommand: baseRunner } = createCommandRunner()
  const runCommand = async (command, args, options) => {
    if ([command, ...args].join(' ') === 'git diff --quiet origin/main aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -- .github/workflows/pr-ci.yml') {
      throw new Error('files differ')
    }
    return baseRunner(command, args, options)
  }

  await assert.rejects(() => integratePullRequest({
    cwd: CANONICAL_MAIN,
    prNumber: 42,
    runCommand,
    acquireLock: async () => async () => {},
    packageScripts: {},
    canonicalMainPath: CANONICAL_MAIN,
  }), /trusted CI definition/i)
  assert.equal(calls.some(({ command, args }) => command === 'gh' && args[1] === 'merge'), false)
})

test('integration rejects a PR head that is behind the fetched main branch', async () => {
  const { calls, runCommand: baseRunner } = createCommandRunner()
  const runCommand = async (command, args, options) => {
    if ([command, ...args].join(' ') === 'git merge-base --is-ancestor origin/main aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') {
      throw new Error('not an ancestor')
    }
    return baseRunner(command, args, options)
  }

  await assert.rejects(() => integratePullRequest({
    cwd: CANONICAL_MAIN,
    prNumber: 42,
    runCommand,
    acquireLock: async () => async () => {},
    packageScripts: {},
    canonicalMainPath: CANONICAL_MAIN,
  }), /latest origin\/main/i)
  assert.equal(calls.some(({ command, args }) => command === 'gh' && args[1] === 'merge'), false)
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

test('integration retains the merge error when lock release also fails', async () => {
  const { runCommand } = createCommandRunner({ failMerge: true })

  await assert.rejects(() => integratePullRequest({
    cwd: CANONICAL_MAIN,
    prNumber: 42,
    runCommand,
    acquireLock: async () => async () => { throw new Error('release lock failed') },
    packageScripts: {},
    canonicalMainPath: CANONICAL_MAIN,
  }), (error) => {
    assert.match(error.message, /merge failed/)
    assert.match(error.releaseLockError.message, /release lock failed/)
    return true
  })
})

test('integration retains a frozen merge error when lock release also fails', async () => {
  const mergeError = Object.freeze(new Error('merge failed'))
  const { runCommand } = createCommandRunner({ failMerge: true, mergeError })

  await assert.rejects(() => integratePullRequest({
    cwd: CANONICAL_MAIN,
    prNumber: 42,
    runCommand,
    acquireLock: async () => async () => { throw new Error('release lock failed') },
    packageScripts: {},
    canonicalMainPath: CANONICAL_MAIN,
  }), (error) => {
    assert.equal(error, mergeError)
    assert.match(error.message, /merge failed/)
    assert.match(getReleaseLockError(error).message, /release lock failed/)
    return true
  })
})
