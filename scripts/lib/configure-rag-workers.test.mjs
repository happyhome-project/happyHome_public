import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_RAG_WORKER_TIMEOUT_SECONDS,
  buildRagWorkerFunctionConfigs,
} from '../configure-rag-workers.mjs'

test('buildRagWorkerFunctionConfigs gives RAG workers enough time and scheduled triggers', () => {
  const configs = buildRagWorkerFunctionConfigs({
    workerToken: 'worker-secret',
    ragCron: '*/5 * * * * * *',
    videoCron: '*/10 * * * * * *',
  })

  assert.equal(DEFAULT_RAG_WORKER_TIMEOUT_SECONDS, 120)
  assert.deepEqual(configs.map((config) => config.name), ['post-rag-worker', 'post-video-rag-worker'])
  for (const config of configs) {
    assert.equal(config.timeout, 120)
    assert.equal(config.memorySize, 512)
    assert.equal(config.envVariables.POST_RAG_WORKER_TOKEN, 'worker-secret')
    assert.equal(config.triggers.length, 1)
    assert.equal(config.triggers[0].type, 'timer')
  }
  assert.equal(configs[0].triggers[0].config, '*/5 * * * * * *')
  assert.equal(configs[1].triggers[0].config, '*/10 * * * * * *')
})
