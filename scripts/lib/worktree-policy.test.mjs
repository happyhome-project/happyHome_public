import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  assertHooksPathConfigured,
  assertPrePushAllowed,
  assertWorktreePolicy,
  formatWorktreeReport,
  parseDivergence,
  parsePrePushUpdates,
} from './worktree-policy.mjs'

const CANONICAL_MAIN = 'C:\\Project\\Claude\\happyHome'

test('worktree policy requires the repository AGENTS.md', () => {
  assert.throws(() => assertWorktreePolicy({
    agentsExists: false,
    branch: 'codex/example',
    cwd: 'X:\\worktrees\\example\\happyHome',
    canonicalMainPath: CANONICAL_MAIN,
  }), /AGENTS\.md/)
})

test('worktree policy rejects a symbolic-link AGENTS.md', () => {
  assert.throws(() => assertWorktreePolicy({
    agentsExists: true,
    agentsIsSymbolicLink: true,
    branch: 'codex/example',
    cwd: 'X:\\worktrees\\example\\happyHome',
    canonicalMainPath: CANONICAL_MAIN,
  }), /symbolic link/i)
})

test('worktree policy allows main only in the canonical workspace', () => {
  assert.doesNotThrow(() => assertWorktreePolicy({
    agentsExists: true,
    branch: 'main',
    cwd: 'c:/PROJECT/Claude/happyHome/',
    canonicalMainPath: CANONICAL_MAIN,
  }))
  assert.doesNotThrow(() => assertWorktreePolicy({
    agentsExists: true,
    branch: 'codex/example',
    cwd: 'X:\\worktrees\\example\\happyHome',
    canonicalMainPath: CANONICAL_MAIN,
  }))
  assert.throws(() => assertWorktreePolicy({
    agentsExists: true,
    branch: 'main',
    cwd: 'X:\\worktrees\\example\\happyHome',
    canonicalMainPath: CANONICAL_MAIN,
  }), /canonical.*C:\\Project\\Claude\\happyHome/i)
})

test('divergence parser requires and labels git left-right counts', () => {
  assert.deepEqual(parseDivergence('3\t2\n'), { behind: 3, ahead: 2 })
  assert.throws(() => parseDivergence('unknown'), /divergence/i)
})

test('worktree report includes cwd, branch, HEAD, and divergence', () => {
  assert.equal(formatWorktreeReport({
    cwd: 'X:\\worktrees\\example\\happyHome',
    branch: 'codex/example',
    head: 'abcdef123456',
    behind: 3,
    ahead: 2,
  }), '[worktree-preflight] cwd=X:\\worktrees\\example\\happyHome branch=codex/example HEAD=abcdef123456 divergence=behind=3 ahead=2')
})

test('pre-push parser reads all ref update fields', () => {
  const updates = parsePrePushUpdates([
    'refs/heads/codex/example aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/codex/example bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'refs/tags/v1 cccccccccccccccccccccccccccccccccccccccc refs/tags/v1 0000000000000000000000000000000000000000',
  ].join('\n'))

  assert.deepEqual(updates, [
    {
      localRef: 'refs/heads/codex/example',
      localSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      remoteRef: 'refs/heads/codex/example',
      remoteSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
    {
      localRef: 'refs/tags/v1',
      localSha: 'cccccccccccccccccccccccccccccccccccccccc',
      remoteRef: 'refs/tags/v1',
      remoteSha: '0000000000000000000000000000000000000000',
    },
  ])
})

test('pre-push policy rejects every update targeting main, including deletion', () => {
  assert.throws(() => assertPrePushAllowed(
    'refs/heads/topic aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/main bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n',
  ), /refs\/heads\/main/)
  assert.throws(() => assertPrePushAllowed(
    '(delete) 0000000000000000000000000000000000000000 refs/heads/main bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n',
  ), /refs\/heads\/main/)
})

test('pre-push policy permits non-main branches and tags', () => {
  assert.doesNotThrow(() => assertPrePushAllowed([
    'refs/heads/topic aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/topic bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'refs/tags/v1 cccccccccccccccccccccccccccccccccccccccc refs/tags/v1 0000000000000000000000000000000000000000',
  ].join('\n')))
})

test('pre-push parser rejects malformed hook input', () => {
  assert.throws(() => parsePrePushUpdates('refs/heads/topic only-two-fields\n'), /Malformed pre-push update/)
})

test('hooks path verification requires the repository-managed path', () => {
  assert.doesNotThrow(() => assertHooksPathConfigured('.githooks\n'))
  assert.throws(() => assertHooksPathConfigured('.git/hooks'), /core\.hooksPath/)
})

test('PR CI checks pull requests and merge groups at their exact heads', () => {
  const workflowPath = fileURLToPath(new URL('../../.github/workflows/pr-ci.yml', import.meta.url))
  const workflow = readFileSync(workflowPath, 'utf8')

  assert.match(workflow, /^name:\s*pr-ci\s*$/m)
  assert.match(workflow, /^\s+pull_request:\s*$/m)
  assert.match(workflow, /^\s+merge_group:\s*$/m)
  assert.match(workflow, /offline:\s*\r?\n\s*name:\s*offline/)
  assert.match(workflow, /runs-on:\s*windows-latest/)
  assert.match(workflow, /ref:\s*\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.event\.merge_group\.head_sha \}\}/)
  assert.match(workflow, /fetch-depth:\s*0/)
  assert.match(workflow, /git diff --check \$\{\{ github\.event\.pull_request\.base\.sha \}\} \$\{\{ github\.event\.pull_request\.head\.sha \}\}/)
  assert.match(workflow, /git diff --check \$\{\{ github\.event\.merge_group\.base_sha \}\} \$\{\{ github\.event\.merge_group\.head_sha \}\}/)
  assert.match(workflow, /scripts\['release:plan'\]/)
  assert.doesNotMatch(workflow, /\n\s+fi\s*$/m)
  assert.match(workflow, /release:plan is not installed yet; skipping PR release-plan generation[\s\S]*exit 0/)
})
