import CloudBase from '@cloudbase/node-sdk'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { planArchiveTopicConsistencyRepair } from '../../scripts/lib/archive-topic-consistency-migration.mjs'

const PLANNER_SHA256 = 'ff154dd66aff6edd66ae5f729ff0f66a31c981969309b0fb640a3ccd5cf24a74'

function normalizedTextDigest(url) {
  return createHash('sha256').update(readFileSync(url, 'utf8').replace(/\r\n/g, '\n')).digest('hex')
}

async function readAll(database, collectionName) {
  const rows = []
  for (let skip = 0; ; skip += 100) {
    const response = await database.collection(collectionName).skip(skip).limit(100).get()
    const page = Array.isArray(response?.data) ? response.data : []
    rows.push(...page)
    if (page.length < 100) return rows
  }
}

export async function up({ releaseContext } = {}) {
  const plannerUrl = new URL('../../scripts/lib/archive-topic-consistency-migration.mjs', import.meta.url)
  if (normalizedTextDigest(plannerUrl) !== PLANNER_SHA256) throw new Error('archive-topic-consistency-v1 planner digest mismatch')

  const env = String(releaseContext?.envId || process.env.TCB_ENV || '').trim()
  const secretId = String(process.env.TENCENTCLOUD_SECRETID || '').trim()
  const secretKey = String(process.env.TENCENTCLOUD_SECRETKEY || '').trim()
  if (!env || !secretId || !secretKey) throw new Error('archive-topic-consistency-v1 requires release env and Tencent Cloud credentials')

  const database = CloudBase.init({ env, secretId, secretKey }).database()
  const [communities, topics, posts, links] = await Promise.all([
    readAll(database, 'communities'),
    readAll(database, 'archive_topics'),
    readAll(database, 'posts'),
    readAll(database, 'archive_post_topics'),
  ])
  const now = new Date().toISOString()
  const plan = planArchiveTopicConsistencyRepair({ communities, topics, posts, links, now })

  for (const item of plan.topicUpserts) {
    await database.collection('archive_topics').doc(item.id).set({ data: item.data })
  }
  for (const item of plan.linkUpserts) {
    await database.collection('archive_post_topics').doc(item.id).set({ data: item.data })
  }
  for (const item of plan.linkDeletes) {
    await database.collection('archive_post_topics').doc(item.id).update({ data: item.data })
  }
  for (const item of plan.communityUpdates) {
    await database.collection('communities').doc(item.communityId).update({ data: {
      archiveTopicOrder: item.archiveTopicOrder,
      archiveTopicOrderRevision: item.archiveTopicOrderRevision,
    } })
  }

  console.log(`[archive-topic-consistency-v1] ${JSON.stringify(plan.summary)}`)
}
