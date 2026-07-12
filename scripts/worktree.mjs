#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'

import {
  assessPublicIntegrationMain,
  assessRetirementTargetBoundary,
  classifyWorktreeRetirement,
  collectPinnedRetirementEvidence,
  createWorktreePlan,
  decideSync,
  decideBootstrap,
  findOpenPullRequest,
  githubRepositoryFromRemote,
  interpretAncestorExitStatus,
  normalizeExternalCommandResult,
  validateOpenPullRequestInventory,
  verifiedPublicOriginUrl,
  verifySyncSnapshot,
  executePinnedWorktreeCreation,
  executeWorktreeMutation,
  verifyCreateTargetBoundary,
} from './lib/worktree-lifecycle.mjs'
import { assessRuntime } from './lib/worktree-environment.mjs'
import { acquireIntegrationLock } from './lib/integrate-pr-policy.mjs'

function die(message) {
  throw new Error(message)
}

const NETWORK_TIMEOUT_MS = 60_000

function git(args, { cwd = process.cwd(), allowFailure = false, timeout = null } = {}) {
  const options = {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }
  if (timeout !== null) options.timeout = timeout
  const result = spawnSync('git', args, options)
  const outcome = normalizeExternalCommandResult(result, { allowFailure })
  if (!outcome.ok && !allowFailure) die(`git ${args.join(' ')} failed: ${outcome.stderr || `exit ${outcome.status}`}`)
  return outcome
}

function parseFlags(argv) {
  const flags = new Map()
  const positionals = []
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (!value.startsWith('--')) {
      positionals.push(value)
      continue
    }
    const [key, inline] = value.slice(2).split('=', 2)
    if (inline !== undefined) flags.set(key, inline)
    else if (argv[index + 1] && !argv[index + 1].startsWith('--')) flags.set(key, argv[++index])
    else flags.set(key, true)
  }
  return { flags, positionals }
}

function isReparsePoint(path) {
  return lstatSync(path).isSymbolicLink()
}

function isBareRepositoryPath(path) {
  try {
    const result = git(['rev-parse', '--is-bare-repository'], { cwd: path, allowFailure: true })
    return result.ok && result.stdout === 'true'
  } catch {
    return false
  }
}

function commonGitDir(cwd = process.cwd()) {
  const value = git(['rev-parse', '--git-common-dir'], { cwd }).stdout
  return resolve(cwd, value)
}

function withWorktreeOperationLock(cwd, action) {
  const directory = join(commonGitDir(cwd), 'happyhome-worktrees')
  mkdirSync(directory, { recursive: true })
  const release = acquireIntegrationLock(join(directory, 'operations.lock'), { prNumber: 'worktree-operation' })
  try {
    return action()
  } finally {
    release()
  }
}

function normalizePath(value) {
  return resolve(String(value)).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function currentIdentity(cwd = process.cwd(), { mainSha = null } = {}) {
  const root = git(['rev-parse', '--show-toplevel'], { cwd }).stdout
  const branch = git(['branch', '--show-current'], { cwd: root }).stdout || '(detached)'
  const head = git(['rev-parse', 'HEAD'], { cwd: root }).stdout
  if (mainSha !== null && !/^[0-9a-f]{40}$/i.test(String(mainSha))) die('currentIdentity requires an exact main SHA')
  const main = mainSha === null ? git(['rev-parse', 'origin/main'], { cwd: root }).stdout : String(mainSha)
  const [behind, ahead] = git(['rev-list', '--left-right', '--count', `${main}...${head}`], { cwd: root }).stdout.split(/\s+/).map(Number)
  const dirty = git(['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root }).stdout.length > 0
  return { root, branch, head, main, behind, ahead, dirty }
}

function refreshOriginMain(cwd, { required = true, remoteUrl = 'origin' } = {}) {
  const result = git(['fetch', '--quiet', remoteUrl, '+refs/heads/main:refs/remotes/origin/main'], {
    cwd,
    allowFailure: true,
    timeout: NETWORK_TIMEOUT_MS,
  })
  if (!result.ok && required) die(`unable to refresh origin/main: ${result.stderr || result.stdout || 'git fetch failed'}`)
  return result
}

function hasGitOperation(cwd) {
  const directory = git(['rev-parse', '--absolute-git-dir'], { cwd }).stdout
  return ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG', 'rebase-merge', 'rebase-apply', 'sequencer']
    .some((name) => existsSync(join(directory, name)))
}

function isWithinPath(path, parent) {
  const normalizedPath = normalizePath(path)
  const normalizedParent = normalizePath(parent)
  return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`)
}

function hasExistingReparseAncestor(path) {
  let current = resolve(path)
  while (true) {
    if (existsSync(current) && isReparsePoint(current)) return true
    const parent = dirname(current)
    if (parent === current) return false
    current = parent
  }
}

function captureCreateTargetBoundary(targetPath) {
  let anchor = dirname(resolve(targetPath))
  while (!existsSync(anchor)) {
    const parent = dirname(anchor)
    if (parent === anchor) die(`worktree:create cannot find an existing target ancestor: ${targetPath}`)
    anchor = parent
  }
  const stats = lstatSync(anchor)
  return {
    targetExists: existsSync(targetPath),
    hasReparseAncestor: hasExistingReparseAncestor(dirname(targetPath)),
    anchorPath: normalizePath(anchor),
    anchorRealPath: normalizePath(realpathSync.native(anchor)),
    anchorDevice: String(stats.dev),
    anchorInode: String(stats.ino),
  }
}

function registeredWorktreePaths(root) {
  const output = git(['worktree', 'list', '--porcelain'], { cwd: root }).stdout
  return output.split(/\n\n/).filter(Boolean).map((block) => {
    const line = block.split(/\r?\n/).find((value) => value.startsWith('worktree '))
    return line ? line.slice('worktree '.length) : ''
  }).filter(Boolean)
}

function hooksState(root) {
  const configured = git(['config', '--get', 'core.hooksPath'], { cwd: root, allowFailure: true }).stdout.replace(/\\/g, '/')
  const required = ['post-checkout', 'pre-push']
  const missing = required.filter((hook) => !existsSync(join(root, '.githooks', hook)))
  return { ready: configured === '.githooks' && missing.length === 0, configured: configured || null, missing }
}

function agentsState(root) {
  const path = join(root, 'AGENTS.md')
  return { ready: existsSync(path) && !isReparsePoint(path), path }
}

function safeMetadata(path) {
  const result = {}
  try {
    result.hooks = hooksState(path)
  } catch (error) {
    result.hooks = { ready: false, configured: null, missing: [], error: error?.message || String(error) }
  }
  try {
    result.agents = agentsState(path)
  } catch (error) {
    result.agents = { ready: false, path: join(path, 'AGENTS.md'), error: error?.message || String(error) }
  }
  return result
}

function ensureHooksAndAgents(root) {
  const agents = agentsState(root)
  if (!agents.ready) die(`bootstrap requires a real AGENTS.md: ${agents.path}`)
  const hooks = hooksState(root)
  if (hooks.missing.length > 0) die(`bootstrap requires tracked hooks: ${hooks.missing.join(', ')}`)
  if (hooks.configured !== '.githooks') git(['config', '--worktree', 'core.hooksPath', '.githooks'], { cwd: root })
  const repaired = hooksState(root)
  if (!repaired.ready) die(`bootstrap could not configure core.hooksPath; got ${repaired.configured || '(unset)'}`)
}

function isHeadInMain(cwd, headSha = 'HEAD', mainSha = 'origin/main') {
  const result = git(['merge-base', '--is-ancestor', headSha, mainSha], { cwd, allowFailure: true })
  return interpretAncestorExitStatus(result.status)
}

function uniqueCommitCount(cwd, headSha = 'HEAD', mainSha = null) {
  const exclusions = mainSha === null ? ['origin/main', '--remotes=origin'] : [mainSha]
  return Number(git(['rev-list', '--count', headSha, '--not', ...exclusions], { cwd }).stdout || '0')
}

function assertRetirementTargetBoundary(path, operator) {
  const reparseAncestor = hasExistingReparseAncestor(path)
  const registered = !reparseAncestor
    && registeredWorktreePaths(operator.root).some((candidate) => normalizePath(candidate) === normalizePath(path))
  let targetCommonDirectory = null
  if (!reparseAncestor && registered) {
    try {
      targetCommonDirectory = realCommonGitDir(path)
    } catch {
      targetCommonDirectory = null
    }
  }
  const assessment = assessRetirementTargetBoundary({
    registered,
    operatorCommonDirectory: operator.commonDirectory,
    targetCommonDirectory,
    hasReparseAncestor: reparseAncestor,
  })
  if (!assessment.eligible) die(`retire target boundary is blocked: ${assessment.reasons.join(', ')}`)
}

function realCommonGitDir(cwd = process.cwd()) {
  return normalizePath(realpathSync.native(commonGitDir(cwd)))
}

function openPullRequestInventory(cwd, { repository: requestedRepository = null } = {}) {
  const limit = 1000
  const remote = requestedRepository ? null : git(['config', '--get', 'remote.origin.url'], { cwd, allowFailure: true })
  const repository = requestedRepository || (remote?.ok ? githubRepositoryFromRemote(remote.stdout) : null)
  if (!repository) {
    return { pulls: null, error: remote?.ok ? 'origin is not a GitHub repository' : (remote?.stderr || 'origin unavailable') }
  }
  const result = spawnSync('gh', ['pr', 'list', '--repo', repository, '--state', 'open', '--limit', String(limit), '--json', 'number,url,headRefName,headRefOid'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: NETWORK_TIMEOUT_MS,
    env: { ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0' },
  })
  if (result.error || result.status !== 0) {
    return { pulls: null, error: result.error?.message || String(result.stderr || '').trim() || `gh exited ${result.status}` }
  }
  try {
    return validateOpenPullRequestInventory(JSON.parse(String(result.stdout || '[]')), limit)
  } catch (error) {
    return { pulls: null, error: `unable to parse open PR inventory: ${error?.message || error}` }
  }
}

function openPrForIdentity(identity, inventory) {
  return findOpenPullRequest(inventory.pulls, identity, { error: inventory.error })
}

function report(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function bootstrapFingerprint(identity, npm) {
  return {
    packageSha256: createHash('sha256').update(readFileSync(join(identity.root, 'package.json'), 'utf8')).digest('hex'),
    lockSha256: createHash('sha256').update(readFileSync(join(identity.root, 'package-lock.json'), 'utf8')).digest('hex'),
    node: process.versions.node,
    npm,
    platform: process.platform,
    arch: process.arch,
  }
}

function readBootstrapMarker(root) {
  try { return JSON.parse(readFileSync(join(root, '.codex-local', 'bootstrap.json'), 'utf8')) } catch { return null }
}

function writeBootstrapMarker(identity, fingerprint) {
  const directory = join(identity.root, '.codex-local')
  mkdirSync(directory, { recursive: true })
  const path = join(directory, 'bootstrap.json')
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, `${JSON.stringify({
    schemaVersion: 2,
    fingerprint,
    completedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8')
  renameSync(temporary, path)
}

function publicIntegrationOperator(action, { refresh = true, expected = null } = {}) {
  const cwd = process.cwd()
  const remote = git(['remote', 'get-url', 'origin'], { cwd, allowFailure: true })
  const verifiedOriginUrl = verifiedPublicOriginUrl(remote.ok ? remote.stdout : '')
  const repository = 'happyhome-project/happyHome_public'
  if (refresh) refreshOriginMain(cwd, { remoteUrl: verifiedOriginUrl })
  const identity = { ...currentIdentity(cwd), commonDirectory: realCommonGitDir(cwd), originUrl: verifiedOriginUrl }
  const assessment = assessPublicIntegrationMain({
    root: identity.root,
    commonDirectory: identity.commonDirectory,
    repository,
    branch: identity.branch,
    head: identity.head,
    main: identity.main,
    behind: identity.behind,
    ahead: identity.ahead,
    isDirty: identity.dirty,
    hasOperation: hasGitOperation(identity.root),
    pathIsReparsePoint: isReparsePoint(identity.root),
    expected,
  })
  if (!assessment.eligible) {
    die(`${action} requires a clean synchronized main worktree for happyhome-project/happyHome_public: ${assessment.reasons.join(', ')}`)
  }
  return identity
}

function runNpmCi(root) {
  const invocation = process.platform === 'win32'
    ? { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', 'npm.cmd ci'] }
    : { command: 'npm', args: ['ci'] }
  const result = spawnSync(invocation.command, invocation.args, { cwd: root, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) die(`npm ci failed with exit ${result.status}`)
}

function npmVersion(root = process.cwd()) {
  const invocation = process.platform === 'win32'
    ? { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', 'npm.cmd --version'] }
    : { command: 'npm', args: ['--version'] }
  const result = spawnSync(invocation.command, invocation.args, { cwd: root, encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0) return ''
  return String(result.stdout || '').trim()
}

function doctor() {
  const root = git(['rev-parse', '--show-toplevel']).stdout
  const identity = currentIdentity(root)
  const nodeMajor = Number(process.versions.node.split('.')[0])
  const npm = npmVersion(identity.root)
  const runtime = assessRuntime({ nodeVersion: process.versions.node, npmVersion: npm })
  const modules = existsSync(join(identity.root, 'node_modules'))
  const hooks = hooksState(identity.root)
  const agents = agentsState(identity.root)
  report({
    status: runtime.ready && modules && hooks.ready && agents.ready && !identity.dirty && identity.behind === 0 ? 'ready' : 'not_ready',
    identity,
    node: process.versions.node,
    nodeMajor,
    npm,
    runtime,
    nodeModulesPresent: modules,
    hooks,
    agents,
  })
}

function bootstrap(root = process.cwd()) {
  refreshOriginMain(root)
  const identity = currentIdentity(root)
  if (!identity.branch.startsWith('codex/')) die('bootstrap requires an attached codex/* branch')
  if (identity.behind !== 0 || identity.dirty) die('bootstrap requires a clean worktree synchronized with origin/main')
  const npm = npmVersion(identity.root)
  const runtime = assessRuntime({ nodeVersion: process.versions.node, npmVersion: npm })
  if (!runtime.ready) die(`bootstrap requires Node 24 and npm 11; got Node ${process.versions.node}, npm ${npm || '(unavailable)'}`)
  ensureHooksAndAgents(identity.root)
  const fingerprint = bootstrapFingerprint(identity, npm)
  const decision = decideBootstrap({ fingerprint, marker: readBootstrapMarker(identity.root), nodeModulesPresent: existsSync(join(identity.root, 'node_modules')) })
  if (decision.action === 'install') {
    runNpmCi(identity.root)
    writeBootstrapMarker(identity, fingerprint)
  }
  report({ status: 'ready', action: decision.action === 'skip' ? 'skipped' : 'installed', root: identity.root, head: identity.head, fingerprint })
}

function create({ flags }) {
  const requested = createWorktreePlan({ name: flags.get('name'), path: flags.get('path') })
  const plan = { ...requested, path: resolve(requested.path) }
  const targetBoundary = captureCreateTargetBoundary(plan.path)
  verifyCreateTargetBoundary(targetBoundary, targetBoundary)

  const identity = publicIntegrationOperator('worktree:create')
  const runtime = assessRuntime({ nodeVersion: process.versions.node, npmVersion: npmVersion(identity.root) })
  if (!runtime.ready) die(`worktree:create requires Node 24 and npm 11; got Node ${process.versions.node}, npm ${npmVersion(identity.root) || '(unavailable)'}`)
  if (isWithinPath(plan.path, identity.root)) die('worktree:create target must not be inside the public integration main workspace')
  const agents = git(['cat-file', '-e', `${identity.main}:AGENTS.md`], { cwd: identity.root, allowFailure: true })
  if (!agents.ok) die('worktree:create requires origin/main to contain AGENTS.md')
  verifyCreateTargetBoundary(targetBoundary, captureCreateTargetBoundary(plan.path))

  const refreshedOperator = publicIntegrationOperator('worktree:create', { refresh: true, expected: identity })
  let created
  withWorktreeOperationLock(identity.root, () => {
    const liveOperator = publicIntegrationOperator('worktree:create', { refresh: false, expected: refreshedOperator })
    verifyCreateTargetBoundary(targetBoundary, captureCreateTargetBoundary(plan.path))
    created = executePinnedWorktreeCreation({
      operator: liveOperator,
      branch: plan.branch,
      path: plan.path,
      addWorktree: ({ root, branch, path, startPoint }) => {
        git(['worktree', 'add', '-b', branch, path, startPoint], { cwd: root })
      },
      readCreated: (path, mainSha) => currentIdentity(path, { mainSha }),
    })
  })
  const agentsPath = join(created.root, 'AGENTS.md')
  if (!existsSync(agentsPath) || isReparsePoint(agentsPath)) {
    die('worktree:create requires a real AGENTS.md in the new worktree')
  }
  bootstrap(created.root)
}

function sync({ flags }) {
  const legacy = ['prepare', 'apply', 'expected-head', 'expected-main', 'confirm-no-owner'].filter((flag) => flags.has(flag))
  if (legacy.length) die(`legacy sync flags are not supported: ${legacy.map((flag) => `--${flag}`).join(', ')}`)
  refreshOriginMain(process.cwd())
  const identity = currentIdentity()
  if (!identity.branch.startsWith('codex/')) die('sync requires an attached codex/* branch')
  const decision = decideSync({
    isDirty: identity.dirty,
    hasOperation: hasGitOperation(identity.root),
    behind: identity.behind,
    ahead: identity.ahead,
    main: identity.main,
  })
  if (decision.action === 'blocked') die(`sync is blocked: ${decision.reason}`)
  if (decision.args) {
    const live = currentIdentity(identity.root)
    verifySyncSnapshot(identity, live, hasGitOperation(identity.root))
    git(decision.args, { cwd: identity.root })
  }
  report({ status: 'synchronized', action: decision.action, identity: currentIdentity() })
}

function retirementProbe(path, { mainSha, prInventory, operator } = {}) {
  assertRetirementTargetBoundary(path, operator)
  const evidence = collectPinnedRetirementEvidence({
    mainSha,
    readIdentity: (pinnedMain) => currentIdentity(path, { mainSha: pinnedMain }),
    readUniqueCommitCount: (pinnedHead, pinnedMain) => uniqueCommitCount(path, pinnedHead, pinnedMain),
    readHeadInMain: (pinnedHead, pinnedMain) => isHeadInMain(path, pinnedHead, pinnedMain),
  })
  const identity = evidence.identity
  const pr = openPrForIdentity(identity, prInventory)
  const decision = classifyWorktreeRetirement({
    kind: 'worktree',
    branch: identity.branch,
    hasOperation: hasGitOperation(identity.root),
    isDirty: identity.dirty,
    openPr: pr,
    uniqueCommits: evidence.uniqueCommits,
    headInMain: evidence.headInMain,
    pathIsReparsePoint: isReparsePoint(identity.root),
  })
  return { identity, pr, decision }
}

function retire({ flags, positionals }) {
  const legacy = ['prepare', 'apply', 'confirm-no-owner', 'delete-merged-local-branch'].filter((flag) => flags.has(flag))
  if (legacy.length) die(`legacy retire flags are not supported: ${legacy.map((flag) => `--${flag}`).join(', ')}`)
  const targetPath = positionals[1]
  if (!targetPath) die('worktree:retire requires a worktree path')
  const operator = publicIntegrationOperator('worktree:retire')
  assertRetirementTargetBoundary(targetPath, operator)
  const prInventory = openPullRequestInventory(operator.root, { repository: 'happyhome-project/happyHome_public' })
  if (!prInventory.pulls) die(`retirement is blocked: open PR inventory unavailable: ${prInventory.error}`)
  executeWorktreeMutation({
    withOperationLock: (action) => withWorktreeOperationLock(operator.root, action),
    probe: () => {
      const liveOperator = publicIntegrationOperator('worktree:retire', { refresh: false, expected: operator })
      assertRetirementTargetBoundary(targetPath, liveOperator)
      return retirementProbe(targetPath, {
        mainSha: liveOperator.main,
        prInventory,
        operator: liveOperator,
      })
    },
    verify: (liveProbe) => {
      if (!liveProbe.decision.eligible) die(`retirement is blocked: ${liveProbe.decision.reasons.join(', ')}`)
    },
    remove: () => {
      const finalOperator = publicIntegrationOperator('worktree:retire', { refresh: false, expected: operator })
      assertRetirementTargetBoundary(targetPath, finalOperator)
      const finalProbe = retirementProbe(targetPath, {
        mainSha: finalOperator.main,
        prInventory,
        operator: finalOperator,
      })
      if (!finalProbe.decision.eligible) die(`retirement is blocked at final remove: ${finalProbe.decision.reasons.join(', ')}`)
      git(['worktree', 'remove', targetPath])
    },
  })
  report({ status: 'retired', path: targetPath })
}

function status({ flags }) {
  const fresh = flags.has('fresh')
  const refreshed = fresh ? refreshOriginMain(process.cwd(), { required: false }) : { ok: true }
  const output = git(['worktree', 'list', '--porcelain']).stdout
  const prInventory = fresh && refreshed.ok ? openPullRequestInventory(process.cwd()) : { pulls: null, error: 'not_evaluated' }
  const blocks = output.split(/\n\n/).filter(Boolean)
  const entries = blocks.map((block) => {
    const lines = block.split(/\r?\n/)
    const path = lines.find((line) => line.startsWith('worktree '))?.slice(9)
    const head = lines.find((line) => line.startsWith('HEAD '))?.slice(5)
    const branch = lines.find((line) => line.startsWith('branch refs/heads/'))?.slice('branch refs/heads/'.length) || '(detached)'
    const kind = lines.includes('bare') || isBareRepositoryPath(path) ? 'bare' : 'worktree'
    if (kind === 'bare') {
      return {
        kind,
        path,
        head: head || null,
        branch,
        retirement: classifyWorktreeRetirement({ kind }),
      }
    }
    try {
      const identity = currentIdentity(path)
      const pr = fresh && refreshed.ok ? openPrForIdentity(identity, prInventory) : { known: false, open: null, error: 'not_evaluated' }
      const retirement = classifyWorktreeRetirement({
        kind,
        branch: identity.branch,
        hasOperation: hasGitOperation(identity.root),
        isDirty: identity.dirty,
        openPr: pr,
        uniqueCommits: fresh && refreshed.ok ? uniqueCommitCount(identity.root) : null,
        headInMain: fresh && refreshed.ok ? isHeadInMain(identity.root) : null,
        pathIsReparsePoint: isReparsePoint(identity.root),
      })
      return {
        kind,
        path,
        head,
        branch,
        identity,
        ...safeMetadata(path),
        retirement,
      }
    } catch (error) {
      const probeError = error?.message || String(error)
      return {
        kind: 'unprobeable',
        path,
        head,
        branch,
        probeError,
        retirement: classifyWorktreeRetirement({ kind: 'worktree', probeError }),
      }
    }
  })
  report({
    status: fresh ? (refreshed.ok && prInventory.pulls !== null ? 'fresh' : 'stale') : 'local',
    refresh: !fresh ? { status: 'not_evaluated' } : refreshed.ok
      ? { ok: true }
      : { ok: false, error: refreshed.stderr || refreshed.stdout || 'git fetch failed' },
    entries,
    pullRequests: !fresh ? { status: 'not_evaluated' } : prInventory.pulls !== null
      ? { ok: true, count: prInventory.pulls.length }
      : { ok: false, error: prInventory.error || 'open PR inventory unavailable' },
  })
  if (fresh && (!refreshed.ok || prInventory.pulls === null)) process.exitCode = 1
}

const { flags, positionals } = parseFlags(process.argv.slice(2))
const command = positionals[0]

try {
  if (command === 'create') create({ flags })
  else if (command === 'doctor') doctor()
  else if (command === 'bootstrap') bootstrap()
  else if (command === 'status') status({ flags })
  else if (command === 'sync-main') sync({ flags })
  else if (command === 'retire') retire({ flags, positionals })
  else die('Usage: worktree.mjs <create|doctor|bootstrap|status|sync-main|retire>')
} catch (error) {
  console.error(`[worktree] ${error?.message || error}`)
  process.exitCode = 1
}
