import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_RAG_WORKER_TIMEOUT_SECONDS,
  applyRagWorkerConfig,
  buildRagWorkerFunctionConfigs,
} from '../configure-rag-workers.mjs'

test('buildRagWorkerFunctionConfigs gives RAG workers enough time and scheduled triggers', () => {
  const configs = buildRagWorkerFunctionConfigs({
    workerToken: 'worker-secret',
    timerToken: 'timer-secret',
    ragCron: '0 */5 * * * * *',
    videoCron: '0 */10 * * * * *',
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
  assert.equal(configs[0].triggers[0].config, '0 */5 * * * * *')
  assert.equal(configs[0].triggers[0].name, 'post-rag-worker-every-minute')
  assert.equal(configs[0].envVariables.POST_RAG_TIMER_TOKEN, 'timer-secret')
  assert.equal(configs[1].triggers[0].config, '0 */10 * * * * *')
})

test('applyRagWorkerConfig performs zero mutations when function and timers already match', async () => {
  const configs = buildRagWorkerFunctionConfigs({ workerToken: 'worker', timerToken: 'timer' })
  const mutations = []
  const details = new Map(configs.map(config => [config.name, {
    Timeout: config.timeout,
    MemorySize: config.memorySize,
    Namespace: 'env',
    Environment: { Variables: Object.entries(config.envVariables).map(([Key, Value]) => ({ Key, Value })) },
  }]))
  const triggers = new Map([
    ['post-rag-worker', [{ TriggerName: 'post-rag-worker-every-minute', TriggerDesc: configs[0].triggers[0].config, CustomArgument: configs[0].triggers[0].customArgument }]],
    ['post-video-rag-worker', [{ TriggerName: configs[1].triggers[0].name, TriggerDesc: configs[1].triggers[0].config }]],
  ])
  const app = { functions: {
    async getFunctionDetail(name) { return details.get(name) },
    async updateFunctionConfig(payload) { mutations.push(['update', payload]) },
    async createFunctionTriggers(name, value) { mutations.push(['create', name, value]) },
    getFunctionConfig() { return { namespace: 'env' } },
    scfService: { async request(action, payload) {
      if (action === 'ListTriggers') return { Triggers: triggers.get(payload.FunctionName) || [] }
      mutations.push([action, payload]); return {}
    } },
  } }
  const results = await applyRagWorkerConfig(app, configs)
  assert.deepEqual(mutations, [])
  assert.equal(results.every(result => result.changed === false), true)
})

test('buildRagWorkerFunctionConfigs defaults to minute-level CloudBase 7-field cron', () => {
  const configs = buildRagWorkerFunctionConfigs({ workerToken: 'worker-secret', timerToken: 'timer-secret' })

  assert.equal(configs[0].triggers[0].config, '0 * * * * * *')
  assert.equal(configs[1].triggers[0].config, '0 */10 * * * * *')
})
