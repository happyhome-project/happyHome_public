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
