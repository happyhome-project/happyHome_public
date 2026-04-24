jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  getWXContext: jest.fn().mockReturnValue({ OPENID: 'test-openid' }),
  DYNAMIC_CURRENT_ENV: 'test',
}))

jest.mock('../../../lib/db', () => ({
  getById: jest.fn(),
  create: jest.fn(),
  updateById: jest.fn(),
  query: jest.fn(),
  removeById: jest.fn(),
  softDelete: jest.fn(),
}))

import {
  handleCreate,
  handleGet,
  handleJoinAttendance,
  handleListAttendanceMembers,
  handleList,
  handleUpdate,
} from '../index'
import * as db from '../../../lib/db'

beforeEach(() => jest.clearAllMocks())

const mockSection = {
  _id: 'section-1',
  communityId: 'community-1',
  name: '活动',
  icon: 'activity',
  order: 1,
  enableComment: true,
  enableLike: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  type: 'realtime',
  status: 'active',
  widgets: [
    {
      widgetId: 'title-widget',
      type: 'short_text',
      label: '标题',
      fieldKey: 'title',
      required: true,
      order: 0,
      showInList: true,
    },
    {
      widgetId: 'attendance-widget',
      type: 'attendance',
      label: '活动参与',
      fieldKey: 'attendance',
      required: false,
      order: 1,
      showInList: true,
      capacity: 2,
    },
  ],
}

test('create: attendance 控件不会参与发帖必填校验', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.getById as jest.Mock).mockResolvedValue(mockSection)
  ;(db.create as jest.Mock).mockResolvedValue('post-1')

  const result = await handleCreate({
    communityId: 'community-1',
    sectionId: 'section-1',
    content: {
      'title-widget': '周六爬山',
    },
  } as any, 'test-openid')

  expect(result.postId).toBe('post-1')
  expect(db.create).toHaveBeenCalledWith('posts', expect.objectContaining({
    content: { 'title-widget': '周六爬山' },
  }))
})

test('update: 保存时会清理无效字段和 attendance 字段', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({
      _id: 'post-1',
      sectionId: 'section-1',
      authorId: 'test-openid',
      status: 'active',
    })
    .mockResolvedValueOnce(mockSection)
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  await handleUpdate({
    postId: 'post-1',
    content: {
      'title-widget': '更新后的标题',
      'attendance-widget': 'should-be-removed',
      'legacy-widget': 'legacy',
    } as any,
  }, 'test-openid')

  expect(db.updateById).toHaveBeenCalledWith('posts', 'post-1', expect.objectContaining({
    content: { 'title-widget': '更新后的标题' },
  }))
})

test('joinAttendance: 同一用户重复参与不会重复创建记录', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({
      _id: 'post-1',
      communityId: 'community-1',
      sectionId: 'section-1',
      status: 'active',
    })
    .mockResolvedValueOnce(mockSection)
    .mockResolvedValueOnce({ _id: 'test-openid', nickName: 'Tester', avatarUrl: 'avatar.png' })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
    .mockResolvedValueOnce([{ _id: 'attendance-1', postId: 'post-1', widgetId: 'attendance-widget', userId: 'test-openid', joinedAt: '2024-01-01T00:00:00.000Z' }])
    .mockResolvedValueOnce([{ _id: 'attendance-1', postId: 'post-1', widgetId: 'attendance-widget', userId: 'test-openid', joinedAt: '2024-01-01T00:00:00.000Z' }])

  const result = await handleJoinAttendance({ postId: 'post-1', widgetId: 'attendance-widget' }, 'test-openid')

  expect(db.create).not.toHaveBeenCalled()
  expect(result.summary.count).toBe(1)
  expect(result.summary.isJoined).toBe(true)
})

test('joinAttendance: 满员后新用户不能再参与', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({
      _id: 'post-1',
      communityId: 'community-1',
      sectionId: 'section-1',
      status: 'active',
    })
    .mockResolvedValueOnce({
      ...mockSection,
      widgets: [{ ...mockSection.widgets[1], capacity: 1 }],
    })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ _id: 'attendance-1', postId: 'post-1', widgetId: 'attendance-widget', userId: 'another-user', joinedAt: '2024-01-01T00:00:00.000Z' }])

  await expect(handleJoinAttendance({ postId: 'post-1', widgetId: 'attendance-widget' }, 'test-openid'))
    .rejects.toThrow('已满员')
})

test('get/listAttendanceMembers: 返回参与聚合和完整名单', async () => {
  ;(db.getById as jest.Mock).mockImplementation(async (_collectionName: string, id: string) => {
    if (id === 'post-1') {
      return {
        _id: 'post-1',
        communityId: 'community-1',
        sectionId: 'section-1',
        status: 'active',
        content: { 'title-widget': '周六爬山' },
      }
    }
    if (id === 'section-1') return mockSection
    if (id === 'user-1') return { _id: 'user-1', nickName: '一号', avatarUrl: '1.png' }
    if (id === 'user-2') return { _id: 'user-2', nickName: '二号', avatarUrl: '2.png' }
    return null
  })
  ;(db.query as jest.Mock).mockImplementation(async (collectionName: string, where: any) => {
    if (collectionName === 'post_attendance_members') {
      return [
        { _id: 'attendance-2', postId: 'post-1', widgetId: 'attendance-widget', userId: 'user-2', joinedAt: '2024-01-02T00:00:00.000Z' },
        { _id: 'attendance-1', postId: 'post-1', widgetId: 'attendance-widget', userId: 'user-1', joinedAt: '2024-01-01T00:00:00.000Z' },
      ]
    }
    if (collectionName === 'community_members' && where.communityId === 'community-1') {
      return [{ _id: 'member-1', status: 'active' }]
    }
    return []
  })

  const detail = await handleGet({ postId: 'post-1' }, 'user-1')
  const roster = await handleListAttendanceMembers({ postId: 'post-1', widgetId: 'attendance-widget' }, 'user-1')

  expect(detail.post.attendanceSummaryByWidget['attendance-widget'].count).toBe(2)
  expect(detail.post.attendanceSummaryByWidget['attendance-widget'].isJoined).toBe(true)
  expect(roster.members).toHaveLength(2)
  expect(roster.members[0].userId).toBe('user-2')
})

test('list：非 active 成员不可查看帖子', async () => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce(mockSection)
  ;(db.query as jest.Mock).mockResolvedValueOnce([])

  await expect(handleList({ sectionId: 'section-1' }, '')).rejects.toThrow('需要先加入社区后查看内容')
})

test('get：非 active 成员不可查看帖子详情', async () => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce({
    _id: 'post-1',
    communityId: 'community-1',
    sectionId: 'section-1',
    status: 'active',
  })
  ;(db.query as jest.Mock).mockResolvedValueOnce([])

  await expect(handleGet({ postId: 'post-1' }, '')).rejects.toThrow('需要先加入社区后查看内容')
})
