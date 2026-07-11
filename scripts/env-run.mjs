#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import process from 'node:process'

import { assertEnvironmentProfile } from './lib/environment-profile.mjs'

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0) throw new Error(`git ${args.join(' ')} failed`)
  return String(result.stdout || '').trim()
}

function parse(argv) {
  const separator = argv.indexOf('--')
  const options = separator === -1 ? argv : argv.slice(0, separator)
  const command = separator === -1 ? [] : argv.slice(separator + 1)
  const profile = options.find((value) => value.startsWith('--profile='))?.slice('--profile='.length)
  if (!profile) throw new Error('env:run requires --profile=read|fixture-write|release')
  if (command.length === 0) throw new Error('env:run requires a command after --')
  return { profile, command }
}

try {
  const { profile, command } = parse(process.argv.slice(2))
  const cwd = git(['rev-parse', '--show-toplevel'])
  assertEnvironmentProfile(profile, {
    cwd,
    branch: git(['branch', '--show-current']),
    dirty: git(['status', '--porcelain=v1', '--untracked-files=all']).length > 0,
    head: git(['rev-parse', 'HEAD']),
    originMain: git(['rev-parse', 'origin/main']),
  })
  if (profile === 'fixture-write' && !process.env.HAPPYHOME_FIXTURE_PREFIX) {
    throw new Error('fixture-write requires HAPPYHOME_FIXTURE_PREFIX for isolated test data')
  }
  const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  process.exitCode = result.status || 0
} catch (error) {
  console.error(`[env-run] ${error?.message || error}`)
  process.exitCode = 1
}
