import assert from 'node:assert/strict'
import test from 'node:test'

import { invokeTrustedAdminWithManager, invokeTrustedAdminWithRetry } from './trusted-admin-invoke.mjs'

test('trusted admin manager invocation injects the internal token and returns the function result', async () => {
  let received = null
  const manager = {
    functions: {
      async invokeFunction(name, payload) {
        received = { name, payload }
        return {
          InvokeResult: 0,
          ErrMsg: '',
          RetMsg: JSON.stringify({ success: true, deleted: true }),
        }
      },
    },
  }

  const result = await invokeTrustedAdminWithManager(
    { action: 'community.hardDelete', communityId: 'community-1' },
    { manager, internalToken: 'test-token', timeoutMs: 100 },
  )

  assert.deepEqual(received, {
    name: 'admin',
    payload: {
      action: 'community.hardDelete',
      communityId: 'community-1',
      _internalToken: 'test-token',
    },
  })
  assert.deepEqual(result, { success: true, deleted: true })
})

test('trusted admin manager invocation rejects function failures', async () => {
  const manager = {
    functions: {
      async invokeFunction() {
        return {
          InvokeResult: 0,
          ErrMsg: '',
          RetMsg: JSON.stringify({ success: false, error: 'cleanup failed' }),
        }
      },
    },
  }

  await assert.rejects(
    invokeTrustedAdminWithManager(
      { action: 'community.hardDelete' },
      { manager, internalToken: 'test-token', timeoutMs: 100 },
    ),
    /community\.hardDelete: cleanup failed/,
  )
})

test('trusted admin manager invocation has a bounded timeout', async () => {
  const manager = {
    functions: {
      async invokeFunction() {
        return await new Promise(() => {})
      },
    },
  }

  await assert.rejects(
    invokeTrustedAdminWithManager(
      { action: 'community.hardDelete' },
      { manager, internalToken: 'test-token', timeoutMs: 5 },
    ),
    /community\.hardDelete timed out after 5ms/,
  )
})

test('trusted admin retry repeats only an SCF execution timeout and then returns success', async () => {
  let calls = 0
  const manager = {
    functions: {
      async invokeFunction() {
        calls += 1
        if (calls === 1) {
          return {
            InvokeResult: 1,
            ErrMsg: 'Invoking task timed out after 15 seconds',
            RetMsg: '',
          }
        }
        return {
          InvokeResult: 0,
          ErrMsg: '',
          RetMsg: JSON.stringify({ success: true, deleted: true }),
        }
      },
    },
  }

  const result = await invokeTrustedAdminWithRetry(
    { action: 'community.hardDelete' },
    { manager, internalToken: 'test-token', timeoutMs: 100, attempts: 2 },
  )

  assert.equal(calls, 2)
  assert.deepEqual(result, { success: true, deleted: true })
})

test('trusted admin retry does not repeat non-timeout failures', async () => {
  let calls = 0
  const manager = {
    functions: {
      async invokeFunction() {
        calls += 1
        return {
          InvokeResult: 0,
          ErrMsg: '',
          RetMsg: JSON.stringify({ success: false, error: 'permission denied' }),
        }
      },
    },
  }

  await assert.rejects(
    invokeTrustedAdminWithRetry(
      { action: 'community.hardDelete' },
      { manager, internalToken: 'test-token', timeoutMs: 100, attempts: 2 },
    ),
    /permission denied/,
  )
  assert.equal(calls, 1)
})
