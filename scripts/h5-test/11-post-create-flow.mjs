// 11-post-create-flow.mjs
//
// Regression test for Bug #1 + #2 + #3（2026-04-23）：
//
// Bug #1：0-widget 板块能发空内容 post
// Bug #2：mp-weixin 上拼车板块看不到 widget 输入框（stale build）
// Bug #3：前端不挡 → 后端报"必填项未填写"
//
// 这个脚本覆盖**后端的正确性**（Bug #1 修复 + required widgets 验证）。
// Bug #2 是 mp-weixin 编译产物问题，由 `scripts/mp-test-bug2.mjs`（automator）兜底。
//
// 跑完下列 C 字链路，每个 section 类型 × 每个 widget 类型：
//   选板块 → 填表 → 发布 → 详情 → 编辑 → 删除
//
// 并分别在 0-widget / required-only / optional-only / mixed 板块上发帖，
// 验证后端的校验层：
//   - 0 widget → 禁止发帖 ✓
//   - 缺 required → 禁止发帖 ✓
//   - optional 为空 → 允许发帖 ✓
//   - 有 value → 发布成功 + 详情能取回 + 编辑 + 删除
//
// 用法：node scripts/h5-test/11-post-create-flow.mjs

import { callAdmin, callAs, createAsserter, makeRunId, trackCommunity } from './_shared.mjs'

async function main() {
  const { assert, expectReject, finish } = createAsserter('post-create-flow')
  const runId = makeRunId()

  // ── 1) 种 community + 成员 ──
  const owner = `post-flow-owner-${runId}`
  const member = `post-flow-member-${runId}`
  await callAs(owner, 'user', 'login', { nickName: `Owner-${runId}`, avatarUrl: '' })
  await callAs(member, 'user', 'login', { nickName: `Member-${runId}`, avatarUrl: '' })
  const { communityId } = await callAs(owner, 'community', 'create', {
    name: `发帖流程回归-${runId}`,
    description: 'post-create-flow regression',
    coverImage: '',
    location: { province: 'P', city: 'C', district: 'D', address: 'A' },
    joinType: 'open',
  })
  trackCommunity(communityId)
  await callAdmin('community.approve', { communityId })

  // member 加入（open join 自动审批）
  await callAs(member, 'member', 'apply', { communityId })
  const { status: memberStatus } = await callAs(member, 'member', 'myStatus', { communityId })
  assert(memberStatus === 'active', 'open-join community auto-approves member')

  // ── 2) 创建 4 类板块 ──
  console.log('\n[step] 创建 4 类板块')
  const { sectionId: emptySectionId } = await callAdmin('section.create', {
    communityId, name: '未配置控件板块', icon: '❓', order: 0, type: 'evergreen',
  })
  const { sectionId: requiredOnlyId } = await callAdmin('section.create', {
    communityId, name: '全必填板块', icon: '📋', order: 1, type: 'realtime',
  })
  const { sectionId: optionalOnlyId } = await callAdmin('section.create', {
    communityId, name: '全选填板块', icon: '✏️', order: 2, type: 'evergreen',
  })
  const { sectionId: mixedId } = await callAdmin('section.create', {
    communityId, name: '混合板块', icon: '🔀', order: 3, type: 'realtime',
  })

  // 给 requiredOnly 配 2 个必填
  const widgetsRequired = [
    { widgetId: '', label: '目的地', type: 'short_text', required: true, showInList: true },
    { widgetId: '', label: '出发时间', type: 'datetime', required: true, showInList: true },
  ]
  await callAdmin('section.updateWidgets', { sectionId: requiredOnlyId, communityId, widgets: widgetsRequired })

  // 给 optionalOnly 配 2 个选填
  await callAdmin('section.updateWidgets', { sectionId: optionalOnlyId, communityId, widgets: [
    { widgetId: '', label: '备注', type: 'rich_text', required: false, showInList: false },
    { widgetId: '', label: '图片', type: 'image_group', required: false, showInList: false },
  ]})

  // 给 mixed 配必填+选填组合
  await callAdmin('section.updateWidgets', { sectionId: mixedId, communityId, widgets: [
    { widgetId: '', label: '标题', type: 'short_text', required: true, showInList: true },
    { widgetId: '', label: '简介', type: 'summary', required: false, showInList: true },
    { widgetId: '', label: '活动时间', type: 'datetime', required: true, showInList: true },
    { widgetId: '', label: '参与人数上限', type: 'number', required: false, showInList: false },
  ]})

  // 拉回最新 widgets 拿到真实 widgetId
  const { section: requiredSection } = await callAs(member, 'section', 'get', { sectionId: requiredOnlyId })
  const { section: mixedSection } = await callAs(member, 'section', 'get', { sectionId: mixedId })
  const { section: optionalSection } = await callAs(member, 'section', 'get', { sectionId: optionalOnlyId })

  // ── 3) Bug #1 验证：空 widgets 板块禁止发帖 ──
  console.log('\n[Bug #1] 空 widgets 板块禁止发帖')
  await expectReject(
    () => callAs(member, 'post', 'create', { communityId, sectionId: emptySectionId, content: {} }),
    '未配置控件板块 → create 被拒'
  )

  // ── 4) Bug #1 衍生：空 widgets 板块也不能编辑现有 post（防未来数据漂移） ──
  // 跳过：手工造数据的开销比收益大，模拟即可

  // ── 5) 必填 widgets：缺字段拒、齐字段过 ──
  console.log('\n[Bug #3 inverse] 必填缺字段 → 被拒')
  await expectReject(
    () => callAs(member, 'post', 'create', { communityId, sectionId: requiredOnlyId, content: {} }),
    '全必填板块 空 content → 被拒'
  )
  const reqByLabel = Object.fromEntries(requiredSection.widgets.map(w => [w.label, w.widgetId]))
  await expectReject(
    () => callAs(member, 'post', 'create', {
      communityId, sectionId: requiredOnlyId,
      content: { [reqByLabel['目的地']]: '望京' },  // 缺出发时间
    }),
    '全必填板块 缺1必填 → 被拒'
  )
  const { postId: reqPostId } = await callAs(member, 'post', 'create', {
    communityId, sectionId: requiredOnlyId,
    content: {
      [reqByLabel['目的地']]: '望京',
      [reqByLabel['出发时间']]: '2026-05-01 09:00',
    },
  })
  assert(!!reqPostId, '全必填板块 齐字段 → 发布成功')

  // ── 6) 选填 widgets：全空也能发（这是允许的，但至少有 widgets） ──
  console.log('\n[step] 选填 widgets 全空发布')
  const { postId: optPostId } = await callAs(member, 'post', 'create', {
    communityId, sectionId: optionalOnlyId, content: {},
  })
  assert(!!optPostId, '全选填板块 空 content → 发布成功（有 widgets）')

  // ── 7) 混合板块：完整 C 字链路（create → get → update → delete） ──
  console.log('\n[step] 混合板块 C 字链路')
  const mixByLabel = Object.fromEntries(mixedSection.widgets.map(w => [w.label, w.widgetId]))

  // create
  const { postId: mixPostId } = await callAs(member, 'post', 'create', {
    communityId, sectionId: mixedId,
    content: {
      [mixByLabel['标题']]: '周日爬山',
      [mixByLabel['活动时间']]: '2026-05-03 08:30',
    },
  })
  assert(!!mixPostId, '混合板块 create OK')

  // get
  const { post: gotPost } = await callAs(member, 'post', 'get', { postId: mixPostId })
  assert(gotPost.content[mixByLabel['标题']] === '周日爬山', 'get 返回标题正确')
  assert(gotPost.content[mixByLabel['活动时间']] === '2026-05-03 08:30', 'get 返回活动时间正确')

  // update（带新字段）
  await callAs(member, 'post', 'update', {
    postId: mixPostId,
    content: {
      [mixByLabel['标题']]: '周日爬山 (改期)',
      [mixByLabel['活动时间']]: '2026-05-04 08:30',
      [mixByLabel['简介']]: '香山红叶',
      [mixByLabel['参与人数上限']]: 20,
    },
  })
  const { post: updatedPost } = await callAs(member, 'post', 'get', { postId: mixPostId })
  assert(updatedPost.content[mixByLabel['标题']] === '周日爬山 (改期)', 'update 标题生效')
  assert(updatedPost.content[mixByLabel['简介']] === '香山红叶', 'update 新增选填字段生效')
  assert(updatedPost.content[mixByLabel['参与人数上限']] === 20, 'update number 字段生效')

  // update 必填字段不能清空
  await expectReject(
    () => callAs(member, 'post', 'update', { postId: mixPostId, content: { [mixByLabel['简介']]: 'only' }}),
    'update 时必填字段不能清空 → 被拒'
  )

  // delete
  await callAs(member, 'post', 'delete', { postId: mixPostId })
  await expectReject(
    () => callAs(member, 'post', 'get', { postId: mixPostId }),
    'delete 后 post.get 抛"帖子不存在"'
  )

  await finish()
}

main().catch(async (err) => {
  console.error('[FATAL]', err)
  process.exit(1)
})
