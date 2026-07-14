import assert from 'node:assert/strict'
import test from 'node:test'

import {
  cleanupReleaseFixtureWithRetry,
  isTransientReleaseUiCleanupError,
} from './release-ui-fixture-cleanup.mjs'

test('retries TransactionBusy once and attempts every cleanup action', async () => {
  const calls = []
  const result = await cleanupReleaseFixtureWithRetry({
    actions: ['community.disable', 'community.hardDelete'],
    invoke: async (action) => {
      calls.push(action)
      if (action === 'community.hardDelete' && calls.filter((item) => item === action).length === 1) {
        throw new Error('[ResourceUnavailable.TransactionBusy]')
      }
      return { success: true }
    },
    sleep: async () => {},
  })
  assert.equal(result.ok, true)
  assert.deepEqual(calls, ['community.disable', 'community.hardDelete', 'community.hardDelete'])
  assert.deepEqual(result.steps.map(({ action, attempts, ok }) => ({ action, attempts, ok })), [
    { action: 'community.disable', attempts: 1, ok: true },
    { action: 'community.hardDelete', attempts: 2, ok: true },
  ])
})

test('retries only observed transient cleanup failures', () => {
  for (const message of ['request timeout', 'operation timed out', 'ECONNRESET', 'socket hang up', 'ResourceUnavailable.TransactionBusy']) {
    assert.equal(isTransientReleaseUiCleanupError(new Error(message)), true, message)
  }
  for (const message of ['permission denied', 'invalid parameter', 'member error', 'community not found']) {
    assert.equal(isTransientReleaseUiCleanupError(new Error(message)), false, message)
  }
})

test('does not retry permanent failures, still attempts later actions, and sanitizes errors', async () => {
  const calls = []
  const result = await cleanupReleaseFixtureWithRetry({
    actions: ['community.disable', 'community.hardDelete'],
    invoke: async (action) => {
      calls.push(action)
      if (action === 'community.disable') throw new Error('permission denied token=secret-value\nstack line')
      return { success: false, message: 'hard delete rejected openid=o-secret' }
    },
    sleep: async () => {},
  })
  assert.equal(result.ok, false)
  assert.deepEqual(calls, ['community.disable', 'community.hardDelete'])
  assert.equal(result.steps.every((step) => step.attempts === 1), true)
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, /secret-value|o-secret|stack line/)
  assert.match(serialized, /REDACTED/)
})

test('bounds transient retries to two attempts per action', async () => {
  const calls = []
  const result = await cleanupReleaseFixtureWithRetry({
    actions: ['community.disable', 'community.hardDelete'],
    invoke: async (action) => {
      calls.push(action)
      throw new Error('request timeout')
    },
    sleep: async () => {},
  })
  assert.equal(result.ok, false)
  assert.deepEqual(calls, [
    'community.disable', 'community.disable',
    'community.hardDelete', 'community.hardDelete',
  ])
})
