import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import {
  assertAutoReplayFinished,
  assertReleaseReplayCoverage,
  buildAutoReplayArgs,
  resolveReplayConfigPath,
  shouldRequireReleaseReplay,
} from './mp-replay-policy.mjs'

test('requires an explicit release replay config path', () => {
  assert.throws(() => assertReleaseReplayCoverage(''), /HH_MP_REPLAY_CONFIG_PATH/)
})

test('requires both release replay coverage markers', () => {
  const dir = makeTempDir()
  writeFileSync(join(dir, 'release-replay.json'), 'HH_RELEASE_HOME_DETAIL_NONEMPTY', 'utf8')
  assert.throws(() => assertReleaseReplayCoverage(dir), /HH_RELEASE_PROFILE_LOGIN_CLEAN/)
  rmSync(dir, { recursive: true, force: true })
})

test('accepts release replay coverage markers in a file or directory', () => {
  const dir = makeTempDir()
  writeFileSync(join(dir, 'release-replay.json'), [
    'case: HH_RELEASE_HOME_DETAIL_NONEMPTY',
    'case: HH_RELEASE_PROFILE_LOGIN_CLEAN',
  ].join('\n'), 'utf8')
  assert.doesNotThrow(() => assertReleaseReplayCoverage(dir))
  rmSync(dir, { recursive: true, force: true })
})

test('builds auto-replay args with replay config path when provided', () => {
  assert.deepEqual(buildAutoReplayArgs({
    projectPath: 'dist/mp',
    port: 21929,
    replayConfigPath: 'replay.json',
  }), [
    'auto-replay',
    '--project', 'dist/mp',
    '--port', '21929',
    '--replay-all',
    '--trust-project',
    '--replay-config-path', 'replay.json',
  ])
})

test('parses strict replay inputs', () => {
  assert.equal(shouldRequireReleaseReplay(['--require-release-replay'], {}), true)
  assert.equal(shouldRequireReleaseReplay([], { HH_REQUIRE_RELEASE_REPLAY: '1' }), true)
  assert.match(resolveReplayConfigPath({
    args: ['--replay-config-path', 'fixtures/replay.json'],
    env: {},
    cwd: 'C:/repo',
  }), /fixtures[\\/]replay\.json$/)
})

test('requires the auto-replay finish marker', () => {
  assert.throws(() => assertAutoReplayFinished('started'), /finish marker/)
  assert.doesNotThrow(() => assertAutoReplayFinished('auto-replay finish'))
})

function makeTempDir() {
  return mkdirSync(join(tmpdir(), `hh-replay-${Date.now()}-${Math.random().toString(16).slice(2)}`), { recursive: true })
}
