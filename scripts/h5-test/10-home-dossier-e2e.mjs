// 端到端验证：Classical Dossier 首页数据流
// 覆盖 Task B（schema + 云函数）和 Task C（admin 三态切换、motto 编辑）
//
// 用法：node scripts/h5-test/10-home-dossier-e2e.mjs

import { callAdmin, callAs, createAsserter, makeRunId } from './_shared.mjs'

async function main() {
  const { assert, expectReject, finish } = createAsserter('dossier-home-e2e')
  const runId = makeRunId()

  // ── 1) 种一个已审批社区 ──
  const owner = `dossier-owner-${runId}`
  await callAs(owner, 'user', 'login', { nickName: `Owner-${runId}`, avatarUrl: '' })
  const { communityId } = await callAs(owner, 'community', 'create', {
    name: `卷宗测试社区-${runId}`,
    description: 'dossier e2e',
    coverImage: '',
    location: { province: 'P', city: 'C', district: 'D', address: 'A' },
    joinType: 'open',
  })
  await callAdmin('community.approve', { communityId })
  console.log(`[seed] communityId=${communityId}`)

  // ── 2) 设置社区格言 motto ──
  console.log('\n[step] community.updateMeta (motto)')
  await callAdmin('community.updateMeta', {
    communityId,
    motto: '远亲不如近邻，近邻不如对门。',
    mottoCite: '民谚',
  })
  const { communities } = await callAdmin('community.list')
  const target = communities.find(c => c._id === communityId)
  assert(!!target, 'community found in list')
  assert(target.motto === '远亲不如近邻，近邻不如对门。', 'motto persisted')
  assert(target.mottoCite === '民谚', 'mottoCite persisted')

  // ── 3) 创建 realtime 板块（默认 active） ──
  console.log('\n[step] section.create realtime')
  const { sectionId: realtimeId } = await callAdmin('section.create', {
    communityId, name: '本周拼车', icon: '🚗', order: 0, type: 'realtime',
  })
  // ── 4) 创建 evergreen 板块 ──
  console.log('[step] section.create evergreen')
  const { sectionId: evergreenId } = await callAdmin('section.create', {
    communityId, name: '好店推荐', icon: '⭐', order: 1, type: 'evergreen',
  })
  // ── 5) 创建老式板块（不传 type），验证默认值 ──
  console.log('[step] section.create legacy (no type)')
  const { sectionId: legacyId } = await callAdmin('section.create', {
    communityId, name: '老式板块', icon: '📋', order: 2,
  })

  // ── 6) list 检查 type/status 都正确 ──
  console.log('\n[step] section.list 校验 type/status')
  const list1 = await callAdmin('section.list', { communityId })
  const s1 = list1.sections.find(x => x._id === realtimeId)
  const s2 = list1.sections.find(x => x._id === evergreenId)
  const s3 = list1.sections.find(x => x._id === legacyId)
  assert(s1.type === 'realtime', 'realtime section 类型正确')
  assert(s1.status === 'active', 'realtime 默认 status=active')
  assert(s2.type === 'evergreen', 'evergreen section 类型正确')
  assert(s2.status === 'active', 'evergreen status=active')
  assert(s3.type === 'evergreen', '不传 type 时默认 evergreen')
  assert(s3.status === 'active', '不传时默认 status=active')

  // ── 7) 切换 realtime 到 dormant ──
  console.log('\n[step] section.updateStatus realtime -> dormant')
  await callAdmin('section.updateStatus', { sectionId: realtimeId, status: 'dormant' })
  const list2 = await callAdmin('section.list', { communityId })
  const s1_dormant = list2.sections.find(x => x._id === realtimeId)
  assert(s1_dormant.status === 'dormant', 'realtime 切换到 dormant 生效')

  // ── 8) 切换 realtime 到 archived ──
  console.log('[step] section.updateStatus realtime -> archived')
  await callAdmin('section.updateStatus', { sectionId: realtimeId, status: 'archived' })
  const list3 = await callAdmin('section.list', { communityId })
  const s1_archived = list3.sections.find(x => x._id === realtimeId)
  assert(s1_archived.status === 'archived', 'realtime 切换到 archived 生效')

  // ── 9) 切回 active ──
  console.log('[step] section.updateStatus realtime -> active')
  await callAdmin('section.updateStatus', { sectionId: realtimeId, status: 'active' })
  const list4 = await callAdmin('section.list', { communityId })
  assert(list4.sections.find(x => x._id === realtimeId).status === 'active', 'realtime 切回 active 生效')

  // ── 10) evergreen 不能切到 dormant（应报错） ──
  console.log('\n[step] section.updateStatus evergreen -> dormant 应被拒绝')
  await expectReject(
    () => callAdmin('section.updateStatus', { sectionId: evergreenId, status: 'dormant' }),
    'evergreen 不能切 dormant',
  )

  // ── 11) section.updateMeta 改 type: evergreen 自动强制 status=active ──
  console.log('\n[step] section.updateMeta type 从 realtime 变 evergreen 应重置 status')
  await callAdmin('section.updateStatus', { sectionId: realtimeId, status: 'dormant' })
  await callAdmin('section.updateMeta', { sectionId: realtimeId, type: 'evergreen' })
  const list5 = await callAdmin('section.list', { communityId })
  const changed = list5.sections.find(x => x._id === realtimeId)
  assert(changed.type === 'evergreen', 'type 改为 evergreen')
  assert(changed.status === 'active', 'evergreen 强制 status=active')

  // ── 12) section.updateMeta 改 accentColor ──
  console.log('\n[step] section.updateMeta accentColor')
  await callAdmin('section.updateMeta', { sectionId: evergreenId, accentColor: '#3A6A45' })
  const list6 = await callAdmin('section.list', { communityId })
  assert(
    list6.sections.find(x => x._id === evergreenId).accentColor === '#3A6A45',
    'accentColor 持久化',
  )

  // ── 13) 用户侧 section.list（走 gateway，非 admin）也应看到 type/status ──
  console.log('\n[step] 用户侧 section.list 看到 type/status')
  const userListRes = await callAs(owner, 'section', 'list', { communityId })
  const userSections = userListRes.sections
  const userRt = userSections.find(x => x._id === realtimeId)
  assert(userRt?.type === 'evergreen', '用户侧看到新 type')
  assert(userRt?.status === 'active', '用户侧看到新 status')

  // ── 14) 带 withPostCount 时返回 postCount ──
  console.log('\n[step] section.list withPostCount 返回聚合计数')
  const userListWithCount = await callAs(owner, 'section', 'list', { communityId, withPostCount: true })
  const counted = userListWithCount.sections.find(x => x._id === evergreenId)
  assert(typeof counted.postCount === 'number', 'postCount 是数字')
  assert(counted.postCount === 0, 'postCount 初始 0（无帖子）')

  finish()
}

main().catch(err => {
  console.error('\n❌ 测试失败:', err)
  process.exit(1)
})
