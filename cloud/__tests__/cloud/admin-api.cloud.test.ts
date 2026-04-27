// L3 云端验收测试：通过 HTTP 调用真实 admin 云函数
//
// 运行前需设置环境变量：CLOUD_API_URL + 以下任一组凭证
//   - TEST_ADMIN_USERNAME + TEST_ADMIN_PASSWORD（推荐，会自动 auth.login）
//   - TEST_ADMIN_SESSION_TOKEN（已有 session token 时直接用）
//   - ADMIN_TOKEN（仅当云函数 env ADMIN_LEGACY_TOKEN_FALLBACK=1 时可用）
//
// 用法：
//   CLOUD_API_URL=https://xxx.app.tcloudbase.com \
//   TEST_ADMIN_USERNAME=xxx TEST_ADMIN_PASSWORD=yyy npm run test:cloud

import { isCloudAvailable, callAdmin, rawFetch, testId, cleanupSection } from './helpers'

const describeCloud = isCloudAvailable ? describe : describe.skip

describeCloud('L3 云端验收：Admin HTTP API', () => {
  // ---- 鉴权 ----
  // 2026-04-23：admin 改为 session 鉴权后，401=未认证/session 无效，403=已认证但无权
  test('无 token 调用返回 401', async () => {
    const res = await rawFetch('community.list')
    expect(res.status).toBe(401)
  })

  test('错误 token 返回 401', async () => {
    const res = await rawFetch('community.list', {}, 'wrong-token')
    expect(res.status).toBe(401)
  })

  // ---- 社区管理 ----
  test('community.list 返回社区列表', async () => {
    const result = await callAdmin('community.list')
    expect(result).toHaveProperty('communities')
    expect(Array.isArray(result.communities)).toBe(true)
  })

  // ---- 板块管理 ----
  let testSectionId = ''
  const testCommunityId = process.env.TEST_COMMUNITY_ID || ''

  // 仅在配置了 TEST_COMMUNITY_ID 时执行板块 CRUD
  const describeSections = testCommunityId ? describe : describe.skip

  describeSections('板块 CRUD（需要 TEST_COMMUNITY_ID）', () => {
    test('section.create 创建板块', async () => {
      const result = await callAdmin('section.create', {
        communityId: testCommunityId,
        name: `测试板块-${testId()}`,
        icon: 'test',
        order: 99,
      })
      expect(result.sectionId).toBeTruthy()
      testSectionId = result.sectionId
    })

    test('section.get 获取板块详情', async () => {
      if (!testSectionId) return
      const result = await callAdmin('section.get', { sectionId: testSectionId })
      expect(result.section).toBeTruthy()
      expect(result.section.communityId).toBe(testCommunityId)
    })

    test('section.list 查询板块列表', async () => {
      const result = await callAdmin('section.list', { communityId: testCommunityId })
      expect(Array.isArray(result.sections)).toBe(true)
    })

    test('section.updateWidgets 更新控件', async () => {
      if (!testSectionId) return
      const result = await callAdmin('section.updateWidgets', {
        sectionId: testSectionId,
        widgets: [{
          type: 'short_text',
          label: '标题',
          fieldKey: 'title',
          required: true,
          order: 0,
          showInList: true,
        }],
      })
      expect(result.widgets).toHaveLength(1)
      expect(result.widgets[0].widgetId).toBeTruthy()
    })

    test('section.delete 删除测试板块', async () => {
      if (!testSectionId) return
      const result = await callAdmin('section.delete', { sectionId: testSectionId })
      expect(result.success).toBe(true)
    })
  })

  // ---- 成员审批 ----
  const describeMembers = testCommunityId ? describe : describe.skip

  describeMembers('成员审批（需要 TEST_COMMUNITY_ID）', () => {
    test('member.pendingList 查询待审批', async () => {
      const result = await callAdmin('member.pendingList', { communityId: testCommunityId })
      expect(result).toHaveProperty('members')
      expect(Array.isArray(result.members)).toBe(true)
    })
  })

  // ---- 未知 action ----
  test('未知 action 返回 500', async () => {
    await expect(callAdmin('nonexistent.action')).rejects.toThrow(/Unknown action|500/)
  })
})
