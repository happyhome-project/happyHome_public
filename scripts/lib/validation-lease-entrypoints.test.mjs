import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import test from 'node:test'

import { acquireValidationLease } from './validation-lease.mjs'

const root = path.resolve(import.meta.dirname, '..', '..')
const cli = path.join(root, 'scripts', 'validation-lease.mjs')

function runCli(args, homeDir) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
  })
}

test('validation lease CLI reports status and requires complete recovery arguments', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'happyhome-lease-cli-'))
  const status = runCli(['status'], homeDir)
  assert.equal(status.status, 0, status.stderr)
  assert.deepEqual(JSON.parse(status.stdout), { status: 'absent' })

  const invalid = runCli(['recover', '--confirm-no-owner'], homeDir)
  assert.notEqual(invalid.status, 0)
  assert.match(invalid.stderr, /expected-owner-token|reason/i)
})

test('validation lease CLI recovers only the expected stale owner', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'happyhome-lease-cli-'))
  const lease = await acquireValidationLease({ command: 'stale-test', homeDir, now: 0 })
  const result = runCli([
    'recover',
    `--expected-owner-token=${lease.snapshot.ownerToken}`,
    '--confirm-no-owner',
    '--reason=test owner exited',
  ], homeDir)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).snapshot.status, 'recovered')
})

test('DevTools leaf entrypoints each acquire one distinct validation lease', async () => {
  const contracts = new Map([
    ['test-mp.mjs', 'test-mp'],
    ['test-mp-replay.mjs', 'test-mp-replay'],
    ['check-devtools-automation.mjs', 'check-devtools-automation'],
    ['test-mp-release-ui.mjs', 'test-mp-release-ui'],
  ])
  for (const [file, command] of contracts) {
    const source = await readFile(path.join(root, 'scripts', file), 'utf8')
    assert.match(source, /import \{ withValidationLease \} from ['"]\.\/lib\/validation-lease\.mjs['"]/)
    assert.equal(source.match(/withValidationLease\(/g)?.length, 1, file)
    assert.match(source, new RegExp(`withValidationLease\\(\\{ command: ['"]${command}['"] \\},`))
  }
})
test('fixture-write is guarded while read remains unguarded', async () => {
  const source = await readFile(path.join(root, 'scripts', 'env-run.mjs'), 'utf8')
  assert.equal(source.match(/withValidationLease\(/g)?.length, 1)
  assert.match(source, /profile === ['"]fixture-write['"][\s\S]*withValidationLease/)
  assert.doesNotMatch(source, /profile === ['"]read['"][\s\S]{0,120}withValidationLease/)
})

test('a held lease blocks a second guarded fixture-write command', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'happyhome-lease-env-'))
  const env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir, HAPPYHOME_FIXTURE_PREFIX: 'lease-test' }
  const envRun = path.join(root, 'scripts', 'env-run.mjs')
  const first = spawn(process.execPath, [envRun, '--profile=fixture-write', '--', process.execPath, '-e', 'setTimeout(() => {}, 5000)'], {
    cwd: root,
    env,
    stdio: 'ignore',
  })
  try {
    const leasePath = path.join(homeDir, '.happyhome', 'validation-lease.json')
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { await readFile(leasePath); break } catch { await new Promise((resolve) => setTimeout(resolve, 20)) }
    }
    const second = spawnSync(process.execPath, [envRun, '--profile=fixture-write', '--', process.execPath, '-e', 'process.exit(0)'], {
      cwd: root,
      encoding: 'utf8',
      env,
    })
    assert.notEqual(second.status, 0)
    assert.match(second.stderr, /validation lease already exists/i)
  } finally {
    first.kill()
    await new Promise((resolve) => first.once('exit', resolve))
  }
})
