import assert from 'node:assert/strict'
import test from 'node:test'

import { runReleaseUiChecks } from './release-ui-check-runner.mjs'

function failure(message) {
  return async () => { throw new Error(message) }
}

test('runs profile identity before provisioning fixture-dependent checks', async () => {
  const calls = []
  const pass = (stage, result = {}) => async () => { calls.push(stage); return result }
  const result = await runReleaseUiChecks({
    coldStart: pass('coldStart'),
    provisionFixture: pass('fixture'),
    archiveTabs: pass('archiveTabs'),
    homeDetail: pass('homeDetail'),
    profile: pass('profile'),
    cleanup: pass('cleanup'),
  })
  assert.deepEqual(calls, ['coldStart', 'profile', 'fixture', 'archiveTabs', 'homeDetail', 'cleanup'])
  assert.equal(result.ok, true)
})

test('profile identity failure skips fixture work and still runs cleanup', async () => {
  const calls = []
  const mark = (stage) => async () => { calls.push(stage) }
  const result = await runReleaseUiChecks({
    coldStart: mark('coldStart'),
    profile: async () => { calls.push('profile'); throw new Error('package identity mismatch') },
    provisionFixture: mark('fixture'),
    archiveTabs: mark('archiveTabs'),
    homeDetail: mark('homeDetail'),
    cleanup: mark('cleanup'),
  })
  assert.deepEqual(calls, ['coldStart', 'profile', 'cleanup'])
  assert.deepEqual(result.failures.map((item) => item.stage), ['profile'])
  assert.deepEqual(result.skipped.map((item) => item.stage), ['provisionFixture', 'archiveTabs', 'homeDetail'])
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

test('fixture failure after profile still runs cleanup', async () => {
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
  assert.deepEqual(calls, ['coldStart', 'profile', 'fixture', 'cleanup'])
  assert.deepEqual(result.failures.map((item) => item.stage), ['provisionFixture'])
  assert.deepEqual(result.skipped.map((item) => item.stage), ['archiveTabs', 'homeDetail'])
})

test('archive tabs failure still runs independent detail evidence and cleanup', async () => {
  const calls = []
  const mark = (stage) => async () => { calls.push(stage) }
  const result = await runReleaseUiChecks({
    coldStart: mark('coldStart'),
    profile: mark('profile'),
    provisionFixture: mark('fixture'),
    archiveTabs: async () => { calls.push('archiveTabs'); throw new Error('tabs failed') },
    homeDetail: mark('homeDetail'),
    cleanup: mark('cleanup'),
  })
  assert.deepEqual(calls, ['coldStart', 'profile', 'fixture', 'archiveTabs', 'homeDetail', 'cleanup'])
  assert.deepEqual(result.failures.map((item) => item.stage), ['archiveTabs'])
  assert.equal(result.ok, false)
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
