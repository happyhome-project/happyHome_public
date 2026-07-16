import { createHash } from 'node:crypto'

export const GLOBAL_COLLABORATION_MIGRATION_ID = 'global-collaboration-v1'
export const GLOBAL_COLLABORATION_COMPLETION_KEY = 'migration.global_collaboration_v1'

export const GLOBAL_COLLABORATION_TEMPLATE_IDS = Object.freeze({
  carpool: 'collaboration-template-carpool',
  activity_invite: 'collaboration-template-activity-invite',
})

const RAG_REBUILD_COLLECTIONS = new Set([
  'post_rag_jobs',
  'post_rag_index_state',
  'post_rag_index_state_v2',
  'post_rag_index_versions',
  'post_rag_chunks',
  'post_video_rag_jobs',
])

const NEVER_DELETE_DEPENDENT_COLLECTIONS = new Set([
  'post_rag_outbox',
  'post_video_rag_assets',
])

const LABEL_ALIASES = Object.freeze({
  carpool_origin: ['出发地', '起点', '出发地点'],
  carpool_destination: ['目的地', '终点', '到达地点'],
  carpool_departure_time: ['出发时间', '时间'],
  carpool_seats: ['空余座位', '剩余座位', '座位'],
  carpool_contact: ['联系人', '联系方式'],
  carpool_attendance: ['上车', '我要上车', '报名'],
  carpool_location: ['地图位置', '位置'],
  carpool_note: ['补充说明', '说明', '备注'],
  activity_invite_title: ['邀约主题', '活动主题', '标题'],
  activity_invite_starts_at: ['出发时间', '活动时间', '时间'],
  activity_invite_location: ['集合地点', '地图位置', '位置'],
  activity_invite_contact: ['联系电话', '联系方式', '联系人电话'],
  activity_invite_capacity: ['人数上限', '人数', '名额'],
  activity_invite_note: ['补充说明', '说明', '备注'],
  activity_invite_attendance: ['我要参与', '报名', '参与'],
})

function cleanText(value) {
  return String(value ?? '').normalize('NFKC').trim()
}

function clone(value) {
  return value == null ? value : structuredClone(value)
}

export function canonicalize(value) {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

export function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonicalJson(value)).digest('hex')
}

export function equalCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right)
}

function widget(widgetId, type, label, fieldKey, required, order, showInList, extra = {}) {
  return { widgetId, type, label, fieldKey, required, order, showInList, ...extra }
}

export function buildGlobalCollaborationTemplates(now = new Date().toISOString()) {
  return [
    {
      _id: GLOBAL_COLLABORATION_TEMPLATE_IDS.carpool,
      systemKey: 'carpool',
      name: '拼车出行',
      icon: '🚗',
      order: 0,
      status: 'active',
      enableComment: true,
      enableLike: true,
      protectedSystemKey: true,
      widgets: [
        widget('carpool_origin', 'short_text', '出发地', 'origin', true, 0, true),
        widget('carpool_destination', 'short_text', '目的地', 'destination', true, 1, true),
        widget('carpool_departure_time', 'datetime', '出发时间', 'departureTime', true, 2, true),
        widget('carpool_seats', 'short_text', '空余座位', 'seats', true, 3, false),
        widget('carpool_contact', 'short_text', '联系人', 'contact', true, 4, false),
        widget('carpool_attendance', 'attendance', '上车', 'attendance', false, 5, false),
        widget('carpool_location', 'location', '地图位置', 'location', true, 6, false),
        widget('carpool_note', 'note_blocks', '补充说明', 'note', false, 7, false),
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: GLOBAL_COLLABORATION_TEMPLATE_IDS.activity_invite,
      systemKey: 'activity_invite',
      name: '出游邀约',
      icon: '👣',
      order: 1,
      status: 'active',
      enableComment: true,
      enableLike: true,
      protectedSystemKey: true,
      widgets: [
        widget('activity_invite_title', 'short_text', '邀约主题', 'title', true, 0, true),
        widget('activity_invite_starts_at', 'datetime', '出发时间', 'startsAt', true, 1, true),
        widget('activity_invite_location', 'location', '集合地点', 'location', true, 2, false),
        widget('activity_invite_contact', 'short_text', '联系电话', 'contact', true, 3, false, { visibility: 'member' }),
        widget('activity_invite_capacity', 'number', '人数上限', 'capacity', true, 4, false, { unit: '人' }),
        widget('activity_invite_note', 'note_blocks', '补充说明', 'note', false, 5, false),
        widget('activity_invite_attendance', 'attendance', '我要参与', 'attendance', false, 6, true, { capacityWidgetId: 'activity_invite_capacity' }),
      ],
      createdAt: now,
      updatedAt: now,
    },
  ]
}

export function classifyRealtimeSection(section) {
  if (cleanText(section?.type) !== 'realtime') return null
  const systemKey = cleanText(section?.systemKey)
  const name = cleanText(section?.name)
  if (systemKey === 'carpool' || name === '拼车出行') return 'carpool'
  if (systemKey === 'activity_invite' || name === '出游邀约') return 'activity_invite'
  return 'delete'
}

function typeCompatible(source, target) {
  if (source === target) return true
  const textTypes = new Set(['short_text', 'text'])
  return textTypes.has(source) && textTypes.has(target)
}

function candidateScore(source, target) {
  if (!source || !target || !typeCompatible(cleanText(source.type), cleanText(target.type))) return -1
  if (cleanText(source.widgetId) === cleanText(target.widgetId)) return 400
  if (cleanText(source.fieldKey) && cleanText(source.fieldKey) === cleanText(target.fieldKey)) return 300
  const aliases = new Set([cleanText(target.label), ...(LABEL_ALIASES[target.widgetId] || []).map(cleanText)])
  if (aliases.has(cleanText(source.label))) return 200
  return -1
}

function assertMappedWidgetContract(source, target, sectionLabel) {
  if (cleanText(source.type) !== cleanText(target.type)) {
    throw new Error(`${sectionLabel} ${target.label} type mismatch: expected ${target.type}, got ${source.type || '(missing)'}`)
  }
  if (cleanText(source.fieldKey) !== cleanText(target.fieldKey)) {
    throw new Error(`${sectionLabel} ${target.label} fieldKey mismatch: expected ${target.fieldKey}, got ${source.fieldKey || '(missing)'}`)
  }
  const acceptedLabels = new Set([cleanText(target.label), ...(LABEL_ALIASES[target.widgetId] || []).map(cleanText)])
  if (!acceptedLabels.has(cleanText(source.label))) {
    throw new Error(`${sectionLabel} ${target.label} label mismatch: got ${source.label || '(missing)'}`)
  }
  if (source.required === true !== (target.required === true)) {
    throw new Error(`${sectionLabel} ${target.label} required mismatch: expected ${target.required === true}, got ${source.required === true}`)
  }
  if (source.showInList === true !== (target.showInList === true)) {
    throw new Error(`${sectionLabel} ${target.label} showInList mismatch: expected ${target.showInList === true}, got ${source.showInList === true}`)
  }
  if (Number(source.order) !== Number(target.order)) {
    throw new Error(`${sectionLabel} ${target.label} order mismatch: expected ${target.order}, got ${source.order ?? '(missing)'}`)
  }
}

export function buildWidgetMapping(section, template, { strict = false, referenceLabel = '' } = {}) {
  const sources = Array.isArray(section?.widgets) ? section.widgets : []
  const targets = Array.isArray(template?.widgets) ? template.widgets : []
  const used = new Set()
  const targetToSource = {}
  const unmappedRequired = []
  const unmappedOptional = []
  const sectionLabel = referenceLabel || `section ${section?._id || '(missing)'}`

  for (const target of targets) {
    const ranked = sources
      .map((source, index) => ({ source, index, score: used.has(index) ? -1 : candidateScore(source, target) }))
      .filter((candidate) => candidate.score >= 0)
      .sort((left, right) => right.score - left.score || left.index - right.index)
    if (!ranked.length) {
      if (target.required) unmappedRequired.push(target.widgetId)
      else unmappedOptional.push(target.widgetId)
      continue
    }
    const selected = ranked[0]
    used.add(selected.index)
    targetToSource[target.widgetId] = cleanText(selected.source.widgetId)
    if (strict) assertMappedWidgetContract(selected.source, target, sectionLabel)
  }

  if (unmappedRequired.length) {
    throw new Error(`${sectionLabel} missing required controls: ${unmappedRequired.join(', ')}`)
  }
  if (strict) {
    const extras = sources.filter((_source, index) => !used.has(index))
    if (extras.length) throw new Error(`${sectionLabel} has unexpected controls: ${extras.map((item) => item.widgetId || item.label || '(unnamed)').join(', ')}`)
    if (template?.systemKey === 'activity_invite' && unmappedOptional.length) {
      throw new Error(`${sectionLabel} missing established controls: ${unmappedOptional.join(', ')}`)
    }
  }
  return { targetToSource, unmappedRequired, unmappedOptional }
}

function contractProjection(template) {
  const fields = ['_id', 'systemKey', 'name', 'icon', 'order', 'status', 'enableComment', 'enableLike', 'protectedSystemKey', 'widgets']
  return Object.fromEntries(fields.map((key) => [key, clone(template?.[key])]))
}

function assertExistingTemplates(existingTemplates, desiredTemplates) {
  const byId = new Map((existingTemplates || []).map((item) => [cleanText(item?._id), item]))
  const bySystemKey = new Map((existingTemplates || []).map((item) => [cleanText(item?.systemKey), item]))
  const creates = []
  for (const desired of desiredTemplates) {
    const existing = byId.get(desired._id) || bySystemKey.get(desired.systemKey)
    if (!existing) {
      creates.push({ collection: 'collaboration_templates', id: desired._id, before: null, after: clone(desired) })
      continue
    }
    if (cleanText(existing._id) !== desired._id || !equalCanonical(contractProjection(existing), contractProjection(desired))) {
      throw new Error(`existing collaboration template ${desired.systemKey} does not match the protected contract`)
    }
  }
  const protectedKeys = new Set(desiredTemplates.map((item) => item.systemKey))
  const conflicting = (existingTemplates || []).filter((item) => protectedKeys.has(cleanText(item.systemKey)) && !desiredTemplates.some((desired) => desired._id === item._id))
  if (conflicting.length) throw new Error(`duplicate protected collaboration templates: ${conflicting.map((item) => item._id).join(', ')}`)
  return creates
}

function remapContent(content, mapping) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return content
  const result = clone(content)
  for (const [targetId, sourceId] of Object.entries(mapping.targetToSource)) {
    if (!Object.prototype.hasOwnProperty.call(content, sourceId)) continue
    if (sourceId !== targetId) delete result[sourceId]
    result[targetId] = clone(content[sourceId])
  }
  return result
}

function convertPost(post, classification, mapping) {
  const after = clone(post)
  delete after.sectionId
  after.area = 'collaboration'
  after.collaborationTemplateId = GLOBAL_COLLABORATION_TEMPLATE_IDS[classification]
  after.collaborationSystemKey = classification
  after.content = remapContent(post.content, mapping)
  if (Object.prototype.hasOwnProperty.call(post, 'pendingContent')) after.pendingContent = remapContent(post.pendingContent, mapping)
  if (classification === 'activity_invite') {
    const startsAt = cleanText(after.content?.activity_invite_starts_at)
    if (startsAt) after.eventStartsAt = startsAt
  }
  return after
}

export function collectCloudReferences(value, target = new Set()) {
  if (typeof value === 'string') {
    if (value.startsWith('cloud://')) target.add(value)
    return target
  }
  if (Array.isArray(value)) {
    for (const item of value) collectCloudReferences(item, target)
    return target
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectCloudReferences(item, target)
  }
  return target
}

function sortDocuments(rows) {
  return [...(rows || [])].sort((left, right) => cleanText(left?._id).localeCompare(cleanText(right?._id)))
}

export function digestGlobalCollaborationSnapshot(snapshot) {
  const dependents = Object.fromEntries(Object.entries(snapshot?.dependents || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([collection, rows]) => [collection, sortDocuments(rows)]))
  return sha256({
    communities: sortDocuments(snapshot?.communities),
    sections: sortDocuments(snapshot?.sections),
    posts: sortDocuments(snapshot?.posts),
    collaborationTemplates: sortDocuments(snapshot?.collaborationTemplates),
    ragCommunityVersions: sortDocuments(snapshot?.ragCommunityVersions),
    dependents,
    referenceDocuments: sortDocuments(snapshot?.referenceDocuments),
    archiveTopics: sortDocuments(snapshot?.archiveTopics),
    archivePostTopics: sortDocuments(snapshot?.archivePostTopics),
  })
}

export function buildArchiveMutationGuard(snapshot) {
  const sections = sortDocuments((snapshot.sections || []).filter((section) => cleanText(section.type) !== 'realtime'))
  const sectionIds = new Set(sections.map((section) => cleanText(section._id)))
  const posts = sortDocuments((snapshot.posts || []).filter((post) => cleanText(post.area) === 'archive' || sectionIds.has(cleanText(post.sectionId))))
  const archiveTopics = sortDocuments(snapshot.archiveTopics)
  const archivePostTopics = sortDocuments(snapshot.archivePostTopics)
  const payload = { sections, posts, archiveTopics, archivePostTopics }
  return {
    sectionIds: sections.map((item) => cleanText(item._id)),
    postIds: posts.map((item) => cleanText(item._id)),
    sectionCount: sections.length,
    postCount: posts.length,
    digest: sha256(payload),
    payload,
  }
}

function assertReferenceSections(snapshot, realtimeSections, desiredByKey) {
  if (!realtimeSections.length) return
  const communities = new Map((snapshot.communities || []).map((community) => [cleanText(community._id), community]))
  const references = [
    { communityName: '明士班', classification: 'carpool' },
    { communityName: '青山村', classification: 'activity_invite' },
  ]
  for (const expected of references) {
    const matches = realtimeSections.filter((section) => (
      cleanText(communities.get(cleanText(section.communityId))?.name) === expected.communityName
      && classifyRealtimeSection(section) === expected.classification
    ))
    if (matches.length !== 1) {
      throw new Error(`${expected.communityName} ${expected.classification} reference section count must be exactly 1; got ${matches.length}`)
    }
    buildWidgetMapping(matches[0], desiredByKey.get(expected.classification), {
      strict: true,
      referenceLabel: `${expected.communityName} ${expected.classification === 'carpool' ? '拼车出行' : '出游邀约'}`,
    })
  }
}

function dependentPostId(collection, row) {
  const explicit = cleanText(row?.postId)
  if (explicit) return explicit
  if (['post_search_documents', 'post_search_index_state', 'post_rag_index_state', 'post_rag_index_state_v2'].includes(collection)) {
    return cleanText(row?._id)
  }
  return ''
}

function planDependents(snapshot, retainedById, deletedPostIds, mappingsBySection) {
  const deletes = []
  const updates = []
  for (const [collection, rows] of Object.entries(snapshot.dependents || {}).sort(([left], [right]) => left.localeCompare(right))) {
    for (const row of sortDocuments(rows)) {
      const postId = dependentPostId(collection, row)
      if (!postId) continue
      const retained = retainedById.get(postId)
      const deleteForRemovedPost = deletedPostIds.has(postId) && !NEVER_DELETE_DEPENDENT_COLLECTIONS.has(collection)
      // Retained local-search rows remain usable and preserve availability until
      // the post-release community backfill refreshes their stable widget IDs.
      // RAG rows are versioned and can be safely replaced by the outbox event.
      const deleteDerivedForRetained = Boolean(retained) && RAG_REBUILD_COLLECTIONS.has(collection)
      if (deleteForRemovedPost || deleteDerivedForRetained) {
        deletes.push({ collection, id: cleanText(row._id), before: clone(row), after: null })
        continue
      }
      if (collection === 'post_attendance_members' && retained) {
        const targetAttendanceId = retained.classification === 'carpool'
          ? 'carpool_attendance'
          : retained.classification === 'activity_invite'
            ? 'activity_invite_attendance'
            : ''
        const sourceAttendanceId = mappingsBySection.get(retained.sectionId)?.targetToSource?.[targetAttendanceId]
        if (targetAttendanceId && sourceAttendanceId && cleanText(row.widgetId) === sourceAttendanceId && sourceAttendanceId !== targetAttendanceId) {
          updates.push({
            collection,
            id: cleanText(row._id),
            before: clone(row),
            after: { ...clone(row), widgetId: targetAttendanceId },
          })
        }
      }
    }
  }
  const operationSort = (left, right) => left.collection.localeCompare(right.collection) || left.id.localeCompare(right.id)
  return { deletes: deletes.sort(operationSort), updates: updates.sort(operationSort) }
}

function versionDocument(current, communityId, preparedAt) {
  if (current) return clone(current)
  return {
    _id: communityId,
    communityId,
    contentVersion: 0,
    aclVersion: 0,
    createdAt: preparedAt,
    updatedAt: preparedAt,
  }
}

function buildOutboxEvents(postUpdates, postsToDelete, versions, preparedAt) {
  const currentByCommunity = new Map((versions || []).map((item) => [cleanText(item.communityId || item._id), clone(item)]))
  const changes = [
    ...postUpdates.map((operation) => ({ postId: operation.id, communityId: cleanText(operation.after.communityId), reasonCode: 'post.updated', eventType: 'post.upsert' })),
    ...postsToDelete.map((operation) => ({ postId: operation.id, communityId: cleanText(operation.before.communityId), reasonCode: 'post.deleted', eventType: 'post.delete' })),
  ].sort((left, right) => left.communityId.localeCompare(right.communityId) || left.postId.localeCompare(right.postId) || left.eventType.localeCompare(right.eventType))
  const events = []
  for (const change of changes) {
    if (!change.communityId) throw new Error(`post ${change.postId} has no communityId for RAG outbox`)
    const persistedBeforeVersion = currentByCommunity.has(change.communityId) ? clone(currentByCommunity.get(change.communityId)) : null
    const baseVersion = versionDocument(persistedBeforeVersion, change.communityId, preparedAt)
    if (!Number.isSafeInteger(baseVersion.contentVersion) || baseVersion.contentVersion < 0 || !Number.isSafeInteger(baseVersion.aclVersion) || baseVersion.aclVersion < 0) {
      throw new Error(`invalid RAG community version for ${change.communityId}`)
    }
    const afterVersion = {
      ...clone(baseVersion),
      contentVersion: baseVersion.contentVersion + 1,
      updatedAt: preparedAt,
    }
    const outboxId = sha256([change.communityId, change.eventType, 'post', change.postId, afterVersion.contentVersion, afterVersion.aclVersion])
    const afterOutbox = {
      _id: outboxId,
      schemaVersion: 2,
      communityId: change.communityId,
      aggregateType: 'post',
      aggregateId: change.postId,
      eventType: change.eventType,
      reasonCode: change.reasonCode,
      contentVersion: afterVersion.contentVersion,
      aclVersion: afterVersion.aclVersion,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: preparedAt,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: null,
      materializedJobId: null,
      fanoutSkip: 0,
      fanoutAfterPostId: null,
      createdAt: preparedAt,
      updatedAt: preparedAt,
    }
    events.push({
      postId: change.postId,
      communityId: change.communityId,
      reasonCode: change.reasonCode,
      eventType: change.eventType,
      versionId: change.communityId,
      beforeVersion: persistedBeforeVersion,
      afterVersion,
      outboxId,
      beforeOutbox: null,
      afterOutbox,
    })
    currentByCommunity.set(change.communityId, afterVersion)
  }
  return events
}

function planFiles(snapshot, postsToDelete, sectionsToDelete, dependentDeletes, desiredTemplates) {
  const candidates = new Set()
  for (const operation of postsToDelete) {
    collectCloudReferences(operation.before?.content, candidates)
    collectCloudReferences(operation.before?.pendingContent, candidates)
  }
  const deletedPostIds = new Set(postsToDelete.map((operation) => operation.id))
  const deletedSectionIds = new Set(sectionsToDelete.map((operation) => operation.id))
  const deletedDependentIds = new Set(dependentDeletes.map((operation) => `${operation.collection}\u0000${operation.id}`))
  const references = new Set()
  for (const community of snapshot.communities || []) collectCloudReferences(community, references)
  for (const post of snapshot.posts || []) if (!deletedPostIds.has(cleanText(post._id))) collectCloudReferences(post, references)
  for (const section of snapshot.sections || []) if (!deletedSectionIds.has(cleanText(section._id))) collectCloudReferences(section, references)
  for (const template of [...(snapshot.collaborationTemplates || []), ...desiredTemplates]) collectCloudReferences(template, references)
  for (const document of snapshot.referenceDocuments || []) collectCloudReferences(document, references)
  for (const [collection, rows] of Object.entries(snapshot.dependents || {})) {
    for (const row of rows || []) {
      if (!deletedDependentIds.has(`${collection}\u0000${cleanText(row._id)}`)) collectCloudReferences(row, references)
    }
  }
  const allCandidates = [...candidates].sort()
  return {
    candidates: allCandidates,
    protected: allCandidates.filter((fileId) => references.has(fileId)),
    delete: allCandidates.filter((fileId) => !references.has(fileId)),
  }
}

function assertNoArchiveMutation(guard, mutationIds) {
  const postMutations = new Set(mutationIds.posts)
  const sectionMutations = new Set(mutationIds.sections)
  const badPosts = guard.postIds.filter((id) => postMutations.has(id))
  const badSections = guard.sectionIds.filter((id) => sectionMutations.has(id))
  if (badPosts.length || badSections.length) {
    throw new Error(`archive data entered migration mutation set: posts=${badPosts.join(',') || '-'} sections=${badSections.join(',') || '-'}`)
  }
}

export function planGlobalCollaborationMigration(snapshot, { preparedAt = new Date().toISOString(), requireReferenceSections = true } = {}) {
  if (!snapshot || !Array.isArray(snapshot.sections) || !Array.isArray(snapshot.posts)) throw new Error('migration snapshot requires sections and posts')
  if (!Number.isFinite(Date.parse(preparedAt))) throw new Error('preparedAt must be an ISO timestamp')
  const desiredTemplates = buildGlobalCollaborationTemplates(preparedAt)
  const desiredByKey = new Map(desiredTemplates.map((item) => [item.systemKey, item]))
  const templateCreates = assertExistingTemplates(snapshot.collaborationTemplates || [], desiredTemplates)
  const sectionById = new Map(snapshot.sections.map((section) => [cleanText(section._id), section]))
  const realtimeSections = snapshot.sections.filter((section) => classifyRealtimeSection(section) !== null)
  if (requireReferenceSections) assertReferenceSections(snapshot, realtimeSections, desiredByKey)

  const mappingsBySection = new Map()
  for (const section of realtimeSections) {
    const classification = classifyRealtimeSection(section)
    if (classification === 'delete') continue
    mappingsBySection.set(cleanText(section._id), buildWidgetMapping(section, desiredByKey.get(classification), { strict: false }))
  }

  const retainedById = new Map()
  const postUpdates = []
  const postsToDelete = []
  for (const post of snapshot.posts || []) {
    const section = sectionById.get(cleanText(post.sectionId))
    const classification = classifyRealtimeSection(section)
    if (!classification) continue
    if (cleanText(post.area) === 'archive') {
      throw new Error(`archive post ${post._id} entered realtime migration mutation set`)
    }
    if (classification === 'delete') {
      postsToDelete.push({ collection: 'posts', id: cleanText(post._id), before: clone(post), after: null })
      continue
    }
    const sectionId = cleanText(section._id)
    const mapping = mappingsBySection.get(sectionId)
    const after = convertPost(post, classification, mapping)
    const operation = { collection: 'posts', id: cleanText(post._id), before: clone(post), after }
    postUpdates.push(operation)
    retainedById.set(operation.id, { classification, sectionId })
  }
  postUpdates.sort((left, right) => left.id.localeCompare(right.id))
  postsToDelete.sort((left, right) => left.id.localeCompare(right.id))

  const sectionsToDelete = realtimeSections.map((section) => ({ collection: 'sections', id: cleanText(section._id), before: clone(section), after: null }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const deletedPostIds = new Set(postsToDelete.map((operation) => operation.id))
  const dependents = planDependents(snapshot, retainedById, deletedPostIds, mappingsBySection)
  const files = planFiles(snapshot, postsToDelete, sectionsToDelete, dependents.deletes, desiredTemplates)
  const outboxEvents = buildOutboxEvents(postUpdates, postsToDelete, snapshot.ragCommunityVersions || [], preparedAt)
  const guard = buildArchiveMutationGuard(snapshot)
  const mutationIds = {
    posts: [...postUpdates.map((item) => item.id), ...postsToDelete.map((item) => item.id)].sort(),
    sections: sectionsToDelete.map((item) => item.id),
    collaborationTemplates: templateCreates.map((item) => item.id),
    dependents: [...dependents.updates, ...dependents.deletes].map((item) => `${item.collection}/${item.id}`).sort(),
  }
  assertNoArchiveMutation(guard, mutationIds)

  const summary = {
    realtimeSectionCount: realtimeSections.length,
    retainedSectionCount: realtimeSections.filter((section) => classifyRealtimeSection(section) !== 'delete').length,
    deletedSectionCount: realtimeSections.filter((section) => classifyRealtimeSection(section) === 'delete').length,
    retainedPostCount: postUpdates.length,
    deletedPostCount: postsToDelete.length,
    dependentDeleteCount: dependents.deletes.length,
    dependentUpdateCount: dependents.updates.length,
    fileDeleteCount: files.delete.length,
    fileProtectedCount: files.protected.length,
    templateCreateCount: templateCreates.length,
    outboxEventCount: outboxEvents.length,
  }
  const plan = {
    schemaVersion: 1,
    migrationId: GLOBAL_COLLABORATION_MIGRATION_ID,
    preparedAt,
    sourceDigest: digestGlobalCollaborationSnapshot(snapshot),
    desiredTemplates,
    templateCreates,
    postUpdates,
    postsToDelete,
    dependentUpdates: dependents.updates,
    dependentDeletes: dependents.deletes,
    sectionsToDelete,
    outboxEvents,
    files,
    archiveGuard: guard,
    mutationIds,
    summary,
  }
  plan.noop = templateCreates.length === 0 && postUpdates.length === 0 && postsToDelete.length === 0
    && dependents.updates.length === 0 && dependents.deletes.length === 0 && sectionsToDelete.length === 0 && files.delete.length === 0
  plan.planDigest = sha256(plan)
  return plan
}

export function createGlobalCollaborationManifest({ envId, headSha, preparedAt, snapshot, plan } = {}) {
  if (!cleanText(envId)) throw new Error('manifest envId is required')
  if (!/^[0-9a-f]{40}$/i.test(cleanText(headSha))) throw new Error('manifest headSha must be a full commit SHA')
  if (!plan || plan.migrationId !== GLOBAL_COLLABORATION_MIGRATION_ID) throw new Error('global collaboration plan is required')
  if (preparedAt && preparedAt !== plan.preparedAt) throw new Error('manifest preparedAt must match the reviewed plan')
  const sourceDigest = digestGlobalCollaborationSnapshot(snapshot)
  if (sourceDigest !== plan.sourceDigest) throw new Error('plan source snapshot mismatch')
  const manifest = {
    schemaVersion: 1,
    migrationId: GLOBAL_COLLABORATION_MIGRATION_ID,
    envId: cleanText(envId),
    headSha: cleanText(headSha).toLowerCase(),
    preparedAt: preparedAt || plan.preparedAt,
    sourceDigest,
    planDigest: plan.planDigest,
    archiveDigest: plan.archiveGuard.digest,
    summary: clone(plan.summary),
    plan: clone(plan),
  }
  manifest.manifestSha256 = sha256(manifest)
  return manifest
}

export function verifyGlobalCollaborationManifest(manifest, { envId, headSha, expectedManifestSha256 = '' } = {}) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.migrationId !== GLOBAL_COLLABORATION_MIGRATION_ID) {
    throw new Error('unsupported global collaboration migration manifest')
  }
  const { manifestSha256, ...unsigned } = manifest
  const actual = sha256(unsigned)
  if (!/^[0-9a-f]{64}$/i.test(cleanText(manifestSha256)) || actual !== cleanText(manifestSha256).toLowerCase()) {
    throw new Error('global collaboration manifest hash mismatch')
  }
  if (expectedManifestSha256 && actual !== cleanText(expectedManifestSha256).toLowerCase()) throw new Error('reviewed manifest SHA256 mismatch')
  if (envId && cleanText(manifest.envId) !== cleanText(envId)) throw new Error('global collaboration manifest environment mismatch')
  if (headSha && cleanText(manifest.headSha).toLowerCase() !== cleanText(headSha).toLowerCase()) throw new Error('global collaboration manifest HEAD mismatch')
  if (manifest.planDigest !== manifest.plan?.planDigest || sha256({ ...manifest.plan, planDigest: undefined }) !== manifest.planDigest) {
    throw new Error('global collaboration manifest plan digest mismatch')
  }
  if (manifest.sourceDigest !== manifest.plan?.sourceDigest || manifest.archiveDigest !== manifest.plan?.archiveGuard?.digest) {
    throw new Error('global collaboration manifest binding mismatch')
  }
  assertNoArchiveMutation(manifest.plan.archiveGuard, manifest.plan.mutationIds)
  return { manifestSha256: actual, planDigest: manifest.planDigest }
}

function restoreOperationsToBefore(rows, operations, label) {
  const byId = new Map((rows || []).map((row) => [cleanText(row._id), clone(row)]))
  for (const operation of operations || []) {
    const current = byId.get(operation.id) || null
    const beforeMatches = equalCanonical(current, operation.before)
    const afterMatches = equalCanonical(current, operation.after)
    if (!beforeMatches && !afterMatches) {
      throw new Error(`${label}/${operation.id} is neither the reviewed before nor after state`)
    }
    if (operation.before == null) byId.delete(operation.id)
    else byId.set(operation.id, clone(operation.before))
  }
  return sortDocuments([...byId.values()])
}

export function normalizePartialSnapshotToManifestSource(snapshot, plan) {
  const normalized = clone(snapshot)
  normalized.collaborationTemplates = restoreOperationsToBefore(
    normalized.collaborationTemplates,
    plan.templateCreates,
    'collaboration_templates',
  )
  normalized.sections = restoreOperationsToBefore(normalized.sections, plan.sectionsToDelete, 'sections')
  normalized.posts = restoreOperationsToBefore(normalized.posts, [...plan.postUpdates, ...plan.postsToDelete], 'posts')
  normalized.dependents ||= {}
  const dependentOperations = [...plan.dependentUpdates, ...plan.dependentDeletes]
  for (const collection of new Set(dependentOperations.map((operation) => operation.collection))) {
    normalized.dependents[collection] = restoreOperationsToBefore(
      normalized.dependents[collection],
      dependentOperations.filter((operation) => operation.collection === collection),
      collection,
    )
  }

  const versionsByCommunity = new Map((normalized.ragCommunityVersions || []).map((row) => [cleanText(row.communityId || row._id), clone(row)]))
  const eventsByCommunity = new Map()
  for (const event of plan.outboxEvents || []) {
    const list = eventsByCommunity.get(event.communityId) || []
    list.push(event)
    eventsByCommunity.set(event.communityId, list)
  }
  for (const [communityId, events] of eventsByCommunity) {
    const current = versionsByCommunity.get(communityId) || null
    const allowed = [events[0].beforeVersion, ...events.map((event) => event.afterVersion)]
    if (!allowed.some((candidate) => equalCanonical(current, candidate))) {
      throw new Error(`rag_community_versions/${communityId} is not a reviewed migration state`)
    }
    if (events[0].beforeVersion == null) versionsByCommunity.delete(communityId)
    else versionsByCommunity.set(communityId, clone(events[0].beforeVersion))
  }
  normalized.ragCommunityVersions = sortDocuments([...versionsByCommunity.values()])
  return normalized
}

export async function executeVerifiedGlobalCollaborationPlan({ manifest, envId, headSha, expectedManifestSha256 = '', readSnapshot, apply }) {
  verifyGlobalCollaborationManifest(manifest, { envId, headSha, expectedManifestSha256 })
  if (typeof readSnapshot !== 'function' || typeof apply !== 'function') throw new Error('verified migration executor requires readSnapshot and apply')
  const snapshot = await readSnapshot()
  const currentArchiveGuard = buildArchiveMutationGuard(snapshot)
  if (currentArchiveGuard.digest !== manifest.archiveDigest) throw new Error('archive digest changed after prepare; refusing mutation')
  const currentDigest = digestGlobalCollaborationSnapshot(snapshot)
  let resumed = false
  if (currentDigest === manifest.sourceDigest) {
    const replanned = planGlobalCollaborationMigration(snapshot, { preparedAt: manifest.preparedAt, requireReferenceSections: true })
    if (replanned.planDigest !== manifest.planDigest) throw new Error('global collaboration plan changed after prepare; refusing mutation')
  } else {
    let normalized
    try {
      normalized = normalizePartialSnapshotToManifestSource(snapshot, manifest.plan)
    } catch (error) {
      throw new Error(`global collaboration source snapshot mismatch; ${error.message}`, { cause: error })
    }
    if (digestGlobalCollaborationSnapshot(normalized) !== manifest.sourceDigest) {
      throw new Error('global collaboration source snapshot mismatch; prepare a new manifest before any mutation')
    }
    resumed = true
  }
  return apply(manifest.plan, snapshot, { resumed })
}

function applyOperations(rows, operations) {
  const byId = new Map((rows || []).map((row) => [cleanText(row._id), clone(row)]))
  for (const operation of operations || []) {
    if (operation.after == null) byId.delete(operation.id)
    else byId.set(operation.id, clone(operation.after))
  }
  return sortDocuments([...byId.values()])
}

export function applyPlanToSnapshot(snapshot, plan) {
  const result = clone(snapshot)
  result.collaborationTemplates = applyOperations(result.collaborationTemplates, plan.templateCreates)
  result.sections = applyOperations(result.sections, plan.sectionsToDelete)
  result.posts = applyOperations(result.posts, [...plan.postUpdates, ...plan.postsToDelete])
  result.dependents ||= {}
  const dependentOperations = [...plan.dependentUpdates, ...plan.dependentDeletes]
  for (const collection of new Set(dependentOperations.map((operation) => operation.collection))) {
    result.dependents[collection] = applyOperations(result.dependents[collection], dependentOperations.filter((operation) => operation.collection === collection))
  }
  const versionById = new Map((result.ragCommunityVersions || []).map((row) => [cleanText(row.communityId || row._id), clone(row)]))
  const outboxById = new Map((result.postRagOutbox || []).map((row) => [cleanText(row._id), clone(row)]))
  for (const event of plan.outboxEvents || []) {
    versionById.set(event.communityId, clone(event.afterVersion))
    outboxById.set(event.outboxId, clone(event.afterOutbox))
  }
  result.ragCommunityVersions = sortDocuments([...versionById.values()])
  result.postRagOutbox = sortDocuments([...outboxById.values()])
  return result
}

export const __testing = Object.freeze({ remapContent })
