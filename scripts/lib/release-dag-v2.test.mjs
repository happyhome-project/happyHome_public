import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertRagBootstrapVerified,
  executeReleaseDagV2,
  isReleaseDagV2Enabled,
  partitionReleaseCloudFunctions,
  releaseDagMode,
} from './release-dag-v2.mjs'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, reject, resolve }
}

function successfulDeps(events, overrides = {}) {
  return {
    preflight: async () => events.push('preflight'),
    configureRag: async () => events.push('configure-rag'),
    deployRag: async () => events.push('deploy-rag'),
    startTimer: async () => { events.push('timer-fixture-ready'); return { id: 'timer' } },
    waitTimer: async () => { events.push('timer-wait'); return { complete: true } },
    cleanupTimer: async () => events.push('timer-cleanup'),
    deployRemainingCloud: async () => events.push('deploy-other-cloud'),
    runBasicCloudSmoke: async () => events.push('basic-cloud-smoke'),
    runBackfill: async () => events.push('backfill'),
    runSemanticGates: async () => events.push('semantic-gates'),
    publishAdmin: async () => events.push('admin'),
    publishMiniprogram: async () => events.push('mini'),
    ...overrides,
  }
}

test('DAG V2 is default-on and only explicit zero selects legacy order', () => {
  assert.equal(isReleaseDagV2Enabled({}), true)
  assert.equal(isReleaseDagV2Enabled({ HH_RELEASE_DAG_V2: '1' }), true)
  assert.equal(isReleaseDagV2Enabled({ HH_RELEASE_DAG_V2: '0' }), false)
  assert.equal(releaseDagMode({}), 'v2')
  assert.equal(releaseDagMode({ HH_RELEASE_DAG_V2: '0' }), 'legacy')
})

test('preflight failure blocks index configuration deployment and publication nodes', async () => {
  const events = []
  await assert.rejects(() => executeReleaseDagV2(successfulDeps(events, {
    preflight: async () => { events.push('preflight'); throw new Error('preflight failed after its own cleanup') },
  })), /preflight failed/)
  assert.deepEqual(events, ['preflight'])
})

test('RAG bootstrap and remaining cloud subsets are an exact partition and require fresh admin plus worker proof', () => {
  const partition = partitionReleaseCloudFunctions(['user', 'post-rag-worker', 'admin', 'post'])
  assert.deepEqual(partition.ragBootstrap, ['admin', 'post-rag-worker'])
  assert.deepEqual(partition.remaining, ['post', 'user'])
  assert.deepEqual([...partition.ragBootstrap, ...partition.remaining].sort(), ['admin', 'post', 'post-rag-worker', 'user'])
  assert.doesNotThrow(() => assertRagBootstrapVerified(partition.ragBootstrap, ['post-rag-worker', 'admin']))
  assert.throws(() => assertRagBootstrapVerified(partition.ragBootstrap, ['post-rag-worker']), /admin.*fresh verified/i)
})

test('DAG creates the timer fixture after RAG deploy and overlaps its wait with independent cloud work', async () => {
  const events = []
  const timer = deferred()
  const smoke = deferred()
  const resultPromise = executeReleaseDagV2(successfulDeps(events, {
    waitTimer: async () => { events.push('timer-wait:start'); await timer.promise; events.push('timer-wait:done'); return { complete: true } },
    runBasicCloudSmoke: async () => { events.push('basic-smoke:start'); await smoke.promise; events.push('basic-smoke:done') },
  }))

  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(events.slice(0, 8), [
    'preflight', 'configure-rag', 'deploy-rag', 'timer-fixture-ready',
    'timer-wait:start', 'deploy-other-cloud', 'basic-smoke:start',
  ])
  timer.resolve()
  await new Promise((resolve) => setImmediate(resolve))
  assert(events.includes('timer-cleanup'))
  assert(!events.includes('backfill'))
  smoke.resolve()
  await resultPromise
  assert(events.indexOf('timer-cleanup') < events.indexOf('backfill'))
  assert(events.indexOf('basic-smoke:done') < events.indexOf('backfill'))
  assert(events.indexOf('backfill') < events.indexOf('semantic-gates'))
  assert(events.indexOf('semantic-gates') < events.indexOf('admin'))
  assert(events.indexOf('admin') < events.indexOf('mini'))
})

test('a parallel cloud failure aborts timer waiting, awaits cleanup, and blocks semantic and publication nodes', async () => {
  const events = []
  let timerSignal
  await assert.rejects(() => executeReleaseDagV2(successfulDeps(events, {
    waitTimer: async (_session, { signal }) => {
      timerSignal = signal
      events.push('timer-wait:start')
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
      events.push('timer-wait:aborted')
      throw new Error('timer aborted')
    },
    deployRemainingCloud: async () => { events.push('deploy-other-cloud'); throw new Error('cloud deploy failed') },
  })), (error) => error instanceof AggregateError && error.errors.some((item) => /cloud branch failed/.test(item?.message || '')))
  assert.equal(timerSignal.aborted, true)
  assert(events.indexOf('timer-wait:aborted') < events.indexOf('timer-cleanup'))
  assert(!events.includes('backfill'))
  assert(!events.includes('admin'))
  assert(!events.includes('mini'))
})

test('timer cleanup failure is retained with the primary timer failure and blocks publication', async () => {
  const events = []
  await assert.rejects(() => executeReleaseDagV2(successfulDeps(events, {
    waitTimer: async () => { throw new Error('timer deadline exceeded') },
    cleanupTimer: async () => { events.push('timer-cleanup'); throw new Error('timer cleanup failed') },
  })), (error) => {
    assert(error instanceof AggregateError)
    assert.match(String(error), /parallel phase failed/i)
    assert.equal(error.errors.length, 2)
    assert(error.errors.every((item) => /timer branch failed/.test(item.message)))
    assert.doesNotMatch(error.errors.map((item) => item.message).join('\n'), /deadline exceeded|cleanup failed/)
    return true
  })
  assert.deepEqual(events.filter((event) => event === 'timer-cleanup'), ['timer-cleanup'])
  assert(!events.includes('admin'))
})

test('timer failure aborts the cloud branch before smoke and publishes no raw child error in the aggregate message', async () => {
  const events = []
  const deploy = deferred()
  const result = executeReleaseDagV2(successfulDeps(events, {
    waitTimer: async () => { throw new Error('secret-child-detail') },
    deployRemainingCloud: async () => { events.push('deploy:start'); await deploy.promise; events.push('deploy:done') },
    runBasicCloudSmoke: async () => events.push('smoke:must-not-run'),
  }))
  await new Promise((resolve) => setImmediate(resolve))
  deploy.resolve()
  await assert.rejects(result, (error) => {
    assert(error instanceof AggregateError)
    assert.doesNotMatch(error.message, /secret-child-detail/)
    assert.doesNotMatch(error.errors.map((item) => item.message).join('\n'), /secret-child-detail/)
    return true
  })
  assert(!events.includes('smoke:must-not-run'))
  assert(!events.includes('admin'))
  assert(!events.includes('mini'))
})
