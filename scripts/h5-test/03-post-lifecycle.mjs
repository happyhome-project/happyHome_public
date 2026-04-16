// Scenario 3: create post, list, soft-delete, verify.

import { callAs, createAsserter, makeRunId, seedApprovedCommunity } from './_shared.mjs'

const { assert, expectReject, finish } = createAsserter('post-lifecycle')
const runId = makeRunId()
const { communityId, sectionId, widgetId } = await seedApprovedCommunity(runId)
const author = `scene-post-${runId}`

console.log(`Scenario: post lifecycle (author=${author}, community=${communityId})`)

await callAs(author, 'user', 'login', { nickName: 'PostAuthor', avatarUrl: '' })
await callAs(author, 'member', 'apply', { communityId })

const { postId } = await callAs(author, 'post', 'create', {
  communityId, sectionId,
  content: { [widgetId]: 'scenario post body' },
})
assert(!!postId, `post created: ${postId}`)

const list = await callAs(author, 'post', 'list', { sectionId })
assert(list.posts.some((p) => p._id === postId), 'post appears in list')

const got = await callAs(author, 'post', 'get', { postId })
assert(got.post._id === postId, 'post.get returns the post')
assert(got.post.content[widgetId] === 'scenario post body', 'content preserved')

// Update
const updateRes = await callAs(author, 'post', 'update', {
  postId,
  content: { [widgetId]: 'updated body' },
})
assert(!!updateRes.updatedAt, 'post.update returns new updatedAt')

const afterUpdate = await callAs(author, 'post', 'get', { postId })
assert(afterUpdate.post.content[widgetId] === 'updated body', 'content updated')

// Soft-delete
await callAs(author, 'post', 'delete', { postId })
const listAfter = await callAs(author, 'post', 'list', { sectionId })
assert(!listAfter.posts.some((p) => p._id === postId), 'post removed from active list')
await expectReject(
  () => callAs(author, 'post', 'get', { postId }),
  'post.get on soft-deleted throws',
)

finish()
