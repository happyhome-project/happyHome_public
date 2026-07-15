#!/usr/bin/env node
/**
 * scripts/update-admin-env.mjs
 *
 * 一次性脚本：把 admin 云函数的 env 变量补上（双权限改造需要）。
 * 通过 @cloudbase/manager-node 用 CAM 密钥更新——不用人去 CloudBase 控制台逐个填。
 *
 * 现有 env 会保留并合并；同名 key 会被覆盖。
 */
import CloudBase from '@cloudbase/manager-node'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildWechatAuditFunctionEnvs, redactFunctionEnvRows } from './lib/wechat-audit-env.mjs'

function loadDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const content = fs.readFileSync(filePath, 'utf-8')
  const out = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

const fileEnv = loadDotEnvFile(path.join(os.homedir(), '.happyhome', 'cam.env'))
const adminPrivateEnv = loadDotEnvFile(path.join(os.homedir(), '.happyhome', 'admin-internal.env'))
const ENV_ID = process.env.TCB_ENV || fileEnv.TCB_ENV || 'cloudbase-3gh862acb1505ff3'
const SECRET_ID = process.env.TENCENTCLOUD_SECRETID || fileEnv.TENCENTCLOUD_SECRETID
const SECRET_KEY = process.env.TENCENTCLOUD_SECRETKEY || fileEnv.TENCENTCLOUD_SECRETKEY

if (!SECRET_ID || !SECRET_KEY) {
  console.error('[update-env] Missing TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY')
  process.exit(1)
}

const TARGET_ENVS = {
  ADMIN_LEGACY_TOKEN_FALLBACK: '0',
  BOOTSTRAP_ADMIN_ENABLED: 'false',
  ADMIN_SESSION_TTL_DAYS: '7',
}

const app = CloudBase.init({ secretId: SECRET_ID, secretKey: SECRET_KEY, envId: ENV_ID })

const detail = await app.functions.getFunctionDetail('admin')
const existing = {}
const envItems = detail?.Environment?.Variables || []
for (const v of envItems) existing[v.Key] = v.Value
const adminInternalToken = String(
  process.env.ADMIN_INTERNAL_CALL_TOKEN ||
  adminPrivateEnv.ADMIN_INTERNAL_CALL_TOKEN ||
  existing.ADMIN_INTERNAL_CALL_TOKEN ||
  '',
).trim()
if (adminInternalToken.length < 32) {
  console.error('[update-env] Missing strong ADMIN_INTERNAL_CALL_TOKEN in env or ~/.happyhome/admin-internal.env')
  process.exit(1)
}

const envInfo = await app.env.getEnvInfo()
const storageConf = envInfo?.EnvInfo?.Storages?.[0]
const auditCallbackToken =
  process.env.AUDIT_CALLBACK_TOKEN ||
  fileEnv.AUDIT_CALLBACK_TOKEN ||
  existing.AUDIT_CALLBACK_TOKEN ||
  crypto.randomBytes(24).toString('hex')

const AUDIT_ENVS = {
  TENCENT_SECRET_ID: process.env.TENCENT_SECRET_ID || fileEnv.TENCENT_SECRET_ID || SECRET_ID,
  TENCENT_SECRET_KEY: process.env.TENCENT_SECRET_KEY || fileEnv.TENCENT_SECRET_KEY || SECRET_KEY,
  TENCENT_CI_BUCKET: process.env.TENCENT_CI_BUCKET || fileEnv.TENCENT_CI_BUCKET || storageConf?.Bucket || existing.TENCENT_CI_BUCKET || '',
  TENCENT_CI_REGION: process.env.TENCENT_CI_REGION || fileEnv.TENCENT_CI_REGION || storageConf?.Region || existing.TENCENT_CI_REGION || '',
  AUDIT_CALLBACK_TOKEN: auditCallbackToken,
}

for (const key of ['TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY', 'TENCENT_CI_BUCKET', 'TENCENT_CI_REGION']) {
  if (!AUDIT_ENVS[key]) {
    console.error(`[update-env] Missing ${key}; cannot configure content audit env`)
    process.exit(1)
  }
}

const merged = { ...existing, ...TARGET_ENVS, ADMIN_INTERNAL_CALL_TOKEN: adminInternalToken }
delete merged.ADMIN_TOKEN
delete merged.BOOTSTRAP_ADMIN_USERNAME
delete merged.BOOTSTRAP_ADMIN_PASSWORD
for (const [key, value] of Object.entries(AUDIT_ENVS)) merged[key] = value

function redactEnvRows(rows) {
  return rows.map(({ Key, Value }) => ({
    Key,
    Value: /SECRET|TOKEN|PASSWORD/i.test(Key) ? '[redacted]' : Value,
  }))
}

console.log('[update-env] admin 函数现有 env:')
console.table(redactEnvRows(envItems))
console.log('[update-env] 目标 env (合并后):')
console.table(redactEnvRows(Object.entries(merged).map(([Key, Value]) => ({ Key, Value }))))

await app.functions.updateFunctionConfig({
  name: 'admin',
  envVariables: merged,
})

const wxSource = {
  WX_APPID: process.env.WX_APPID || fileEnv.WX_APPID || existing.WX_APPID || '',
  WX_APPSECRET: process.env.WX_APPSECRET || fileEnv.WX_APPSECRET || existing.WX_APPSECRET || '',
  WX_MESSAGE_TOKEN: process.env.WX_MESSAGE_TOKEN || fileEnv.WX_MESSAGE_TOKEN || '',
}

for (const functionName of ['post', 'wechat-audit-callback']) {
  const functionDetail = await app.functions.getFunctionDetail(functionName)
  const functionExisting = Object.fromEntries(
    (functionDetail?.Environment?.Variables || []).map(({ Key, Value }) => [Key, Value]),
  )
  const functionMerged = buildWechatAuditFunctionEnvs(functionName, functionExisting, wxSource)
  console.log(`[update-env] ${functionName} 目标 env (合并后):`)
  console.table(redactFunctionEnvRows(functionMerged))
  await app.functions.updateFunctionConfig({ name: functionName, envVariables: functionMerged })
}

console.log('\n✓ admin/post/wechat-audit-callback 函数 env 已更新。下次冷启动生效。')
