#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createReleaseSession, readLatestReleaseSessionPath, readReleaseSession, repairReleaseSession } from './lib/release-session-identity.mjs'

const CANONICAL_ROOT = resolve('C:/Project/Claude/happyHome_public')
const PUBLIC_ORIGIN = 'https://github.com/happyhome-project/happyHome_public.git'
const GENERATED_BUILD_INFO = 'miniprogram/src/generated/build-info.ts'

function option(args, name) {
  const equals = args.find(arg => arg.startsWith(`--${name}=`))
  if (equals) return equals.slice(name.length + 3)
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] || '' : ''
}

function normalizePath(value) {
  return resolve(value).replaceAll('\\', '/').toLowerCase()
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
}

export function collectReleaseSessionGitState(root = process.cwd()) {
  git(root, ['fetch', '--quiet', 'origin', 'main'])
  const commands = [['diff', '--name-only'], ['diff', '--cached', '--name-only'], ['ls-files', '--others', '--exclude-standard']]
  const changedPaths = [...new Set(commands.flatMap(args => git(root, args).split(/\r?\n/).filter(Boolean).map(value => value.replaceAll('\\', '/'))))]
  return {
    root: resolve(root),
    branch: git(root, ['branch', '--show-current']),
    headSha: git(root, ['rev-parse', 'HEAD']),
    originMainSha: git(root, ['rev-parse', 'origin/main']),
    originUrl: git(root, ['remote', 'get-url', 'origin']),
    changedPaths,
  }
}

export function assertCanonicalReleaseSessionGitState(state, { action = 'create', expectedGitSha = '', enforceCanonicalRoot = true } = {}) {
  if (enforceCanonicalRoot && normalizePath(state.root) !== normalizePath(CANONICAL_ROOT)) throw new Error('release session requires canonical public main workspace')
  if (state.branch !== 'main') throw new Error('release session requires main branch')
  if (String(state.originUrl || '').replace(/\/$/, '') !== PUBLIC_ORIGIN) throw new Error('release session requires exact public origin')
  if (state.headSha !== state.originMainSha) throw new Error('release session HEAD must equal origin/main')
  if (expectedGitSha && state.headSha !== expectedGitSha) throw new Error('release session gitSha does not match current main')
  // prepare may have written the release-owned marker before a recoverable failure.
  // deploy.mjs remains responsible for validating that marker against the exact session.
  const allowed = ['prepare', 'publish', 'repair', 'status'].includes(action) ? new Set([GENERATED_BUILD_INFO]) : new Set()
  const unexpected = (state.changedPaths || []).filter(path => !allowed.has(String(path).replaceAll('\\', '/')))
  if (unexpected.length) throw new Error(`release session requires clean workspace; unexpected: ${unexpected.join(', ')}`)
  return state
}

export function buildReleaseSessionInvocation(session, action) {
  const fullCurrent = session.identity.strategy === 'full-current' ? ['--full-current'] : []
  const identity = [
    `--release-run-id=${session.identity.releaseRunId}`,
    `--version=${session.release.version}`,
    `--desc=${session.release.desc}`,
  ]
  if (action === 'prepare') return { command: process.execPath, args: ['scripts/deploy.mjs', 'release-prepare', ...fullCurrent, ...identity] }
  if (action === 'publish') return {
    command: process.execPath,
    args: ['scripts/deploy.mjs', 'release-publish', '--use-tcb', ...fullCurrent, '--resume', ...identity, '--cloud-deploy-concurrency=2', '--cloud-smoke-concurrency=3'],
  }
  throw new Error(`unsupported release session action: ${action}`)
}

function assertSessionPathInsideRoot(root, sessionPath) {
  const absolute = resolve(root, sessionPath)
  const local = relative(resolve(root), absolute)
  if (!local || local === '.' || local === '..' || local.startsWith(`..\\`) || local.startsWith('../')) throw new Error('release session path must stay inside workspace')
  return absolute
}

export async function runReleaseSessionCli({
  argv = process.argv.slice(2),
  root = process.cwd(),
  gitState = null,
  enforceCanonicalRoot = true,
  spawn = spawnSync,
  now = new Date(),
} = {}) {
  const action = argv[0] || 'status'
  const state = gitState || collectReleaseSessionGitState(root)
  if (action === 'create') {
    assertCanonicalReleaseSessionGitState(state, { action, enforceCanonicalRoot })
    return await createReleaseSession({
      root,
      gitSha: state.headSha,
      envId: option(argv, 'env') || process.env.TCB_ENV || 'cloudbase-3gh862acb1505ff3',
      strategy: argv.includes('--main') ? 'main' : 'full-current',
      now,
    })
  }
  const requestedPath = option(argv, 'session')
  const sessionPath = requestedPath
    ? assertSessionPathInsideRoot(root, requestedPath)
    : await readLatestReleaseSessionPath(root)
  const session = await readReleaseSession(sessionPath)
  assertCanonicalReleaseSessionGitState(state, { action, expectedGitSha: session.identity.gitSha, enforceCanonicalRoot })
  if (action === 'status') return { path: sessionPath, session }
  if (action === 'repair') {
    return await repairReleaseSession({
      root,
      sessionPath,
      changes: {
        ...(option(argv, 'run-id') ? { releaseRunId: option(argv, 'run-id') } : {}),
        ...(option(argv, 'version') ? { version: option(argv, 'version') } : {}),
        ...(option(argv, 'desc') ? { desc: option(argv, 'desc') } : {}),
        ...(option(argv, 'display-name') ? { displayName: option(argv, 'display-name') } : {}),
      },
      repairLatest: argv.includes('--repair-latest'),
      reason: option(argv, 'reason'),
      now,
    })
  }
  const invocation = buildReleaseSessionInvocation(session, action)
  const result = spawn(invocation.command, invocation.args, { cwd: root, stdio: 'inherit', windowsHide: true, env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`release session ${action} failed with exit code ${result.status}`)
  return { action, path: sessionPath, releaseRunId: session.identity.releaseRunId, version: session.release.version, desc: session.release.desc }
}

async function main() {
  const result = await runReleaseSessionCli()
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`[release-session] ${error?.message || error}`)
    process.exitCode = 1
  })
}
