import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { reconcileOwnedScfTimer } from './scf-owned-timer.mjs'

const require = createRequire(import.meta.url)
const { FunctionService } = require('@cloudbase/manager-node/lib/function/index.js')

test('installed manager drops customArgument while owned SCF client sends and verifies it', async () => {
  let managerParams
  const service = new FunctionService({ inited: true, cloudBaseContext: {}, getUserService: () => ({}) })
  service.getFunctionConfig = () => ({ namespace: 'env' })
  service.scfService = { request: async (_action, params) => { managerParams = params; return {} } }
  await service.createFunctionTriggers('worker', [{ name: 'timer', type: 'timer', config: '0 * * * * * *', customArgument: 'secret' }])
  assert.doesNotMatch(managerParams.Triggers, /CustomArgument|secret/)

  const calls = []
  let triggers = []
  const request = async (action, params) => {
    calls.push([action, params])
    if (action === 'ListTriggers') return { Triggers: triggers }
    if (action === 'CreateTrigger') triggers = [{ TriggerName: params.TriggerName, TriggerDesc: params.TriggerDesc, CustomArgument: params.CustomArgument, Enable: params.Enable }]
    return {}
  }
  const result = await reconcileOwnedScfTimer(request, { functionName: 'post-rag-worker', namespace: 'env', cron: '0 * * * * * *', customArgument: '{"workerToken":"secret"}' })
  assert.equal(calls.find(call => call[0] === 'CreateTrigger')[1].CustomArgument, '{"workerToken":"secret"}')
  assert.equal(result.customArgumentHash.length, 64)
})

test('SCF timer polls long enough for a newly created trigger to become visible', async () => {
  let listCount = 0
  let created
  const waits = []
  const request = async (action, params) => {
    if (action === 'ListTriggers') {
      listCount += 1
      return { Triggers: listCount < 7 || !created ? [] : [created] }
    }
    if (action === 'CreateTrigger') {
      created = { TriggerName: params.TriggerName, TriggerDesc: params.TriggerDesc, CustomArgument: params.CustomArgument, Enable: params.Enable }
    }
    return {}
  }

  const result = await reconcileOwnedScfTimer(request, {
    functionName: 'post-rag-worker',
    namespace: 'env',
    cron: '0 * * * * * *',
    customArgument: 'secret',
    wait: async ms => { waits.push(ms) },
  })

  assert.equal(result.triggerName, 'post-rag-worker-every-minute')
  assert.deepEqual(waits, [1000, 1000, 1000, 1000, 1000])
  assert.equal(listCount, 7)
})

test('SCF timer accepts the canonical JSON cron readback returned by SCF', async () => {
  const cron = '0 * * * * * *'
  const customArgument = 'secret'
  const request = async action => action === 'ListTriggers' ? { Triggers: [{
    TriggerName: 'post-rag-worker-every-minute',
    TriggerDesc: JSON.stringify({ cron }),
    CustomArgument: customArgument,
    Enable: 'OPEN',
  }] } : {}

  const result = await reconcileOwnedScfTimer(request, {
    functionName: 'post-rag-worker',
    namespace: 'env',
    cron,
    customArgument,
    wait: async () => {},
  })

  assert.equal(result.cron, cron)
})

test('SCF timer fails closed when readback omits CustomArgument', async () => {
  const request = async action => action === 'ListTriggers' ? { Triggers: [] } : {}
  await assert.rejects(() => reconcileOwnedScfTimer(request, { functionName: 'post-rag-worker', namespace: 'env', cron: '0 * * * * * *', customArgument: 'secret', wait: async () => {} }), /verification/)
})

test('SCF timer deletes stale owned trigger and preserves exact desired and unrelated', async () => {
  const calls = []
  let triggers = [
    { TriggerName: 'post-rag-worker-every-5-min', TriggerDesc: 'old' },
    { TriggerName: 'post-rag-worker-every-minute', TriggerDesc: 'cron', CustomArgument: 'secret', Enable: 'OPEN' },
    { TriggerName: 'unrelated', TriggerDesc: 'x' },
  ]
  const request = async (action, params) => {
    calls.push([action, params])
    if (action === 'ListTriggers') return { Triggers: triggers }
    if (action === 'DeleteTrigger') triggers = triggers.filter(trigger => trigger.TriggerName !== params.TriggerName)
    return {}
  }
  await reconcileOwnedScfTimer(request, { functionName: 'post-rag-worker', namespace: 'env', cron: 'cron', customArgument: 'secret' })
  assert.deepEqual(calls.filter(call => call[0] === 'DeleteTrigger').map(call => call[1].TriggerName), ['post-rag-worker-every-5-min'])
  assert.equal(triggers.some(trigger => trigger.TriggerName === 'unrelated'), true)
})
