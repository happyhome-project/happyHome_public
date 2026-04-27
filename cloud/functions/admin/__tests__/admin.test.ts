jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  DYNAMIC_CURRENT_ENV: 'test',
}))

jest.mock('../../../lib/db', () => ({
  getById: jest.fn(),
  create: jest.fn(),
  updateById: jest.fn(),
  updateWhere: jest.fn(),
  removeById: jest.fn(),
  softDelete: jest.fn(),
  query: jest.fn(),
  increment: jest.fn(),
}))

jest.mock('../../../lib/storage', () => ({
  deleteFile: jest.fn(),
}))

jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mocked-uuid'),
}))

import { main } from '../index'
import * as db from '../../../lib/db'

beforeEach(() => jest.clearAllMocks())

test('member.list: 会物理清理历史 left 记录并且不返回', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({ _id: 'community-1', creatorId: 'creator-1' })
    .mockResolvedValueOnce({ _id: 'u-active', nickName: 'Active User', avatarUrl: '' })
  ;(db.query as jest.Mock).mockResolvedValueOnce([
    { _id: 'member-left-1', communityId: 'community-1', userId: 'u-left', role: 'member', status: 'left' },
    { _id: 'member-active-1', communityId: 'community-1', userId: 'u-active', role: 'member', status: 'active' },
  ])
  ;(db.removeById as jest.Mock).mockResolvedValue({})

  const result: any = await main({ action: 'member.list', communityId: 'community-1', status: 'all' })

  expect(db.removeById).toHaveBeenCalledWith('community_members', 'member-left-1')
  expect(result.members).toHaveLength(1)
  expect(result.members[0]._id).toBe('member-active-1')
})

test('member.list: 昵称优先显示真实昵称，测试账号缺失昵称时显示测试账号名', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({ _id: 'community-1', creatorId: 'creator-1' })
    .mockResolvedValueOnce({ _id: 'u-real', nickName: '张三', avatarUrl: '' })
    .mockRejectedValueOnce(new Error('not found'))
  ;(db.query as jest.Mock).mockResolvedValueOnce([
    { _id: 'member-real-1', communityId: 'community-1', userId: 'u-real', role: 'member', status: 'active' },
    { _id: 'member-test-1', communityId: 'community-1', userId: 'h5-reject-candidate-001', role: 'member', status: 'rejected' },
  ])

  const result: any = await main({ action: 'member.list', communityId: 'community-1', status: 'all' })

  const real = result.members.find((m: any) => m._id === 'member-real-1')
  const test = result.members.find((m: any) => m._id === 'member-test-1')
  expect(real.nickName).toBe('张三')
  expect(test.nickName).toContain('测试账号(')
})

test('member.kick: rejected 记录可移除，且不递减 memberCount', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({ _id: 'community-1', creatorId: 'creator-1' })
    .mockResolvedValueOnce({
      _id: 'member-1',
      communityId: 'community-1',
      userId: 'h5-reject-candidate-001',
      role: 'member',
      status: 'rejected',
    })
  ;(db.removeById as jest.Mock).mockResolvedValue({})

  const result: any = await main({ action: 'member.kick', communityId: 'community-1', memberId: 'member-1' })

  expect(db.removeById).toHaveBeenCalledWith('community_members', 'member-1')
  expect(db.increment).not.toHaveBeenCalled()
  expect(result.success).toBe(true)
})

test('member.kick: active 成员移除后递减 memberCount', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({ _id: 'community-1', creatorId: 'creator-1' })
    .mockResolvedValueOnce({
      _id: 'member-2',
      communityId: 'community-1',
      userId: 'u-active',
      role: 'member',
      status: 'active',
    })
  ;(db.removeById as jest.Mock).mockResolvedValue({})
  ;(db.increment as jest.Mock).mockResolvedValue({})

  const result: any = await main({ action: 'member.kick', communityId: 'community-1', memberId: 'member-2' })

  expect(db.removeById).toHaveBeenCalledWith('community_members', 'member-2')
  expect(db.increment).toHaveBeenCalledWith('communities', 'community-1', 'memberCount', -1)
  expect(result.success).toBe(true)
})

test('section.updateWidgets: evergreen 板块不允许配置 attendance', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'section-1',
    type: 'evergreen',
    widgets: [],
  })

  await expect(main({
    action: 'section.updateWidgets',
    sectionId: 'section-1',
    widgets: [
      { widgetId: 'attendance-1', type: 'attendance', label: '活动参与', fieldKey: 'attendance', required: false, order: 0, showInList: true },
    ],
  })).rejects.toThrow('realtime')
})

test('section.updateWidgets: 占位标签名不允许保存', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'section-1',
    type: 'realtime',
    widgets: [],
  })

  await expect(main({
    action: 'section.updateWidgets',
    sectionId: 'section-1',
    widgets: [
      { widgetId: 'w1', type: 'short_text', label: '新控件', fieldKey: 'f1', required: false, order: 0, showInList: false },
    ],
  })).rejects.toThrow('占位文案')
})

test('section.updateWidgets: 公告控件由管理员维护且不进入帖子列表展示', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'section-1',
    type: 'evergreen',
    widgets: [],
  })
  ;(db.query as jest.Mock).mockResolvedValue([])
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result: any = await main({
    action: 'section.updateWidgets',
    sectionId: 'section-1',
    widgets: [
      {
        widgetId: 'notice-1',
        type: 'admin_notice',
        label: '近期课程',
        fieldKey: 'notice',
        required: true,
        order: 0,
        showInList: true,
        noticeContent: '  周三晚 7 点开课  ',
      },
    ],
  })

  expect(result.widgets[0]).toEqual(expect.objectContaining({
    type: 'admin_notice',
    label: '近期课程',
    required: false,
    showInList: false,
    noticeContent: '周三晚 7 点开课',
  }))
  expect(db.updateById).toHaveBeenCalledWith('sections', 'section-1', {
    widgets: expect.arrayContaining([
      expect.objectContaining({ type: 'admin_notice', noticeContent: '周三晚 7 点开课' }),
    ]),
  })
})

test('section.updateWidgets: 公告正文按 emoji 安全字符数截断', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'section-1',
    type: 'evergreen',
    widgets: [],
  })
  ;(db.query as jest.Mock).mockResolvedValue([])
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result: any = await main({
    action: 'section.updateWidgets',
    sectionId: 'section-1',
    widgets: [
      {
        widgetId: 'notice-emoji',
        type: 'admin_notice',
        label: '近期课程',
        fieldKey: 'notice',
        required: false,
        order: 0,
        showInList: false,
        noticeContent: ` ${'😀'.repeat(501)} `,
      },
    ],
  })

  expect(Array.from(result.widgets[0].noticeContent)).toHaveLength(500)
  expect(result.widgets[0].noticeContent).toBe('😀'.repeat(500))
})

test('post.getAdmin: 返回 attendance 汇总和完整名单', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({
      _id: 'post-1',
      communityId: 'community-1',
      sectionId: 'section-1',
      authorId: 'author-1',
      status: 'active',
      content: { title: '活动帖' },
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    .mockResolvedValueOnce({ _id: 'author-1', nickName: '作者', avatarUrl: '' })
    .mockResolvedValueOnce({
      _id: 'section-1',
      communityId: 'community-1',
      name: '活动区',
      type: 'realtime',
      enableComment: true,
      enableLike: true,
      widgets: [
        { widgetId: 'attendance-1', type: 'attendance', label: '活动参与', fieldKey: 'attendance', required: false, order: 0, showInList: true, capacity: 5 },
      ],
    })
    .mockResolvedValueOnce({ _id: 'user-1', nickName: '小王', avatarUrl: '1.png' })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([
      { _id: 'record-1', postId: 'post-1', widgetId: 'attendance-1', userId: 'user-1', joinedAt: '2024-01-02T00:00:00.000Z' },
    ])
    .mockResolvedValueOnce([
      { _id: 'record-1', postId: 'post-1', widgetId: 'attendance-1', userId: 'user-1', joinedAt: '2024-01-02T00:00:00.000Z' },
    ])

  const result: any = await main({ action: 'post.getAdmin', postId: 'post-1' })

  expect(result.post.attendanceSummaryByWidget['attendance-1'].count).toBe(1)
  expect(result.attendanceMembersByWidget['attendance-1']).toHaveLength(1)
  expect(result.attendanceMembersByWidget['attendance-1'][0].userId).toBe('user-1')
})

test('post.removeAttendanceMemberAdmin: 可移除参与人并返回最新名单', async () => {
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([{ _id: 'record-1', postId: 'post-1', widgetId: 'attendance-1', userId: 'user-1' }])
    .mockResolvedValueOnce([])
  ;(db.removeById as jest.Mock).mockResolvedValue({})

  const result: any = await main({
    action: 'post.removeAttendanceMemberAdmin',
    postId: 'post-1',
    widgetId: 'attendance-1',
    userId: 'user-1',
  })

  expect(db.removeById).toHaveBeenCalledWith('post_attendance_members', 'record-1')
  expect(result).toEqual({ success: true, members: [], total: 0 })
})
