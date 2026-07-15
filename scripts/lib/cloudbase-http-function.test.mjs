import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import * as httpFunction from './cloudbase-http-function.mjs'

const {
  WECHAT_AUDIT_CALLBACK_PATH,
  assertWechatAuditHttpAccess,
  cloudBaseDeployArgs,
} = httpFunction

test('callback deploy remains an Event function handled by index.main', () => {
  assert.deepEqual(cloudBaseDeployArgs('wechat-audit-callback', 'env-1'), [
    'fn', 'deploy', 'wechat-audit-callback', '--force', '--env-id', 'env-1', '--deployMode', 'cos', '--json',
  ])
})

test('callback HTTP access uses a separate exact service binding', () => {
  assert.deepEqual(httpFunction.cloudBaseCreateServiceArgs('env-1'), [
    'service', 'create', '--service-path', WECHAT_AUDIT_CALLBACK_PATH,
    '--function', 'wechat-audit-callback', '--json', '--env-id', 'env-1',
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

test('existing exact callback access is attested without mutation', async () => {
  const calls = []
  const result = await httpFunction.ensureWechatAuditHttpAccess({
    readAccess: async () => ({ APISet: [{ Name: 'wechat-audit-callback', Path: '/wechat-audit-callback' }] }),
    beforeCreate: async () => calls.push('fence'),
    createAccess: async () => calls.push('create'),
  })
  assert.deepEqual(result, { changed: false })
  assert.deepEqual(calls, [])
})

test('missing callback access is created only after a mutation fence and fresh readback', async () => {
  const calls = []
  let reads = 0
  const result = await httpFunction.ensureWechatAuditHttpAccess({
    readAccess: async () => {
      reads += 1
      calls.push(`read-${reads}`)
      return reads === 1
        ? 'i HTTP 访问服务为空'
        : { APISet: [{ Name: 'wechat-audit-callback', Path: '/wechat-audit-callback' }] }
    },
    beforeCreate: async () => calls.push('fence'),
    createAccess: async () => calls.push('create'),
  })
  assert.deepEqual(result, { changed: true })
  assert.deepEqual(calls, ['read-1', 'fence', 'create', 'read-2'])
})

test('a conflicting callback path fails closed without creating another binding', async () => {
  let created = false
  await assert.rejects(() => httpFunction.ensureWechatAuditHttpAccess({
    readAccess: async () => ({ APISet: [{ Name: 'admin', Path: '/wechat-audit-callback' }] }),
    beforeCreate: async () => {},
    createAccess: async () => { created = true },
  }), /already bound to admin/)
  assert.equal(created, false)
})

test('formal CloudBase deploy provisions callback access through the guarded helper', () => {
  const source = readFileSync(new URL('../deploy.mjs', import.meta.url), 'utf8')
  assert.match(source, /ensureWechatAuditHttpAccess\(\{/)
  assert.match(source, /beforeCreate:[^]*beforeFunctionDeploy/)
  assert.match(source, /cloudBaseCreateServiceArgs\(envId\)/)
})
