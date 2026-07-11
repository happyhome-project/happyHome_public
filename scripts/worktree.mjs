#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'

import {
  confirmNoOwner,
  createWorktreePlan,
  createRetirementManifest,
  decideSync,
  evaluateLeaseOwner,
  evaluateRetirement,
  verifyRetirementManifest,
} from './lib/worktree-lifecycle.mjs'
import { assessRuntime } from './lib/worktree-environment.mjs'
import { acquireIntegrationLock } from './lib/integrate-pr-policy.mjs'

function die(message) {
  throw new Error(message)
}

function git(args, { cwd = process.cwd(), allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0 && !allowFailure) die(`git ${args.join(' ')} failed: ${String(result.stderr || '').trim() || `exit ${result.status}`}`)
  return { ok: result.status === 0, stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim() }
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

function currentIdentity(cwd = process.cwd()) {
  const root = git(['rev-parse', '--show-toplevel'], { cwd }).stdout
  const branch = git(['branch', '--show-current'], { cwd: root }).stdout || '(detached)'
  const head = git(['rev-parse', 'HEAD'], { cwd: root }).stdout
  const main = git(['rev-parse', 'origin/main'], { cwd: root }).stdout
  const [behind, ahead] = git(['rev-list', '--left-right', '--count', 'origin/main...HEAD'], { cwd: root }).stdout.split(/\s+/).map(Number)
  const dirty = git(['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root }).stdout.length > 0
  return { root, branch, head, main, behind, ahead, dirty }
}

function refreshOriginMain(cwd, { required = true } = {}) {
  const result = git(['fetch', '--quiet', 'origin', 'main'], { cwd, allowFailure: true })
  if (!result.ok && required) die(`unable to refresh origin/main: ${result.stderr || result.stdout || 'git fetch failed'}`)
  return result
}

function hasGitOperation(cwd) {
  const directory = git(['rev-parse', '--absolute-git-dir'], { cwd }).stdout
  return ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG', 'rebase-merge', 'rebase-apply', 'sequencer']
    .some((name) => existsSync(join(directory, name)))
}

function isCanonicalMain(path, branch) {
  return branch === 'main' && normalizePath(path) === normalizePath('C:\\Project\\Claude\\happyHome')
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

function registeredWorktreePaths(root) {
  const output = git(['worktree', 'list', '--porcelain'], { cwd: root }).stdout
  return output.split(/\n\n/).filter(Boolean).map((block) => {
    const line = block.split(/\r?\n/).find((value) => value.startsWith('worktree '))
    return line ? line.slice('worktree '.length) : ''
  }).filter(Boolean)
}

function assertRegisteredWorktree(path, root) {
  const requested = normalizePath(path)
  if (!registeredWorktreePaths(root).some((candidate) => normalizePath(candidate) === requested)) {
    die(`retire target is not a registered HappyHome worktree: ${path}`)
  }
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

function isHeadInMain(cwd) {
  return git(['merge-base', '--is-ancestor', 'HEAD', 'origin/main'], { cwd, allowFailure: true }).ok
}

function uniqueCommitCount(cwd) {
  return Number(git(['rev-list', '--count', 'HEAD', '--not', 'origin/main', '--remotes=origin'], { cwd }).stdout || '0')
}

function openPrForBranch(branch, cwd) {
  if (!branch || branch === '(detached)') return { known: true, open: false }
  const result = spawnSync('gh', ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error || result.status !== 0) return { known: false, open: true }
  try {
    return { known: true, open: JSON.parse(String(result.stdout || '[]')).length > 0 }
  } catch {
    return { known: false, open: true }
  }
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

function requireCanonicalMain(identity, action) {
  if (!isCanonicalMain(identity.root, identity.branch)) {
    die(`${action} must run in the canonical main workspace C:\\Project\\Claude\\happyHome`)
  }
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
  const identity = currentIdentity(input.worktree_path || input.worktreePath || input.cwd || process.cwd())
  withRegistryLock(identity.root, () => {
    const registry = loadRegistry(identity.root)
    registry.leases[pathKey(identity.root)] = {
      provider: flags.get('provider') || input.provider || 'codex',
      ownerId: input.session_id || input.sessionId || null,
      path: identity.root,
      branch: identity.branch,
      head: identity.head,
      retention: input.retention || 'managed',
      state: 'active',
      lastSeenAt: new Date().toISOString(),
    }
    writeRegistry(registry, identity.root)
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
  const beforeFetch = currentIdentity()
  requireCanonicalMain(beforeFetch, 'worktree:create')
  if (beforeFetch.dirty) die('worktree:create requires a clean canonical main workspace')
  const runtime = assessRuntime({ nodeVersion: process.versions.node, npmVersion: npmVersion(beforeFetch.root) })
  if (!runtime.ready) die(`worktree:create requires Node 24 and npm 11; got Node ${process.versions.node}, npm ${npmVersion(beforeFetch.root) || '(unavailable)'}`)
  if (isWithinPath(plan.path, beforeFetch.root)) die('worktree:create target must not be inside the canonical main workspace')
  if (hasExistingReparseAncestor(dirname(plan.path))) die('worktree:create target must not have a reparse-point ancestor')
  if (existsSync(plan.path)) die(`worktree:create target already exists: ${plan.path}`)

  refreshOriginMain(beforeFetch.root)
  const identity = currentIdentity(beforeFetch.root)
  if (identity.head !== identity.main) die('worktree:create requires canonical main HEAD to equal origin/main after fetch')
  const agents = git(['cat-file', '-e', 'origin/main:AGENTS.md'], { cwd: identity.root, allowFailure: true })
  if (!agents.ok) die('worktree:create requires origin/main to contain AGENTS.md')

  git(['worktree', 'add', '-b', plan.branch, plan.path, 'origin/main'], { cwd: identity.root })
  const created = currentIdentity(plan.path)
  if (created.branch !== plan.branch || created.head !== identity.main) {
    die('worktree:create verification failed; refusing automatic cleanup of the new worktree')
  }
  const agentsPath = join(created.root, 'AGENTS.md')
  if (!existsSync(agentsPath) || isReparsePoint(agentsPath)) {
    die('worktree:create requires a real AGENTS.md in the new worktree')
  }
  bootstrap(created.root)
}

function sync({ flags }) {
  refreshOriginMain(process.cwd())
  const identity = currentIdentity()
  const owner = ownerState(identity.root, identity.root)
  const decision = decideSync({
    activeOwner: owner.activeOwner,
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

function retirementProbe(path, { hasOwnerConfirmation = false } = {}) {
  const identity = currentIdentity(path)
  const owner = hasOwnerConfirmation
    ? confirmNoOwner(ownerState(identity.root, identity.root), true)
    : ownerState(identity.root, identity.root)
  const pr = openPrForBranch(identity.branch, identity.root)
  const decision = evaluateRetirement({
    ...owner,
    hasOperation: hasGitOperation(identity.root),
    isCanonicalMain: isCanonicalMain(identity.root, identity.branch),
    isDirty: identity.dirty,
    openPr: pr.open,
    uniqueCommits: uniqueCommitCount(identity.root),
    headInMain: isHeadInMain(identity.root),
    pathIsReparsePoint: isReparsePoint(identity.root),
  })
  return { identity, owner, pr, decision }
}

function retire({ flags, positionals }) {
  const operator = currentIdentity()
  requireCanonicalMain(operator, 'worktree:retire')
  refreshOriginMain(operator.root)
  if (flags.has('prepare')) {
    const path = flags.get('prepare') === true ? positionals[1] : flags.get('prepare')
    if (!path) die('retire --prepare requires a worktree path')
    assertRegisteredWorktree(path, operator.root)
    const probe = retirementProbe(path, { hasOwnerConfirmation: flags.has('confirm-no-owner') })
    if (!probe.decision.eligible) return report({ status: 'blocked', ...probe })
    const manifest = createRetirementManifest({ ...probe.identity, path: probe.identity.root, provider: probe.owner.lease?.provider || 'manual' })
    const directory = join(registryDir(probe.identity.root), 'retire')
    mkdirSync(directory, { recursive: true })
    const file = join(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${basename(probe.identity.root)}.json`)
    writeFileSync(file, `${JSON.stringify({ ...manifest, confirmNoOwner: flags.has('confirm-no-owner') }, null, 2)}\n`, 'utf8')
    return report({ status: 'prepared', manifestPath: file, manifest })
  }

  if (!flags.has('apply')) die('retire requires --prepare <path> or --apply <manifest>')
  const manifestPath = String(flags.get('apply'))
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assertRegisteredWorktree(manifest.path, operator.root)
  const probe = retirementProbe(manifest.path, { hasOwnerConfirmation: manifest.confirmNoOwner === true })
  verifyRetirementManifest(manifest, { ...probe.identity, path: probe.identity.root })
  if (!probe.decision.eligible) die(`retirement is blocked: ${probe.decision.reasons.join(', ')}`)
  git(['worktree', 'remove', manifest.path])
  if (flags.has('delete-merged-local-branch') && manifest.branch !== '(detached)') {
    git(['branch', '-d', manifest.branch], { cwd: 'C:\\Project\\Claude\\happyHome' })
  }
  report({ status: 'retired', path: manifest.path, branch: manifest.branch })
}

function status() {
  const refreshed = refreshOriginMain(process.cwd(), { required: false })
  if (!refreshed.ok) {
    report({ status: 'stale', refresh: { ok: false, error: refreshed.stderr || refreshed.stdout || 'git fetch failed' }, entries: [] })
    process.exitCode = 1
    return
  }
  const output = git(['worktree', 'list', '--porcelain']).stdout
  const blocks = output.split(/\n\n/).filter(Boolean)
  const entries = blocks.map((block) => {
    const lines = block.split(/\r?\n/)
    const path = lines.find((line) => line.startsWith('worktree '))?.slice(9)
    const head = lines.find((line) => line.startsWith('HEAD '))?.slice(5)
    const branch = lines.find((line) => line.startsWith('branch refs/heads/'))?.slice('branch refs/heads/'.length) || '(detached)'
    try {
      const identity = currentIdentity(path)
      return {
        path,
        head,
        branch,
        identity,
        ...safeMetadata(path),
        lifecycle: ownerState(path),
      }
    } catch (error) {
      return {
        path,
        head,
        branch,
        ...safeMetadata(path),
        lifecycle: { activeOwner: false, ownerState: 'unknown', stale: false, lease: null },
        probeError: error?.message || String(error),
      }
    }
  })
  report({ status: 'fresh', refresh: { ok: true }, entries })
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
