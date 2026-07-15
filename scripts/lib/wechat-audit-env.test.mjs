import assert from 'node:assert/strict'
import test from 'node:test'

import { buildWechatAuditFunctionEnvs, redactFunctionEnvRows } from './wechat-audit-env.mjs'

test('buildWechatAuditFunctionEnvs propagates credentials to post and callback without dropping existing values', () => {
  const source = { WX_APPID: 'wx123', WX_APPSECRET: 'app-secret', WX_MESSAGE_TOKEN: 'message-token-with-at-least-32-chars' }
  assert.deepEqual(buildWechatAuditFunctionEnvs('post', { KEEP: 'yes' }, source), {
    KEEP: 'yes', WX_APPID: 'wx123', WX_APPSECRET: 'app-secret',
  })
  assert.deepEqual(buildWechatAuditFunctionEnvs('wechat-audit-callback', { KEEP: 'yes' }, source), {
    KEEP: 'yes', WX_APPID: 'wx123', WX_MESSAGE_TOKEN: 'message-token-with-at-least-32-chars',
  })
})

test('buildWechatAuditFunctionEnvs fails closed for missing or weak callback secrets', () => {
  assert.throws(() => buildWechatAuditFunctionEnvs('post', {}, {}), /WX_APPID.*WX_APPSECRET/i)
  assert.throws(() => buildWechatAuditFunctionEnvs('wechat-audit-callback', {}, {
    WX_APPID: 'wx123', WX_MESSAGE_TOKEN: 'short',
  }), /WX_MESSAGE_TOKEN/i)
})

test('redactFunctionEnvRows hides all secrets and tokens', () => {
  const rows = redactFunctionEnvRows({ WX_APPID: 'wx123', WX_APPSECRET: 'secret', WX_MESSAGE_TOKEN: 'token', SAFE: 'visible' })
  assert.deepEqual(rows, [
    { Key: 'WX_APPID', Value: 'wx123' },
    { Key: 'WX_APPSECRET', Value: '[redacted]' },
    { Key: 'WX_MESSAGE_TOKEN', Value: '[redacted]' },
    { Key: 'SAFE', Value: 'visible' },
  ])
})
