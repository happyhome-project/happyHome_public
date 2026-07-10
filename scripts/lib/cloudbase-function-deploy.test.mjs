import assert from 'node:assert/strict'
import test from 'node:test'

import { deployFunctionsWithConcurrency } from './cloudbase-function-deploy.mjs'

test('deployFunctionsWithConcurrency runs deploy then detail per function with bounded parallelism', async () => {
  const events = []
  let active = 0
  let maxActive = 0
  const result = await deployFunctionsWithConcurrency({
    functions: ['post', 'admin', 'user'],
    concurrency: 2,
    deployOne: async (fn) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      events.push(`${fn}:deploy:start`)
      await new Promise((resolve) => setTimeout(resolve, fn === 'post' ? 30 : 10))
      events.push(`${fn}:deploy:end`)
      active -= 1
      return { ok: true, reason: 'ok' }
    },
    detailOne: async (fn) => {
      events.push(`${fn}:detail:start`)
      await new Promise((resolve) => setTimeout(resolve, 1))
      events.push(`${fn}:detail:end`)
      return { ok: true, output: JSON.stringify({ data: { Status: 'Active' } }) }
    },
  })

  assert.equal(maxActive, 2)
  assert.deepEqual(result.map((item) => item.fn), ['post', 'admin', 'user'])
  for (const fn of ['post', 'admin', 'user']) {
    assert(events.indexOf(`${fn}:deploy:end`) < events.indexOf(`${fn}:detail:start`))
  }
  assert(result.every((item) => item.status === 'passed'))
  assert(result.every((item) => item.durationMs >= 0))
})

test('deployFunctionsWithConcurrency rejects when a function deploy fails', async () => {
  let error
  try {
    await deployFunctionsWithConcurrency({
      functions: ['post', 'admin'],
      concurrency: 2,
      deployOne: async (fn) => fn === 'admin'
        ? { ok: false, reason: 'deploy failed' }
        : { ok: true, reason: 'ok' },
      detailOne: async () => ({ ok: true, output: '{}' }),
    })
  } catch (caught) {
    error = caught
  }

  assert.match(error?.message || '', /admin deploy failed: deploy failed/)
  assert(Array.isArray(error.functionResults))
  const admin = error.functionResults.find((item) => item.fn === 'admin')
  assert.equal(admin.status, 'failed')
  assert.equal(admin.deploy.reason, 'deploy failed')
  assert.equal(admin.detail, null)
})

test('deployFunctionsWithConcurrency keeps per-function evidence when deploy or detail throws', async () => {
  let error
  try {
    await deployFunctionsWithConcurrency({
      functions: ['post', 'admin', 'user'],
      concurrency: 2,
      deployOne: async (fn) => {
        if (fn === 'admin') throw new Error('spawn failed')
        return { ok: true, reason: 'ok' }
      },
      detailOne: async (fn) => {
        if (fn === 'user') throw new Error('detail crashed')
        return { ok: true, output: '{}' }
      },
    })
  } catch (caught) {
    error = caught
  }

  assert.match(error?.message || '', /admin deploy failed: spawn failed/)
  assert.deepEqual(error.functionResults.map((item) => item.fn), ['post', 'admin', 'user'])
  const admin = error.functionResults.find((item) => item.fn === 'admin')
  assert.equal(admin.status, 'failed')
  assert.equal(admin.deploy.reason, 'spawn failed')
  assert.equal(admin.detail, null)
  const user = error.functionResults.find((item) => item.fn === 'user')
  assert.equal(user.status, 'failed')
  assert.equal(user.detail.reason, 'detail crashed')
})

test('deployFunctionsWithConcurrency runs the release fence immediately before each function deployment', async () => {
  const events = []
  await deployFunctionsWithConcurrency({
    functions: ['post', 'admin'],
    concurrency: 2,
    beforeDeploy: async (fn) => events.push(`${fn}:fence`),
    afterDeploy: async (fn) => events.push(`${fn}:record`),
    deployOne: async (fn) => { events.push(`${fn}:deploy`); return { ok: true } },
    detailOne: async () => ({ ok: true }),
  })

  for (const fn of ['post', 'admin']) {
    assert(events.indexOf(`${fn}:fence`) < events.indexOf(`${fn}:deploy`))
    assert(events.indexOf(`${fn}:deploy`) < events.indexOf(`${fn}:record`))
  }
})
