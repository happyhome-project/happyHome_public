// L2 本地集成测试：完整业务链路
// db 通过 jest.integration.config.js moduleNameMapper 映射到 db.local（内存）
// wx-server-sdk 在此文件 mock（Jest 自动 hoist 到最顶部）

import { _getOpenId, setCurrentUser, resetCurrentUser } from './setup'

let uuidCounter = 0
jest.mock('uuid', () => ({
  v4: () => `uuid-${++uuidCounter}`,
}))

jest.mock('wx-server-sdk', () => ({
  __esModule: true,
  default: {
    init: jest.fn(),
    getWXContext: jest.fn(() => ({ OPENID: _getOpenId() })),
    DYNAMIC_CURRENT_ENV: 'local-test',
    database: jest.fn(), // 不应被调用（db 已映射到 db.local）
  },
  init: jest.fn(),
  getWXContext: jest.fn(() => ({ OPENID: _getOpenId() })),
  DYNAMIC_CURRENT_ENV: 'local-test',
}))

import { _resetAll, _dump } from '../../lib/db.local'

// 导入各云函数 handler
import { handleLogin } from '../../functions/user/index'
import {
  handleCreate as createCommunity,
  handleApprove as approveCommunity,
  handleList as listCommunities,
  handleGet as getCommunity,
} from '../../functions/community/index'
import {
  handleApply,
  handleLeave,
  handleMemberApprove,
  handlePendingList,
} from '../../functions/member/index'
import {
  handleCreate as createSection,
  handleUpdateWidgets,
  handleList as listSections,
} from '../../functions/section/index'
import {
  handleCreate as createPost,
  handleList as listPosts,
  handleGet as getPost,
  handleUpdate as updatePost,
  handleDelete as deletePost,
} from '../../functions/post/index'

beforeEach(() => {
  _resetAll()
  resetCurrentUser()
})

// ============================================================
// 完整链路：注册 → 建社区 → 审批 → 加入 → 建板块 → 发帖 → 改帖 → 删帖
// ============================================================
describe('核心业务全链路', () => {
  const SUPER_ADMIN = 'openid-superadmin'
  const COMMUNITY_CREATOR = 'openid-creator'
  const NORMAL_USER = 'openid-normal'

  async function setupSuperAdmin() {
    // 直接在 db 中创建 superAdmin 用户（模拟 admin 后台操作）
    const db = await import('../../lib/db')
    await db.create('users', {
      _id: SUPER_ADMIN,
      nickName: 'SuperAdmin',
      avatarUrl: '',
      role: 'superAdmin',
      createdAt: new Date().toISOString(),
    })
  }

  test('用户注册（新用户 + 老用户更新）', async () => {
    setCurrentUser('openid-test-user')

    // 新用户登录
    const result1 = await handleLogin({ nickName: '张三', avatarUrl: 'avatar1.jpg' }, _getOpenId())
    expect(result1.isNew).toBe(true)
    expect(result1.user.nickName).toBe('张三')

    // 老用户登录（更新信息）
    const result2 = await handleLogin({ nickName: '张三改名', avatarUrl: 'avatar2.jpg' }, _getOpenId())
    expect(result2.isNew).toBe(false)
    expect(result2.user.nickName).toBe('张三改名')
  })

  test('创建社区 → SuperAdmin 审批 → 社区上线', async () => {
    await setupSuperAdmin()
    setCurrentUser(COMMUNITY_CREATOR)

    // 创建社区（状态为 pending）
    const { communityId } = await createCommunity({
      name: '快乐小区',
      description: '一个快乐的小区',
      coverImage: 'cover.jpg',
      location: { address: '北京市朝阳区', lat: 39.9, lng: 116.4 },
      joinType: 'open',
    }, _getOpenId())
    expect(communityId).toBeTruthy()

    // 查询应有 pending 状态
    const { community } = await getCommunity({ communityId })
    expect(community.status).toBe('pending')

    // SuperAdmin 审批通过
    setCurrentUser(SUPER_ADMIN)
    await approveCommunity({ communityId }, _getOpenId())

    // 验证状态变为 active
    const { community: approved } = await getCommunity({ communityId })
    expect(approved.status).toBe('active')
  })

  test('完整链路：建社区 → 加入 → 建板块 → 发帖 → 改帖 → 删帖', async () => {
    await setupSuperAdmin()

    // 1. 创建者建社区
    setCurrentUser(COMMUNITY_CREATOR)
    const { communityId } = await createCommunity({
      name: '测试社区',
      description: '集成测试用',
      coverImage: 'cover.jpg',
      location: { address: '上海市浦东新区', lat: 31.2, lng: 121.5 },
      joinType: 'open',
    }, _getOpenId())

    // SuperAdmin 审批
    setCurrentUser(SUPER_ADMIN)
    await approveCommunity({ communityId }, _getOpenId())

    // 2. 普通用户加入（open 类型，直接加入）
    setCurrentUser(NORMAL_USER)
    const applyResult = await handleApply({ communityId }, _getOpenId())
    expect(applyResult.status).toBe('active')

    // 验证 memberCount 递增
    const { community } = await getCommunity({ communityId })
    expect(community.memberCount).toBe(1) // creator 的 memberCount 未加（创建时为0）

    // 3. 创建者（管理员）创建板块
    setCurrentUser(COMMUNITY_CREATOR)
    const { sectionId } = await createSection({
      communityId,
      name: '日常分享',
      icon: 'chat',
      order: 1,
    }, _getOpenId())
    expect(sectionId).toBeTruthy()

    // 4. 设置板块 widgets
    const { widgets } = await handleUpdateWidgets({
      communityId,
      sectionId,
      widgets: [
        {
          widgetId: '',
          type: 'short_text',
          label: '标题',
          fieldKey: 'title',
          required: true,
          order: 0,
          showInList: true,
        },
        {
          widgetId: '',
          type: 'rich_text',
          label: '内容',
          fieldKey: 'body',
          required: false,
          order: 1,
          showInList: false,
        },
      ],
    }, _getOpenId())
    expect(widgets[0].widgetId).toBeTruthy() // UUID 已自动分配
    expect(widgets[1].widgetId).toBeTruthy()
    const titleWidgetId = widgets[0].widgetId
    const bodyWidgetId = widgets[1].widgetId

    // 5. 普通用户发帖
    setCurrentUser(NORMAL_USER)
    const { postId } = await createPost({
      communityId,
      sectionId,
      content: { [titleWidgetId]: '我的第一篇帖子' },
    }, _getOpenId())
    expect(postId).toBeTruthy()

    // 6. 查帖
    const { post } = await getPost({ postId }) as { post: any }
    expect(post.content[titleWidgetId]).toBe('我的第一篇帖子')
    expect(post.authorId).toBe(NORMAL_USER)

    // 7. 改帖
    const updateResult = await updatePost({
      postId,
      content: {
        [titleWidgetId]: '修改后的标题',
        [bodyWidgetId]: '补充内容',
      },
    }, _getOpenId())
    expect(updateResult.success).toBe(true)

    const { post: updated } = await getPost({ postId }) as { post: any }
    expect(updated.content[titleWidgetId]).toBe('修改后的标题')

    // 8. 列表查询
    const { posts } = await listPosts({ sectionId })
    expect(posts).toHaveLength(1)

    // 9. 删帖
    await deletePost({ postId }, _getOpenId())
    await expect(getPost({ postId })).rejects.toThrow('帖子不存在')

    // 列表不再显示已删除帖子
    const { posts: afterDelete } = await listPosts({ sectionId })
    expect(afterDelete).toHaveLength(0)
  })

  test('需审批社区：申请 → 管理员审批 → 加入', async () => {
    await setupSuperAdmin()

    // 创建 approval 类型社区
    setCurrentUser(COMMUNITY_CREATOR)
    const { communityId } = await createCommunity({
      name: '审批社区',
      description: '需要审批才能加入',
      coverImage: 'cover.jpg',
      location: { address: '深圳市南山区', lat: 22.5, lng: 114.0 },
      joinType: 'approval',
    }, _getOpenId())

    setCurrentUser(SUPER_ADMIN)
    await approveCommunity({ communityId }, _getOpenId())

    // 普通用户申请加入（状态应为 pending）
    setCurrentUser(NORMAL_USER)
    const applyResult = await handleApply({ communityId }, _getOpenId())
    expect(applyResult.status).toBe('pending')

    // 管理员查看待审批列表
    setCurrentUser(COMMUNITY_CREATOR)
    const { members: pending } = await handlePendingList({ communityId }, _getOpenId())
    expect(pending).toHaveLength(1)
    const memberId = pending[0]._id

    // 管理员审批通过
    const approveResult = await handleMemberApprove({ communityId, memberId }, _getOpenId())
    expect(approveResult.success).toBe(true)
    expect(approveResult.changed).toBe(true)

    // 验证 memberCount
    const { community } = await getCommunity({ communityId })
    expect(community.memberCount).toBe(1)

    // 待审批列表应为空
    const { members: afterApprove } = await handlePendingList({ communityId }, _getOpenId())
    expect(afterApprove).toHaveLength(0)
  })

  test('权限校验：非成员不能发帖', async () => {
    await setupSuperAdmin()
    setCurrentUser(COMMUNITY_CREATOR)

    const { communityId } = await createCommunity({
      name: '权限测试',
      description: '',
      coverImage: '',
      location: { address: '', lat: 0, lng: 0 },
      joinType: 'open',
    }, _getOpenId())
    setCurrentUser(SUPER_ADMIN)
    await approveCommunity({ communityId }, _getOpenId())

    setCurrentUser(COMMUNITY_CREATOR)
    const { sectionId } = await createSection({
      communityId,
      name: '板块',
      icon: '',
      order: 0,
    }, _getOpenId())
    await handleUpdateWidgets({
      communityId,
      sectionId,
      widgets: [{
        widgetId: '', type: 'short_text', label: '标题',
        fieldKey: 'title', required: true, order: 0, showInList: true,
      }],
    }, _getOpenId())

    // 未加入社区的用户不能发帖
    setCurrentUser('openid-outsider')
    await expect(createPost({
      communityId,
      sectionId,
      content: { 'any-id': '标题' },
    }, _getOpenId())).rejects.toThrow('非社区成员')
  })

  test('权限校验：非管理员不能创建板块', async () => {
    await setupSuperAdmin()
    setCurrentUser(COMMUNITY_CREATOR)

    const { communityId } = await createCommunity({
      name: '权限测试2',
      description: '',
      coverImage: '',
      location: { address: '', lat: 0, lng: 0 },
      joinType: 'open',
    }, _getOpenId())
    setCurrentUser(SUPER_ADMIN)
    await approveCommunity({ communityId }, _getOpenId())

    // 普通用户加入
    setCurrentUser(NORMAL_USER)
    await handleApply({ communityId }, _getOpenId())

    // 普通成员尝试创建板块 → 权限不足
    await expect(createSection({
      communityId,
      name: '非法板块',
      icon: '',
      order: 0,
    }, _getOpenId())).rejects.toThrow('权限不足')
  })

  test('退出社区 → memberCount 递减', async () => {
    await setupSuperAdmin()
    setCurrentUser(COMMUNITY_CREATOR)

    const { communityId } = await createCommunity({
      name: '退出测试',
      description: '',
      coverImage: '',
      location: { address: '', lat: 0, lng: 0 },
      joinType: 'open',
    }, _getOpenId())
    setCurrentUser(SUPER_ADMIN)
    await approveCommunity({ communityId }, _getOpenId())

    setCurrentUser(NORMAL_USER)
    await handleApply({ communityId }, _getOpenId())

    const { community: before } = await getCommunity({ communityId })
    expect(before.memberCount).toBe(1)

    await handleLeave({ communityId }, _getOpenId())

    const { community: after } = await getCommunity({ communityId })
    expect(after.memberCount).toBe(0)
  })

  test('帖子 required 字段校验', async () => {
    await setupSuperAdmin()
    setCurrentUser(COMMUNITY_CREATOR)

    const { communityId } = await createCommunity({
      name: '校验测试',
      description: '',
      coverImage: '',
      location: { address: '', lat: 0, lng: 0 },
      joinType: 'open',
    }, _getOpenId())
    setCurrentUser(SUPER_ADMIN)
    await approveCommunity({ communityId }, _getOpenId())

    setCurrentUser(COMMUNITY_CREATOR)
    const { sectionId } = await createSection({
      communityId,
      name: '带必填项的板块',
      icon: '',
      order: 0,
    }, _getOpenId())
    const { widgets } = await handleUpdateWidgets({
      communityId,
      sectionId,
      widgets: [{
        widgetId: '', type: 'short_text', label: '必填标题',
        fieldKey: 'title', required: true, order: 0, showInList: true,
      }],
    }, _getOpenId())
    const widgetId = widgets[0].widgetId

    // 空内容 → 报错
    await expect(createPost({
      communityId,
      sectionId,
      content: {},
    }, _getOpenId())).rejects.toThrow('必填项未填写：必填标题')

    // 空字符串 → 报错
    await expect(createPost({
      communityId,
      sectionId,
      content: { [widgetId]: '' },
    }, _getOpenId())).rejects.toThrow('必填项未填写：必填标题')

    // 正常内容 → 成功
    const { postId } = await createPost({
      communityId,
      sectionId,
      content: { [widgetId]: '有效标题' },
    }, _getOpenId())
    expect(postId).toBeTruthy()
  })

  test('他人不能删除/修改别人的帖子', async () => {
    await setupSuperAdmin()
    setCurrentUser(COMMUNITY_CREATOR)

    const { communityId } = await createCommunity({
      name: '权限测试3',
      description: '',
      coverImage: '',
      location: { address: '', lat: 0, lng: 0 },
      joinType: 'open',
    }, _getOpenId())
    setCurrentUser(SUPER_ADMIN)
    await approveCommunity({ communityId }, _getOpenId())

    // 创建板块
    setCurrentUser(COMMUNITY_CREATOR)
    const { sectionId } = await createSection({
      communityId, name: '板块', icon: '', order: 0,
    }, _getOpenId())
    const { widgets } = await handleUpdateWidgets({
      communityId, sectionId,
      widgets: [{ widgetId: '', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true }],
    }, _getOpenId())
    const wid = widgets[0].widgetId

    // 用户A发帖
    setCurrentUser(NORMAL_USER)
    await handleApply({ communityId }, _getOpenId())
    const { postId } = await createPost({
      communityId, sectionId, content: { [wid]: '用户A的帖子' },
    }, _getOpenId())

    // 用户B（也加入了社区）尝试删除/修改
    const USER_B = 'openid-user-b'
    setCurrentUser(USER_B)
    await handleApply({ communityId }, _getOpenId())

    await expect(deletePost({ postId }, _getOpenId())).rejects.toThrow('无权删除')
    await expect(updatePost({ postId, content: { [wid]: '篡改' } }, _getOpenId())).rejects.toThrow('无权修改')
  })
})
