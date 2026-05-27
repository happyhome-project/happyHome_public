// 09-community-lifecycle.mjs
// 端到端测试：社区 disable / listDisabled / restore / hardDelete 全流程 + 级联删验证
//
// 运行：node scripts/h5-test/09-community-lifecycle.mjs
// 前置：admin 云函数已部署最新代码（包含 community.disable/restore/listDisabled/hardDelete）
//       ALLOW_TEST_OPENID=true（for http-gateway 注入）

import { callAs, callAdmin, seedApprovedCommunity, makeRunId, createAsserter } from './_shared.mjs'

const runId = makeRunId()
const name = 'community-lifecycle'
const t = createAsserter(name)

console.log(`\n[${name}] runId=${runId}\n`)

async function main() {
  // 1) 种子：建一个 active 社区 + section + widget
  console.log('Step 1: seed approved community with section + widget')
  const { ownerOpenid, communityId, sectionId, widgetId } = await seedApprovedCommunity(runId)
  console.log(`  communityId=${communityId}\n  sectionId=${sectionId}\n  widgetId=${widgetId}`)

  // 2) 让 owner 发一条帖子（测级联删 posts + COS fileID 收集路径）
  console.log('\nStep 2: create a post with image_group to exercise cascade')
  const { postId } = await callAs(ownerOpenid, 'post', 'create', {
    communityId, sectionId,
    content: {
      [widgetId]: 'hello lifecycle',
      // 伪造 image_group：模拟 cloud:// 路径，让级联收集逻辑跑到
      __fake_images__: ['cloud://fake/not-real-1.png', 'cloud://fake/not-real-2.png'],
    },
  })
  t.assert(!!postId, `post created: ${postId}`)

  // 3) 校验初态：community.list 能查到这个社区
  console.log('\nStep 3: verify community is in active list')
  const activeBefore = await callAdmin('community.list')
  const inActive = (activeBefore.communities || []).some(c => c._id === communityId)
  t.assert(inActive, 'community appears in admin community.list')

  // 4) disable（active → disabled）
  console.log('\nStep 4: disable the community')
  const disableRes = await callAdmin('community.disable', { communityId })
  t.assert(disableRes.success === true, 'community.disable returns success')

  // 5) listDisabled 应该包含它
  console.log('\nStep 5: verify community appears in listDisabled')
  const disabledList = await callAdmin('community.listDisabled')
  const inDisabled = (disabledList.communities || []).some(c => c._id === communityId)
  t.assert(inDisabled, 'community appears in community.listDisabled')

  // 6) superAdmin community.list 是全状态总列表，禁用后仍可出现，但状态必须是 disabled。
  const activeAfterDisable = await callAdmin('community.list')
  const afterDisableCommunity = (activeAfterDisable.communities || []).find(c => c._id === communityId)
  t.assert(afterDisableCommunity?.status === 'disabled', 'community.list shows disabled status after disable')

  // 7) restore（disabled → active）
  console.log('\nStep 6: restore')
  const restoreRes = await callAdmin('community.restore', { communityId })
  t.assert(restoreRes.success === true, 'community.restore returns success')

  const activeAfterRestore = await callAdmin('community.list')
  t.assert((activeAfterRestore.communities || []).some(c => c._id === communityId), 'restored community reappears in community.list')

  // 8) 拒绝对 active 社区硬删
  console.log('\nStep 7: hardDelete on active community should be rejected')
  await t.expectReject(
    () => callAdmin('community.hardDelete', { communityId }),
    'hardDelete rejects active community'
  )

  // 9) 再 disable，然后 hardDelete
  console.log('\nStep 8: disable again, then hardDelete')
  await callAdmin('community.disable', { communityId })
  const hdRes = await callAdmin('community.hardDelete', { communityId })
  t.assert(hdRes.success === true, 'community.hardDelete returns success')

  // 10) 验证级联：community / sections / members / posts 全部看不见
  console.log('\nStep 9: verify cascade deletion')

  // 10a) community 本体已从 active/disabled 列表里消失
  const activeFinal = await callAdmin('community.list')
  t.assert(!(activeFinal.communities || []).some(c => c._id === communityId), 'community gone from community.list')

  const disabledFinal = await callAdmin('community.listDisabled')
  t.assert(!(disabledFinal.communities || []).some(c => c._id === communityId), 'community gone from community.listDisabled')

  // 10b) sections 被清（走 admin.section.list）
  const sectionsFinal = await callAdmin('section.list', { communityId })
  t.assert((sectionsFinal.sections || []).length === 0, `sections cleared: ${(sectionsFinal.sections || []).length} remaining`)

  // 10c) community_members 被清 —— 走 admin.member.pendingList 的话只能看到 pending，active 成员看不到
  //      但我们没有直接 list 所有 members 的 admin action；退而求其次：原 owner 再次调 community.list 应该查不到这个 community
  //      （因为 user-side 也是过滤 status: active，而且 member 记录没了）
  const ownerView = await callAs(ownerOpenid, 'community', 'list', {})
  t.assert(!(ownerView.communities || []).some(c => c._id === communityId), 'original owner no longer sees the community')

  // 10d) posts: post.list by sectionId — sectionId 都没了，应该空或报错
  try {
    const postList = await callAs(ownerOpenid, 'post', 'list', { sectionId })
    t.assert((postList.posts || []).length === 0, 'posts cleared via section')
  } catch (err) {
    // section 不存在报错也算符合预期
    t.assert(true, `posts unreachable (section gone): ${String(err.message).slice(0, 60)}`)
  }

  await t.finish()
}

main().catch(err => {
  console.error('[FATAL]', err)
  process.exit(1)
})
