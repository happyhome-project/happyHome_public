#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import {
  assertPrePushAllowed,
  assertWorktreePolicy,
  formatWorktreeReport,
  parseDivergence,
} from './lib/worktree-policy.mjs'

function runGit(args, cwd = process.cwd()) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr || '').trim() || `exit ${result.status}`}`)
  }
  return String(result.stdout || '').trim()
}

function runPostCheckoutPreflight() {
  const root = runGit(['rev-parse', '--show-toplevel'])
  const branch = runGit(['branch', '--show-current'], root)
  const head = runGit(['rev-parse', 'HEAD'], root)
  const { behind, ahead } = parseDivergence(runGit(['rev-list', '--left-right', '--count', 'origin/main...HEAD'], root))

  console.log(formatWorktreeReport({ cwd: root, branch, head, behind, ahead }))
  assertWorktreePolicy({
    agentsExists: existsSync(join(root, 'AGENTS.md')),
    branch,
    cwd: root,
  })
}

function runPrePushPolicy() {
  assertPrePushAllowed(readFileSync(0, 'utf8'))
}

try {
  if (process.argv.includes('--pre-push')) runPrePushPolicy()
  else runPostCheckoutPreflight()
} catch (error) {
  console.error(`[worktree-preflight] ${error?.message || error}`)
  process.exitCode = 1
}
