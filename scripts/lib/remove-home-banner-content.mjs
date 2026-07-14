const PAGE_SIZE = 100

function normalizeId(value) {
  return String(value || '').trim()
}

function getMessage(error) {
  return String(error?.message || error || 'unknown error')
}

export function parseHomeBannerCleanupArgs(argv = []) {
  const options = {
    apply: argv.includes('--apply'),
    allCommunities: argv.includes('--all-communities'),
    confirmSoftDeleteBannerPosts: argv.includes('--confirm-soft-delete-banner-posts'),
    help: argv.includes('--help') || argv.includes('-h'),
  }
  if (options.apply) {
    if (!options.allCommunities) {
      throw new Error('Apply requires --all-communities')
    }
    if (!options.confirmSoftDeleteBannerPosts) {
      throw new Error('Apply requires --confirm-soft-delete-banner-posts')
    }
  }
  return options
}

export async function listAllCommunities(invoke) {
  const communities = []
  let afterId = ''
  while (true) {
    const result = await invoke('community.listAllPageAdmin', { afterId, limit: PAGE_SIZE })
    const items = Array.isArray(result?.items) ? result.items : []
    communities.push(...items)
    if (!result?.hasMore) break
    const nextAfterId = normalizeId(result?.nextAfterId)
    if (!nextAfterId || nextAfterId === afterId) {
      throw new Error('community pagination did not advance')
    }
    afterId = nextAfterId
  }
  return communities
}

export function freezeHomeBannerSnapshot(communities) {
  const entries = []
  const uniquePostIds = new Set()
  let bannerCount = 0
  for (const community of communities) {
    const communityId = normalizeId(community?._id || community?.id)
    const banners = Array.isArray(community?.homeBanners) ? community.homeBanners : []
    const postIds = []
    const invalidBanners = []
    const seen = new Set()
    bannerCount += banners.length
    banners.forEach((banner, index) => {
      const postId = normalizeId(banner?.postId)
      if (!postId) {
        invalidBanners.push({ index, bannerId: normalizeId(banner?.bannerId), reason: 'missing postId' })
        return
      }
      uniquePostIds.add(postId)
      if (!seen.has(postId)) {
        seen.add(postId)
        postIds.push(postId)
      }
    })
    entries.push({
      communityId,
      status: String(community?.status || ''),
      bannerCount: banners.length,
      postIds,
      invalidBanners,
      expectedBanners: banners.map((banner) => ({ ...banner })),
    })
  }
  return {
    communities: entries,
    communityCount: entries.length,
    bannerCount,
    uniquePostIds: [...uniquePostIds],
  }
}

async function validatePosts(snapshot, invoke) {
  const posts = new Map()
  for (const postId of snapshot.uniquePostIds) {
    try {
      const result = await invoke('post.getAdmin', { postId })
      if (!result?.post) throw new Error('post not found')
      posts.set(postId, { post: result.post, error: '' })
    } catch (error) {
      posts.set(postId, { post: null, error: getMessage(error) })
    }
  }
  return posts
}

function communityValidationIssues(entry, validatedPosts) {
  const issues = entry.invalidBanners.map((banner) => ({
    type: 'invalid_banner',
    ...banner,
  }))
  if (!entry.communityId) issues.push({ type: 'invalid_community', reason: 'missing community id' })
  for (const postId of entry.postIds) {
    const validation = validatedPosts.get(postId)
    if (!validation?.post) {
      issues.push({ type: 'post_validation_failed', postId, reason: validation?.error || 'post not found' })
      continue
    }
    if (normalizeId(validation.post.communityId) !== entry.communityId) {
      issues.push({ type: 'post_community_mismatch', postId })
    }
  }
  return issues
}

export async function runHomeBannerCleanup(options, invoke) {
  const communities = await listAllCommunities(invoke)
  const snapshot = freezeHomeBannerSnapshot(communities)
  const validatedPosts = await validatePosts(snapshot, invoke)
  const statuses = [...new Set(snapshot.communities.map((entry) => entry.status).filter(Boolean))]
  const report = {
    mode: options?.apply ? 'apply' : 'dry-run',
    communityCount: snapshot.communityCount,
    communityStatuses: statuses,
    bannerCount: snapshot.bannerCount,
    uniquePostCount: snapshot.uniquePostIds.length,
    snapshot: snapshot.communities
      .filter((entry) => entry.bannerCount > 0)
      .map((entry) => ({
        communityId: entry.communityId,
        status: entry.status,
        bannerCount: entry.bannerCount,
        postIds: [...entry.postIds],
        invalidBanners: [...entry.invalidBanners],
      })),
    deletedPostCount: 0,
    alreadyDeletedPostCount: 0,
    clearedCommunityCount: 0,
    failedCommunityCount: 0,
    issues: [],
  }

  for (const entry of snapshot.communities) {
    if (entry.bannerCount === 0) continue
    const issues = communityValidationIssues(entry, validatedPosts)
    if (issues.length > 0) {
      report.failedCommunityCount += 1
      report.issues.push({ communityId: entry.communityId, issues })
      continue
    }
    if (!options?.apply) continue

    try {
      for (const postId of entry.postIds) {
        const validation = validatedPosts.get(postId)
        const alreadyDeleted = validation.post.status === 'deleted'
        await invoke('post.deleteAdmin', { postId })
        validation.post.status = 'deleted'
        if (alreadyDeleted) report.alreadyDeletedPostCount += 1
        else report.deletedPostCount += 1
      }
      await invoke('community.updateHomeBanners', {
        communityId: entry.communityId,
        banners: [],
        expectedBanners: entry.expectedBanners,
      })
      report.clearedCommunityCount += 1
    } catch (error) {
      report.failedCommunityCount += 1
      report.issues.push({
        communityId: entry.communityId,
        issues: [{ type: 'apply_failed', reason: getMessage(error) }],
      })
    }
  }

  return report
}
