import { createHash } from 'node:crypto'

import { projectLegacyArchivePost } from './archive-legacy-projection.mjs'

const PAGE_SIZE = 100

async function readAll(database, collectionName) {
  const rows = []
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const page = await database.collection(collectionName).where({}).skip(skip).limit(PAGE_SIZE).get()
    const data = Array.isArray(page?.data) ? page.data : []
    rows.push(...data)
    if (data.length < PAGE_SIZE) return rows
  }
}

async function readDocument(database, collectionName, id) {
  const response = await database.collection(collectionName).doc(id).get()
  const data = response?.data
  return (Array.isArray(data) ? data[0] : data) || null
}

function canonical(value) {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

function equalValue(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

function planDigest(changes) {
  const records = changes.map(({ before, after }) => ({
    collection: 'posts',
    id: before._id,
    before: canonical(before),
    after: canonical(after),
  }))
  return createHash('sha256').update(JSON.stringify({ schemaVersion: 1, records })).digest('hex')
}

export async function planArchiveLegacyProjectionRepair(database) {
  if (!database?.collection) throw new Error('CloudBase database is required')
  const [sections, posts] = await Promise.all([
    readAll(database, 'sections'),
    readAll(database, 'posts'),
  ])
  const sectionById = new Map(sections.map((section) => [String(section?._id || ''), section]))
  const changes = []
  let skippedPostCount = 0
  let imageTextCount = 0
  let textCount = 0
  let emptyTitleCount = 0
  for (const post of posts) {
    const projection = projectLegacyArchivePost(post, sectionById.get(String(post?.sectionId || '')))
    if (!projection?.changed) {
      skippedPostCount += 1
      continue
    }
    changes.push({ before: structuredClone(post), after: projection.after })
    if (!String(projection.after.content?.title || '').trim()) emptyTitleCount += 1
    if (projection.after.format === 'image_text') imageTextCount += 1
    else textCount += 1
  }
  changes.sort((left, right) => String(left.before._id).localeCompare(String(right.before._id)))
  return {
    summary: {
      sectionCount: sections.length,
      candidatePostCount: posts.length,
      changedPostCount: changes.length,
      skippedPostCount,
      imageTextCount,
      textCount,
      emptyTitleCount,
      planDigest: planDigest(changes),
    },
    backup: { posts: changes.map(({ before }) => structuredClone(before)) },
    work: changes,
  }
}

async function mutateExact(database, before, after) {
  if (typeof database.runTransaction !== 'function') {
    throw new Error('CloudBase runTransaction is required for archive legacy projection repair')
  }
  await database.runTransaction(async (transaction) => {
    const current = await readDocument(transaction, 'posts', before._id)
    if (!equalValue(current, before)) {
      throw new Error(`posts/${before._id} changed after archive legacy projection dry-run`)
    }
    await transaction.collection('posts').doc(before._id).update({
      format: after.format,
      content: after.content,
    })
  })
}

export async function applyArchiveLegacyProjectionRepair(database, plan) {
  if (!plan || !Array.isArray(plan.work)) throw new Error('A reviewed archive legacy projection plan is required')
  for (const { before, after } of plan.work) await mutateExact(database, before, after)

  for (const { before, after } of plan.work) {
    const actual = await readDocument(database, 'posts', before._id)
    if (!equalValue(actual, after)) throw new Error(`posts/${before._id} failed archive legacy projection verification`)
  }

  const residual = await planArchiveLegacyProjectionRepair(database)
  if (residual.summary.changedPostCount !== 0) {
    throw new Error(`archive legacy projection residual scan found ${residual.summary.changedPostCount} posts`)
  }
  return {
    ...plan.summary,
    applied: true,
    verifiedPostCount: plan.summary.changedPostCount,
    residualPlanDigest: residual.summary.planDigest,
  }
}
