#!/usr/bin/env node
/**
 * scripts/verify-community-creator.mjs
 *
 * 只读报告：扫所有 communities，找出 creatorId 空或引用到不存在 user 的记录。
 *
 * 背景：双权限改造后 community admin 按 creatorId ∪ community_members(role=admin)
 * 判断归属。历史数据里若有 creatorId 为空的社区，communityAdmin 将看不到它们。
 *
 * 本脚本只报告，不自动回填——归属需要人工决定。
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
  console.error('[verify] Missing TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY')
  process.exit(1)
}

const app = CloudBase.init({ secretId: SECRET_ID, secretKey: SECRET_KEY, envId: ENV_ID })
const db = app.database

const BATCH = 100
let offset = 0
let missingCreator = []
let orphanCreator = []
let total = 0

while (true) {
  const res = await db.collection('communities').skip(offset).limit(BATCH).get()
  const docs = res?.data || []
  if (docs.length === 0) break
  total += docs.length

  for (const c of docs) {
    if (!c.creatorId) {
      missingCreator.push({ _id: c._id, name: c.name, status: c.status, createdAt: c.createdAt })
      continue
    }
    try {
      const userRes = await db.collection('users').doc(c.creatorId).get()
      if (!userRes?.data?.length) {
        orphanCreator.push({ _id: c._id, name: c.name, creatorId: c.creatorId, status: c.status })
      }
    } catch {
      orphanCreator.push({ _id: c._id, name: c.name, creatorId: c.creatorId, status: c.status })
    }
  }

  if (docs.length < BATCH) break
  offset += BATCH
}

console.log(`\n[verify] 扫描完成，共 ${total} 条社区记录。`)
console.log(`  - creatorId 为空: ${missingCreator.length}`)
if (missingCreator.length) console.table(missingCreator)
console.log(`  - creatorId 指向的 user 不存在: ${orphanCreator.length}`)
if (orphanCreator.length) console.table(orphanCreator)

if (missingCreator.length + orphanCreator.length > 0) {
  console.log('\n[verify] 这些社区在 communityAdmin 视图里不会出现。')
  console.log('         如需修复：superAdmin 在 admin-web 管理员管理里创建对应账号，并手工修补。')
}
