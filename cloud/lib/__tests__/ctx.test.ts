jest.mock('wx-server-sdk', () => ({
  getWXContext: jest.fn(),
}))

import cloud from 'wx-server-sdk'
import { resolveOpenId } from '../ctx'

const getWXContext = cloud.getWXContext as jest.Mock

function runtimeContext(values: Record<string, string>) {
  return {
    memory_limit_in_mb: 256,
    time_limit_in_ms: 3000,
    request_id: 'test-request',
    function_version: '$LATEST',
    function_name: 'test-function',
    namespace: 'test-env',
    environment: JSON.stringify({
      TCB_CONTEXT_KEYS: Object.keys(values).join(','),
      ...values,
    }),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  getWXContext.mockReturnValue({})
  delete process.env.ALLOW_TEST_OPENID
})

test('prefers the trusted WeChat OPENID over a CloudBase Web UUID', () => {
  getWXContext.mockReturnValue({ OPENID: 'wechat-user' })

  expect(resolveOpenId({}, runtimeContext({ TCB_UUID: 'web-user' }))).toBe('wechat-user')
})

test('maps a trusted CloudBase Web UUID to a namespaced identity', () => {
  expect(resolveOpenId({}, runtimeContext({ TCB_UUID: 'web-user' }))).toBe('web:web-user')
})

test('rejects an explicitly anonymous CloudBase Web identity', () => {
  expect(() => resolveOpenId({}, runtimeContext({
    TCB_UUID: 'anonymous-user',
    TCB_ISANONYMOUS_USER: 'true',
  }))).toThrow('Authenticated caller required')
})

test('ignores event test identity by default', () => {
  expect(resolveOpenId({ _testOpenid: 'attacker' })).toBe('')
})

test('keeps ALLOW_TEST_OPENID=true test injection compatibility', () => {
  process.env.ALLOW_TEST_OPENID = 'true'

  expect(resolveOpenId({ _testOpenid: 'fixture-user' })).toBe('fixture-user')
})
