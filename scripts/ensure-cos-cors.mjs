#!/usr/bin/env node
/**
 * Ensure the default CloudBase COS bucket allows browser uploads from admin-web.
 *
 * Usage:
 *   node scripts/ensure-cos-cors.mjs
 *   node scripts/ensure-cos-cors.mjs --dry-run
 *
 * Credentials are loaded from ~/.happyhome/cam.env, or from environment variables:
 *   TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY / TCB_ENV
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
  'http://localhost:5180',
  'http://127.0.0.1:5180',
  'http://localhost:5173',
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

const envInfo = await app.env.getEnvInfo()
const storageConf = envInfo?.EnvInfo?.Storages?.[0]
if (!storageConf) {
  console.error('[ensure-cos-cors] Cannot read CloudBase storage config')
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
console.log(`[ensure-cos-cors] existing CORS rules: ${existingRules.length}`)

function originCovered(origin) {
  return existingRules.some((rule) => {
    const origins = rule.AllowedOrigins || rule.AllowedOrigin || []
    const list = Array.isArray(origins) ? origins : [origins]
    return list.includes(origin) || list.includes('*')
  })
}

const missingOrigins = ALLOWED_ORIGINS.filter((origin) => !originCovered(origin))
if (missingOrigins.length === 0) {
  console.log('[ensure-cos-cors] required origins are already covered')
  process.exit(0)
}

console.log('[ensure-cos-cors] missing origins:', missingOrigins.join(', '))

const newRule = {
  AllowedOrigins: ALLOWED_ORIGINS,
  AllowedMethods: ['GET', 'POST', 'PUT', 'HEAD'],
  AllowedHeaders: ['*'],
  ExposeHeaders: ['ETag', 'Content-Length', 'x-cos-request-id'],
  MaxAgeSeconds: 600,
}

const merged = [...existingRules, newRule]

console.log('[ensure-cos-cors] appending rule:')
console.log(JSON.stringify(newRule, null, 2))
console.log(`[ensure-cos-cors] merged CORS rules: ${merged.length}`)

if (DRY_RUN) {
  console.log('[ensure-cos-cors] dry run; not writing')
  process.exit(0)
}

await putBucketCors(merged)
console.log('[ensure-cos-cors] CORS rule applied')
