export function buildPinnedArchiveSortKey(pinnedAt, postId) {
  return `PINNED_${pinnedAt}_${postId}`
}

export function planArchivePinnedSortRepair({ posts }) {
  const rows = Array.isArray(posts) ? posts : []
  const updates = []
  let eligible = 0
  let skippedInvalid = 0

  for (const post of rows) {
    if (post?.area !== 'archive' || post?.status !== 'active' || post?.isPinned !== true) continue
    eligible += 1

    const postId = String(post?._id || '').trim()
    const pinnedAt = String(post?.pinnedAt || '').trim()
    const createdAt = String(post?.createdAt || '').trim()
    if (!postId || !pinnedAt || !createdAt) {
      skippedInvalid += 1
      continue
    }

    const sortKey = buildPinnedArchiveSortKey(pinnedAt, postId)
    if (post.sortKey !== sortKey) updates.push({ postId, expectedPinnedAt: pinnedAt, sortKey })
  }

  return {
    updates,
    summary: {
      scanned: rows.length,
      eligible,
      updates: updates.length,
      skippedInvalid,
    },
  }
}
