// Scenario 4: permission boundaries — only author/member can do their thing.

import { callAs, createAsserter, makeRunId, seedApprovedCommunity } from './_shared.mjs'

const { expectReject, finish } = createAsserter('permission')
const runId = makeRunId()
const { communityId, sectionId, widgetId } = await seedApprovedCommunity(runId)
const author = `scene-perm-auth-${runId}`
const intruder = `scene-perm-intr-${runId}`

console.log(`Scenario: permission boundaries`)

await callAs(author, 'user', 'login', { nickName: 'Author', avatarUrl: '' })
await callAs(intruder, 'user', 'login', { nickName: 'Intruder', avatarUrl: '' })
await callAs(author, 'member', 'apply', { communityId })

const { postId } = await callAs(author, 'post', 'create', {
  communityId, sectionId, content: { [widgetId]: 'private post' },
})

await expectReject(
  () => callAs(intruder, 'post', 'create', {
    communityId, sectionId, content: { [widgetId]: 'sneaky' },
  }),
  'non-member cannot create post',
)

await expectReject(
  () => callAs(intruder, 'post', 'delete', { postId }),
  'non-author cannot delete post',
)

await expectReject(
  () => callAs(intruder, 'post', 'update', { postId, content: { [widgetId]: 'hacked' } }),
  'non-author cannot update post',
)

await expectReject(
  () => callAs(intruder, 'member', 'memberApprove', { communityId, memberId: 'x' }),
  'non-admin cannot approve members',
)

await finish()
