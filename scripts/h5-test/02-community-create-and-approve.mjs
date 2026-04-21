// Scenario 2: community creation + admin approval lifecycle.

import { callAs, callAdmin, createAsserter, makeRunId, trackCommunity } from './_shared.mjs'

const { assert, finish } = createAsserter('community-create')
const runId = makeRunId()
const owner = `scene-comm-${runId}`

console.log(`Scenario: community create+approve (owner=${owner})`)

await callAs(owner, 'user', 'login', { nickName: 'CommOwner', avatarUrl: '' })

const { communityId } = await callAs(owner, 'community', 'create', {
  name: `CommTest-${runId}`,
  description: '',
  coverImage: '',
  location: { province: 'P', city: 'C', district: 'D', address: 'A' },
  joinType: 'approval',
})
assert(!!communityId, `community created: ${communityId}`)
trackCommunity(communityId)

// Fresh community is pending — not visible in default public list
const publicList = await callAs(owner, 'community', 'list', {})
assert(
  !publicList.communities.some((c) => c._id === communityId),
  'pending community is NOT in public list',
)

// ...but visible in includeAll view
const allList = await callAs(owner, 'community', 'list', { includeAll: true })
const found = allList.communities.find((c) => c._id === communityId)
assert(!!found, 'pending community IS in includeAll list')
assert(found?.status === 'pending', 'status is pending before approval')
assert(found?.creatorId === owner, 'creatorId is the owner')

await callAdmin('community.approve', { communityId })
const afterApprove = await callAs(owner, 'community', 'list', {})
assert(
  afterApprove.communities.some((c) => c._id === communityId),
  'approved community is in public list',
)

await finish()
