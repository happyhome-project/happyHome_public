import CloudBase from '@cloudbase/node-sdk'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { executeArchiveMigration } from '../../scripts/lib/archive-migration.mjs'

const PAGE_SIZE = 100
const ARCHIVE_MIGRATION_LOGIC_SHA256 = 'a94a0033872e7c0491bd70c2f47372aabec9a4fed41c21267901f0eaa615ea2b'

async function readAll(database, collectionName, where = {}) {
  const rows = []
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const page = await database.collection(collectionName).where(where).skip(skip).limit(PAGE_SIZE).get()
    rows.push(...page.data)
    if (page.data.length < PAGE_SIZE) return rows
  }
}

export async function up({ releaseContext } = {}) {
  const logicBytes = readFileSync(new URL('../../scripts/lib/archive-migration.mjs', import.meta.url))
  const logicDigest = createHash('sha256').update(logicBytes).digest('hex')
  if (logicDigest !== ARCHIVE_MIGRATION_LOGIC_SHA256) {
    throw new Error('archive-posts-v1 migration logic digest mismatch')
  }
  const env = String(releaseContext?.envId || process.env.TCB_ENV || '').trim()
  const secretId = String(process.env.TENCENTCLOUD_SECRETID || '').trim()
  const secretKey = String(process.env.TENCENTCLOUD_SECRETKEY || '').trim()
  if (!env || !secretId || !secretKey) {
    throw new Error('archive-posts-v1 requires release env and Tencent Cloud credentials')
  }

  const app = CloudBase.init({ env, secretId, secretKey })
  const database = app.database()
  const communities = await readAll(database, 'communities')
  const summary = {
    communityCount: 0,
    topicCount: 0,
    postCount: 0,
    linkCount: 0,
    skippedRealtime: 0,
    warningCount: 0,
  }

  for (const community of communities) {
    const communityId = String(community?._id || '').trim()
    if (!communityId) continue
    const [sections, posts, archiveTopics] = await Promise.all([
      readAll(database, 'sections', { communityId }),
      readAll(database, 'posts', { communityId }),
      readAll(database, 'archive_topics', { communityId }),
    ])
    const result = await executeArchiveMigration({
      set: (collectionName, id, data) => database.collection(collectionName).doc(id).set({ data }),
      update: (collectionName, id, data) => database.collection(collectionName).doc(id).update({ data }),
    }, { communityId, sections, posts, archiveTopics }, { apply: true })

    summary.communityCount += 1
    summary.topicCount += result.topicCount
    summary.postCount += result.postCount
    summary.linkCount += result.linkCount
    summary.skippedRealtime += result.skippedRealtime
    summary.warningCount += result.warningCount
  }

  console.log(`[archive-posts-v1] ${JSON.stringify(summary)}`)
}
