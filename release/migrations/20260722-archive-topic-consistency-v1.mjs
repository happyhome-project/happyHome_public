import CloudBase from '@cloudbase/node-sdk'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { planArchiveTopicConsistencyRepair } from '../../scripts/lib/archive-topic-consistency-migration.mjs'

const PLANNER_SHA256 = '89b5c678340166c726396844d36f4f8adaaa8c3eac4e768291e3bab054356732'

function normalizedTextDigest(url) {
  return createHash('sha256').update(readFileSync(url, 'utf8').replace(/\r\n/g, '\n')).digest('hex')
}

async function readAll(database, collectionName) {
  const rows = []
  let afterId = ''
  for (;;) {
    let query = database.collection(collectionName)
    if (afterId) query = query.where({ _id: database.command.gt(afterId) })
    const response = await query.orderBy('_id', 'asc').limit(100).get()
    const page = Array.isArray(response?.data) ? response.data : []
    rows.push(...page)
    if (page.length < 100) return rows
    afterId = String(page[page.length - 1]._id || '')
    if (!afterId) throw new Error(`archive-topic-consistency-v1 ${collectionName} pagination requires _id`)
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

  const [afterCommunities, afterTopics, afterPosts, afterLinks] = await Promise.all([
    readAll(database, 'communities'),
    readAll(database, 'archive_topics'),
    readAll(database, 'posts'),
    readAll(database, 'archive_post_topics'),
  ])
  const residual = planArchiveTopicConsistencyRepair({
    communities: afterCommunities,
    topics: afterTopics,
    posts: afterPosts,
    links: afterLinks,
    now,
  })
  if (Object.values(residual.summary).some((value) => Number(value) !== 0)) {
    throw new Error(`archive-topic-consistency-v1 residual plan is not empty: ${JSON.stringify(residual.summary)}`)
  }
  console.log(`[archive-topic-consistency-v1] ${JSON.stringify({ ...plan.summary, residual: residual.summary })}`)
}
