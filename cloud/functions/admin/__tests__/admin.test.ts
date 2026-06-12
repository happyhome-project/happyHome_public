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
import * as storage from '../../../lib/storage'

beforeEach(() => jest.resetAllMocks())

test('admin.approvalSummary: superAdmin 返回社区创建和成员加入待办数', async () => {
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([
      { _id: 'pending-community-1', name: '待审社区', status: 'pending' },
    ])
    .mockResolvedValueOnce([
      { _id: 'community-1', name: '青山村', status: 'active' },
      { _id: 'community-2', name: '明士班', status: 'active' },
    ])
    .mockResolvedValueOnce([
      { _id: 'member-1', status: 'pending' },
      { _id: 'member-2', status: 'pending' },
    ])
    .mockResolvedValueOnce([])

  const result: any = await main({
    action: 'admin.approvalSummary',
    _actAs: { accountId: 'super-1', role: 'superAdmin', userId: 'boss-openid', username: 'boss' },
  })

  expect(result.pendingCommunityCount).toBe(1)
  expect(result.pendingMemberCount).toBe(2)
  expect(result.communities).toEqual([
    { communityId: 'community-1', communityName: '青山村', pendingMemberCount: 2 },
  ])
})

test('admin.approvalSummary: communityAdmin 只返回自己可管理社区的成员待办', async () => {
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([{ _id: 'community-1' }]) // listOwnedCommunityIds: created
    .mockResolvedValueOnce([{ communityId: 'community-2' }]) // listOwnedCommunityIds: as admin
    .mockResolvedValueOnce([{ _id: 'member-1', status: 'pending' }])
    .mockResolvedValueOnce([])
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({ _id: 'community-1', name: '青山村', status: 'active' })
    .mockResolvedValueOnce({ _id: 'community-2', name: '明士班', status: 'active' })

  const result: any = await main({
    action: 'admin.approvalSummary',
    _actAs: { accountId: 'ca-1', role: 'communityAdmin', userId: 'admin-openid', username: 'ca' },
  })

  expect(result.pendingCommunityCount).toBe(0)
  expect(result.pendingMemberCount).toBe(1)
  expect(result.communities).toEqual([
    { communityId: 'community-1', communityName: '青山村', pendingMemberCount: 1 },
  ])
})

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

test('section.updateWidgets: 普通控件允许空标签或占位标签保存', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'section-1',
    type: 'realtime',
    widgets: [],
  })
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result: any = await main({
    action: 'section.updateWidgets',
    sectionId: 'section-1',
    widgets: [
      { widgetId: 'w1', type: 'short_text', label: '新控件', fieldKey: 'f1', required: false, order: 0, showInList: false },
      { widgetId: 'w2', type: 'number', label: '', fieldKey: 'f2', required: false, order: 1, showInList: false },
    ],
  })

  expect(result.widgets).toEqual(expect.arrayContaining([
    expect.objectContaining({ widgetId: 'w1', label: '新控件' }),
    expect.objectContaining({ widgetId: 'w2', label: '' }),
  ]))
})

test('section.updateWidgets: attendance 空标签或通用标签会按无标题保存', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'section-1',
    type: 'realtime',
    widgets: [],
  })
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result: any = await main({
    action: 'section.updateWidgets',
    sectionId: 'section-1',
    widgets: [
      { widgetId: 'attendance-1', type: 'attendance', label: '短文字', fieldKey: 'attendance', required: false, order: 0, showInList: true },
    ],
  })

  expect(result.widgets[0].label).toBe('')
  expect(db.updateById).toHaveBeenCalledWith('sections', 'section-1', {
    widgets: expect.arrayContaining([
      expect.objectContaining({ widgetId: 'attendance-1', type: 'attendance', label: '' }),
    ]),
  })
})

test('section.updateWidgets: 新增控件不查询历史帖子影响', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'section-1',
    type: 'realtime',
    widgets: [
      { widgetId: 'title-1', type: 'short_text', label: '标题', fieldKey: 'title', required: false, order: 0, showInList: false },
    ],
  })
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  await main({
    action: 'section.updateWidgets',
    sectionId: 'section-1',
    widgets: [
      { widgetId: 'title-1', type: 'short_text', label: '标题', fieldKey: 'title', required: false, order: 0, showInList: false },
      { widgetId: 'image-1', type: 'image_group', label: '照片', fieldKey: 'images', required: false, order: 1, showInList: false },
    ],
  })

  expect(db.query).not.toHaveBeenCalledWith('posts', { sectionId: 'section-1', status: 'active' })
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

test('section.create: 图文攻略展示模板可保存到板块', async () => {
  ;(db.create as jest.Mock).mockResolvedValue('section-guide')

  const result: any = await main({
    action: 'section.create',
    communityId: 'community-1',
    name: '亲子出游',
    type: 'evergreen',
    displayTemplate: 'guide_note',
  })

  expect(result.sectionId).toBe('section-guide')
  expect(db.create).toHaveBeenCalledWith('sections', expect.objectContaining({
    name: '亲子出游',
    type: 'evergreen',
    displayTemplate: 'guide_note',
    widgets: [
      expect.objectContaining({ widgetId: 'guide_title', type: 'short_text', label: '标题', required: true, showInList: true, locked: true }),
      expect.objectContaining({ widgetId: 'guide_images', type: 'image_group', label: '封面/图片', required: true, showInList: false, locked: true }),
      expect.objectContaining({ widgetId: 'guide_distance', type: 'short_text', label: '距离', required: false, showInList: false, locked: true }),
      expect.objectContaining({ widgetId: 'guide_highest_altitude', type: 'short_text', label: '最高海拔', required: false, showInList: false, locked: true }),
      expect.objectContaining({ widgetId: 'guide_total_climb', type: 'short_text', label: '累计爬升', required: false, showInList: false, locked: true }),
      expect.objectContaining({ widgetId: 'guide_reference_duration', type: 'short_text', label: '参考用时', required: false, showInList: false, locked: true }),
      expect.objectContaining({ widgetId: 'guide_drive_duration', type: 'short_text', label: '驾车到达用时', required: true, showInList: false, locked: true }),
      expect.objectContaining({ widgetId: 'guide_body', type: 'rich_note', label: '正文', required: false, showInList: false, locked: true }),
      expect.objectContaining({ widgetId: 'guide_location', type: 'location', label: '线路轨迹/地点', required: false, showInList: false, locked: true }),
    ],
  }))
})

test('section.updateWidgets: 图文攻略固定控件不能删除或修改', async () => {
  const guideWidgets = [
    { widgetId: 'guide_title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true, locked: true },
    { widgetId: 'guide_images', type: 'image_group', label: '封面/图片', fieldKey: 'images', required: true, order: 1, showInList: false, locked: true },
    { widgetId: 'guide_distance', type: 'short_text', label: '距离', fieldKey: 'distance', required: false, order: 2, showInList: false, locked: true },
    { widgetId: 'guide_highest_altitude', type: 'short_text', label: '最高海拔', fieldKey: 'highestAltitude', required: false, order: 3, showInList: false, locked: true },
    { widgetId: 'guide_total_climb', type: 'short_text', label: '累计爬升', fieldKey: 'totalClimb', required: false, order: 4, showInList: false, locked: true },
    { widgetId: 'guide_reference_duration', type: 'short_text', label: '参考用时', fieldKey: 'referenceDuration', required: false, order: 5, showInList: false, locked: true },
    { widgetId: 'guide_drive_duration', type: 'short_text', label: '驾车到达用时', fieldKey: 'driveDuration', required: true, order: 6, showInList: false, locked: true },
    { widgetId: 'guide_body', type: 'rich_note', label: '正文', fieldKey: 'body', required: false, order: 7, showInList: false, locked: true },
    { widgetId: 'guide_location', type: 'location', label: '线路轨迹/地点', fieldKey: 'location', required: false, order: 8, showInList: false, locked: true },
  ]
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'section-guide',
    type: 'evergreen',
    displayTemplate: 'guide_note',
    widgets: guideWidgets,
  })

  await expect(main({
    action: 'section.updateWidgets',
    sectionId: 'section-guide',
    widgets: guideWidgets.filter((widget) => widget.widgetId !== 'guide_images'),
  })).rejects.toThrow('固定控件')

  await expect(main({
    action: 'section.updateWidgets',
    sectionId: 'section-guide',
    widgets: guideWidgets.map((widget) => (
      widget.widgetId === 'guide_title'
        ? { ...widget, type: 'summary' }
        : widget
    )),
  })).rejects.toThrow('固定控件')
})

test('section.updateWidgets: 图文攻略允许在固定控件后追加小控件', async () => {
  const guideWidgets = [
    { widgetId: 'guide_title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true, locked: true },
    { widgetId: 'guide_images', type: 'image_group', label: '封面/图片', fieldKey: 'images', required: true, order: 1, showInList: false, locked: true },
    { widgetId: 'guide_distance', type: 'short_text', label: '距离', fieldKey: 'distance', required: false, order: 2, showInList: false, locked: true },
    { widgetId: 'guide_highest_altitude', type: 'short_text', label: '最高海拔', fieldKey: 'highestAltitude', required: false, order: 3, showInList: false, locked: true },
    { widgetId: 'guide_total_climb', type: 'short_text', label: '累计爬升', fieldKey: 'totalClimb', required: false, order: 4, showInList: false, locked: true },
    { widgetId: 'guide_reference_duration', type: 'short_text', label: '参考用时', fieldKey: 'referenceDuration', required: false, order: 5, showInList: false, locked: true },
    { widgetId: 'guide_drive_duration', type: 'short_text', label: '驾车到达用时', fieldKey: 'driveDuration', required: true, order: 6, showInList: false, locked: true },
    { widgetId: 'guide_body', type: 'rich_note', label: '正文', fieldKey: 'body', required: false, order: 7, showInList: false, locked: true },
    { widgetId: 'guide_location', type: 'location', label: '线路轨迹/地点', fieldKey: 'location', required: false, order: 8, showInList: false, locked: true },
  ]
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'section-guide',
    type: 'evergreen',
    displayTemplate: 'guide_note',
    widgets: guideWidgets,
  })
  ;(db.updateById as jest.Mock).mockResolvedValue({})
  ;(db.query as jest.Mock).mockResolvedValue([])

  const result: any = await main({
    action: 'section.updateWidgets',
    sectionId: 'section-guide',
    widgets: [
      ...guideWidgets,
      { widgetId: 'guide_age', type: 'short_text', label: '适合年龄', fieldKey: 'age', required: false, order: 9, showInList: false },
    ],
  })

  expect(result.widgets.slice(0, 9).every((widget: any) => widget.locked === true)).toBe(true)
  expect(result.widgets[9]).toEqual(expect.objectContaining({ widgetId: 'guide_age', locked: false }))
  expect(db.updateById).toHaveBeenCalledWith('sections', 'section-guide', expect.objectContaining({
    widgets: expect.arrayContaining([
      expect.objectContaining({ widgetId: 'guide_images', required: true, locked: true }),
      expect.objectContaining({ widgetId: 'guide_drive_duration', required: true, locked: true }),
      expect.objectContaining({ widgetId: 'guide_distance', locked: true }),
      expect.objectContaining({ widgetId: 'guide_age', locked: false }),
    ]),
  }))
})

test('section.get: 旧图文攻略板块会补齐路线攻略固定控件', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'section-guide',
    type: 'evergreen',
    displayTemplate: 'guide_note',
    widgets: [
      { widgetId: 'guide_title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true, locked: true },
      { widgetId: 'guide_images', type: 'image_group', label: '封面/图片', fieldKey: 'images', required: true, order: 1, showInList: false, locked: true },
      { widgetId: 'guide_body', type: 'rich_note', label: '正文', fieldKey: 'body', required: false, order: 2, showInList: false, locked: true },
      { widgetId: 'guide_location', type: 'location', label: '地点', fieldKey: 'location', required: false, order: 3, showInList: false, locked: true },
    ],
  })

  const result: any = await main({
    action: 'section.get',
    sectionId: 'section-guide',
  })

  expect(result.section.widgets.map((widget: any) => widget.widgetId).slice(0, 9)).toEqual([
    'guide_title',
    'guide_images',
    'guide_distance',
    'guide_highest_altitude',
    'guide_total_climb',
    'guide_reference_duration',
    'guide_drive_duration',
    'guide_body',
    'guide_location',
  ])
  expect(result.section.widgets[6]).toEqual(expect.objectContaining({
    widgetId: 'guide_drive_duration',
    label: '驾车到达用时',
    required: true,
    order: 6,
    locked: true,
  }))
  expect(result.section.widgets[8]).toEqual(expect.objectContaining({
    widgetId: 'guide_location',
    label: '线路轨迹/地点',
    order: 8,
    locked: true,
  }))
})

test('section.updateMeta: 展示模板只接受默认和图文攻略', async () => {
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  await main({
    action: 'section.updateMeta',
    sectionId: 'section-1',
    displayTemplate: 'guide_note',
  })

  expect(db.updateById).toHaveBeenLastCalledWith('sections', 'section-1', {
    displayTemplate: 'guide_note',
  })

  await main({
    action: 'section.updateMeta',
    sectionId: 'section-1',
    displayTemplate: 'unexpected-template',
  })

  expect(db.updateById).toHaveBeenLastCalledWith('sections', 'section-1', {
    displayTemplate: 'default',
  })
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
      adminEditedAt: '2024-01-03T00:00:00.000Z',
      adminEditedByUsername: 'ops-admin',
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
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      { _id: 'record-1', postId: 'post-1', widgetId: 'attendance-1', userId: 'user-1', joinedAt: '2024-01-02T00:00:00.000Z' },
    ])
    .mockResolvedValueOnce([
      { _id: 'record-1', postId: 'post-1', widgetId: 'attendance-1', userId: 'user-1', joinedAt: '2024-01-02T00:00:00.000Z' },
    ])

  const result: any = await main({ action: 'post.getAdmin', postId: 'post-1' })

  expect(result.post.attendanceSummaryByWidget['attendance-1'].count).toBe(1)
  expect(result.post.adminEditedAt).toBe('2024-01-03T00:00:00.000Z')
  expect(result.post.adminEditedByUsername).toBe('ops-admin')
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

test('community.hardDelete: cleans cloud files from current and pending post content', async () => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce({
    _id: 'community-1',
    status: 'disabled',
    coverImage: 'cloud://env/community-cover.jpg',
  })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([
      {
        _id: 'post-1',
        content: { images: ['cloud://env/current.jpg'] },
        pendingContent: { rich: { imageFileIDs: ['cloud://env/pending.jpg'] } },
      },
    ])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
  ;(db.removeById as jest.Mock).mockResolvedValue({})
  ;(storage.deleteFile as jest.Mock).mockResolvedValue({})

  await main({ action: 'community.hardDelete', communityId: 'community-1' })

  expect(storage.deleteFile).toHaveBeenCalledWith([
    'cloud://env/community-cover.jpg',
    'cloud://env/current.jpg',
    'cloud://env/pending.jpg',
  ])
})

test('admin.createAccount: 创建绑定微信的 superAdmin 时同步小程序用户角色', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([]) // username 未占用
  ;(db.getById as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('not found'), { errCode: -502001 }))
  ;(db.create as jest.Mock)
    .mockResolvedValueOnce('super-account-1')
    .mockResolvedValueOnce('super-openid')

  const result: any = await main({
    action: 'admin.createAccount',
    username: 'ops',
    password: 'happyhome2024',
    role: 'superAdmin',
    userId: 'super-openid',
    _actAs: { accountId: 'root', role: 'superAdmin', userId: 'root-openid', username: 'root' },
  })

  expect(db.create).toHaveBeenCalledWith('admin_accounts', expect.objectContaining({
    username: 'ops',
    userId: 'super-openid',
    role: 'superAdmin',
    status: 'active',
  }))
  expect(db.create).toHaveBeenCalledWith('users', expect.objectContaining({
    _id: 'super-openid',
    role: 'superAdmin',
    roleSource: 'admin_account',
  }))
  expect(result.accountId).toBe('super-account-1')
})

test('admin.bindWechat: 绑定 superAdmin 微信 openId 时同步小程序用户角色', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([]) // openId 未绑定其他账号
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({
      _id: 'super-account-1',
      username: 'admin',
      role: 'superAdmin',
      status: 'active',
      userId: '',
    })
    .mockResolvedValueOnce({
      _id: 'super-openid',
      nickName: '一年',
      avatarUrl: '',
      role: 'user',
    })
  ;(db.updateById as jest.Mock).mockResolvedValue({})
  ;(db.updateWhere as jest.Mock).mockResolvedValue({})

  const result: any = await main({
    action: 'admin.bindWechat',
    accountId: 'super-account-1',
    openId: 'super-openid',
    _actAs: { accountId: 'root', role: 'superAdmin', userId: 'root-openid', username: 'root' },
  })

  expect(db.updateById).toHaveBeenCalledWith('admin_accounts', 'super-account-1', { userId: 'super-openid' })
  expect(db.updateById).toHaveBeenCalledWith('users', 'super-openid', {
    role: 'superAdmin',
    roleSource: 'admin_account',
  })
  expect(db.updateWhere).toHaveBeenCalledWith('admin_sessions', { accountId: 'super-account-1' }, { userId: 'super-openid' })
  expect(result.success).toBe(true)
})

test('admin.listAccounts: 标记未删除社区的创建者管理员账号', async () => {
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([
      {
        _id: 'account-creator',
        username: 'creator-admin',
        role: 'communityAdmin',
        status: 'active',
        userId: 'creator-openid',
        createdAt: '2026-04-28T00:00:00.000Z',
        createdBy: 'boss',
      },
      {
        _id: 'account-free',
        username: 'free-admin',
        role: 'communityAdmin',
        status: 'active',
        userId: 'free-openid',
        createdAt: '2026-04-28T00:00:00.000Z',
        createdBy: 'boss',
      },
    ])
    .mockResolvedValueOnce([{ _id: 'community-1', name: '青山村', creatorId: 'creator-openid' }])
    .mockResolvedValueOnce([])

  const result: any = await main({ action: 'admin.listAccounts' })

  expect(result.accounts[0]).toEqual(expect.objectContaining({
    _id: 'account-creator',
    creatorCommunityCount: 1,
    creatorCommunityNames: ['青山村'],
  }))
  expect(result.accounts[1]).toEqual(expect.objectContaining({
    _id: 'account-free',
    creatorCommunityCount: 0,
  }))
})

test('admin.deleteAccount: 不能删除未删除社区的创建者管理员账号', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'account-creator',
    userId: 'creator-openid',
    username: 'creator-admin',
    role: 'communityAdmin',
    status: 'active',
  })
  ;(db.query as jest.Mock).mockResolvedValueOnce([
    { _id: 'community-1', name: '青山村', creatorId: 'creator-openid' },
  ])

  await expect(main({
    action: 'admin.deleteAccount',
    accountId: 'account-creator',
    _actAs: { accountId: 'super-1', role: 'superAdmin', userId: 'boss', username: 'boss' },
  })).rejects.toThrow('创建者管理员账号')
  expect(db.removeById).not.toHaveBeenCalledWith('admin_accounts', 'account-creator')
})

test('admin.deleteAccount: 删除普通管理员账号并清理 session', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'account-free',
    userId: 'free-openid',
    username: 'free-admin',
    role: 'communityAdmin',
    status: 'active',
  })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      { _id: 'session-1', accountId: 'account-free' },
      { _id: 'session-2', accountId: 'account-free' },
    ])
  ;(db.removeById as jest.Mock).mockResolvedValue({})

  const result: any = await main({
    action: 'admin.deleteAccount',
    accountId: 'account-free',
    _actAs: { accountId: 'super-1', role: 'superAdmin', userId: 'boss', username: 'boss' },
  })

  expect(db.removeById).toHaveBeenCalledWith('admin_sessions', 'session-1')
  expect(db.removeById).toHaveBeenCalledWith('admin_sessions', 'session-2')
  expect(db.removeById).toHaveBeenCalledWith('admin_accounts', 'account-free')
  expect(result).toEqual({ success: true, revokedSessions: 2 })
})

test('admin.deleteAccount: 不能删除自己的账号', async () => {
  await expect(main({
    action: 'admin.deleteAccount',
    accountId: 'super-1',
    _actAs: { accountId: 'super-1', role: 'superAdmin', userId: 'boss', username: 'boss' },
  })).rejects.toThrow('不能删除自己的账号')
})

test('post.pinAdmin: active 帖子可置顶并记录操作人', async () => {
  ;(db.getById as jest.Mock).mockReset()
  ;(db.updateById as jest.Mock).mockReset()
  ;(db.getById as jest.Mock).mockResolvedValueOnce({
    _id: 'post-1',
    communityId: 'community-1',
    status: 'active',
  })
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result: any = await main({
    action: 'post.pinAdmin',
    postId: 'post-1',
    _actAs: { accountId: 'admin-1', role: 'superAdmin', userId: 'ops-openid', username: 'ops' },
  })

  expect(db.updateById).toHaveBeenCalledWith('posts', 'post-1', expect.objectContaining({
    isPinned: true,
    pinnedAt: expect.any(String),
    pinnedByAccountId: 'admin-1',
  }))
  expect(result.success).toBe(true)
})

test('post.featureAdmin: active 帖子可加精并记录操作人', async () => {
  ;(db.getById as jest.Mock).mockReset()
  ;(db.updateById as jest.Mock).mockReset()
  ;(db.getById as jest.Mock).mockResolvedValueOnce({
    _id: 'post-1',
    communityId: 'community-1',
    status: 'active',
  })
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result: any = await main({
    action: 'post.featureAdmin',
    postId: 'post-1',
    _actAs: { accountId: 'admin-1', role: 'superAdmin', userId: 'ops-openid', username: 'ops' },
  })

  expect(db.updateById).toHaveBeenCalledWith('posts', 'post-1', expect.objectContaining({
    isFeatured: true,
    featuredAt: expect.any(String),
    featuredByAccountId: 'admin-1',
  }))
  expect(result.success).toBe(true)
})

test('post.listAdmin: filters pinned and featured posts', async () => {
  ;(db.getById as jest.Mock).mockReset()
  ;(db.query as jest.Mock).mockReset()
  ;(db.query as jest.Mock).mockResolvedValueOnce([
    {
      _id: 'post-featured-pinned',
      communityId: 'community-1',
      sectionId: 'section-1',
      authorId: 'user-1',
      status: 'active',
      isPinned: true,
      isFeatured: true,
      createdAt: '2026-04-22T10:00:00.000Z',
      content: {},
    },
    {
      _id: 'post-normal',
      communityId: 'community-1',
      sectionId: 'section-1',
      authorId: 'user-1',
      status: 'active',
      isPinned: false,
      isFeatured: false,
      createdAt: '2026-04-22T11:00:00.000Z',
      content: {},
    },
  ])
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'users' && id === 'user-1') return { _id: 'user-1', nickName: '一年' }
    if (collectionName === 'sections' && id === 'section-1') {
      return {
        _id: 'section-1',
        communityId: 'community-1',
        name: '拼车出行',
        type: 'realtime',
        status: 'active',
        widgets: [],
      }
    }
    return null
  })

  const result: any = await main({
    action: 'post.listAdmin',
    communityId: 'community-1',
    pinned: true,
    featured: true,
    _actAs: { accountId: 'admin-1', role: 'superAdmin', userId: 'ops-openid', username: 'ops' },
  })

  expect(result.posts.map((post: any) => post._id)).toEqual(['post-featured-pinned'])
  expect(result.total).toBe(1)
})

test('post.pinAdmin/post.featureAdmin: deleted 帖子不可置顶或加精', async () => {
  ;(db.getById as jest.Mock).mockReset()
  ;(db.updateById as jest.Mock).mockReset()
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({
      _id: 'post-deleted',
      communityId: 'community-1',
      status: 'deleted',
    })
    .mockResolvedValueOnce({
      _id: 'post-deleted',
      communityId: 'community-1',
      status: 'deleted',
    })

  await expect(main({
    action: 'post.pinAdmin',
    postId: 'post-deleted',
    _actAs: { accountId: 'admin-1', role: 'superAdmin', userId: 'ops-openid', username: 'ops' },
  })).rejects.toThrow('已删除帖子不能置顶或加精')

  await expect(main({
    action: 'post.featureAdmin',
    postId: 'post-deleted',
    _actAs: { accountId: 'admin-1', role: 'superAdmin', userId: 'ops-openid', username: 'ops' },
  })).rejects.toThrow('已删除帖子不能置顶或加精')
  expect(db.updateById).not.toHaveBeenCalled()
})

test('post.deleteAdmin: clears pin and featured flags', async () => {
  ;(db.getById as jest.Mock).mockReset()
  ;(db.updateById as jest.Mock).mockReset()
  ;(db.getById as jest.Mock).mockResolvedValueOnce({
    _id: 'post-flagged',
    communityId: 'community-1',
    status: 'active',
    isPinned: true,
    pinnedAt: '2026-04-20T10:00:00.000Z',
    pinnedByAccountId: 'admin-old',
    isFeatured: true,
    featuredAt: '2026-04-20T11:00:00.000Z',
    featuredByAccountId: 'admin-old',
  })
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result: any = await main({
    action: 'post.deleteAdmin',
    postId: 'post-flagged',
    _actAs: { accountId: 'admin-1', role: 'superAdmin', userId: 'ops-openid', username: 'ops' },
  })

  expect(db.updateById).toHaveBeenCalledWith('posts', 'post-flagged', {
    status: 'deleted',
    isPinned: false,
    pinnedAt: '',
    pinnedByAccountId: '',
    isFeatured: false,
    featuredAt: '',
    featuredByAccountId: '',
  })
  expect(result).toEqual({ success: true })
})
