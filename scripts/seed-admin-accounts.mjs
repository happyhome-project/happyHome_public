#!/usr/bin/env node
/**
 * scripts/seed-admin-accounts.mjs
 *
 * 一次性（幂等）脚本：为 admin-web 双权限改造种入第一个 superAdmin 账号。
 *
 * 触发时机：新环境首次上线、`admin_accounts` 集合为空时。重复跑无副作用——
 * 如果已有任何账号存在，就直接跳过。
 *
 * 用法：
 *   node scripts/seed-admin-accounts.mjs
 *     默认读 ~/.happyhome/cam.env 里的 TENCENTCLOUD_SECRETID/SECRETKEY/TCB_ENV
 *     用户名/密码从 env SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD 读（必填）
 *
 * 哈希算法与 cloud/lib/auth.ts 保持一致（scrypt，N=16384, r=8, p=1, keylen=64）。
 */
import CloudBase from '@cloudbase/manager-node'
import { randomBytes, scryptSync } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SCRYPT_KEYLEN = 64
const SCRYPT_COST = 16384
const SCRYPT_BLOCK_SIZE = 8
const SCRYPT_PARALLEL = 1

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

const CAM_ENV_FILE = path.join(os.homedir(), '.happyhome', 'cam.env')
const fileEnv = loadDotEnvFile(CAM_ENV_FILE)

const ENV_ID = process.env.TCB_ENV || fileEnv.TCB_ENV || 'cloudbase-3gh862acb1505ff3'
const SECRET_ID = process.env.TENCENTCLOUD_SECRETID || fileEnv.TENCENTCLOUD_SECRETID
const SECRET_KEY = process.env.TENCENTCLOUD_SECRETKEY || fileEnv.TENCENTCLOUD_SECRETKEY
const USERNAME = (process.env.SEED_ADMIN_USERNAME || fileEnv.SEED_ADMIN_USERNAME || '').trim()
const PASSWORD = (process.env.SEED_ADMIN_PASSWORD || fileEnv.SEED_ADMIN_PASSWORD || '').trim()

if (!SECRET_ID || !SECRET_KEY) {
  console.error('[seed-admin] Missing TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY')
  console.error(`  Expected file: ${CAM_ENV_FILE}`)
  process.exit(1)
}
if (!USERNAME || !PASSWORD) {
  console.error('[seed-admin] Missing SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD')
  console.error('  Put them in env vars or ~/.happyhome/cam.env')
  process.exit(1)
}
if (PASSWORD.length < 6) {
  console.error('[seed-admin] Password must be at least 6 characters')
  process.exit(1)
}

const app = CloudBase.init({ secretId: SECRET_ID, secretKey: SECRET_KEY, envId: ENV_ID })
const db = app.database

// ensure 集合存在
try {
  const existRes = await db.checkCollectionExists('admin_accounts')
  if (!existRes?.Exists) {
    await db.createCollection('admin_accounts')
    console.log('✓ created collection admin_accounts')
  }
} catch (e) {
  console.error('[seed-admin] 无法确保 admin_accounts 集合存在:', e?.message || e)
  process.exit(1)
}

const existing = await db
  .collection('admin_accounts')
  .where({})
  .limit(1)
  .get()

if (existing?.data?.length) {
  console.log('= admin_accounts 已有账号，跳过 seed（幂等）')
  process.exit(0)
}

const salt = randomBytes(16).toString('hex')
const hash = scryptSync(PASSWORD, salt, SCRYPT_KEYLEN, {
  N: SCRYPT_COST,
  r: SCRYPT_BLOCK_SIZE,
  p: SCRYPT_PARALLEL,
}).toString('hex')

const now = new Date().toISOString()
const result = await db.collection('admin_accounts').add({
  username: USERNAME,
  passwordHash: hash,
  passwordSalt: salt,
  userId: '',
  role: 'superAdmin',
  status: 'active',
  createdAt: now,
  createdBy: 'seed',
})

console.log('✓ 已创建初始 superAdmin:', {
  _id: result?.id || result,
  username: USERNAME,
  role: 'superAdmin',
})
console.log('\n下一步：')
console.log('  1. admin-web 用 ' + USERNAME + ' / <你的密码> 登录')
console.log('  2. 进入"管理员管理"创建 communityAdmin 账号')
console.log('  3. 扫码登录接入后，用 admin.bindWechat 把账号绑到对应 openId')
