import assert from 'node:assert/strict'
import test from 'node:test'
import { runReleasePreflight } from './release-preflight.mjs'

test('release preflight aggregates failed and indeterminate checks instead of failing first', async () => {
  const result = await runReleasePreflight({ checks: [
    { name: 'collections', run: async () => ({ status: 'failed', detail: 'missing' }) },
    { name: 'index', run: async () => { throw new Error('socket secret=do-not-print') } },
    { name: 'trigger', run: async () => ({ status: 'passed' }) },
  ] })
  assert.equal(result.ok, false)
  assert.deepEqual(result.checks.map(item => item.status), ['failed', 'indeterminate', 'passed'])
  assert.doesNotMatch(JSON.stringify(result), /do-not-print/)
})

test('release preflight always cleans up a unique temporary fixture', async () => {
  const calls = []
  const result = await runReleasePreflight({ checks: [{
    name: 'probe',
    createFixture: async () => { calls.push('create'); return { id: 'unique-secret' } },
    run: async () => { calls.push('run'); throw new Error('pending') },
    cleanupFixture: async fixture => { calls.push(`cleanup:${fixture.id}`) },
  }] })
  assert.deepEqual(calls, ['create', 'run', 'cleanup:unique-secret'])
  assert.equal(result.checks[0].status, 'indeterminate')
})

test('release preflight reports cleanup failure and fails closed', async () => {
  const result = await runReleasePreflight({ checks: [{
    name: 'probe', createFixture: async () => ({ id: 'x' }), run: async () => ({ status: 'passed' }),
    cleanupFixture: async () => { throw new Error('cleanup failed') },
  }] })
  assert.equal(result.ok, false)
  assert.equal(result.checks[0].status, 'failed')
  assert.equal(result.checks[0].cleanup, 'failed')
})

test('release preflight cleans a predeclared fixture identity when create throws after remote commit', async () => {
  const cleaned = []
  const identity = { runId: 'known-before-create' }
  const result = await runReleasePreflight({ checks: [{ name: 'probe', fixture: identity,
    createFixture: async () => { throw new Error('response lost') },
    run: async () => ({ status: 'passed' }), cleanupFixture: async fixture => cleaned.push(fixture.runId),
  }] })
  assert.deepEqual(cleaned, ['known-before-create'])
  assert.equal(result.ok, false)
})
