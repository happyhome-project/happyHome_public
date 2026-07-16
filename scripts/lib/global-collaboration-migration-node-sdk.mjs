import {
  GLOBAL_COLLABORATION_COMPLETION_KEY,
  buildArchiveMutationGuard,
  canonicalize,
  collectCloudReferences,
  createGlobalCollaborationManifest,
  equalCanonical,
  executeVerifiedGlobalCollaborationPlan,
  planGlobalCollaborationMigration,
} from './global-collaboration-migration.mjs'

const PAGE_SIZE = 100
const FILE_DELETE_BATCH_SIZE = 50
const COMPLETION_DOCUMENT_ID = 'migration_global_collaboration_v1'
const TRANSACTION_BUSY_PATTERN = /ResourceUnavailable\.TransactionBusy|Transaction is busy/i

export async function runTransactionWithBusyRetry(
  database,
  callback,
  { attempts = 4, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {},
) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await database.runTransaction(callback)
    } catch (error) {
      if (!TRANSACTION_BUSY_PATTERN.test(String(error?.message || error)) || attempt >= attempts) throw error
      await sleep(attempt * 250)
    }
  }
  throw new Error('global collaboration transaction retry exhausted')
}

export const GLOBAL_COLLABORATION_DEPENDENT_COLLECTIONS = Object.freeze([
  'post_attendance_members',
  'content_audit_tasks',
  'post_search_documents',
  'post_search_terms',
  'post_search_chunks',
  'post_search_vector_terms',
  'post_search_index_state',
  'post_rag_jobs',
  'post_rag_index_state',
  'post_rag_index_state_v2',
  'post_rag_index_versions',
  'post_rag_chunks',
  'post_video_rag_jobs',
])

const FILE_REFERENCE_COLLECTIONS = Object.freeze([
  'users',
  'community_members',
  'admin_accounts',
  'app_configs',
  'admin_notifications',
  'community_create_requests',
  'post_video_rag_assets',
])

function isMissingCollectionError(error) {
  return /not exist|does not exist|不存在|CollectionNotExists|DATABASE_COLLECTION_NOT_EXIST/i.test(String(error?.message || error))
}

function asRows(response) {
  const data = response?.data
  if (Array.isArray(data)) return data
  return data ? [data] : []
}

async function readAll(database, collectionName, { allowMissing = false } = {}) {
  const rows = []
  let lastId = ''
  try {
    for (;;) {
      const where = lastId ? { _id: database.command.gt(lastId) } : {}
      const page = await database.collection(collectionName).where(where).orderBy('_id', 'asc').limit(PAGE_SIZE).get()
      const data = asRows(page)
      rows.push(...data)
      if (data.length < PAGE_SIZE) return rows
      const nextLastId = String(data[data.length - 1]?._id || '')
      if (!nextLastId || nextLastId <= lastId) throw new Error(`${collectionName} cursor did not advance`)
      lastId = nextLastId
    }
  } catch (error) {
    if (allowMissing && isMissingCollectionError(error)) return []
    throw error
  }
}

async function readDocument(database, collectionName, id) {
  try {
    const response = await database.collection(collectionName).doc(id).get()
    return asRows(response)[0] || null
  } catch (error) {
    if (isMissingCollectionError(error) || /not found|DOCUMENT_NOT_FOUND/i.test(String(error?.message || error))) return null
    throw error
  }
}

export async function readOutboxedPostTransactionState(transaction, { postId, versionId, outboxId }) {
  // CloudBase transactions reject overlapping document reads with TransactionBusy.
  const currentPost = await readDocument(transaction, 'posts', postId)
  const currentVersion = await readDocument(transaction, 'rag_community_versions', versionId)
  const currentOutbox = await readDocument(transaction, 'post_rag_outbox', outboxId)
  return { currentPost, currentVersion, currentOutbox }
}

function stripId(document) {
  if (!document) return document
  const { _id: _id, ...data } = document
  return data
}

function topLevelPatch(before, after, removeCommand) {
  const patch = {}
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
  keys.delete('_id')
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(after || {}, key)) patch[key] = removeCommand
    else if (!equalCanonical(before?.[key], after?.[key])) patch[key] = after[key]
  }
  return patch
}

async function applyDocumentOperation(database, operation) {
  let result = 'skipped'
  await runTransactionWithBusyRetry(database, async (transaction) => {
    const current = await readDocument(transaction, operation.collection, operation.id)
    if (equalCanonical(current, operation.after)) return
    if (!equalCanonical(current, operation.before)) {
      throw new Error(`${operation.collection}/${operation.id} changed outside the reviewed migration state`)
    }
    if (operation.after == null) {
      await transaction.collection(operation.collection).doc(operation.id).remove()
    } else if (operation.before == null) {
      await transaction.collection(operation.collection).doc(operation.id).set(stripId(operation.after))
    } else {
      const patch = topLevelPatch(operation.before, operation.after, database.command.remove())
      if (Object.keys(patch).length) await transaction.collection(operation.collection).doc(operation.id).update(patch)
    }
    result = 'applied'
  })
  const actual = await readDocument(database, operation.collection, operation.id)
  if (!equalCanonical(actual, operation.after)) throw new Error(`${operation.collection}/${operation.id} failed exact verification`)
  return result
}

function versionAdvancedPast(current, event) {
  return current
    && String(current.communityId || current._id || '') === event.communityId
    && Number.isSafeInteger(current.contentVersion)
    && current.contentVersion >= event.afterVersion.contentVersion
    && Number.isSafeInteger(current.aclVersion)
    && current.aclVersion >= event.afterVersion.aclVersion
}

function outboxDescendsFromEvent(current, event) {
  if (!current) return false
  const immutableFields = [
    '_id', 'schemaVersion', 'communityId', 'aggregateType', 'aggregateId',
    'eventType', 'reasonCode', 'contentVersion', 'aclVersion', 'createdAt',
  ]
  return immutableFields.every((field) => equalCanonical(current[field], event.afterOutbox[field]))
}

async function applyOutboxedPostOperation(database, operation, event) {
  let result = 'skipped'
  await runTransactionWithBusyRetry(database, async (transaction) => {
    const { currentPost, currentVersion, currentOutbox } = await readOutboxedPostTransactionState(transaction, {
      postId: operation.id,
      versionId: event.versionId,
      outboxId: event.outboxId,
    })
    if (equalCanonical(currentPost, operation.after)
      && outboxDescendsFromEvent(currentOutbox, event)
      && versionAdvancedPast(currentVersion, event)) return
    if (!equalCanonical(currentPost, operation.before)
      || !equalCanonical(currentVersion, event.beforeVersion)
      || currentOutbox != null) {
      throw new Error(`posts/${operation.id} or its RAG outbox changed outside the reviewed migration state`)
    }

    if (operation.after == null) {
      await transaction.collection('posts').doc(operation.id).remove()
    } else {
      const patch = topLevelPatch(operation.before, operation.after, database.command.remove())
      if (Object.keys(patch).length) await transaction.collection('posts').doc(operation.id).update(patch)
    }
    if (event.beforeVersion == null) {
      await transaction.collection('rag_community_versions').doc(event.versionId).set(stripId(event.afterVersion))
    } else {
      const patch = topLevelPatch(event.beforeVersion, event.afterVersion, database.command.remove())
      await transaction.collection('rag_community_versions').doc(event.versionId).update(patch)
    }
    await transaction.collection('post_rag_outbox').doc(event.outboxId).set(stripId(event.afterOutbox))
    result = 'applied'
  })

  const [actualPost, actualOutbox, actualVersion] = await Promise.all([
    readDocument(database, 'posts', operation.id),
    readDocument(database, 'post_rag_outbox', event.outboxId),
    readDocument(database, 'rag_community_versions', event.versionId),
  ])
  if (!equalCanonical(actualPost, operation.after) || !outboxDescendsFromEvent(actualOutbox, event) || !versionAdvancedPast(actualVersion, event)) {
    throw new Error(`posts/${operation.id} failed post/outbox verification`)
  }
  return result
}

async function recordCompletion(database, manifest, appliedAt) {
  const desired = {
    _id: COMPLETION_DOCUMENT_ID,
    key: GLOBAL_COLLABORATION_COMPLETION_KEY,
    status: 'complete',
    manifestSha256: manifest.manifestSha256,
    planDigest: manifest.planDigest,
    archiveDigest: manifest.archiveDigest,
    summary: manifest.summary,
    appliedAt,
  }
  await runTransactionWithBusyRetry(database, async (transaction) => {
    const current = await readDocument(transaction, 'app_configs', COMPLETION_DOCUMENT_ID)
    if (current) {
      if (current.status !== 'complete' || current.manifestSha256 !== manifest.manifestSha256 || current.planDigest !== manifest.planDigest) {
        throw new Error('global collaboration completion state belongs to another manifest')
      }
      return
    }
    await transaction.collection('app_configs').doc(COMPLETION_DOCUMENT_ID).set(stripId(desired))
  })
  const actual = await readDocument(database, 'app_configs', COMPLETION_DOCUMENT_ID)
  if (actual?.status !== 'complete' || actual?.manifestSha256 !== manifest.manifestSha256) {
    throw new Error('global collaboration completion state verification failed')
  }
  return actual
}

async function deleteUnreferencedFiles(storage, fileIds) {
  if (!fileIds.length) return 0
  if (!storage || typeof storage.deleteFile !== 'function') throw new Error('CloudBase storage.deleteFile is required')
  let deleted = 0
  for (let offset = 0; offset < fileIds.length; offset += FILE_DELETE_BATCH_SIZE) {
    const batch = fileIds.slice(offset, offset + FILE_DELETE_BATCH_SIZE)
    const response = await storage.deleteFile({ fileList: batch })
    const results = response?.fileList || []
    const failures = results.filter((item) => !/^(SUCCESS|FILE_NOT_FOUND)$/i.test(String(item?.code || 'SUCCESS')))
    if (failures.length) throw new Error(`cloud file cleanup failed: ${failures.map((item) => `${item.fileID}:${item.code}`).join(', ')}`)
    deleted += batch.length
  }
  return deleted
}

export async function captureGlobalCollaborationSnapshot(database) {
  if (!database?.collection || typeof database.runTransaction !== 'function') throw new Error('CloudBase database with transactions is required')
  const [communities, sections, posts, collaborationTemplates, ragCommunityVersions, archiveTopics, archivePostTopics] = await Promise.all([
    readAll(database, 'communities'),
    readAll(database, 'sections'),
    readAll(database, 'posts'),
    readAll(database, 'collaboration_templates', { allowMissing: true }),
    readAll(database, 'rag_community_versions', { allowMissing: true }),
    readAll(database, 'archive_topics', { allowMissing: true }),
    readAll(database, 'archive_post_topics', { allowMissing: true }),
  ])
  const dependentEntries = await Promise.all(GLOBAL_COLLABORATION_DEPENDENT_COLLECTIONS.map(async (collection) => [
    collection,
    await readAll(database, collection, { allowMissing: true }),
  ]))
  const referenceEntries = await Promise.all(FILE_REFERENCE_COLLECTIONS.map(async (collection) => [
    collection,
    await readAll(database, collection, { allowMissing: true }),
  ]))
  return canonicalize({
    communities,
    sections,
    posts,
    collaborationTemplates,
    ragCommunityVersions,
    dependents: Object.fromEntries(dependentEntries),
    referenceDocuments: referenceEntries.flatMap(([collection, rows]) => rows
      .filter((document) => !(collection === 'app_configs' && document?._id === COMPLETION_DOCUMENT_ID))
      .map((document) => ({ collection, document }))),
    archiveTopics,
    archivePostTopics,
  })
}

export async function prepareGlobalCollaborationMigration(database, { envId, headSha, preparedAt = new Date().toISOString() } = {}) {
  const snapshot = await captureGlobalCollaborationSnapshot(database)
  const plan = planGlobalCollaborationMigration(snapshot, { preparedAt, requireReferenceSections: true })
  return createGlobalCollaborationManifest({ envId, headSha, preparedAt, snapshot, plan })
}

export async function applyGlobalCollaborationMigration({
  database,
  storage,
  manifest,
  envId,
  headSha,
  expectedManifestSha256 = '',
  now = () => new Date().toISOString(),
} = {}) {
  return executeVerifiedGlobalCollaborationPlan({
    manifest,
    envId,
    headSha,
    expectedManifestSha256,
    readSnapshot: () => captureGlobalCollaborationSnapshot(database),
    apply: async (plan, _snapshot, { resumed }) => {
      const counters = { applied: 0, skipped: 0 }
      const count = (result) => { counters[result] += 1 }

      for (const operation of plan.templateCreates) count(await applyDocumentOperation(database, operation))
      for (const operation of plan.dependentUpdates) count(await applyDocumentOperation(database, operation))
      for (const operation of plan.dependentDeletes) count(await applyDocumentOperation(database, operation))

      const postOperations = new Map([...plan.postUpdates, ...plan.postsToDelete].map((operation) => [operation.id, operation]))
      for (const event of plan.outboxEvents) {
        const operation = postOperations.get(event.postId)
        if (!operation) throw new Error(`missing post operation for outbox ${event.outboxId}`)
        count(await applyOutboxedPostOperation(database, operation, event))
      }
      for (const operation of plan.sectionsToDelete) count(await applyDocumentOperation(database, operation))

      const afterDatabase = await captureGlobalCollaborationSnapshot(database)
      const afterArchive = buildArchiveMutationGuard(afterDatabase)
      if (afterArchive.digest !== manifest.archiveDigest) throw new Error('archive digest changed during global collaboration migration')
      const residual = planGlobalCollaborationMigration(afterDatabase, { preparedAt: manifest.preparedAt, requireReferenceSections: false })
      if (!residual.noop) throw new Error(`global collaboration residual migration work remains: ${JSON.stringify(residual.summary)}`)

      const liveReferences = collectCloudReferences(afterDatabase)
      const newlyReferenced = plan.files.delete.filter((fileId) => liveReferences.has(fileId))
      if (newlyReferenced.length) throw new Error(`cloud files gained live references during migration: ${newlyReferenced.join(', ')}`)
      const deletedFileCount = await deleteUnreferencedFiles(storage, plan.files.delete)
      const completion = await recordCompletion(database, manifest, now())
      return {
        applied: true,
        resumed,
        manifestSha256: manifest.manifestSha256,
        planDigest: manifest.planDigest,
        archiveDigest: afterArchive.digest,
        operations: counters,
        deletedFileCount,
        completionId: completion._id,
        residualSummary: residual.summary,
      }
    },
  })
}
