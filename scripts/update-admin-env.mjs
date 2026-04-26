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
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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
const ENV_ID = process.env.TCB_ENV || fileEnv.TCB_ENV || 'cloudbase-3gh862acb1505ff3'
const SECRET_ID = process.env.TENCENTCLOUD_SECRETID || fileEnv.TENCENTCLOUD_SECRETID
const SECRET_KEY = process.env.TENCENTCLOUD_SECRETKEY || fileEnv.TENCENTCLOUD_SECRETKEY

if (!SECRET_ID || !SECRET_KEY) {
  console.error('[update-env] Missing TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY')
  process.exit(1)
}

const TARGET_ENVS = {
  ADMIN_LEGACY_TOKEN_FALLBACK: '1',
  BOOTSTRAP_ADMIN_USERNAME: 'admin',
  BOOTSTRAP_ADMIN_PASSWORD: 'happyhome2024',
  ADMIN_SESSION_TTL_DAYS: '7',
  // 保留原 ADMIN_TOKEN（fallback 路径要用）
  ADMIN_TOKEN: 'happyhome-admin-2024',
}

const app = CloudBase.init({ secretId: SECRET_ID, secretKey: SECRET_KEY, envId: ENV_ID })

const detail = await app.functions.getFunctionDetail('admin')
const existing = {}
const envItems = detail?.Environment?.Variables || []
for (const v of envItems) existing[v.Key] = v.Value

const merged = { ...existing, ...TARGET_ENVS }

console.log('[update-env] admin 函数现有 env:')
console.table(envItems)
console.log('[update-env] 目标 env (合并后):')
console.table(Object.entries(merged).map(([Key, Value]) => ({ Key, Value })))

await app.functions.updateFunctionConfig({
  name: 'admin',
  envVariables: merged,
})

console.log('\n✓ admin 函数 env 已更新。下次冷启动生效。')
