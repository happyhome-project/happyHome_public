import { createHash } from 'node:crypto'

const MAX_TOPICS = 5
const MAX_TOPIC_LENGTH = 20

function normalizeTopic(value) {
  const displayName = String(value || '').normalize('NFKC').trim().replace(/^#+\s*/, '').trim()
  if (!displayName || Array.from(displayName).length > MAX_TOPIC_LENGTH) return null
  return { displayName, topicKey: displayName.toLowerCase() }
}

function digestId(prefix, ...parts) {
  return `${prefix}_${createHash('sha1').update(parts.join('\u0000')).digest('hex')}`
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

export function planArchiveMigration({ communityId, sections, posts }) {
  const evergreen = (sections || [])
    .filter((section) => section.communityId === communityId && section.type !== 'realtime')
    .sort((left, right) => Number(left.order || 0) - Number(right.order || 0) || String(left._id).localeCompare(String(right._id)))
  const sectionById = new Map(evergreen.map((section) => [section._id, section]))
  const topicUpserts = []
  for (const section of evergreen) {
    const topic = normalizeTopic(section.name)
    if (!topic) continue
    topicUpserts.push({
      _id: digestId('at', communityId, topic.topicKey),
      communityId,
      topicKey: topic.topicKey,
      displayName: topic.displayName,
      origins: ['legacy'],
      enabled: true,
      legacyOrder: Number(section.order || 0),
      legacySectionId: section._id,
      recentScore: 0,
      recentPostCount: 0,
    })
  }

  const postUpdates = []
  const topicLinks = []
  const warnings = []
  let skippedRealtime = 0
  for (const post of posts || []) {
    if (post.communityId !== communityId) continue
    const section = sectionById.get(post.sectionId)
    if (!section) {
      if ((sections || []).some((item) => item._id === post.sectionId && item.type === 'realtime')) skippedRealtime += 1
      continue
    }
    const legacyTopic = normalizeTopic(section.name)
    if (!legacyTopic) {
      warnings.push({ postId: post._id, reason: 'invalid legacy section topic' })
      continue
    }
    const createdAt = Number.isNaN(Date.parse(String(post.createdAt || ''))) ? '1970-01-01T00:00:00.000Z' : String(post.createdAt)
    if (createdAt.startsWith('1970-')) warnings.push({ postId: post._id, reason: 'invalid createdAt; fallback sort key used' })
    const topics = mergeLegacyTopic(post.topics, legacyTopic.displayName)
    const sortKey = `${createdAt}_${post._id}`
    postUpdates.push({
      postId: post._id,
      data: { area: 'archive', origin: 'legacy_section', topics, sortKey },
    })
    for (const rawTopic of topics) {
      const topic = normalizeTopic(rawTopic)
      topicLinks.push({
        _id: digestId('apt', post._id, topic.topicKey),
        communityId,
        topicKey: topic.topicKey,
        postId: post._id,
        sortKey,
        createdAt,
        status: post.status || 'active',
        auditStatus: post.auditStatus || 'pass',
      })
    }
  }
  return { topicUpserts, postUpdates, topicLinks, skippedRealtime, warnings }
}

export async function executeArchiveMigration(deps, input, { apply = false } = {}) {
  const plan = planArchiveMigration(input)
  if (apply) {
    for (const topic of plan.topicUpserts) await deps.set('archive_topics', topic._id, topic)
    for (const update of plan.postUpdates) await deps.update('posts', update.postId, update.data)
    for (const link of plan.topicLinks) await deps.set('archive_post_topics', link._id, link)
  }
  return {
    applied: apply,
    topicCount: plan.topicUpserts.length,
    postCount: plan.postUpdates.length,
    linkCount: plan.topicLinks.length,
    skippedRealtime: plan.skippedRealtime,
    warningCount: plan.warnings.length,
    warningPostIds: plan.warnings.slice(0, 20).map((item) => item.postId),
  }
}
