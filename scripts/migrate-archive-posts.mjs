#!/usr/bin/env node
import CloudBase from '@cloudbase/node-sdk'
import { executeArchiveMigration } from './lib/archive-migration.mjs'

function flag(name) {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || ''
}

const communityId = flag('community-id').trim()
const apply = process.argv.includes('--apply')
if (!communityId) throw new Error('Usage: migrate-archive-posts --community-id=<id> [--apply]')
const env = String(process.env.TCB_ENV || '').trim()
const secretId = String(process.env.TENCENTCLOUD_SECRETID || '').trim()
const secretKey = String(process.env.TENCENTCLOUD_SECRETKEY || '').trim()
if (!env || !secretId || !secretKey) throw new Error('TCB_ENV and Tencent Cloud credentials are required')

const app = CloudBase.init({ env, secretId, secretKey })
const database = app.database()
async function readAll(collectionName, where) {
  const rows = []
  for (let skip = 0; ; skip += 100) {
    const page = await database.collection(collectionName).where(where).skip(skip).limit(100).get()
    rows.push(...page.data)
    if (page.data.length < 100) return rows
  }
}

const sections = await readAll('sections', { communityId })
const posts = await readAll('posts', { communityId })
const result = await executeArchiveMigration({
  set: (collectionName, id, data) => database.collection(collectionName).doc(id).set({ data }),
  update: (collectionName, id, data) => database.collection(collectionName).doc(id).update({ data }),
}, { communityId, sections, posts }, { apply })
console.log(JSON.stringify(result, null, 2))
