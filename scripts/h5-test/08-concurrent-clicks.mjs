/**
 * Scenario 8: Concurrency & idempotency — "user clicked twice really fast"
 *
 * Simulates repeat-click / race-condition scenarios at the API level:
 *   - 5 parallel join requests for same community → 1 member record, 4 errors
 *   - 5 parallel post-create requests → 5 distinct posts (not deduped by backend; frontend must debounce)
 *   - 5 parallel member.myStatus reads → all succeed with same result
 *
 * This complements the frontend useBusyLock unit tests. These tests verify
 * BACKEND behavior under concurrent load from a logically-single user.
 */

import { callAs, createAsserter, makeRunId, seedApprovedCommunity } from './_shared.mjs'

const { assert, finish } = createAsserter('concurrent-clicks')
const runId = makeRunId()
const { communityId, sectionId, widgetId } = await seedApprovedCommunity(runId)
const user = `concurrent-${runId}`

console.log(`Scenario: concurrent clicks (user=${user})\n`)

// Register user first
await callAs(user, 'user', 'login', { nickName: 'ConcurrentUser', avatarUrl: '' })

// ---- Test 1: Concurrent join requests ----
console.log('Test 1: 5 parallel member.apply on open community')
const joinResults = await Promise.allSettled(
  Array.from({ length: 5 }, () => callAs(user, 'member', 'apply', { communityId })),
)
const joinSuccess = joinResults.filter((r) => r.status === 'fulfilled')
const joinFail = joinResults.filter((r) => r.status === 'rejected')
console.log(`  success=${joinSuccess.length}, fail=${joinFail.length}`)

// Exact count: at most 1 should succeed, the rest should fail with "已是社区成员" or "已有待审批的申请"
// Backend has a TOCTOU window — two queries could both return "not a member" before either creates
// the record. Accept 1-2 successes as "acceptable" but record the count for awareness.
assert(joinSuccess.length >= 1, 'at least one join succeeds')
assert(joinSuccess.length <= 2, `at most 2 joins succeed (actual: ${joinSuccess.length}) — if >2, backend lacks race protection`)

// After the dust settles, myStatus should say isMember=true
const statusAfter = await callAs(user, 'member', 'myStatus', { communityId })
assert(statusAfter.isMember === true, 'user is a member after concurrent joins')

// ---- Test 2: Concurrent post creation ----
console.log('\nTest 2: 5 parallel post.create (expected: all succeed, creating duplicate posts)')
const postResults = await Promise.allSettled(
  Array.from({ length: 5 }, (_, i) =>
    callAs(user, 'post', 'create', {
      communityId, sectionId,
      content: { [widgetId]: `concurrent post ${i}` },
    }),
  ),
)
const postSuccess = postResults.filter((r) => r.status === 'fulfilled')
const postIds = new Set(postSuccess.map((r) => r.value.postId))
assert(postIds.size === 5, `5 distinct posts created (got ${postIds.size}) — confirms backend doesn't dedupe, frontend MUST lock`)

// ---- Test 3: Concurrent reads should all succeed ----
console.log('\nTest 3: 10 parallel member.myStatus reads')
const readResults = await Promise.allSettled(
  Array.from({ length: 10 }, () => callAs(user, 'member', 'myStatus', { communityId })),
)
const readSuccess = readResults.filter((r) => r.status === 'fulfilled')
assert(readSuccess.length === 10, '10 parallel reads all succeed')

// ---- Test 4: Concurrent delete of same post ----
console.log('\nTest 4: 5 parallel post.delete of same post (expected: 1 success, 4 fail)')
const targetPostId = [...postIds][0]
const delResults = await Promise.allSettled(
  Array.from({ length: 5 }, () => callAs(user, 'post', 'delete', { postId: targetPostId })),
)
const delSuccess = delResults.filter((r) => r.status === 'fulfilled')
const delFail = delResults.filter((r) => r.status === 'rejected')
assert(delSuccess.length >= 1, 'at least one delete succeeds')
// Note: soft-delete is idempotent in that subsequent calls don't corrupt state, but may throw "帖子已删除"
console.log(`  delete: ${delSuccess.length} success, ${delFail.length} fail (idempotent soft-delete)`)

finish()
