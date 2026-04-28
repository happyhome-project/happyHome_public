#!/usr/bin/env node
// 切换 admin 函数 env WXACODE_ENV_VERSION，控制 wxacode.getUnlimited 生成的
// 二维码指向小程序的哪个版本。
//
// 用法：
//   node scripts/set-wxacode-env.mjs trial    # 走体验版（小程序新版还没发布时联调用）
//   node scripts/set-wxacode-env.mjs release  # 走生产版（默认；小程序新版已发布到正式环境后切回这个）
//   node scripts/set-wxacode-env.mjs develop  # 走开发版（一般不用）
//
// 体验版限制：扫码用户的微信号必须在小程序「体验版成员」白名单里，
// 否则扫码会提示"无权限访问"。在小程序后台「成员管理 → 体验成员」添加。

import CloudBase from '@cloudbase/manager-node'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function loadDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const out = {}
  for (const rawLine of fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
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
  console.error('Missing CAM keys in ~/.happyhome/cam.env')
  process.exit(1)
}

const NEW_VALUE = process.argv[2] || 'trial'  // 默认 trial；要恢复时跑 `node ... release`

const app = CloudBase.init({ secretId: SECRET_ID, secretKey: SECRET_KEY, envId: ENV_ID })
const detail = await app.functions.getFunctionDetail('admin')
const existing = {}
for (const v of detail?.Environment?.Variables || []) existing[v.Key] = v.Value

const before = existing.WXACODE_ENV_VERSION || '(unset → default release)'
existing.WXACODE_ENV_VERSION = NEW_VALUE

await app.functions.updateFunctionConfig({ name: 'admin', envVariables: existing })

console.log(`✓ admin 函数 WXACODE_ENV_VERSION: ${before} → ${NEW_VALUE}`)
console.log(`下一次 admin 函数冷启动后生效（约 ~30 秒）。`)
