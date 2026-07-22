import { createHash } from 'node:crypto'

function digestId(prefix, ...parts) {
  return `${prefix}_${createHash('sha1').update(parts.join('\u0000')).digest('hex')}`
}

function normalizeTopic(value) {
  const displayName = String(value || '').normalize('NFKC').trim().replace(/^#+\s*/, '').trim()
  if (!displayName || Array.from(displayName).length > 20) return null
  return { topicKey: displayName.toLowerCase(), displayName }
}

function withoutId(value) {
  const { _id, ...data } = value
  return data
}

function unique(values) {
  return [...new Set(values)]
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

function minimumFinite(values) {
  const finite = values.map(Number).filter(Number.isFinite)
  return finite.length > 0 ? Math.min(...finite) : undefined
}

function chooseCanonical(group, order) {
  const orderIndex = new Map(order.map((key, index) => [key, index]))
  return group.slice().sort((left, right) => (
    (left.origins?.includes('admin') ? 0 : left.origins?.includes('legacy') ? 1 : 2)
        - (right.origins?.includes('admin') ? 0 : right.origins?.includes('legacy') ? 1 : 2)
      || String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
      || (orderIndex.get(left.topicKey) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(right.topicKey) ?? Number.MAX_SAFE_INTEGER)
      || String(left.topicKey).localeCompare(String(right.topicKey))
  ))[0]
}

export function planArchiveTopicConsistencyRepair({ communities, topics, posts, links, now }) {
  const topicUpserts = []
  const linkUpserts = []
  const linkDeletes = []
  const communityUpdates = []
  const postsById = new Map(posts.filter((post) => post.area === 'archive').map((post) => [post._id, post]))
  const linksById = new Map(links.map((link) => [link._id, link]))

  for (const community of communities) {
    const communityId = community._id
    const order = Array.isArray(community.archiveTopicOrder) ? community.archiveTopicOrder : []
    const communityTopics = topics.filter((topic) => topic.communityId === communityId && topic.status !== 'deleted')
    const groups = new Map()
    for (const topic of communityTopics) {
      const normalized = normalizeTopic(topic.displayName || topic.topicKey)
      if (!normalized) continue
      const group = groups.get(normalized.topicKey) || []
      group.push(topic)
      groups.set(normalized.topicKey, group)
    }

    const canonicalByDisplay = new Map()
    const aliasToCanonical = new Map()
    const duplicates = []
    for (const [displayKey, group] of groups) {
      const canonical = chooseCanonical(group, order)
      canonicalByDisplay.set(displayKey, canonical)
      for (const topic of group) aliasToCanonical.set(topic.topicKey, canonical.topicKey)
      duplicates.push(...group.filter((topic) => topic._id !== canonical._id).map((topic) => ({ topic, canonical })))
    }

    const communityPosts = posts
      .filter((post) => post.communityId === communityId && post.area === 'archive')
      .slice()
      .sort((left, right) => String(left._id).localeCompare(String(right._id)))
    const desiredLinkIds = new Set()
    const visibleCounts = new Map()
    const discoveredKeys = []
    const syntheticTopics = new Map()

    for (const post of communityPosts) {
      const seen = new Set()
      for (const rawTopic of Array.isArray(post.topics) ? post.topics : []) {
        const normalized = normalizeTopic(rawTopic)
        if (!normalized) continue
        let canonical = canonicalByDisplay.get(normalized.topicKey)
        if (!canonical) {
          canonical = syntheticTopics.get(normalized.topicKey)
          if (!canonical) {
            canonical = {
              _id: digestId('at', communityId, normalized.topicKey),
              communityId,
              topicKey: normalized.topicKey,
              displayName: normalized.displayName,
              origins: ['organic'],
              enabled: true,
              status: 'active',
              recentScore: 0,
              recentPostCount: 0,
              createdAt: now,
              updatedAt: now,
            }
            syntheticTopics.set(normalized.topicKey, canonical)
            canonicalByDisplay.set(normalized.topicKey, canonical)
            aliasToCanonical.set(normalized.topicKey, normalized.topicKey)
            discoveredKeys.push(normalized.topicKey)
          }
        }
        if (seen.has(canonical.topicKey)) continue
        seen.add(canonical.topicKey)
        const id = digestId('apt', post._id, canonical.topicKey)
        desiredLinkIds.add(id)
        const status = String(post.status || 'active')
        const auditStatus = String(post.auditStatus || 'pass')
        const createdAt = String(post.createdAt || now)
        const linkData = {
          communityId,
          topicKey: canonical.topicKey,
          postId: post._id,
          sortKey: String(post.sortKey || `${createdAt}_${post._id}`),
          createdAt,
          status,
          auditStatus,
          updatedAt: now,
        }
        const existingLink = linksById.get(id)
        if (!existingLink || !same(withoutId(existingLink), linkData)) linkUpserts.push({ id, data: linkData })
        if (status === 'active' && auditStatus === 'pass') {
          visibleCounts.set(canonical.topicKey, Number(visibleCounts.get(canonical.topicKey) || 0) + 1)
        }
      }
    }

    const canonicalGroups = new Map()
    for (const topic of communityTopics) {
      const canonicalKey = aliasToCanonical.get(topic.topicKey) || topic.topicKey
      const group = canonicalGroups.get(canonicalKey) || []
      group.push(topic)
      canonicalGroups.set(canonicalKey, group)
    }
    for (const [canonicalKey, group] of canonicalGroups) {
      const canonical = group.find((topic) => topic.topicKey === canonicalKey) || chooseCanonical(group, order)
      const legacyOrder = minimumFinite(group.map((topic) => topic.legacyOrder))
      const adminOrder = minimumFinite(group.map((topic) => topic.adminOrder))
      const topicData = {
        ...withoutId(canonical),
        origins: unique(group.flatMap((topic) => topic.origins || [])),
        enabled: canonical.origins?.some((origin) => origin === 'admin' || origin === 'legacy')
          ? canonical.enabled !== false
          : group.some((topic) => topic.enabled !== false),
        status: 'active',
        recentScore: group.reduce((total, topic) => total + Number(topic.recentScore || 0), 0),
        recentPostCount: Number(visibleCounts.get(canonicalKey) || 0),
        ...(legacyOrder === undefined ? {} : { legacyOrder }),
        ...(adminOrder === undefined ? {} : { adminOrder }),
        ...(canonical.legacySectionId ? {} : {
          ...(group.find((topic) => topic.legacySectionId)?.legacySectionId
            ? { legacySectionId: group.find((topic) => topic.legacySectionId).legacySectionId }
            : {}),
        }),
        updatedAt: now,
      }
      if (!same(withoutId(canonical), topicData)) topicUpserts.push({ id: canonical._id, data: topicData })
    }
    for (const { topic } of duplicates) {
      topicUpserts.push({ id: topic._id, data: {
        ...withoutId(topic),
        enabled: false,
        status: 'deleted',
        recentPostCount: 0,
        deletedAt: now,
        updatedAt: now,
      } })
    }
    for (const topic of syntheticTopics.values()) {
      const topicData = {
        ...withoutId(topic),
        recentPostCount: Number(visibleCounts.get(topic.topicKey) || 0),
      }
      const existingTopic = topics.find((item) => item._id === topic._id)
      if (!existingTopic || !same(withoutId(existingTopic), topicData)) topicUpserts.push({ id: topic._id, data: topicData })
    }

    for (const link of links.filter((link) => link.communityId === communityId)) {
      if (!postsById.has(link.postId) || !desiredLinkIds.has(link._id)) {
        if (link.status !== 'deleted') linkDeletes.push({ id: link._id, data: { status: 'deleted', updatedAt: now } })
      }
    }

    const repairedOrder = unique([
      ...order.map((key) => aliasToCanonical.get(key) || key),
      ...discoveredKeys,
    ])
    if (!same(repairedOrder, order)) {
      communityUpdates.push({
        communityId,
        archiveTopicOrder: repairedOrder,
        archiveTopicOrderRevision: Number(community.archiveTopicOrderRevision || 0) + 1,
      })
    }
  }

  return {
    topicUpserts,
    linkUpserts,
    linkDeletes,
    communityUpdates,
    summary: {
      topicUpserts: topicUpserts.length,
      linkUpserts: linkUpserts.length,
      linkDeletes: linkDeletes.length,
      communityUpdates: communityUpdates.length,
    },
  }
}
