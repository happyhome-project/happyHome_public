import CloudBase from '@cloudbase/node-sdk'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import {
  hasAccidentalPinnedSortData,
  planArchivePinnedSortRepair,
} from '../../scripts/lib/archive-pinned-sort-migration.mjs'

const PLANNER_SHA256 = '7561d77af841ce2322cfcd25e1ee16fdd202f98a683f81c42acdf30214c4f2b8'

function normalizedTextDigest(url) {
  return createHash('sha256').update(readFileSync(url, 'utf8').replace(/\r\n/g, '\n')).digest('hex')
}

function verifyDependencies() {
  const dependencies = [
    ['planner', new URL('../../scripts/lib/archive-pinned-sort-migration.mjs', import.meta.url), PLANNER_SHA256],
  ]
  for (const [label, url, expected] of dependencies) {
    if (normalizedTextDigest(url) !== expected) throw new Error(`archive-pinned-sort-v1 ${label} digest mismatch`)
  }
}

async function readAllPosts(database) {
  const rows = []
  let afterId = ''
  for (;;) {
    let query = database.collection('posts')
    if (afterId) query = query.where({ _id: database.command.gt(afterId) })
    const response = await query.orderBy('_id', 'asc').limit(100).get()
    const page = Array.isArray(response?.data) ? response.data : []
    rows.push(...page)
    if (page.length < 100) return rows
    afterId = String(page[page.length - 1]?._id || '').trim()
    if (!afterId) throw new Error('archive-pinned-sort-v1 pagination requires _id')
  }
}

export async function applyArchivePinnedSortRepair(database) {
  verifyDependencies()
  if (typeof database?.runTransaction !== 'function') throw new Error('archive-pinned-sort-v1 requires CloudBase transactions')
  const posts = await readAllPosts(database)
  const plan = planArchivePinnedSortRepair({ posts })
  if (plan.summary.skippedInvalid > 0) {
    throw new Error(`archive-pinned-sort-v1 found ${plan.summary.skippedInvalid} invalid pinned archive posts`)
  }
  if (plan.updates.some((update) => update.removeNestedData) && typeof database.command?.remove !== 'function') {
    throw new Error('archive-pinned-sort-v1 requires command.remove to repair the accidental nested sortKey')
  }

  let applied = 0
  for (const update of plan.updates) {
    const changed = await database.runTransaction(async (transaction) => {
      const document = transaction.collection('posts').doc(update.postId)
      const snapshot = await document.get()
      const current = snapshot?.data
      if (!current
        || current.area !== 'archive'
        || current.status !== 'active'
        || current.isPinned !== true
        || String(current.pinnedAt || '').trim() !== update.expectedPinnedAt) return false
      const patch = { sortKey: update.sortKey }
      if (update.removeNestedData && hasAccidentalPinnedSortData(current, update.sortKey)) {
        patch.data = database.command.remove()
      }
      await document.update(patch)
      return true
    })
    if (changed) applied += 1
  }

  const residual = planArchivePinnedSortRepair({ posts: await readAllPosts(database) })
  if (residual.summary.updates > 0 || residual.summary.skippedInvalid > 0) {
    throw new Error(`archive-pinned-sort-v1 residual plan is not empty: ${JSON.stringify(residual.summary)}`)
  }

  return { ...plan.summary, applied, residual: residual.summary }
}

export async function up({ releaseContext } = {}) {
  const env = String(releaseContext?.envId || process.env.TCB_ENV || '').trim()
  const secretId = String(process.env.TENCENTCLOUD_SECRETID || '').trim()
  const secretKey = String(process.env.TENCENTCLOUD_SECRETKEY || '').trim()
  if (!env || !secretId || !secretKey) throw new Error('archive-pinned-sort-v1 requires release env and Tencent Cloud credentials')

  const database = CloudBase.init({ env, secretId, secretKey }).database()
  const result = await applyArchivePinnedSortRepair(database)
  console.log(`[archive-pinned-sort-v1] ${JSON.stringify(result)}`)
}
