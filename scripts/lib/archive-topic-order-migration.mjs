function finite(value) { return Number.isFinite(Number(value)) ? Number(value) : Number.MAX_SAFE_INTEGER }

function currentOrder(records) {
  const active = records.filter(topic => topic.status !== 'deleted' && topic.enabled !== false)
  const selected = []
  const seen = new Set()
  const append = items => {
    for (const item of items) {
      if (seen.has(item.topicKey)) continue
      seen.add(item.topicKey); selected.push(item.topicKey)
    }
  }
  append(active.filter(topic => topic.origins?.includes('legacy')).sort((a, b) => finite(a.legacyOrder) - finite(b.legacyOrder) || a.topicKey.localeCompare(b.topicKey)))
  append(active.filter(topic => topic.origins?.includes('admin')).sort((a, b) => finite(a.adminOrder) - finite(b.adminOrder) || a.topicKey.localeCompare(b.topicKey)))
  append(active.slice().sort((a, b) => Number(b.recentScore || 0) - Number(a.recentScore || 0) || Number(b.recentPostCount || 0) - Number(a.recentPostCount || 0) || a.topicKey.localeCompare(b.topicKey)))
  return selected
}

export function planArchiveTopicOrderBackfill(communities, topics) {
  const byCommunity = new Map()
  for (const topic of topics) {
    const list = byCommunity.get(topic.communityId) || []
    list.push(topic); byCommunity.set(topic.communityId, list)
  }
  return communities
    .filter(community => !Array.isArray(community.archiveTopicOrder))
    .map(community => ({
      communityId: community._id,
      archiveTopicOrder: currentOrder(byCommunity.get(community._id) || []),
      archiveTopicOrderRevision: 1,
    }))
}
