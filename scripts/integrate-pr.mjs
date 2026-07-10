#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { isAbsolute, join, resolve, win32 } from 'node:path'
import process from 'node:process'

import {
  acquireIntegrationLock,
  integratePullRequest,
  parsePrNumber,
  resolveSpawnInvocation,
} from './lib/integrate-pr-policy.mjs'

function runCommand(command, args, { cwd = process.cwd() } = {}) {
  const invocation = resolveSpawnInvocation(command, args)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim() || `exit ${result.status}`
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`)
  }
  return String(result.stdout || '')
}

function getPrNumberArgument(args) {
  const equalsArgument = args.find((argument) => argument.startsWith('--pr='))
  if (equalsArgument) return equalsArgument.slice('--pr='.length)
  const flagIndex = args.indexOf('--pr')
  if (flagIndex >= 0) return args[flagIndex + 1]
  return args.find((argument) => !argument.startsWith('--'))
}

function integrationLockPath(root, gitCommonDir) {
  if (/^[a-z]:[\\/]/i.test(root)) {
    const directory = win32.isAbsolute(gitCommonDir) ? gitCommonDir : win32.resolve(root, gitCommonDir)
    return win32.join(directory, 'happyhome-integrate-pr.lock')
  }
  const directory = isAbsolute(gitCommonDir) ? gitCommonDir : resolve(root, gitCommonDir)
  return join(directory, 'happyhome-integrate-pr.lock')
}

try {
  const prNumber = parsePrNumber(getPrNumberArgument(process.argv.slice(2)))
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const result = await integratePullRequest({
    cwd: process.cwd(),
    prNumber,
    runCommand,
    acquireLock: ({ root, gitCommonDir, prNumber: lockedPrNumber }) => acquireIntegrationLock(
      integrationLockPath(root, gitCommonDir),
      { prNumber: lockedPrNumber },
    ),
    packageScripts: packageJson.scripts || {},
  })

  console.log(`[integrate-pr] merged PR #${result.prNumber} at ${result.headRefOid}`)
  console.log('[integrate-pr] main updated with git pull --ff-only origin main')
  console.log(`[integrate-pr] release plan ${result.releasePlanInvoked ? 'completed' : 'skipped (release:plan is not defined)'}`)
} catch (error) {
  console.error(`[integrate-pr] ${error?.message || error}`)
  process.exitCode = 1
}
