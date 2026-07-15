import CloudBase from '@cloudbase/node-sdk'
import { planArchiveTopicOrderBackfill } from '../../scripts/lib/archive-topic-order-migration.mjs'

async function readAll(database, collectionName) {
  const rows = []
  for (let skip = 0; ; skip += 100) {
    const page = await database.collection(collectionName).orderBy('_id', 'asc').skip(skip).limit(100).get()
    rows.push(...page.data)
    if (page.data.length < 100) return rows
  }
}

export async function up({ releaseContext } = {}) {
  const env = String(releaseContext?.envId || process.env.TCB_ENV || '').trim()
  const secretId = String(process.env.TENCENTCLOUD_SECRETID || '').trim()
  const secretKey = String(process.env.TENCENTCLOUD_SECRETKEY || '').trim()
  if (!env || !secretId || !secretKey) throw new Error('archive-topic-order-v1 requires release env and Tencent Cloud credentials')
  const database = CloudBase.init({ env, secretId, secretKey }).database()
  const [communities, topics] = await Promise.all([readAll(database, 'communities'), readAll(database, 'archive_topics')])
  const plan = planArchiveTopicOrderBackfill(communities, topics)
  for (const operation of plan) {
    await database.runTransaction(async transaction => {
      const snapshot = await transaction.collection('communities').doc(operation.communityId).get()
      const community = snapshot.data
      if (Array.isArray(community.archiveTopicOrder)) return
      await transaction.collection('communities').doc(operation.communityId).update({ data: {
        archiveTopicOrder: operation.archiveTopicOrder,
        archiveTopicOrderRevision: operation.archiveTopicOrderRevision,
      } })
    })
  }
  console.log(`[archive-topic-order-v1] ${JSON.stringify({ planned: plan.length, applied: plan.length })}`)
}
