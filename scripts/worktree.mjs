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
  confirmNoOwner,
  createWorktreePlan,
  createRetirementManifest,
  createRetirementRecord,
  decideSync,
  evaluateLeaseOwner,
  findOpenPullRequest,
  githubRepositoryFromRemote,
  interpretAncestorExitStatus,
  normalizeExternalCommandResult,
  validateOpenPullRequestInventory,
  verifiedPublicOriginUrl,
  executeHeartbeatCriticalSection,
  executePinnedWorktreeCreation,
  executeRetirementCriticalSection,
  verifyCreateTargetBoundary,
  verifyRetirementManifest,
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

function registryDir(cwd = process.cwd()) {
  return join(commonGitDir(cwd), 'happyhome-worktrees')
}

function registryPath(cwd = process.cwd()) {
  return join(registryDir(cwd), 'leases.json')
}

function loadRegistry(cwd = process.cwd()) {
  const path = registryPath(cwd)
  if (!existsSync(path)) return { schemaVersion: 1, leases: {} }
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    return value?.schemaVersion === 1 && value?.leases && typeof value.leases === 'object'
      ? value
      : { schemaVersion: 1, leases: {} }
  } catch {
    return { schemaVersion: 1, leases: {} }
  }
}

function writeRegistry(value, cwd = process.cwd()) {
  const directory = registryDir(cwd)
  mkdirSync(directory, { recursive: true })
  const path = registryPath(cwd)
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(temporary, path)
}

function retirementRecordsPath(cwd = process.cwd()) {
  return join(registryDir(cwd), 'retire-records.json')
}

function loadRetirementRecords(cwd = process.cwd()) {
  const path = retirementRecordsPath(cwd)
  if (!existsSync(path)) return { schemaVersion: 1, records: {} }
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    return value?.schemaVersion === 1 && value?.records && typeof value.records === 'object'
      ? value
      : { schemaVersion: 1, records: {} }
  } catch {
    return { schemaVersion: 1, records: {} }
  }
}

function writeRetirementRecords(value, cwd = process.cwd()) {
  const directory = registryDir(cwd)
  mkdirSync(directory, { recursive: true })
  const path = retirementRecordsPath(cwd)
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(temporary, path)
}

function withRegistryLock(cwd, action) {
  const directory = registryDir(cwd)
  mkdirSync(directory, { recursive: true })
  const release = acquireIntegrationLock(join(directory, 'leases.lock'), { prNumber: 'worktree-lease' })
  try {
    return action()
  } finally {
    release()
  }
}

function normalizePath(value) {
  return resolve(String(value)).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function pathKey(path) {
  return createHash('sha256').update(normalizePath(path)).digest('hex')
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

function ownerState(path, cwd = process.cwd()) {
  const lease = loadRegistry(cwd).leases[pathKey(path)]
  return { ...evaluateLeaseOwner(lease), lease: lease || null }
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
  const remote = requestedRepository ? null : git(['remote', 'get-url', 'origin'], { cwd, allowFailure: true })
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

function writeBootstrapMarker(identity) {
  const directory = join(identity.root, '.codex-local')
  mkdirSync(directory, { recursive: true })
  const packageJson = readFileSync(join(identity.root, 'package.json'), 'utf8')
  const lock = readFileSync(join(identity.root, 'package-lock.json'), 'utf8')
  writeFileSync(join(directory, 'bootstrap.json'), `${JSON.stringify({
    schemaVersion: 1,
    head: identity.head,
    node: process.versions.node,
    npmUserAgent: process.env.npm_config_user_agent || null,
    packageSha256: createHash('sha256').update(packageJson).digest('hex'),
    lockSha256: createHash('sha256').update(lock).digest('hex'),
    platform: process.platform,
    arch: process.arch,
    completedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8')
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

function heartbeat({ flags }) {
  const raw = readFileSync(0, 'utf8').trim()
  const input = raw ? JSON.parse(raw) : {}
  const requestedCwd = input.worktree_path || input.worktreePath || input.cwd || process.cwd()
  const identity = executeHeartbeatCriticalSection({
    withLeaseLock: (action) => withRegistryLock(requestedCwd, action),
    readIdentity: () => currentIdentity(requestedCwd),
    writeLease: (liveIdentity) => {
      const registry = loadRegistry(liveIdentity.root)
      registry.leases[pathKey(liveIdentity.root)] = {
        provider: flags.get('provider') || input.provider || 'codex',
        ownerId: input.session_id || input.sessionId || null,
        path: liveIdentity.root,
        branch: liveIdentity.branch,
        head: liveIdentity.head,
        retention: input.retention || 'managed',
        state: 'active',
        lastSeenAt: new Date().toISOString(),
      }
      writeRegistry(registry, liveIdentity.root)
    },
  })
  if (!flags.has('quiet')) report({ status: 'recorded', path: identity.root })
}

function doctor() {
  const root = git(['rev-parse', '--show-toplevel']).stdout
  const refresh = refreshOriginMain(root, { required: false })
  const identity = currentIdentity(root)
  const nodeMajor = Number(process.versions.node.split('.')[0])
  const npm = npmVersion(identity.root)
  const runtime = assessRuntime({ nodeVersion: process.versions.node, npmVersion: npm })
  const modules = existsSync(join(identity.root, 'node_modules'))
  const lifecycle = ownerState(identity.root, identity.root)
  const hooks = hooksState(identity.root)
  const agents = agentsState(identity.root)
  report({
    status: refresh.ok && runtime.ready && modules && hooks.ready && agents.ready && !identity.dirty && identity.behind === 0 ? 'ready' : 'not_ready',
    identity,
    node: process.versions.node,
    nodeMajor,
    npm,
    runtime,
    refresh: refresh.ok ? { ok: true } : { ok: false, error: refresh.stderr || refresh.stdout || 'git fetch failed' },
    nodeModulesPresent: modules,
    hooks,
    agents,
    lifecycle,
  })
}

function bootstrap(root = process.cwd()) {
  refreshOriginMain(root)
  const identity = currentIdentity(root)
  if (!identity.branch.startsWith('codex/')) die('bootstrap requires an attached codex/* branch')
  if (identity.behind !== 0 || identity.dirty) die('bootstrap requires a clean worktree synchronized with origin/main')
  const runtime = assessRuntime({ nodeVersion: process.versions.node, npmVersion: npmVersion(identity.root) })
  if (!runtime.ready) die(`bootstrap requires Node 24 and npm 11; got Node ${process.versions.node}, npm ${npmVersion(identity.root) || '(unavailable)'}`)
  ensureHooksAndAgents(identity.root)
  runNpmCi(identity.root)
  writeBootstrapMarker(identity)
  report({ status: 'bootstrapped', root: identity.root, head: identity.head })
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
  withRegistryLock(identity.root, () => {
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
  refreshOriginMain(process.cwd())
  const identity = currentIdentity()
  const owner = confirmNoOwner(ownerState(identity.root, identity.root), flags.has('confirm-no-owner'))
  const decision = decideSync({
    activeOwner: owner.activeOwner,
    ownerState: owner.ownerState,
    isDirty: identity.dirty,
    behind: identity.behind,
    ahead: identity.ahead,
    detached: identity.branch === '(detached)',
  })
  if (flags.has('prepare')) return report({ identity, decision })
  if (!flags.has('apply')) die('sync requires --prepare or --apply --expected-head <sha> --expected-main <sha>')
  if (flags.get('expected-head') !== identity.head || flags.get('expected-main') !== identity.main) die('sync expected head/main does not match live worktree')
  if (decision.action === 'fast_forward') git(['merge', '--ff-only', 'origin/main'], { cwd: identity.root })
  else if (decision.action === 'reset_detached') git(['checkout', '--detach', 'origin/main'], { cwd: identity.root })
  else if (decision.action !== 'none') die(`sync requires manual resolution: ${decision.reason || decision.action}`)
  report({ status: 'synchronized', action: decision.action, identity: currentIdentity() })
}

function retirementProbe(path, { hasOwnerConfirmation = false, mainSha, prInventory, operator } = {}) {
  assertRetirementTargetBoundary(path, operator)
  const evidence = collectPinnedRetirementEvidence({
    mainSha,
    readIdentity: (pinnedMain) => currentIdentity(path, { mainSha: pinnedMain }),
    readUniqueCommitCount: (pinnedHead, pinnedMain) => uniqueCommitCount(path, pinnedHead, pinnedMain),
    readHeadInMain: (pinnedHead, pinnedMain) => isHeadInMain(path, pinnedHead, pinnedMain),
  })
  const identity = evidence.identity
  const owner = hasOwnerConfirmation
    ? confirmNoOwner(ownerState(identity.root, identity.root), true)
    : ownerState(identity.root, identity.root)
  const pr = openPrForIdentity(identity, prInventory)
  const decision = classifyWorktreeRetirement({
    kind: 'worktree',
    branch: identity.branch,
    ownerState: owner.ownerState,
    activeOwner: owner.activeOwner,
    hasOperation: hasGitOperation(identity.root),
    isDirty: identity.dirty,
    openPr: pr,
    uniqueCommits: evidence.uniqueCommits,
    headInMain: evidence.headInMain,
    pathIsReparsePoint: isReparsePoint(identity.root),
  })
  return { identity, owner, pr, decision }
}

function retire({ flags, positionals }) {
  if (flags.has('delete-merged-local-branch')) {
    die('worktree:retire --delete-merged-local-branch is disabled; local branches are always retained')
  }
  const operator = publicIntegrationOperator('worktree:retire')
  if (flags.has('prepare')) {
    const path = flags.get('prepare') === true ? positionals[1] : flags.get('prepare')
    if (!path) die('retire --prepare requires a worktree path')
    assertRetirementTargetBoundary(path, operator)
    const prInventory = openPullRequestInventory(operator.root, { repository: 'happyhome-project/happyHome_public' })
    const probe = retirementProbe(path, {
      hasOwnerConfirmation: flags.has('confirm-no-owner'),
      mainSha: operator.main,
      prInventory,
      operator,
    })
    if (!probe.decision.eligible) return report({ status: 'blocked', ...probe })
    const manifest = createRetirementManifest({
      ...probe.identity,
      path: probe.identity.root,
      provider: probe.owner.lease?.provider || 'manual',
      confirmNoOwner: flags.has('confirm-no-owner'),
    })
    const directory = join(registryDir(operator.root), 'retire')
    mkdirSync(directory, { recursive: true })
    const file = join(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${basename(probe.identity.root)}.json`)
    withRegistryLock(operator.root, () => {
      const liveOperator = publicIntegrationOperator('worktree:retire', { refresh: false, expected: operator })
      assertRetirementTargetBoundary(path, liveOperator)
      const records = loadRetirementRecords(operator.root)
      const record = createRetirementRecord({ manifest, manifestPath: file })
      if (records.records[manifest.manifestId]) die(`retirement manifest id already exists: ${manifest.manifestId}`)
      writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      records.records[manifest.manifestId] = record
      writeRetirementRecords(records, operator.root)
    })
    return report({ status: 'prepared', manifestPath: file, manifest })
  }

  if (!flags.has('apply')) die('retire requires --prepare <path> or --apply <manifest>')
  const manifestPath = resolve(String(flags.get('apply')))
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const managedDirectory = join(registryDir(operator.root), 'retire')
  const refreshedOperator = publicIntegrationOperator('worktree:retire', { refresh: true, expected: operator })
  assertRetirementTargetBoundary(manifest.path, refreshedOperator)
  const prInventory = openPullRequestInventory(refreshedOperator.root, { repository: 'happyhome-project/happyHome_public' })
  executeRetirementCriticalSection({
    withLeaseLock: (action) => withRegistryLock(operator.root, action),
    probe: () => {
      const liveOperator = publicIntegrationOperator('worktree:retire', { refresh: false, expected: refreshedOperator })
      assertRetirementTargetBoundary(manifest.path, liveOperator)
      const records = loadRetirementRecords(operator.root)
      const record = records.records[manifest.manifestId]
      const verification = { manifestPath, managedDirectory, record }
      const liveProbe = retirementProbe(manifest.path, {
        hasOwnerConfirmation: manifest.confirmNoOwner,
        mainSha: liveOperator.main,
        prInventory,
        operator: liveOperator,
      })
      verifyRetirementManifest(manifest, { ...liveProbe.identity, path: liveProbe.identity.root }, verification)
      return { liveProbe, record, records }
    },
    verify: ({ liveProbe }) => {
      if (!liveProbe.decision.eligible) die(`retirement is blocked: ${liveProbe.decision.reasons.join(', ')}`)
    },
    remove: ({ record, records }) => {
      const finalOperator = publicIntegrationOperator('worktree:retire', { refresh: false, expected: refreshedOperator })
      assertRetirementTargetBoundary(manifest.path, finalOperator)
      const finalProbe = retirementProbe(manifest.path, {
        hasOwnerConfirmation: manifest.confirmNoOwner,
        mainSha: finalOperator.main,
        prInventory,
        operator: finalOperator,
      })
      verifyRetirementManifest(manifest, { ...finalProbe.identity, path: finalProbe.identity.root }, {
        manifestPath,
        managedDirectory,
        record,
      })
      if (!finalProbe.decision.eligible) die(`retirement is blocked at final remove: ${finalProbe.decision.reasons.join(', ')}`)
      git(['worktree', 'remove', manifest.path])
      record.consumedAt = new Date().toISOString()
      writeRetirementRecords(records, operator.root)
    },
  })
  report({ status: 'retired', path: manifest.path, branch: manifest.branch })
}

function status() {
  const refreshed = refreshOriginMain(process.cwd(), { required: false })
  const output = git(['worktree', 'list', '--porcelain']).stdout
  const prInventory = openPullRequestInventory(process.cwd())
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
      const lifecycle = ownerState(path)
      const pr = openPrForIdentity(identity, prInventory)
      const retirement = classifyWorktreeRetirement({
        kind,
        branch: identity.branch,
        ownerState: lifecycle.ownerState,
        activeOwner: lifecycle.activeOwner,
        hasOperation: hasGitOperation(identity.root),
        isDirty: identity.dirty,
        openPr: pr,
        uniqueCommits: refreshed.ok ? uniqueCommitCount(identity.root) : null,
        headInMain: refreshed.ok ? isHeadInMain(identity.root) : null,
        pathIsReparsePoint: isReparsePoint(identity.root),
      })
      return {
        kind,
        path,
        head,
        branch,
        identity,
        ...safeMetadata(path),
        lifecycle,
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
    status: refreshed.ok ? 'fresh' : 'stale',
    refresh: refreshed.ok
      ? { ok: true }
      : { ok: false, error: refreshed.stderr || refreshed.stdout || 'git fetch failed' },
    entries,
  })
  if (!refreshed.ok) process.exitCode = 1
}

const { flags, positionals } = parseFlags(process.argv.slice(2))
const command = positionals[0]

try {
  if (command === 'create') create({ flags })
  else if (command === 'doctor') doctor()
  else if (command === 'bootstrap') bootstrap()
  else if (command === 'heartbeat') heartbeat({ flags })
  else if (command === 'status') status()
  else if (command === 'sync-main') sync({ flags })
  else if (command === 'retire') retire({ flags, positionals })
  else die('Usage: worktree.mjs <create|doctor|bootstrap|heartbeat|status|sync-main|retire>')
} catch (error) {
  console.error(`[worktree] ${error?.message || error}`)
  process.exitCode = 1
}
