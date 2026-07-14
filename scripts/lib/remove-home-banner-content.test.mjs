import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseHomeBannerCleanupArgs,
  runHomeBannerCleanup,
} from './remove-home-banner-content.mjs'

function makeCommunities(count = 4) {
  const statuses = ['active', 'pending', 'rejected', 'disabled']
  return Array.from({ length: count }, (_, index) => ({
    _id: `community-${String(index + 1).padStart(3, '0')}`,
    status: statuses[index % statuses.length],
    homeBanners: index < 2
      ? [{ bannerId: `banner-${index + 1}`, postId: `post-${index + 1}`, title: `banner title ${index + 1}` }]
      : [],
  }))
}

function makeInvoke(communities, overrides = {}) {
  const calls = []
  const posts = new Map(communities.flatMap((community) =>
    (community.homeBanners || []).map((banner) => [banner.postId, {
      _id: banner.postId,
      communityId: community._id,
      status: 'active',
    }]),
  ))
  const invoke = async (action, params) => {
    calls.push({ action, params })
    if (overrides[action]) return overrides[action](params, { calls, posts })
    if (action === 'community.listAllPageAdmin') {
      const start = params.afterId
        ? communities.findIndex((community) => community._id === params.afterId) + 1
        : 0
      const items = communities.slice(start, start + params.limit)
      return {
        items,
        hasMore: start + items.length < communities.length,
        nextAfterId: start + items.length < communities.length ? items.at(-1)._id : null,
      }
    }
    if (action === 'post.getAdmin') return { post: posts.get(params.postId) }
    if (action === 'post.deleteAdmin') {
      posts.get(params.postId).status = 'deleted'
      return { success: true }
    }
    if (action === 'community.updateHomeBanners') return { success: true }
    throw new Error(`unexpected action ${action}`)
  }
  return { invoke, calls, posts }
}

test('cleanup argument parser defaults to dry-run and requires all three apply confirmations', () => {
  assert.deepEqual(parseHomeBannerCleanupArgs([]), {
    apply: false,
    allCommunities: false,
    confirmSoftDeleteBannerPosts: false,
    help: false,
  })
  assert.throws(
    () => parseHomeBannerCleanupArgs(['--apply', '--all-communities']),
    /--confirm-soft-delete-banner-posts/,
  )
  assert.deepEqual(
    parseHomeBannerCleanupArgs(['--all-communities', '--apply', '--confirm-soft-delete-banner-posts']),
    { apply: true, allCommunities: true, confirmSoftDeleteBannerPosts: true, help: false },
  )
})

test('dry-run freezes more than 100 communities across all statuses and performs zero writes', async () => {
  const communities = makeCommunities(125)
  const { invoke, calls } = makeInvoke(communities)

  const report = await runHomeBannerCleanup({ apply: false }, invoke)

  assert.equal(report.communityCount, 125)
  assert.equal(report.bannerCount, 2)
  assert.equal(report.uniquePostCount, 2)
  assert.deepEqual(new Set(report.communityStatuses), new Set(['active', 'pending', 'rejected', 'disabled']))
  assert.equal(calls.filter((call) => call.action === 'community.listAllPageAdmin').length, 2)
  assert.equal(calls.some((call) => call.action === 'post.deleteAdmin'), false)
  assert.equal(calls.some((call) => call.action === 'community.updateHomeBanners'), false)
})

test('apply soft-deletes deduplicated banner posts then clears banners without touching notices', async () => {
  const communities = makeCommunities(4)
  communities[0].homeBanners.push({ bannerId: 'duplicate', postId: 'post-1' })
  const { invoke, calls, posts } = makeInvoke(communities)

  const report = await runHomeBannerCleanup({ apply: true }, invoke)

  assert.equal(report.failedCommunityCount, 0)
  assert.equal(report.deletedPostCount, 2)
  assert.equal(report.clearedCommunityCount, 2)
  assert.equal(posts.get('post-1').status, 'deleted')
  assert.equal(calls.filter((call) => call.action === 'post.deleteAdmin' && call.params.postId === 'post-1').length, 1)
  assert.deepEqual(
    calls.filter((call) => call.action === 'community.updateHomeBanners').map((call) => call.params),
    [
      {
        communityId: 'community-001',
        banners: [],
        expectedBanners: communities[0].homeBanners,
      },
      {
        communityId: 'community-002',
        banners: [],
        expectedBanners: communities[1].homeBanners,
      },
    ],
  )
  assert.equal(calls.some((call) => call.action.startsWith('section.')), false)
})

test('apply leaves a community banner intact after a post failure and reruns idempotently', async () => {
  const communities = makeCommunities(2)
  let failPostTwo = true
  const fixture = makeInvoke(communities, {
    'post.deleteAdmin': async ({ postId }, { posts }) => {
      if (postId === 'post-2' && failPostTwo) throw new Error('transient delete failure')
      posts.get(postId).status = 'deleted'
      return { success: true }
    },
  })

  const first = await runHomeBannerCleanup({ apply: true }, fixture.invoke)
  assert.equal(first.failedCommunityCount, 1)
  assert.deepEqual(
    fixture.calls.filter((call) => call.action === 'community.updateHomeBanners').map((call) => call.params.communityId),
    ['community-001'],
  )

  failPostTwo = false
  fixture.calls.length = 0
  const second = await runHomeBannerCleanup({ apply: true }, fixture.invoke)
  assert.equal(second.failedCommunityCount, 0)
  assert.equal(second.alreadyDeletedPostCount, 1)
  assert.equal(fixture.calls.filter((call) => call.action === 'post.deleteAdmin').length, 2)
  assert.deepEqual(
    fixture.calls.filter((call) => call.action === 'community.updateHomeBanners').map((call) => call.params.communityId),
    ['community-001', 'community-002'],
  )
})
