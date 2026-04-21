/**
 * Scenario 7: User journey for approval-based community
 *
 * Tests the flow where a community requires admin approval to join:
 *   - User tries to post → rejected (not a member)
 *   - User applies → status=pending
 *   - User tries to post while pending → rejected
 *   - Admin approves → status=active
 *   - User can now post
 */

import { callAs, callAdmin, createAsserter, makeRunId, trackCommunity } from './_shared.mjs'

const { assert, expectReject, finish } = createAsserter('approval-journey')
const runId = makeRunId()
const owner = `approval-owner-${runId}`
const applicant = `approval-applicant-${runId}`

console.log(`Scenario: approval community journey\n`)

// Setup: create an approval-based community
await callAs(owner, 'user', 'login', { nickName: 'Owner', avatarUrl: '' })
await callAs(applicant, 'user', 'login', { nickName: 'Applicant', avatarUrl: '' })

const { communityId } = await callAs(owner, 'community', 'create', {
  name: `审批社区-${runId}`,
  description: '',
  coverImage: '',
  location: { province: 'P', city: 'C', district: 'D', address: 'A' },
  joinType: 'approval',
})
trackCommunity(communityId)
await callAdmin('community.approve', { communityId })
const { sectionId } = await callAdmin('section.create', {
  communityId, name: '板块', icon: '📋', order: 0,
})
const { widgets } = await callAdmin('section.updateWidgets', {
  sectionId,
  widgets: [{ type: 'short_text', label: '内容', required: true, showInList: true, widgetId: '' }],
})
const widgetId = widgets[0].widgetId

// ---- Stage 1: Before applying ----
console.log('Stage 1: Before applying')
const s1 = await callAs(applicant, 'member', 'myStatus', { communityId })
assert(s1.isMember === false, 'not a member yet')

await expectReject(
  () => callAs(applicant, 'post', 'create', {
    communityId, sectionId, content: { [widgetId]: 'x' },
  }),
  'cannot post before applying',
)

// ---- Stage 2: Apply (goes to pending) ----
console.log('\nStage 2: Apply')
const applyRes = await callAs(applicant, 'member', 'apply', { communityId })
assert(applyRes.status === 'pending', `apply result: pending (got: ${applyRes.status})`)

const s2 = await callAs(applicant, 'member', 'myStatus', { communityId })
assert(s2.isMember === false, 'pending is not yet a member')
assert(s2.status === 'pending', 'status shows pending')

await expectReject(
  () => callAs(applicant, 'post', 'create', {
    communityId, sectionId, content: { [widgetId]: 'x' },
  }),
  'cannot post while pending',
)

// ---- Stage 3: Admin approves ----
console.log('\nStage 3: Admin approves')
// Get pending list to find memberId
const pending = await callAs(owner, 'member', 'pendingList', { communityId })
const memberId = pending.members.find(m => m.userId === applicant)?._id
assert(!!memberId, `found pending memberId: ${memberId}`)

await callAs(owner, 'member', 'memberApprove', { communityId, memberId })
const s3 = await callAs(applicant, 'member', 'myStatus', { communityId })
assert(s3.isMember === true, 'now a member after approval')

// ---- Stage 4: Can post ----
console.log('\nStage 4: Can post')
const postRes = await callAs(applicant, 'post', 'create', {
  communityId, sectionId, content: { [widgetId]: 'finally in!' },
})
assert(!!postRes.postId, `post created: ${postRes.postId}`)

await finish()
