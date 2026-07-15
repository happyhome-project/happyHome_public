import { createHash } from 'node:crypto'

const PAGE_SIZE = 100
const MAX_TOPICS = 5
const MAX_TOPIC_LENGTH = 20

async function readAll(database, collectionName, where = {}) {
  const rows = []
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const page = await database.collection(collectionName).where(where).skip(skip).limit(PAGE_SIZE).get()
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

function hasMalformedWrapper(row) {
  return row && Object.hasOwn(row, 'data') && row.data && typeof row.data === 'object' && !Array.isArray(row.data)
}

function withoutId(row) {
  const { _id, ...data } = row
  return data
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

function digestId(prefix, ...parts) {
  return `${prefix}_${createHash('sha1').update(parts.join('\u0000')).digest('hex')}`
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function exactKeys(value, expected) {
  return equalValue(Object.keys(value).sort(), [...expected].sort())
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeTopic(value) {
  const displayName = String(value || '').normalize('NFKC').trim().replace(/^#+\s*/, '').trim()
  if (!displayName || Array.from(displayName).length > MAX_TOPIC_LENGTH) return null
  return { displayName, topicKey: displayName.toLowerCase() }
}

function mergeLegacyTopic(existing, legacyName) {
  const values = []
  const seen = new Set()
  for (const raw of [...(Array.isArray(existing) ? existing : []), legacyName]) {
    const topic = normalizeTopic(raw)
    if (!topic || seen.has(topic.topicKey)) continue
    seen.add(topic.topicKey)
    values.push(topic.displayName)
  }
  if (values.length <= MAX_TOPICS) return values
  const legacy = normalizeTopic(legacyName)?.displayName
  return [...values.filter((value) => value !== legacy).slice(0, MAX_TOPICS - 1), legacy]
}

function validTopicWrapper(row) {
  const data = row.data
  return nonEmpty(data.communityId)
    && nonEmpty(data.topicKey)
    && nonEmpty(data.displayName)
    && Array.isArray(data.origins)
    && data.origins.includes('legacy')
    && typeof data.enabled === 'boolean'
    && finiteNumber(data.legacyOrder)
    && nonEmpty(data.legacySectionId)
    && finiteNumber(data.recentScore)
    && finiteNumber(data.recentPostCount)
    && data.createdAt != null
    && data.updatedAt != null
    && row._id === digestId('at', data.communityId, data.topicKey)
}

function validPostWrapper(row) {
  const data = row.data
  const legacyTopic = Array.isArray(data.topics) ? data.topics.at(-1) : ''
  return exactKeys(data, ['area', 'origin', 'topics', 'sortKey', 'status', 'auditStatus'])
    && nonEmpty(row._id)
    && nonEmpty(row.communityId)
    && nonEmpty(row.sectionId)
    && data.area === 'archive'
    && data.origin === 'legacy_section'
    && Array.isArray(data.topics)
    && data.topics.length > 0
    && data.topics.every(nonEmpty)
    && equalValue(mergeLegacyTopic(row.topics, legacyTopic), data.topics)
    && nonEmpty(data.sortKey)
    && data.sortKey.endsWith(`_${row._id}`)
    && nonEmpty(data.status)
    && nonEmpty(data.auditStatus)
}

function validLinkWrapper(row) {
  const data = row.data
  return exactKeys(data, ['communityId', 'topicKey', 'postId', 'sortKey', 'createdAt', 'status', 'auditStatus'])
    && nonEmpty(data.communityId)
    && nonEmpty(data.topicKey)
    && nonEmpty(data.postId)
    && nonEmpty(data.sortKey)
    && data.sortKey.endsWith(`_${data.postId}`)
    && data.createdAt != null
    && nonEmpty(data.status)
    && nonEmpty(data.auditStatus)
    && row._id === digestId('apt', data.postId, data.topicKey)
}

function topLevelPostData(row) {
  return {
    area: row.area,
    origin: row.origin,
    topics: row.topics,
    sortKey: row.sortKey,
    status: row.status,
    auditStatus: row.auditStatus,
  }
}

function topLevelLinkData(row) {
  return {
    communityId: row.communityId,
    topicKey: row.topicKey,
    postId: row.postId,
    sortKey: row.sortKey,
    createdAt: row.createdAt,
    status: row.status,
    auditStatus: row.auditStatus,
  }
}

function repairPlanDigest(work) {
  const records = work.flatMap((item) => [
    ...item.repairPlan.topicUpserts.map(({ before, after }) => ({ collection: 'archive_topics', id: before._id, before: canonical(before), after: canonical(after) })),
    ...item.repairPlan.postUpdates.map(({ before, after }) => ({ collection: 'posts', id: before._id, before: canonical(before), after: canonical(after) })),
    ...item.repairPlan.topicLinks.map(({ before, after }) => ({ collection: 'archive_post_topics', id: before._id, before: canonical(before), after: canonical(after) })),
  ]).sort((left, right) => left.collection.localeCompare(right.collection) || String(left.id).localeCompare(String(right.id)))
  return createHash('sha256').update(JSON.stringify({ schemaVersion: 1, records })).digest('hex')
}

export async function planArchiveMigrationRepair(database) {
  const [allArchiveTopics, allPosts, allArchivePostTopics] = await Promise.all([
    readAll(database, 'archive_topics'),
    readAll(database, 'posts'),
    readAll(database, 'archive_post_topics'),
  ])
  const topicCandidates = allArchiveTopics.filter(hasMalformedWrapper)
  const postCandidates = allPosts.filter((row) => hasMalformedWrapper(row) && (row.data.area === 'archive' || row.data.origin === 'legacy_section'))
  const linkCandidates = allArchivePostTopics.filter(hasMalformedWrapper)
  const malformedTopics = topicCandidates.filter(validTopicWrapper)
  const malformedPosts = postCandidates.filter(validPostWrapper)
  const malformedLinks = linkCandidates.filter(validLinkWrapper)
  const repairedPosts = allPosts
    .filter((row) => !hasMalformedWrapper(row) && row.area === 'archive' && row.origin === 'legacy_section')
    .map((row) => ({ row, data: topLevelPostData(row), wrapped: false }))
    .filter(({ row, data }) => validPostWrapper({ ...row, data }))
  const repairedLinks = allArchivePostTopics
    .filter((row) => !hasMalformedWrapper(row))
    .map((row) => ({ row, data: topLevelLinkData(row), wrapped: false }))
    .filter(({ row, data }) => validLinkWrapper({ ...row, data }))
  const postById = new Map([
    ...repairedPosts.map((record) => [record.row._id, record]),
    ...malformedPosts.map((row) => [row._id, { row, data: row.data, wrapped: true }]),
  ])
  const linkById = new Map([
    ...repairedLinks.map((record) => [record.row._id, record]),
    ...malformedLinks.map((row) => [row._id, { row, data: row.data, wrapped: true }]),
  ])
  const bundleConflictCount = malformedLinks.filter((row) => {
    const post = postById.get(row.data.postId)
    return !post
      || row.data.communityId !== post.row.communityId
      || row.data.sortKey !== post.data.sortKey
      || (post.wrapped && (row.data.status !== post.data.status || row.data.auditStatus !== post.data.auditStatus))
      || !post.data.topics.some((topic) => normalizeTopic(topic)?.topicKey === row.data.topicKey)
  }).length + malformedPosts.filter((row) => row.data.topics.some((topic) => {
    const normalized = normalizeTopic(topic)
    return !normalized || !linkById.has(digestId('apt', row._id, normalized.topicKey))
  })).length
  const conflictCount = topicCandidates.length - malformedTopics.length
    + postCandidates.length - malformedPosts.length
    + linkCandidates.length - malformedLinks.length
    + bundleConflictCount
  if (conflictCount > 0) {
    throw new Error(`Found ${conflictCount} drifted malformed archive migration records; refusing repair`)
  }

  const backup = { archiveTopics: [], posts: [], archivePostTopics: [] }
  backup.archiveTopics.push(...malformedTopics)
  backup.posts.push(...malformedPosts)
  backup.archivePostTopics.push(...malformedLinks)
  const repairPlan = {
    topicUpserts: malformedTopics.map((before) => ({ before, after: { _id: before._id, ...before.data } })),
    postUpdates: malformedPosts.map((before) => ({
      before,
      after: {
        postId: before._id,
        data: {
          ...before.data,
          status: nonEmpty(before.status) ? before.status : before.data.status,
          auditStatus: nonEmpty(before.auditStatus) ? before.auditStatus : before.data.auditStatus,
        },
      },
    })),
    topicLinks: malformedLinks.map((before) => {
      const post = postById.get(before.data.postId)
      return {
        before,
        after: {
          _id: before._id,
          ...before.data,
          status: nonEmpty(post?.row.status) ? post.row.status : before.data.status,
          auditStatus: nonEmpty(post?.row.auditStatus) ? post.row.auditStatus : before.data.auditStatus,
        },
      }
    }),
  }
  const work = [{ communityId: 'all', repairPlan }]
  const communityIds = new Set([
    ...malformedTopics.map((row) => row.data.communityId),
    ...malformedPosts.map((row) => row.communityId),
    ...malformedLinks.map((row) => row.data.communityId),
  ])
  const summary = {
    communityCount: communityIds.size,
    candidateTopicCount: topicCandidates.length,
    candidatePostCount: postCandidates.length,
    candidateLinkCount: linkCandidates.length,
    malformedTopicCount: malformedTopics.length,
    malformedPostCount: malformedPosts.length,
    malformedLinkCount: malformedLinks.length,
    skippedRealtime: 0,
    warningCount: 0,
  }

  summary.planDigest = repairPlanDigest(work)
  return { summary, backup, work }
}

function assertDocumentShape(collectionName, id, actual, expected) {
  if (!actual) throw new Error(`${collectionName}/${id} is missing after archive repair`)
  if (hasMalformedWrapper(actual)) throw new Error(`${collectionName}/${id} still has a malformed data wrapper`)
  for (const [key, value] of Object.entries(expected)) {
    if (!equalValue(actual[key], value)) {
      throw new Error(`${collectionName}/${id} failed archive repair verification for ${key}`)
    }
  }
}

async function mutateExact(database, collectionName, id, before, mutate) {
  if (typeof database.runTransaction !== 'function') throw new Error('CloudBase runTransaction is required for archive repair')
  await database.runTransaction(async (transaction) => {
    const current = await readDocument(transaction, collectionName, id)
    if (!equalValue(current, before)) throw new Error(`${collectionName}/${id} changed after archive repair dry-run`)
    await mutate(transaction.collection(collectionName).doc(id))
  })
}

export async function applyArchiveMigrationRepair(database, repair) {
  if (!repair || !Array.isArray(repair.work)) throw new Error('A reviewed archive repair plan is required')
  for (const item of repair.work) {
    for (const { before, after } of item.repairPlan.topicUpserts) {
      const { _id, ...data } = after
      await mutateExact(database, 'archive_topics', _id, before, (document) => document.set(data))
    }
    for (const { before, after } of item.repairPlan.postUpdates) {
      await mutateExact(database, 'posts', after.postId, before, (document) => document.update({
        ...after.data,
        data: database.command.remove(),
      }))
    }
    for (const { before, after } of item.repairPlan.topicLinks) {
      const { _id, ...data } = after
      await mutateExact(database, 'archive_post_topics', _id, before, (document) => document.set(data))
    }
  }

  for (const item of repair.work) {
    for (const { after } of item.repairPlan.topicUpserts) {
      assertDocumentShape('archive_topics', after._id, await readDocument(database, 'archive_topics', after._id), withoutId(after))
    }
    for (const { after } of item.repairPlan.postUpdates) {
      assertDocumentShape('posts', after.postId, await readDocument(database, 'posts', after.postId), after.data)
    }
    for (const { after } of item.repairPlan.topicLinks) {
      assertDocumentShape('archive_post_topics', after._id, await readDocument(database, 'archive_post_topics', after._id), withoutId(after))
    }
  }

  const residual = await planArchiveMigrationRepair(database)
  if (residual.summary.malformedTopicCount || residual.summary.malformedPostCount || residual.summary.malformedLinkCount) {
    throw new Error('archive repair residual scan found malformed migration records')
  }

  return {
    ...repair.summary,
    applied: true,
    verifiedTopicCount: repair.summary.malformedTopicCount,
    verifiedPostCount: repair.summary.malformedPostCount,
    verifiedLinkCount: repair.summary.malformedLinkCount,
    residualPlanDigest: residual.summary.planDigest,
  }
}
