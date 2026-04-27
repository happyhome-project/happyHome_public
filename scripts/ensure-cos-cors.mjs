#!/usr/bin/env node
/**
 * scripts/ensure-cos-cors.mjs
 *
 * 一次性脚本：给 CloudBase 默认 COS Bucket 配置 CORS，允许 admin-web（admin.tinghai.xin）
 * 浏览器直传视频文件。幂等：已有匹配 origin 的规则就跳过；否则追加（保留其他规则）。
 *
 * 用法：
 *   node scripts/ensure-cos-cors.mjs            # apply
 *   node scripts/ensure-cos-cors.mjs --dry-run  # 仅打印
 *
 * 凭据：从 ~/.happyhome/cam.env 加载 TENCENTCLOUD_SECRETID/SECRETKEY，
 *      或环境变量覆盖。同 ensure-indexes.mjs 风格。
 */
import CloudBase from '@cloudbase/manager-node'
import COS from 'cos-nodejs-sdk-v5'
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

const ALLOWED_ORIGINS = [
  'https://admin.tinghai.xin',
  'http://localhost:5173',  // admin-web 本地 dev 服务器（vite 默认）
  'http://127.0.0.1:5173',
]

const DRY_RUN = process.argv.includes('--dry-run')

if (!SECRET_ID || !SECRET_KEY) {
  console.error('[ensure-cos-cors] Missing TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY')
  process.exit(1)
}

const app = CloudBase.init({
  secretId: SECRET_ID,
  secretKey: SECRET_KEY,
  envId: ENV_ID,
})

// 触发 lazy env config 加载（manager-node 会去 CloudBase API 拿 Storages 配置）
const envInfo = await app.env.getEnvInfo()
const storageConf = envInfo?.EnvInfo?.Storages?.[0]
if (!storageConf) {
  console.error('[ensure-cos-cors] 无法从 CloudBase 取到 Storages 配置')
  process.exit(1)
}
const bucket = storageConf.Bucket
const region = storageConf.Region

console.log('[ensure-cos-cors] env:', ENV_ID)
console.log('[ensure-cos-cors] bucket:', bucket)
console.log('[ensure-cos-cors] region:', region)

const cos = new COS({ SecretId: SECRET_ID, SecretKey: SECRET_KEY })

function getBucketCors() {
  return new Promise((resolve, reject) => {
    cos.getBucketCors({ Bucket: bucket, Region: region }, (err, data) => {
      if (err) {
        // NoSuchCORSConfiguration 视为空规则
        if (err.statusCode === 404 || /NoSuchCORSConfiguration/i.test(String(err.code || err.error || ''))) {
          return resolve({ CORSRules: [] })
        }
        return reject(err)
      }
      resolve(data)
    })
  })
}

function putBucketCors(rules) {
  return new Promise((resolve, reject) => {
    cos.putBucketCors({
      Bucket: bucket,
      Region: region,
      CORSConfiguration: { CORSRules: rules },
    }, (err, data) => err ? reject(err) : resolve(data))
  })
}

const existing = await getBucketCors()
const existingRules = Array.isArray(existing.CORSRules) ? existing.CORSRules : []
console.log(`[ensure-cos-cors] 当前已有 ${existingRules.length} 条 CORS 规则`)

const wantedOrigin = ALLOWED_ORIGINS[0]  // 主域名
const alreadyCovered = existingRules.some((rule) => {
  const origins = rule.AllowedOrigins || rule.AllowedOrigin || []
  const list = Array.isArray(origins) ? origins : [origins]
  return list.includes(wantedOrigin) || list.includes('*')
})

if (alreadyCovered) {
  console.log(`[ensure-cos-cors] ✓ ${wantedOrigin} 已被现有规则覆盖，无需修改`)
  process.exit(0)
}

const newRule = {
  AllowedOrigins: ALLOWED_ORIGINS,
  AllowedMethods: ['GET', 'POST', 'PUT', 'HEAD'],
  AllowedHeaders: ['*'],
  ExposeHeaders: ['ETag', 'Content-Length', 'x-cos-request-id'],
  MaxAgeSeconds: 600,
}

const merged = [...existingRules, newRule]

console.log('[ensure-cos-cors] 即将追加新规则：')
console.log(JSON.stringify(newRule, null, 2))
console.log(`[ensure-cos-cors] 合并后 CORS 规则总数：${merged.length}`)

if (DRY_RUN) {
  console.log('[ensure-cos-cors] --dry-run 模式，未实际写入')
  process.exit(0)
}

await putBucketCors(merged)
console.log('[ensure-cos-cors] ✓ CORS 规则已应用')
