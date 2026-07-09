import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_RAG_NETWORK_FUNCTIONS,
  applyRagNetworkConfig,
  buildRagNetworkFunctionConfigs,
} from '../configure-rag-network.mjs'

test('buildRagNetworkFunctionConfigs targets only ES-facing functions by default', () => {
  const configs = buildRagNetworkFunctionConfigs({
    vpcId: 'vpc-123',
    subnetId: 'subnet-456',
  })

  assert.deepEqual(DEFAULT_RAG_NETWORK_FUNCTIONS, ['post', 'post-rag-worker'])
  assert.deepEqual(configs.map((config) => config.name), ['post', 'post-rag-worker'])
  for (const config of configs) {
    assert.deepEqual(config.vpc, {
      vpcId: 'vpc-123',
      subnetId: 'subnet-456',
    })
  }
})

test('buildRagNetworkFunctionConfigs accepts explicit function scope', () => {
  const configs = buildRagNetworkFunctionConfigs({
    vpcId: 'vpc-123',
    subnetId: 'subnet-456',
    functions: ['post', 'admin', 'post'],
  })

  assert.deepEqual(configs.map((config) => config.name), ['post', 'admin'])
})

test('applyRagNetworkConfig updates only functions whose VPC differs', async () => {
  const calls = []
  const app = {
    functions: {
      async getFunctionDetail(name) {
        if (name === 'post') return { VpcConfig: { VpcId: '', SubnetId: '' } }
        if (name === 'post-rag-worker') {
          return { VpcConfig: { VpcId: 'vpc-123', SubnetId: 'subnet-456' } }
        }
        throw new Error(`unexpected function ${name}`)
      },
      async updateFunctionConfig(payload) {
        calls.push(payload)
        return { RequestId: 'request-1' }
      },
    },
  }

  const results = await applyRagNetworkConfig(app, buildRagNetworkFunctionConfigs({
    vpcId: 'vpc-123',
    subnetId: 'subnet-456',
  }))

  assert.deepEqual(calls, [{
    name: 'post',
    vpc: {
      vpcId: 'vpc-123',
      subnetId: 'subnet-456',
    },
  }])
  assert.deepEqual(results, [
    {
      name: 'post',
      changed: true,
      previousVpc: { vpcId: '', subnetId: '' },
      targetVpc: { vpcId: 'vpc-123', subnetId: 'subnet-456' },
    },
    {
      name: 'post-rag-worker',
      changed: false,
      previousVpc: { vpcId: 'vpc-123', subnetId: 'subnet-456' },
      targetVpc: { vpcId: 'vpc-123', subnetId: 'subnet-456' },
    },
  ])
})
