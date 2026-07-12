import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { classifyChanges, parseNameStatusBuffer, parseNumstatBuffer } from './ci-impact.mjs'

const root = resolve(import.meta.dirname, '..', '..')
const cli = join(root, 'scripts', 'ci-impact.mjs')

const expected = (overrides = {}) => ({
  full: false,
  install: true,
  cloud: false,
  admin: false,
  miniprogram: false,
  deployOutput: false,
  docs: false,
  governance: false,
  releasePlan: false,
  ...overrides,
})

test('classifies documentation-only changes as docs and governance', () => {
  assert.deepEqual(classifyChanges([{ status: 'M', path: 'docs/guide.md' }, { status: 'M', path: 'README.md' }, { status: 'A', path: 'TASKS.md' }]), expected({ docs: true, governance: true }))
})

test('classifies product areas and release planning independently', () => {
  assert.deepEqual(classifyChanges([{ status: 'M', path: 'cloud/functions/a.js' }]), expected({ cloud: true, releasePlan: true }))
  assert.deepEqual(classifyChanges([{ status: 'A', path: 'admin-web/src/a.js' }]), expected({ admin: true, releasePlan: true }))
  assert.deepEqual(classifyChanges([{ status: 'M', path: 'miniprogram/pages/a.js' }]), expected({ miniprogram: true, releasePlan: true }))
})

test('cloud shared changes affect every product', () => {
  assert.deepEqual(classifyChanges([{ status: 'M', path: 'cloud/shared/auth.js' }]), expected({ cloud: true, admin: true, miniprogram: true, releasePlan: true }))
})

test('root manifests, toolchain configuration, governance scripts, workflows, and unknown paths require full validation', () => {
  const cases = [
    [{ status: 'M', path: 'package.json' }],
    [{ status: 'M', path: 'package-lock.json' }],
    [{ status: 'M', path: '.nvmrc' }],
    [{ status: 'M', path: '.github/workflows/pr.yml' }],
    [{ status: 'M', path: 'scripts/ci-impact.mjs' }],
    [{ status: 'M', path: 'scripts/release-plan.mjs' }],
    [{ status: 'M', path: 'scripts/worktree.mjs' }],
    [{ status: 'M', path: 'scripts/lib/docs-policy.mjs' }],
    [{ status: 'M', path: 'mystery/file.xyz' }],
  ]
  for (const changes of cases) assert.deepEqual(classifyChanges(changes), expected({ full: true, cloud: true, admin: true, miniprogram: true, deployOutput: true, docs: true, governance: true, releasePlan: true }))
})

test('deletes, renames, copies, and binary diffs require full validation', () => {
  const cases = [
    [{ status: 'D', path: 'docs/old.md' }],
    [{ status: 'R100', path: 'docs/new.md', oldPath: 'docs/old.md' }],
    [{ status: 'C100', path: 'docs/copy.md', oldPath: 'docs/source.md' }],
    [{ status: 'M', path: 'docs/image.png', binary: true }],
  ]
  for (const changes of cases) assert.deepEqual(classifyChanges(changes), expected({ full: true, cloud: true, admin: true, miniprogram: true, deployOutput: true, docs: true, governance: true, releasePlan: true }))
})

test('empty diffs fail explicitly', () => {
  assert.throws(() => classifyChanges([]), /empty diff/i)
})

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim()
}

test('CLI emits one JSON summary and stable GITHUB_OUTPUT booleans', () => {
  const repo = mkdtempSync(join(tmpdir(), 'ci-impact-'))
  git(repo, ['init', '-b', 'main'])
  git(repo, ['config', 'user.name', 'Test'])
  git(repo, ['config', 'user.email', 'test@example.com'])
  writeFileSync(join(repo, 'README.md'), 'one\n')
  git(repo, ['add', 'README.md'])
  git(repo, ['commit', '-m', 'base'])
  const base = git(repo, ['rev-parse', 'HEAD'])
  writeFileSync(join(repo, 'README.md'), 'two\n')
  git(repo, ['commit', '-am', 'head'])
  const head = git(repo, ['rev-parse', 'HEAD'])
  const outputFile = join(repo, 'github-output.txt')
  const result = spawnSync(process.execPath, [cli, `--base=${base}`, `--head=${head}`], { cwd: repo, encoding: 'utf8', windowsHide: true, env: { ...process.env, GITHUB_OUTPUT: outputFile } })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), expected({ docs: true, governance: true }))
  assert.equal(readFileSync(outputFile, 'utf8'), 'full=false\ninstall=true\ncloud=false\nadmin=false\nminiprogram=false\ndeployOutput=false\ndocs=true\ngovernance=true\nreleasePlan=false\n')
})

test('CLI exits nonzero when git diff fails', () => {
  const result = spawnSync(process.execPath, [cli, '--base=not-a-commit', '--head=also-not-a-commit'], { cwd: root, encoding: 'utf8', windowsHide: true })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /git diff/i)
  assert.equal(result.stdout, '')
})

function commitAll(repo, message) {
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-m', message])
  return git(repo, ['rev-parse', 'HEAD'])
}

function runCli(repo, base, head) {
  const result = spawnSync(process.execPath, [cli, `--base=${base}`, `--head=${head}`], { cwd: repo, encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('parses NUL-delimited unusual paths and associates binary numstat by path', () => {
  const changes = parseNameStatusBuffer(Buffer.from('A\0tab\tname.md\0R100\0old\nname.md\0new\nname.md\0C075\0source.md\0copy.md\0'))
  assert.deepEqual(changes, [
    { status: 'A', path: 'tab\tname.md' },
    { status: 'R100', oldPath: 'old\nname.md', path: 'new\nname.md' },
    { status: 'C075', oldPath: 'source.md', path: 'copy.md' },
  ])
  parseNumstatBuffer(Buffer.from('1\t0\ttab\tname.md\0-\t-\tcopy.md\0'), changes)
  assert.equal(changes[0].binary, undefined)
  assert.equal(changes[2].binary, true)
})

test('associates both old and new binary numstat paths with one rename change', () => {
  const changes = [{ status: 'R100', oldPath: 'old.bin', path: 'new.bin' }]
  parseNumstatBuffer(Buffer.from('-\t-\told.bin\0-\t-\tnew.bin\0'), changes)
  assert.equal(changes[0].binary, true)
  assert.deepEqual(classifyChanges(changes), expected({ full: true, cloud: true, admin: true, miniprogram: true, deployOutput: true, docs: true, governance: true, releasePlan: true }))
})

test('CLI handles real rename/copy records and mixed binary and ordinary files', () => {
  const dangerousRepo = mkdtempSync(join(tmpdir(), 'ci-impact-dangerous-'))
  git(dangerousRepo, ['init', '-b', 'main'])
  git(dangerousRepo, ['config', 'user.name', 'Test'])
  git(dangerousRepo, ['config', 'user.email', 'test@example.com'])
  writeFileSync(join(dangerousRepo, 'rename-source.md'), 'same content\n')
  writeFileSync(join(dangerousRepo, 'copy-source.md'), 'copy content\n')
  const dangerousBase = commitAll(dangerousRepo, 'base')
  git(dangerousRepo, ['mv', 'rename-source.md', 'renamed-file.md'])
  writeFileSync(join(dangerousRepo, 'copy-source.md'), 'copy content changed\n')
  writeFileSync(join(dangerousRepo, 'copied-file.md'), 'copy content\n')
  writeFileSync(join(dangerousRepo, 'ordinary.md'), 'ordinary\n')
  writeFileSync(join(dangerousRepo, 'binary-asset.md'), Buffer.from([0, 1, 2, 3]))
  const dangerousHead = commitAll(dangerousRepo, 'dangerous paths')
  assert.deepEqual(runCli(dangerousRepo, dangerousBase, dangerousHead), expected({ full: true, cloud: true, admin: true, miniprogram: true, deployOutput: true, docs: true, governance: true, releasePlan: true }))
})
