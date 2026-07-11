import assert from 'node:assert/strict'
import test from 'node:test'

import { createCloudReleaseProbe, createCloudReleaseProbeWrapper, hasCloudReleaseProbeResponse } from './cloud-release-probe.mjs'

test('cloud release probes use a per-function strong token and do not expose it in the response payload', () => {
  const probe = createCloudReleaseProbe({
    functionName: 'post',
    randomBytes: () => Buffer.from('a'.repeat(64), 'hex'),
    sourceSha: 'abcdef0123456789',
  })
  assert.equal(probe.functionName, 'post')
  assert.equal(probe.sourceSha, 'abcdef0123456789')
  assert.match(probe.probeToken, /^[a-f0-9]{64}$/)
  assert.doesNotMatch(JSON.stringify(probe.response), /probeToken/)
})

test('cloud release probe response validation accepts nested CloudBase invoke output only when version fields match', () => {
  const probe = createCloudReleaseProbe({ functionName: 'post', randomBytes: () => Buffer.alloc(32, 1), sourceSha: 'abc' })
  assert.equal(hasCloudReleaseProbeResponse({ data: { response: probe.response } }, probe), true)
  assert.equal(hasCloudReleaseProbeResponse({ data: { RetMsg: JSON.stringify(probe.response) } }, probe), true)
  assert.equal(hasCloudReleaseProbeResponse({ data: { response: { ...probe.response, buildId: 'wrong' } } }, probe), false)
})

test('cloud release probe wrapper handles only the signed probe event and lazily loads the business handler', () => {
  const wrapper = createCloudReleaseProbeWrapper()
  assert.match(wrapper, /__happyhomeReleaseProbe/)
  assert.match(wrapper, /require\('\.\/handler\.js'\)/)
  assert(wrapper.indexOf('require(\'./handler.js\')') > wrapper.indexOf('__happyhomeReleaseProbe'))
})
