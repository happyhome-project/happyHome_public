import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { assessRuntime } from './worktree-environment.mjs'

test('environment accepts only the pinned Node 24 and npm 11 major versions', () => {
  assert.deepEqual(assessRuntime({ nodeVersion: '24.14.1', npmVersion: '11.11.0' }), {
    ready: true,
    reasons: [],
  })
  assert.deepEqual(assessRuntime({ nodeVersion: '22.15.0', npmVersion: '11.11.0' }), {
    ready: false,
    reasons: ['node_major'],
  })
  assert.deepEqual(assessRuntime({ nodeVersion: '24.14.1', npmVersion: '10.9.2' }), {
    ready: false,
    reasons: ['npm_major'],
  })
})

test('root package exposes the governed worktree commands and runtime contract', () => {
  const packagePath = fileURLToPath(new URL('../../package.json', import.meta.url))
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))

  assert.equal(pkg.engines.node, '24.x')
  assert.equal(pkg.engines.npm, '11.x')
  assert.equal(pkg.packageManager, 'npm@11.11.0')
  for (const command of ['worktree:create', 'worktree:doctor', 'worktree:bootstrap', 'worktree:status', 'worktree:sync-main', 'worktree:retire', 'docs:check', 'docs:catalog']) {
    assert.equal(typeof pkg.scripts[command], 'string', `missing package script ${command}`)
  }
})

test('Windows hook commands derive the repository root with CMD syntax', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const codex = JSON.parse(readFileSync(`${root}/.codex/hooks.json`, 'utf8'))
  const claude = JSON.parse(readFileSync(`${root}/.claude/settings.json`, 'utf8'))
  const commands = [
    codex.hooks.SessionStart[0].hooks[0].commandWindows,
    claude.hooks.SessionStart[0].hooks[0].command,
    claude.hooks.CwdChanged[0].hooks[0].command,
  ]

  for (const command of commands) {
    assert.match(command, /for \/f/i)
    assert.doesNotMatch(command, /\$\(/)
    assert.match(command, /worktree\.mjs/)
  }
})
