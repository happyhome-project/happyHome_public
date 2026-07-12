import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { acquireIntegrationLock } from './integrate-pr-policy.mjs'

import {
  assessPublicIntegrationMain,
  assessRetirementTargetBoundary,
  collectPinnedRetirementEvidence,
  confirmNoOwner,
  classifyWorktreeRetirement,
  createRetirementManifest,
  createRetirementRecord,
  createWorktreePlan,
  decideSync,
  evaluateLeaseOwner,
  evaluateRetirement,
  executeHeartbeatCriticalSection,
  executeRetirementCriticalSection,
  executePinnedWorktreeCreation,
  findOpenPullRequest,
  githubRepositoryFromRemote,
  interpretAncestorExitStatus,
  normalizeExternalCommandResult,
  validateOpenPullRequestInventory,
  verifiedPublicOriginUrl,
  verifyCreateTargetBoundary,
  verifyRetirementManifest,
} from './worktree-lifecycle.mjs'

function publicIntegrationInput(overrides = {}) {
  return {
    root: 'X:/worktrees/public-main/happyHome',
    commonDirectory: 'X:/git/public-candidate.git',
    repository: 'happyhome-project/happyHome_public',
    branch: 'main',
    head: 'a'.repeat(40),
    main: 'a'.repeat(40),
    behind: 0,
    ahead: 0,
    isDirty: false,
    hasOperation: false,
    pathIsReparsePoint: false,
    ...overrides,
  }
}

test('only a clean synchronized public main is a worktree integration operator', () => {
  assert.deepEqual(assessPublicIntegrationMain(publicIntegrationInput()), {
    eligible: true,
    reasons: [],
  })
})

test('private, unknown, and non-GitHub origins cannot operate public worktrees', () => {
  for (const repository of ['angrybirddd/happyHome', null, 'file:///x/public.git']) {
    const result = assessPublicIntegrationMain(publicIntegrationInput({ repository }))
    assert.equal(result.eligible, false)
    assert.ok(result.reasons.includes('untrusted_origin'))
  }
})

test('feature, dirty, stale, divergent, operation, and reparse operators fail closed', () => {
  const cases = [
    [{ branch: 'codex/task' }, 'not_main_branch'],
    [{ isDirty: true }, 'dirty'],
    [{ head: 'b'.repeat(40) }, 'head_not_origin_main'],
    [{ behind: 1 }, 'diverged_from_origin_main'],
    [{ ahead: 1 }, 'diverged_from_origin_main'],
    [{ hasOperation: true }, 'git_operation'],
    [{ pathIsReparsePoint: true }, 'reparse_point'],
  ]
  for (const [override, reason] of cases) {
    const result = assessPublicIntegrationMain(publicIntegrationInput(override))
    assert.equal(result.eligible, false, JSON.stringify(override))
    assert.ok(result.reasons.includes(reason), JSON.stringify(result))
  }
})

test('a mutation-time operator must match the refreshed root, common dir, and main identity', () => {
  const expected = publicIntegrationInput()
  assert.equal(assessPublicIntegrationMain(publicIntegrationInput({ expected })).eligible, true)
  for (const override of [
    { root: 'X:/worktrees/other/happyHome' },
    { commonDirectory: 'X:/git/private.git' },
    { head: 'b'.repeat(40), main: 'b'.repeat(40) },
  ]) {
    const result = assessPublicIntegrationMain(publicIntegrationInput({ ...override, expected }))
    assert.equal(result.eligible, false)
    assert.ok(result.reasons.includes('operator_changed'), JSON.stringify(result))
  }
})

test('worktree creation pins add and verification to one immutable main SHA across ref drift', () => {
  const first = 'a'.repeat(40)
  const second = 'b'.repeat(40)
  let mutableOriginMain = first
  const events = []
  const created = executePinnedWorktreeCreation({
    operator: { root: 'X:/public-main', main: first },
    branch: 'codex/new-task',
    path: 'X:/worktrees/new-task',
    addWorktree: ({ root, branch, path, startPoint }) => {
      events.push({ root, branch, path, startPoint })
      mutableOriginMain = second
    },
    readCreated: (path, mainSha) => ({
      root: path,
      branch: 'codex/new-task',
      head: first,
      main: mainSha,
      observedMutableOriginMain: mutableOriginMain,
    }),
  })
  assert.equal(events[0].startPoint, first)
  assert.equal(created.main, first)
  assert.equal(created.observedMutableOriginMain, second)
})

test('retirement evidence uses one immutable main SHA after origin/main moves', () => {
  const first = 'a'.repeat(40)
  const second = 'b'.repeat(40)
  const originalHead = 'c'.repeat(40)
  const movedHead = 'd'.repeat(40)
  let mutableOriginMain = first
  let mutableTargetHead = originalHead
  const revisions = []
  const evidence = collectPinnedRetirementEvidence({
    mainSha: first,
    readIdentity: (mainSha) => {
      revisions.push({ mainSha })
      mutableOriginMain = second
      mutableTargetHead = movedHead
      return { head: originalHead, main: mainSha }
    },
    readUniqueCommitCount: (headSha, mainSha) => {
      revisions.push({ headSha, mainSha })
      return 0
    },
    readHeadInMain: (headSha, mainSha) => {
      revisions.push({ headSha, mainSha })
      return true
    },
  })
  assert.deepEqual(revisions, [
    { mainSha: first },
    { headSha: originalHead, mainSha: first },
    { headSha: originalHead, mainSha: first },
  ])
  assert.deepEqual(evidence, {
    identity: { head: originalHead, main: first },
    uniqueCommits: 0,
    headInMain: true,
  })
  assert.equal(mutableOriginMain, second)
  assert.equal(mutableTargetHead, movedHead)
})

test('verified public origin URL stays pinned when origin config drifts before fetch', () => {
  let configuredOrigin = 'git@github.com:happyhome-project/happyHome_public.git'
  const captured = verifiedPublicOriginUrl(configuredOrigin)
  configuredOrigin = 'git@github.com:angrybirddd/happyHome.git'
  assert.equal(captured, 'git@github.com:happyhome-project/happyHome_public.git')
  assert.notEqual(captured, configuredOrigin)
  assert.throws(() => verifiedPublicOriginUrl(configuredOrigin), /untrusted origin/i)
})

test('retirement target boundary requires same real common dir and no reparse ancestor', () => {
  assert.deepEqual(assessRetirementTargetBoundary({
    registered: true,
    operatorCommonDirectory: 'x:/git/public.git',
    targetCommonDirectory: 'x:/git/public.git',
    hasReparseAncestor: false,
  }), { eligible: true, reasons: [] })
  assert.deepEqual(assessRetirementTargetBoundary({
    registered: true,
    operatorCommonDirectory: 'x:/git/public.git',
    targetCommonDirectory: 'x:/git/other.git',
    hasReparseAncestor: false,
  }), { eligible: false, reasons: ['common_directory_mismatch'] })
  assert.deepEqual(assessRetirementTargetBoundary({
    registered: true,
    operatorCommonDirectory: 'x:/git/public.git',
    targetCommonDirectory: 'x:/git/public.git',
    hasReparseAncestor: true,
  }), { eligible: false, reasons: ['reparse_ancestor'] })
})

test('pinned worktree operations reject symbolic refs instead of resolving them later', () => {
  assert.throws(() => executePinnedWorktreeCreation({
    operator: { root: 'X:/public-main', main: 'origin/main' },
    branch: 'codex/new-task',
    path: 'X:/worktrees/new-task',
    addWorktree: () => {},
    readCreated: () => ({}),
  }), /exact main SHA/i)
  assert.throws(() => collectPinnedRetirementEvidence({
    mainSha: 'origin/main',
    readIdentity: () => ({}),
    readUniqueCommitCount: () => 0,
    readHeadInMain: () => true,
  }), /exact main SHA/i)
})

test('allow-failure external command timeouts become failed evidence instead of throwing', () => {
  const timeout = Object.assign(new Error('spawnSync git ETIMEDOUT'), { code: 'ETIMEDOUT' })
  assert.deepEqual(normalizeExternalCommandResult({
    error: timeout,
    status: null,
    stdout: '',
    stderr: '',
  }, { allowFailure: true }), {
    ok: false,
    status: null,
    stdout: '',
    stderr: 'spawnSync git ETIMEDOUT',
  })
  assert.throws(() => normalizeExternalCommandResult({
    error: timeout,
    status: null,
    stdout: '',
    stderr: '',
  }), /ETIMEDOUT/)
})

test('worktree operator source has no private canonical cwd or local branch deletion path', () => {
  const source = readFileSync(fileURLToPath(new URL('../worktree.mjs', import.meta.url)), 'utf8')
  assert.equal(source.includes('C:\\\\Project\\\\Claude\\\\happyHome'), false)
  assert.equal(source.includes("git(['branch', '-d'"), false)
  assert.match(source, /delete-merged-local-branch[\s\S]*?is disabled/)
})

test('operator trust is checked before fetch and network evidence stays outside locks', () => {
  const source = readFileSync(fileURLToPath(new URL('../worktree.mjs', import.meta.url)), 'utf8')
  const operatorBody = source.match(/function publicIntegrationOperator[\s\S]*?\r?\n}\r?\n\r?\nfunction runNpmCi/)?.[0] || ''
  assert.ok(operatorBody.indexOf("remote', 'get-url', 'origin") < operatorBody.indexOf('refreshOriginMain(cwd,'))
  assert.match(operatorBody, /refreshOriginMain\(cwd, \{ remoteUrl: verifiedOriginUrl \}\)/)

  const createBody = source.match(/function create\([\s\S]*?\r?\n}\r?\n\r?\nfunction sync/)?.[0] || ''
  const createLock = createBody.match(/withRegistryLock\([\s\S]*?\r?\n  }\)/)?.[0] || ''
  assert.match(createBody, /publicIntegrationOperator\('worktree:create', \{ refresh: true, expected: identity \}\)[\s\S]*?withRegistryLock/)
  assert.equal(createLock.includes('refresh: true'), false)
  assert.equal(createLock.includes('openPullRequestInventory'), false)
  assert.match(createLock, /executePinnedWorktreeCreation/)

  const retireBody = source.match(/function retire\([\s\S]*?\r?\n}\r?\n\r?\nfunction status/)?.[0] || ''
  const retirementCriticalSection = retireBody.match(/executeRetirementCriticalSection\([\s\S]*?\r?\n  }\)/)?.[0] || ''
  assert.match(retireBody, /openPullRequestInventory[\s\S]*?executeRetirementCriticalSection/)
  assert.match(retireBody, /openPullRequestInventory\([^)]*\{ repository: 'happyhome-project\/happyHome_public' \}\)/)
  assert.equal(retirementCriticalSection.includes('refresh: true'), false)
  assert.equal(retirementCriticalSection.includes('openPullRequestInventory'), false)
  assert.match(retirementCriticalSection, /mainSha: liveOperator\.main/)
  assert.equal(retirementCriticalSection.includes('currentIdentity(manifest.path)'), false)
  assert.match(retirementCriticalSection, /remove: \([\s\S]*?retirementProbe\([\s\S]*?verifyRetirementManifest\([\s\S]*?decision\.eligible[\s\S]*?git\(\['worktree', 'remove'/)
  assert.match(retireBody, /registryDir\(operator\.root\)/)
  assert.equal(retireBody.includes('registryDir(probe.identity.root)'), false)
  assert.match(retireBody, /assertRetirementTargetBoundary[\s\S]*?openPullRequestInventory/)
  assert.match(retireBody, /withRegistryLock\(operator\.root[\s\S]*?assertRetirementTargetBoundary\(path,[\s\S]*?writeFileSync/)
})

test('git and gh calls are bounded and disable interactive credential prompts', () => {
  const source = readFileSync(fileURLToPath(new URL('../worktree.mjs', import.meta.url)), 'utf8')
  assert.match(source, /GIT_TERMINAL_PROMPT: '0'/)
  assert.match(source, /GH_PROMPT_DISABLED: '1'/)
  assert.match(source, /function git\(args,[\s\S]{0,150}timeout = null/)
  assert.equal(source.includes('const GIT_TIMEOUT_MS'), false)
  assert.match(source, /function refreshOriginMain[\s\S]*?timeout: NETWORK_TIMEOUT_MS/)
  assert.match(source, /spawnSync\('gh',[\s\S]*?timeout:/)
  assert.match(source, /git\(\['worktree', 'add'[\s\S]*?\{ cwd: root \}\)/)
  assert.match(source, /git\(\['worktree', 'remove', manifest\.path\]\)/)
})

test('GitHub repository identity is derived from common remote URL forms', () => {
  assert.equal(githubRepositoryFromRemote('git@github.com:happyhome-project/happyHome_public.git'), 'happyhome-project/happyHome_public')
  assert.equal(githubRepositoryFromRemote('https://github.com/happyhome-project/happyHome_public.git'), 'happyhome-project/happyHome_public')
  assert.equal(githubRepositoryFromRemote('ssh://git@github.com/happyhome-project/happyHome_public.git'), 'happyhome-project/happyHome_public')
  assert.equal(githubRepositoryFromRemote('X:/local/public-candidate.git'), null)
})

test('one open-PR inventory is matched by branch or exact head without inventing metadata', () => {
  const pulls = [
    { number: 8, url: 'https://github.test/pr/8', headRefName: 'codex/eight', headRefOid: 'a'.repeat(40) },
  ]
  assert.deepEqual(findOpenPullRequest(pulls, { branch: 'codex/eight', head: 'b'.repeat(40) }), {
    known: true, open: true, number: 8, url: 'https://github.test/pr/8', error: null,
  })
  assert.deepEqual(findOpenPullRequest(pulls, { branch: '(detached)', head: 'a'.repeat(40) }), {
    known: true, open: true, number: 8, url: 'https://github.test/pr/8', error: null,
  })
  assert.deepEqual(findOpenPullRequest(pulls, { branch: 'codex/none', head: 'c'.repeat(40) }), {
    known: true, open: false, number: null, url: null, error: null,
  })
  assert.deepEqual(findOpenPullRequest(null, { branch: 'codex/eight', head: 'a'.repeat(40) }, { error: 'gh unavailable' }), {
    known: false, open: null, number: null, url: null, error: 'gh unavailable',
  })
})

test('git ancestor exit errors stay unknown instead of becoming false', () => {
  assert.equal(interpretAncestorExitStatus(0), true)
  assert.equal(interpretAncestorExitStatus(1), false)
  assert.equal(interpretAncestorExitStatus(128), null)
  assert.equal(interpretAncestorExitStatus(null), null)
})

test('a potentially truncated open-PR inventory fails closed', () => {
  assert.deepEqual(validateOpenPullRequestInventory([{ number: 1 }], 2), {
    pulls: [{ number: 1 }], error: null,
  })
  assert.deepEqual(validateOpenPullRequestInventory([{ number: 1 }, { number: 2 }], 2), {
    pulls: null, error: 'open PR inventory may be truncated at 2 entries',
  })
  assert.deepEqual(validateOpenPullRequestInventory({}, 2), {
    pulls: null, error: 'gh returned a non-array open PR inventory',
  })
})

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr}`)
  return String(result.stdout || '').trim()
}

test('status keeps local inventory and fails closed when origin/main refresh fails', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'happyhome-status-fetch-'))
  const repo = join(directory, 'repo')
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  run('git', ['init', '-b', 'main', repo], directory)
  run('git', ['config', 'user.name', 'Test'], repo)
  run('git', ['config', 'user.email', 'test@example.invalid'], repo)
  run('git', ['commit', '--allow-empty', '-m', 'initial'], repo)
  run('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], repo)
  run('git', ['remote', 'add', 'origin', join(directory, 'missing.git')], repo)

  const scriptPath = fileURLToPath(new URL('../worktree.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [scriptPath, 'status'], { cwd: repo, encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 1)
  const output = JSON.parse(result.stdout)
  assert.equal(output.status, 'stale')
  assert.equal(output.refresh.ok, false)
  assert.equal(output.entries.length, 1)
  assert.equal(output.entries[0].kind, 'worktree')
  assert.equal(output.entries[0].retirement.classification, 'blocked')
  assert.equal(output.entries[0].retirement.checks.headInMain.known, false)
  assert.ok(output.entries[0].retirement.reasons.includes('head_in_main_unknown'))
  assert.ok(output.entries[0].retirement.reasons.includes('unique_commits_unknown'))
  assert.ok(output.entries[0].retirement.reasons.includes('main_branch'))
})

test('status refreshes origin/main to the exact remote main across advance and forced rewind', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'happyhome-status-refresh-'))
  const remote = join(directory, 'remote.git')
  const source = join(directory, 'source')
  const observer = join(directory, 'observer')
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  run('git', ['init', '--bare', remote], directory)
  run('git', ['init', '-b', 'main', source], directory)
  run('git', ['config', 'user.name', 'Test'], source)
  run('git', ['config', 'user.email', 'test@example.invalid'], source)
  run('git', ['commit', '--allow-empty', '-m', 'first'], source)
  const first = run('git', ['rev-parse', 'HEAD'], source)
  run('git', ['remote', 'add', 'origin', remote], source)
  run('git', ['push', '-u', 'origin', 'main'], source)
  run('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], remote)
  run('git', ['clone', remote, observer], directory)
  run('git', ['config', '--unset-all', 'remote.origin.fetch'], observer)

  run('git', ['commit', '--allow-empty', '-m', 'second'], source)
  const second = run('git', ['rev-parse', 'HEAD'], source)
  run('git', ['push', 'origin', 'main'], source)
  assert.equal(run('git', ['rev-parse', 'origin/main'], observer), first)

  const scriptPath = fileURLToPath(new URL('../worktree.mjs', import.meta.url))
  let result = spawnSync(process.execPath, [scriptPath, 'status'], { cwd: observer, encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  let output = JSON.parse(result.stdout)
  assert.equal(run('git', ['rev-parse', 'origin/main'], observer), second)
  let observerEntries = output.entries.filter((entry) => entry.kind === 'worktree' && entry.branch === 'main')
  assert.equal(observerEntries.length, 1)
  assert.equal(observerEntries[0].identity.main, second)

  run('git', ['reset', '--hard', first], source)
  run('git', ['push', '--force', 'origin', 'main'], source)
  result = spawnSync(process.execPath, [scriptPath, 'status'], { cwd: observer, encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  output = JSON.parse(result.stdout)
  assert.equal(run('git', ['rev-parse', 'origin/main'], observer), first)
  observerEntries = output.entries.filter((entry) => entry.kind === 'worktree' && entry.branch === 'main')
  assert.equal(observerEntries.length, 1)
  assert.equal(observerEntries[0].identity.main, first)
})

test('status identifies a common bare Git directory without fabricated worktree evidence', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'happyhome-status-bare-'))
  const source = join(directory, 'source')
  const bare = join(directory, 'common.git')
  const linked = join(directory, 'linked')
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  run('git', ['init', '-b', 'main', source], directory)
  run('git', ['config', 'user.name', 'Test'], source)
  run('git', ['config', 'user.email', 'test@example.invalid'], source)
  run('git', ['commit', '--allow-empty', '-m', 'initial'], source)
  run('git', ['clone', '--bare', source, bare], directory)
  run('git', ['--git-dir', bare, 'worktree', 'add', linked, 'main'], directory)

  const scriptPath = fileURLToPath(new URL('../worktree.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [scriptPath, 'status'], { cwd: linked, encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  const bareEntries = output.entries.filter((candidate) => candidate.kind === 'bare')
  assert.equal(bareEntries.length, 1)
  const [entry] = bareEntries
  assert.equal(entry.kind, 'bare')
  assert.equal(entry.retirement.classification, 'unprobeable')
  assert.deepEqual(entry.retirement.reasons, ['not_work_tree'])
  assert.equal('hooks' in entry, false)
  assert.equal('agents' in entry, false)
  assert.equal('lifecycle' in entry, false)
})

test('status keeps a missing registered path as unprobeable without fabricated evidence', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'happyhome-status-missing-'))
  const repo = join(directory, 'repo')
  const linked = join(directory, 'missing-linked')
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  run('git', ['init', '-b', 'main', repo], directory)
  run('git', ['config', 'user.name', 'Test'], repo)
  run('git', ['config', 'user.email', 'test@example.invalid'], repo)
  run('git', ['commit', '--allow-empty', '-m', 'initial'], repo)
  run('git', ['remote', 'add', 'origin', repo], repo)
  run('git', ['fetch', 'origin', 'main'], repo)
  run('git', ['worktree', 'add', '-b', 'codex/missing', linked, 'main'], repo)
  rmSync(linked, { recursive: true, force: true })

  const scriptPath = fileURLToPath(new URL('../worktree.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [scriptPath, 'status'], { cwd: repo, encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  const entry = output.entries.find((candidate) => candidate.branch === 'codex/missing')
  assert.equal(entry.kind, 'unprobeable')
  assert.equal(entry.retirement.classification, 'unprobeable')
  assert.deepEqual(entry.retirement.reasons, ['probe_error'])
  assert.equal('hooks' in entry, false)
  assert.equal('agents' in entry, false)
  assert.equal('lifecycle' in entry, false)
})

function retirementInput(overrides = {}) {
  return {
    kind: 'worktree',
    branch: 'codex/finished',
    ownerState: 'inactive',
    activeOwner: false,
    hasOperation: false,
    isDirty: false,
    openPr: { known: true, open: false, number: null, url: null, error: null },
    uniqueCommits: 0,
    headInMain: true,
    pathIsReparsePoint: false,
    ...overrides,
  }
}

test('status retirement classification requires explicit passing evidence', () => {
  const result = classifyWorktreeRetirement(retirementInput())
  assert.equal(result.classification, 'eligible')
  assert.equal(result.candidateStale, false)
  assert.equal(result.eligible, true)
  assert.deepEqual(result.reasons, [])
  assert.deepEqual(result.checks.openPr, {
    known: true,
    value: false,
    number: null,
    url: null,
    error: null,
  })
})

test('unknown owner is only a review candidate when every other gate explicitly passes', () => {
  const result = classifyWorktreeRetirement(retirementInput({ ownerState: 'unknown' }))
  assert.equal(result.classification, 'candidate_stale')
  assert.equal(result.candidateStale, true)
  assert.equal(result.eligible, false)
  assert.deepEqual(result.reasons, ['unknown_owner'])

  const active = classifyWorktreeRetirement(retirementInput({ ownerState: 'unknown', activeOwner: true }))
  assert.equal(active.classification, 'blocked')
  assert.deepEqual(active.reasons, ['unknown_owner', 'active_owner'])
})

test('contradictory owner evidence always blocks retirement', () => {
  const stateActive = classifyWorktreeRetirement(retirementInput({ ownerState: 'active', activeOwner: false }))
  assert.equal(stateActive.classification, 'blocked')
  assert.equal(stateActive.eligible, false)
  assert.deepEqual(stateActive.reasons, ['active_owner'])

  const booleanActive = classifyWorktreeRetirement(retirementInput({ ownerState: 'inactive', activeOwner: true }))
  assert.equal(booleanActive.classification, 'blocked')
  assert.equal(booleanActive.eligible, false)
  assert.deepEqual(booleanActive.reasons, ['active_owner'])
})

test('critical unknowns remain unknown and block retirement', () => {
  for (const [field, value, reason] of [
    ['hasOperation', null, 'git_operation_unknown'],
    ['isDirty', null, 'dirty_unknown'],
    ['openPr', { known: false, open: null, number: null, url: null, error: 'gh unavailable' }, 'open_pr_unknown'],
    ['uniqueCommits', null, 'unique_commits_unknown'],
    ['headInMain', null, 'head_in_main_unknown'],
    ['pathIsReparsePoint', null, 'reparse_point_unknown'],
  ]) {
    const result = classifyWorktreeRetirement(retirementInput({ [field]: value }))
    assert.equal(result.classification, 'blocked', field)
    assert.equal(result.eligible, false, field)
    assert.equal(result.candidateStale, false, field)
    assert.deepEqual(result.reasons, [reason], field)
  }
})

test('known blockers and every attached main branch are blocked', () => {
  for (const [field, value, reason] of [
    ['branch', 'main', 'main_branch'],
    ['hasOperation', true, 'git_operation'],
    ['isDirty', true, 'dirty'],
    ['openPr', { known: true, open: true, number: 42, url: 'https://example.test/pr/42', error: null }, 'open_pr'],
    ['uniqueCommits', 1, 'unique_commits'],
    ['headInMain', false, 'head_not_in_main'],
    ['pathIsReparsePoint', true, 'reparse_point'],
  ]) {
    const result = classifyWorktreeRetirement(retirementInput({ [field]: value }))
    assert.equal(result.classification, 'blocked', field)
    assert.deepEqual(result.reasons, [reason], field)
  }
})

test('non-worktrees and identity failures are unprobeable', () => {
  assert.deepEqual(classifyWorktreeRetirement({ kind: 'bare' }), {
    classification: 'unprobeable',
    candidateStale: false,
    eligible: false,
    reasons: ['not_work_tree'],
    checks: {},
  })
  assert.deepEqual(classifyWorktreeRetirement({ kind: 'worktree', probeError: 'identity failed' }), {
    classification: 'unprobeable',
    candidateStale: false,
    eligible: false,
    reasons: ['probe_error'],
    checks: {},
  })
})

const cleanBase = {
  activeOwner: false,
  ownerState: 'inactive',
  hasOperation: false,
  isCanonicalMain: false,
  isDirty: false,
  openPr: false,
  uniqueCommits: 0,
  headInMain: true,
  pathIsReparsePoint: false,
}

test('retirement requires an inactive clean worktree whose head is in main', () => {
  assert.deepEqual(evaluateRetirement(cleanBase), { eligible: true, reasons: [] })

  for (const [field, value, reason] of [
    ['activeOwner', true, 'active_owner'],
    ['ownerState', 'unknown', 'unknown_owner'],
    ['hasOperation', true, 'git_operation'],
    ['isDirty', true, 'dirty'],
    ['openPr', true, 'open_pr'],
    ['uniqueCommits', 1, 'unique_commits'],
    ['headInMain', false, 'head_not_in_main'],
    ['pathIsReparsePoint', true, 'reparse_point'],
  ]) {
    assert.deepEqual(evaluateRetirement({ ...cleanBase, [field]: value }), {
      eligible: false,
      reasons: [reason],
    })
  }
})

test('retirement refuses the canonical main workspace even when clean', () => {
  assert.deepEqual(evaluateRetirement({ ...cleanBase, isCanonicalMain: true }), {
    eligible: false,
    reasons: ['canonical_main'],
  })
})

test('owner confirmation never overrides a recorded active lease', () => {
  assert.deepEqual(confirmNoOwner({ activeOwner: true, ownerState: 'active' }, true), {
    activeOwner: true,
    ownerState: 'active',
  })
  assert.deepEqual(confirmNoOwner({ activeOwner: false, ownerState: 'unknown' }, true), {
    activeOwner: false,
    ownerState: 'inactive',
  })
})

test('stale or missing leases stay unknown rather than becoming inactive', () => {
  const now = Date.parse('2026-07-11T12:00:00.000Z')
  assert.deepEqual(evaluateLeaseOwner(null, { now }), { activeOwner: false, ownerState: 'unknown', stale: false })
  assert.deepEqual(evaluateLeaseOwner({ state: 'active', lastSeenAt: '2026-07-11T11:59:00.000Z' }, { now }), {
    activeOwner: true, ownerState: 'active', stale: false,
  })
  assert.deepEqual(evaluateLeaseOwner({ state: 'active', lastSeenAt: '2026-07-10T11:00:00.000Z' }, { now }), {
    activeOwner: false, ownerState: 'unknown', stale: true,
  })
  assert.deepEqual(evaluateLeaseOwner({ state: 'inactive' }, { now }), {
    activeOwner: false, ownerState: 'inactive', stale: false,
  })
})

test('sync permits only clean, ownerless fast-forward or detached resets', () => {
  assert.deepEqual(decideSync({ activeOwner: false, ownerState: 'inactive', isDirty: false, behind: 3, ahead: 0, detached: false }), {
    action: 'fast_forward',
  })
  assert.deepEqual(decideSync({ activeOwner: false, ownerState: 'inactive', isDirty: false, behind: 3, ahead: 0, detached: true }), {
    action: 'reset_detached',
  })
  assert.deepEqual(decideSync({ activeOwner: false, ownerState: 'inactive', isDirty: false, behind: 3, ahead: 2, detached: false }), {
    action: 'manual_merge',
  })
  assert.deepEqual(decideSync({ activeOwner: true, ownerState: 'active', isDirty: false, behind: 3, ahead: 0, detached: false }), {
    action: 'blocked',
    reason: 'active_owner',
  })
  assert.deepEqual(decideSync({ activeOwner: false, ownerState: 'unknown', isDirty: false, behind: 3, ahead: 0, detached: false }), {
    action: 'blocked',
    reason: 'unknown_owner',
  })
  assert.deepEqual(decideSync({ activeOwner: false, ownerState: 'inactive', isDirty: true, behind: 3, ahead: 0, detached: false }), {
    action: 'blocked',
    reason: 'dirty',
  })
})

test('sync exposes an explicit no-owner confirmation path without overriding active leases', () => {
  const scriptPath = fileURLToPath(new URL('../worktree.mjs', import.meta.url))
  const source = readFileSync(scriptPath, 'utf8')
  assert.match(source, /confirmNoOwner\(ownerState\(identity\.root, identity\.root\), flags\.has\('confirm-no-owner'\)\)/)

  const confirmed = confirmNoOwner({ activeOwner: false, ownerState: 'unknown' }, true)
  assert.deepEqual(decideSync({ ...confirmed, isDirty: false, behind: 1, ahead: 0 }), { action: 'fast_forward' })
  const active = confirmNoOwner({ activeOwner: true, ownerState: 'active' }, true)
  assert.deepEqual(decideSync({ ...active, isDirty: false, behind: 1, ahead: 0 }), { action: 'blocked', reason: 'active_owner' })
})

test('retirement apply requires the prepare manifest to match live identity', () => {
  const manifest = createRetirementManifest({
    manifestId: '11111111-1111-4111-8111-111111111111',
    path: 'X:/worktrees/finished/happyHome',
    branch: 'codex/finished',
    head: 'a'.repeat(40),
    main: 'b'.repeat(40),
    preparedAt: '2026-07-11T12:00:00.000Z',
    expiresAt: '2026-07-11T12:15:00.000Z',
    confirmNoOwner: true,
  })
  const manifestPath = 'X:/repo/.git/happyhome-worktrees/retire/manifest.json'
  const record = createRetirementRecord({ manifest, manifestPath })
  const options = {
    manifestPath,
    managedDirectory: 'X:/repo/.git/happyhome-worktrees/retire',
    record,
    now: Date.parse('2026-07-11T12:05:00.000Z'),
  }

  assert.doesNotThrow(() => verifyRetirementManifest(manifest, { ...manifest }, options))
  assert.throws(() => verifyRetirementManifest(manifest, { ...manifest, head: 'c'.repeat(40) }, options), /head/i)
  assert.throws(() => verifyRetirementManifest(manifest, { ...manifest, branch: 'codex/other' }, options), /branch/i)
  assert.throws(() => verifyRetirementManifest({ ...manifest, schemaVersion: undefined }, { ...manifest }, options), /schema/i)
  assert.throws(() => verifyRetirementManifest({ ...manifest, confirmNoOwner: false }, { ...manifest }, options), /record|digest/i)
  assert.throws(() => verifyRetirementManifest(manifest, { ...manifest }, { ...options, record: null }), /record/i)
  assert.throws(() => verifyRetirementManifest(manifest, { ...manifest }, { ...options, now: Date.parse('2026-07-11T12:16:00.000Z') }), /expired/i)
  assert.throws(() => verifyRetirementManifest(manifest, { ...manifest }, { ...options, manifestPath: 'X:/tmp/manifest.json' }), /managed|path/i)
})

test('retirement rechecks owner state and removes only inside the shared lease lock', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'happyhome-retire-lock-'))
  const lockPath = join(directory, 'leases.lock')
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  let locked = false
  let ownerState = 'inactive'
  let removed = false
  const withLeaseLock = (action) => {
    const release = acquireIntegrationLock(lockPath, { prNumber: 'retire-test' })
    locked = true
    try {
      return action()
    } finally {
      locked = false
      release()
    }
  }

  ownerState = 'active'
  assert.throws(() => executeRetirementCriticalSection({
    withLeaseLock,
    probe: () => ({ ownerState }),
    verify: (probe) => {
      if (probe.ownerState !== 'inactive') throw new Error('active owner')
    },
    remove: () => { removed = true },
  }), /active owner/i)
  assert.equal(removed, false)

  ownerState = 'inactive'
  executeRetirementCriticalSection({
    withLeaseLock,
    probe: () => ({ ownerState }),
    verify: () => assert.equal(locked, true),
    remove: () => {
      assert.equal(locked, true)
      assert.throws(() => acquireIntegrationLock(lockPath, { prNumber: 'heartbeat' }), /already in progress/i)
      removed = true
    },
  })
  assert.equal(removed, true)
  assert.equal(locked, false)
})

test('heartbeat acquires the shared lease lock before reading worktree identity', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'happyhome-heartbeat-lock-'))
  const lockPath = join(directory, 'leases.lock')
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const events = []

  executeHeartbeatCriticalSection({
    withLeaseLock: (action) => {
      const release = acquireIntegrationLock(lockPath, { prNumber: 'heartbeat' })
      try {
        return action()
      } finally {
        release()
      }
    },
    readIdentity: () => {
      assert.throws(() => acquireIntegrationLock(lockPath, { prNumber: 'retire' }), /already in progress/i)
      events.push('identity')
      return { root: 'X:/worktree' }
    },
    writeLease: (identity) => {
      events.push(`lease:${identity.root}`)
    },
  })

  assert.deepEqual(events, ['identity', 'lease:X:/worktree'])
})

test('new worktrees use an explicit safe codex branch name and path', () => {
  assert.deepEqual(createWorktreePlan({
    name: 'docs-governance',
    path: 'X:/Users/<user>/.codex/worktrees/docs-governance/happyHome',
  }), {
    branch: 'codex/docs-governance',
    path: 'X:/Users/<user>/.codex/worktrees/docs-governance/happyHome',
  })
  assert.throws(() => createWorktreePlan({ name: '../main', path: 'X:/tmp/happyHome' }), /safe/i)
  assert.throws(() => createWorktreePlan({ name: 'docs', path: '' }), /path/i)
  assert.throws(() => createWorktreePlan({ name: 'docs', path: 'child-worktree' }), /absolute/i)
})

test('create rejects a reparse or ancestor identity change after fetch', () => {
  const before = {
    targetExists: false,
    hasReparseAncestor: false,
    anchorPath: 'x:/worktrees',
    anchorRealPath: 'x:/worktrees',
    anchorDevice: '1',
    anchorInode: '2',
  }

  assert.doesNotThrow(() => verifyCreateTargetBoundary(before, { ...before }))
  assert.throws(() => verifyCreateTargetBoundary(before, { ...before, hasReparseAncestor: true }), /reparse/i)
  assert.throws(() => verifyCreateTargetBoundary(before, { ...before, anchorInode: '3' }), /changed/i)
  assert.throws(() => verifyCreateTargetBoundary(before, { ...before, targetExists: true }), /exists/i)
})
