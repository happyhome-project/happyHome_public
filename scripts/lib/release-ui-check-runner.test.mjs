import assert from 'node:assert/strict'
import test from 'node:test'

import { runReleaseUiChecks } from './release-ui-check-runner.mjs'

function failure(message) {
  return async () => { throw new Error(message) }
}

test('collects independent archive and profile failures before returning', async () => {
  const calls = []
  const pass = (stage, result = {}) => async () => { calls.push(stage); return result }
  const fail = (stage) => async () => { calls.push(stage); throw new Error(stage) }
  const result = await runReleaseUiChecks({
    coldStart: pass('coldStart'),
    provisionFixture: pass('fixture'),
    archiveTabs: fail('archiveTabs'),
    homeDetail: pass('homeDetail'),
    profile: fail('profile'),
    cleanup: pass('cleanup'),
  })
  assert.deepEqual(calls, ['coldStart', 'fixture', 'archiveTabs', 'homeDetail', 'profile', 'cleanup'])
  assert.deepEqual(result.failures.map((item) => item.stage), ['archiveTabs', 'profile'])
})

test('cold-start failure skips fixture-dependent checks but still runs profile and cleanup', async () => {
  const calls = []
  const mark = (stage) => async () => { calls.push(stage) }
  const result = await runReleaseUiChecks({
    coldStart: async () => { calls.push('coldStart'); throw new Error('cold') },
    provisionFixture: mark('fixture'),
    archiveTabs: mark('archiveTabs'),
    homeDetail: mark('homeDetail'),
    profile: mark('profile'),
    cleanup: mark('cleanup'),
  })
  assert.deepEqual(calls, ['coldStart', 'profile', 'cleanup'])
  assert.deepEqual(result.skipped.map((item) => item.stage), ['provisionFixture', 'archiveTabs', 'homeDetail'])
})

test('fixture failure still runs profile and cleanup', async () => {
  const calls = []
  const mark = (stage) => async () => { calls.push(stage) }
  const result = await runReleaseUiChecks({
    coldStart: mark('coldStart'),
    provisionFixture: async () => { calls.push('fixture'); throw new Error('fixture') },
    archiveTabs: mark('archiveTabs'),
    homeDetail: mark('homeDetail'),
    profile: mark('profile'),
    cleanup: mark('cleanup'),
  })
  assert.deepEqual(calls, ['coldStart', 'fixture', 'profile', 'cleanup'])
  assert.deepEqual(result.failures.map((item) => item.stage), ['provisionFixture'])
})

test('sanitizes stage errors and always reports cleanup failures last', async () => {
  const result = await runReleaseUiChecks({
    coldStart: failure('bad token=secret\nstack'),
    profile: failure('profile failed'),
    cleanup: failure('cleanup openid=o-secret'),
  })
  assert.deepEqual(result.failures.map((item) => item.stage), ['coldStart', 'profile', 'cleanup'])
  assert.doesNotMatch(JSON.stringify(result), /secret|stack|o-secret/)
})
