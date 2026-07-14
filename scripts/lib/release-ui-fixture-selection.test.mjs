import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyAndWaitForReleaseFixtureSelection,
  waitForReleaseFixtureSelection,
} from './release-ui-fixture-selection.mjs'

test('waits for a newly active membership to become visible to bootstrap', async () => {
  const snapshots = [
    { currentCommunityId: 'old-community', communities: [] },
    { currentCommunityId: 'old-community', communities: [{ _id: 'fixture-community' }] },
    { currentCommunityId: 'fixture-community', communities: [{ _id: 'fixture-community' }] },
  ]
  const delays = []

  const result = await waitForReleaseFixtureSelection({
    communityId: 'fixture-community',
    attempts: 3,
    delayMs: 25,
    bootstrap: async () => snapshots.shift(),
    sleep: async (ms) => delays.push(ms),
  })

  assert.equal(result.snapshot.currentCommunityId, 'fixture-community')
  assert.equal(result.attempt, 3)
  assert.deepEqual(delays, [25, 25])
})

test('applies exactly once while bootstrap converges', async () => {
  let applyCalls = 0
  let bootstrapCalls = 0

  const result = await applyAndWaitForReleaseFixtureSelection({
    communityId: 'fixture-community',
    attempts: 3,
    delayMs: 0,
    apply: async () => {
      applyCalls += 1
      return { status: 'active' }
    },
    bootstrap: async () => {
      bootstrapCalls += 1
      return { currentCommunityId: bootstrapCalls === 3 ? 'fixture-community' : 'old-community' }
    },
    sleep: async () => {},
  })

  assert.equal(result.attempt, 3)
  assert.equal(applyCalls, 1)
  assert.equal(bootstrapCalls, 3)
})

test('does not hide a release fixture membership application error', async () => {
  let bootstrapCalls = 0
  await assert.rejects(
    applyAndWaitForReleaseFixtureSelection({
      communityId: 'fixture-community',
      apply: async () => {
        throw new Error('[wx.cloud] member/apply: permission denied')
      },
      bootstrap: async () => {
        bootstrapCalls += 1
        return {}
      },
    }),
    /permission denied/,
  )
  assert.equal(bootstrapCalls, 0)
})

test('fails after the bounded attempts with sanitized selection evidence', async () => {
  let calls = 0

  await assert.rejects(
    waitForReleaseFixtureSelection({
      communityId: 'fixture-community',
      attempts: 2,
      delayMs: 0,
      bootstrap: async () => {
        calls += 1
        return {
          currentCommunityId: 'old-community',
          communities: [{ _id: 'another-community' }],
          viewerOpenId: 'must-not-leak',
          backgroundFetchToken: 'must-not-leak',
        }
      },
      sleep: async () => {},
    }),
    (error) => {
      assert.match(error.message, /after 2 attempts/)
      assert.match(error.message, /actual=old-community/)
      assert.match(error.message, /fixtureListed=false/)
      assert.doesNotMatch(error.message, /must-not-leak/)
      return true
    },
  )
  assert.equal(calls, 2)
})
