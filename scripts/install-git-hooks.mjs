#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import { assertHooksPathConfigured } from './lib/worktree-policy.mjs'

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

try {
  const root = runGit(['rev-parse', '--show-toplevel'])
  for (const hook of ['post-checkout', 'pre-push']) {
    if (!existsSync(join(root, '.githooks', hook))) throw new Error(`Missing tracked hook: .githooks/${hook}`)
  }

  runGit(['config', '--local', 'core.hooksPath', '.githooks'], root)
  const configured = runGit(['config', '--local', '--get', 'core.hooksPath'], root)
  assertHooksPathConfigured(configured)
  console.log(`[git-hooks] core.hooksPath=${configured}`)
} catch (error) {
  console.error(`[git-hooks] ${error?.message || error}`)
  process.exitCode = 1
}
