/**
 * Scenario 6: Cold-start user journey
 *
 * Simulates a BRAND NEW user opening the app for the first time:
 *   - No login, no join, no context
 *   - Tries to post → should be blocked
 *   - Then logs in → tries to post → still blocked (not a member)
 *   - Checks membership → confirms not a member
 *   - Joins the community → membership becomes active
 *   - Posts → succeeds
 *
 * This is the test that catches "frontend lets user reach the form without
 * checking membership" bugs.
 */

import { callAs, createAsserter, makeRunId, seedApprovedCommunity } from './_shared.mjs'

const { assert, expectReject, finish } = createAsserter('cold-start-journey')
const runId = makeRunId()
const { communityId, sectionId, widgetId } = await seedApprovedCommunity(runId)

// A brand new user who just installed the app
const newbie = `cold-start-${runId}`

console.log(`Scenario: cold-start user journey (user=${newbie}, community=${communityId})\n`)

// ---- Stage 1: Before login ----
console.log('Stage 1: Before login')
await expectReject(
  () => callAs('', 'post', 'create', {
    communityId, sectionId, content: { [widgetId]: 'ghost post' },
  }),
  'anonymous user cannot post (empty openid)',
)

// ---- Stage 2: After login, before joining ----
console.log('\nStage 2: After login, before joining')
await callAs(newbie, 'user', 'login', { nickName: 'Newbie', avatarUrl: '' })
assert(true, 'user registered successfully')

// Check membership — should be null
const statusBefore = await callAs(newbie, 'member', 'myStatus', { communityId })
assert(statusBefore.isMember === false, `not a member (isMember=${statusBefore.isMember})`)
assert(statusBefore.status === null, `no membership record (status=${statusBefore.status})`)

// Try to post — backend rejects
await expectReject(
  () => callAs(newbie, 'post', 'create', {
    communityId, sectionId, content: { [widgetId]: 'eager post' },
  }),
  'logged-in non-member cannot post',
)

// ---- Stage 3: Join community ----
console.log('\nStage 3: Join community')
const joinRes = await callAs(newbie, 'member', 'apply', { communityId })
assert(joinRes.status === 'active', `joined open community (status=${joinRes.status})`)

const statusAfter = await callAs(newbie, 'member', 'myStatus', { communityId })
assert(statusAfter.isMember === true, `now a member (isMember=${statusAfter.isMember})`)
assert(statusAfter.status === 'active', `membership is active`)

// ---- Stage 4: Now can post ----
console.log('\nStage 4: Member can post')
const postRes = await callAs(newbie, 'post', 'create', {
  communityId, sectionId, content: { [widgetId]: 'my first post!' },
})
assert(!!postRes.postId, `post created: ${postRes.postId}`)

// Verify it's in the list
const list = await callAs(newbie, 'post', 'list', { sectionId })
assert(list.posts.some(p => p._id === postRes.postId), 'post appears in list')

// ---- Stage 5: Duplicate join attempt ----
console.log('\nStage 5: Edge case — already-member tries to join again')
await expectReject(
  () => callAs(newbie, 'member', 'apply', { communityId }),
  'duplicate join correctly rejected',
)

finish()
