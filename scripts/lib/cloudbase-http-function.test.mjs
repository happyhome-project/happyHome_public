import test from 'node:test'
import assert from 'node:assert/strict'

import {
  WECHAT_AUDIT_CALLBACK_PATH,
  assertWechatAuditHttpAccess,
  cloudBaseDeployArgs,
} from './cloudbase-http-function.mjs'

test('callback deploy creates the HTTP function and exact public path', () => {
  assert.deepEqual(cloudBaseDeployArgs('wechat-audit-callback', 'env-1'), [
    'fn', 'deploy', 'wechat-audit-callback', '--force', '--env-id', 'env-1', '--deployMode', 'cos', '--json',
    '--httpFn', '--path', WECHAT_AUDIT_CALLBACK_PATH,
  ])
})

test('ordinary function deploy remains event based', () => {
  assert.deepEqual(cloudBaseDeployArgs('post', 'env-1'), [
    'fn', 'deploy', 'post', '--force', '--env-id', 'env-1', '--deployMode', 'cos', '--json',
  ])
})

test('HTTP access verification requires the exact function and path binding', () => {
  assert.equal(assertWechatAuditHttpAccess(JSON.stringify({
    APISet: [{ Name: 'wechat-audit-callback', Path: '/wechat-audit-callback', Type: 1 }],
  })).Type, 1)
  assert.equal(assertWechatAuditHttpAccess({
    data: [{ name: 'wechat-audit-callback', path: '/wechat-audit-callback', type: '云函数' }],
  }).type, '云函数')
  assert.throws(() => assertWechatAuditHttpAccess({ APISet: [{ Name: 'admin', Path: '/wechat-audit-callback' }] }), /not bound/)
})
