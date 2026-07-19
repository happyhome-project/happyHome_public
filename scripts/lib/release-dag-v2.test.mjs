import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertRagBootstrapVerified,
  executeReleaseDagV2,
  isReleaseDagV2Enabled,
  partitionReleaseCloudFunctions,
  releaseDagMode,
} from './release-dag-v2.mjs'

test('the deploy-only DAG cannot be downgraded to the retired live-RAG order', () => {
  assert.equal(isReleaseDagV2Enabled({}), true)
  assert.equal(releaseDagMode({}), 'v2')
  assert.equal(isReleaseDagV2Enabled({ HH_RELEASE_DAG_V2: '0' }), true)
  assert.equal(releaseDagMode({ HH_RELEASE_DAG_V2: '0' }), 'v2')
})

test('RAG workers form a deploy-only subset and require fresh artifact proof', () => {
  const partition = partitionReleaseCloudFunctions(['post', 'post-rag-worker', 'post-video-rag-worker', 'admin'])
  assert.deepEqual(partition.ragBootstrap, ['post-rag-worker', 'post-video-rag-worker'])
  assert.deepEqual(partition.remaining, ['admin', 'post'])
  assert.doesNotThrow(() => assertRagBootstrapVerified(partition.ragBootstrap, partition.ragBootstrap))
  assert.throws(() => assertRagBootstrapVerified(partition.ragBootstrap, ['post-rag-worker']), /post-video-rag-worker/)
})

test('release performs deployment and ordinary smoke without timer backfill or semantic gates', async () => {
  const order = []
  const result = await executeReleaseDagV2({
    preflight: async () => { order.push('preflight'); return 'preflight' },
    configureRag: async () => { order.push('configure'); return 'config' },
    deployRag: async () => { order.push('deploy-rag'); return 'rag' },
    deployRemainingCloud: async () => { order.push('deploy-cloud'); return 'cloud' },
    runBasicCloudSmoke: async () => { order.push('ordinary-smoke'); return 'smoke' },
    publishAdmin: async () => { order.push('admin'); return 'admin' },
    publishMiniprogram: async () => { order.push('miniprogram'); return 'miniprogram' },
  })
  assert.deepEqual(order, ['preflight', 'configure', 'deploy-rag', 'deploy-cloud', 'ordinary-smoke', 'admin', 'miniprogram'])
  assert.equal(result.smoke, 'smoke')
})

test('deployment failure blocks smoke and publication', async () => {
  const order = []
  await assert.rejects(() => executeReleaseDagV2({
    preflight: async () => order.push('preflight'),
    configureRag: async () => order.push('configure'),
    deployRag: async () => order.push('deploy-rag'),
    deployRemainingCloud: async () => { order.push('deploy-cloud'); throw new Error('deploy failed') },
    runBasicCloudSmoke: async () => order.push('smoke'),
    publishAdmin: async () => order.push('admin'),
    publishMiniprogram: async () => order.push('miniprogram'),
  }), /deploy failed/)
  assert.deepEqual(order, ['preflight', 'configure', 'deploy-rag', 'deploy-cloud'])
})
