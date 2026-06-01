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
  handleClientLog,
  handleGet,
  handleJoinAttendance,
  handleListAttendanceMembers,
  handleList,
  handleUpdate,
} from '../index'
import * as db from '../../../lib/db'

beforeEach(() => jest.clearAllMocks())

test('clientLog: accepts diagnostic payload without touching data collections', async () => {
  const result = await handleClientLog({
    level: 'info',
    event: 'detail.load.start',
    sessionId: 'session-1',
    route: 'pages/detail/index',
    build: { version: '1.0.test' },
    details: {
      postId: 'post-1',
      token: 'should-not-be-logged',
    },
  }, 'openid-123456')

  expect(result.success).toBe(true)
  expect(db.create).not.toHaveBeenCalled()
  expect(db.updateById).not.toHaveBeenCalled()
})

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
    {
      widgetId: 'notice-widget',
      type: 'admin_notice',
      label: '近期课程',
      fieldKey: 'notice',
      required: true,
      order: 2,
      showInList: false,
      noticeContent: '周三晚 7 点开课',
    },
    {
      widgetId: 'audio-widget',
      type: 'audio_group',
      label: '音频',
      fieldKey: 'audio',
      required: false,
      order: 3,
      showInList: false,
    },
  ],
}

test('create: attendance、公告和音频控件不会参与普通用户发帖', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.getById as jest.Mock).mockResolvedValue(mockSection)
  ;(db.create as jest.Mock).mockResolvedValue('post-1')

  const result = await handleCreate({
    communityId: 'community-1',
    sectionId: 'section-1',
    content: {
      'title-widget': '周六爬山',
      'notice-widget': '用户不应能写公告',
      'audio-widget': [{ title: '用户伪造音频', fileID: 'cloud://env/a.mp3', duration: 10, size: 100, ext: 'mp3' }],
    },
  } as any, 'test-openid')

  expect(result.postId).toBe('post-1')
  expect(db.create).toHaveBeenCalledWith('posts', expect.objectContaining({
    content: { 'title-widget': '周六爬山' },
  }))
})

test('update: 保存时会清理无效字段、attendance、公告和音频字段', async () => {
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
      'notice-widget': 'should-also-be-removed',
      'audio-widget': [{ title: 'should-be-removed', fileID: 'cloud://env/a.mp3', duration: 10, size: 100, ext: 'mp3' }],
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
  expect(detail.post.attendanceSummaryByWidget['attendance-widget'].occupiedSeats).toBe(2)
  expect(detail.post.attendanceSummaryByWidget['attendance-widget'].isJoined).toBe(true)
  expect(roster.members).toHaveLength(2)
  expect(roster.members[0].userId).toBe('user-2')
  expect(roster.members[0].seatCount).toBe(1)
  expect(roster.occupiedSeats).toBe(2)
})

test('joinAttendance: 带 seatCount=3 时写入数据库字段正确', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({
      _id: 'post-1',
      communityId: 'community-1',
      sectionId: 'section-1',
      status: 'active',
    })
    .mockResolvedValueOnce({
      ...mockSection,
      widgets: [{ ...mockSection.widgets[1], capacity: 5 }],
    })
    .mockResolvedValueOnce({ _id: 'test-openid', nickName: 'Tester', avatarUrl: 'avatar.png' })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }]) // community_members
    .mockResolvedValueOnce([])                                       // existing by userId
    .mockResolvedValueOnce([])                                       // capacity pre-check
    .mockResolvedValueOnce([                                         // re-check after insert
      { _id: 'new-id', postId: 'post-1', widgetId: 'attendance-widget', userId: 'test-openid', seatCount: 3, joinedAt: 'now' },
    ])
    .mockResolvedValueOnce([                                         // final summary
      { _id: 'new-id', postId: 'post-1', widgetId: 'attendance-widget', userId: 'test-openid', seatCount: 3, joinedAt: 'now' },
    ])
  ;(db.create as jest.Mock).mockResolvedValue('new-id')

  const result = await handleJoinAttendance({
    postId: 'post-1',
    widgetId: 'attendance-widget',
    seatCount: 3,
  } as any, 'test-openid')

  expect(db.create).toHaveBeenCalledWith('post_attendance_members', expect.objectContaining({
    userId: 'test-openid',
    seatCount: 3,
  }))
  expect(result.summary.occupiedSeats).toBe(3)
  expect(result.summary.mySeatCount).toBe(3)
  expect(result.summary.count).toBe(1)
})

test('joinAttendance: seatCount 累加超容时抛含剩余座位数的明确错误', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({
      _id: 'post-1',
      communityId: 'community-1',
      sectionId: 'section-1',
      status: 'active',
    })
    .mockResolvedValueOnce({
      ...mockSection,
      widgets: [{ ...mockSection.widgets[1], capacity: 5 }],
    })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      { _id: 'a1', userId: 'u1', seatCount: 2, joinedAt: 't1' },
    ])

  await expect(handleJoinAttendance({
    postId: 'post-1',
    widgetId: 'attendance-widget',
    seatCount: 4,
  } as any, 'test-openid')).rejects.toThrow('剩余 3 座，无法容纳 4 位')
  expect(db.create).not.toHaveBeenCalled()
})

test('joinAttendance: 存量记录无 seatCount 字段时按 1 座累加（向后兼容）', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({
      _id: 'post-1',
      communityId: 'community-1',
      sectionId: 'section-1',
      status: 'active',
    })
    .mockResolvedValueOnce({
      ...mockSection,
      widgets: [{ ...mockSection.widgets[1], capacity: 3 }],
    })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      { _id: 'a1', userId: 'u1', joinedAt: 't1' },   // 无 seatCount
      { _id: 'a2', userId: 'u2', joinedAt: 't2' },   // 无 seatCount
    ])

  // capacity=3, occupied=2（按 1 座兜底），seatCount=2 → 2+2>3 → 应抛错
  await expect(handleJoinAttendance({
    postId: 'post-1',
    widgetId: 'attendance-widget',
    seatCount: 2,
  } as any, 'test-openid')).rejects.toThrow('剩余 1 座，无法容纳 2 位')
})

test('joinAttendance: 非法 seatCount (0 / 负数 / 小数) 规范化为 ≥1 整数', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({
      _id: 'post-1',
      communityId: 'community-1',
      sectionId: 'section-1',
      status: 'active',
    })
    .mockResolvedValueOnce({
      ...mockSection,
      widgets: [{ ...mockSection.widgets[1], capacity: 5 }],
    })
    .mockResolvedValueOnce({ _id: 'test-openid', nickName: 'Tester', avatarUrl: 'avatar.png' })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      { _id: 'new-id', userId: 'test-openid', seatCount: 1, joinedAt: 'now' },
    ])
    .mockResolvedValueOnce([
      { _id: 'new-id', userId: 'test-openid', seatCount: 1, joinedAt: 'now' },
    ])
  ;(db.create as jest.Mock).mockResolvedValue('new-id')

  await handleJoinAttendance({
    postId: 'post-1',
    widgetId: 'attendance-widget',
    seatCount: 0,
  } as any, 'test-openid')

  expect(db.create).toHaveBeenCalledWith('post_attendance_members', expect.objectContaining({
    seatCount: 1,
  }))
})

test('joinAttendance: 并发超卖时回滚刚写入的记录', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({
      _id: 'post-1',
      communityId: 'community-1',
      sectionId: 'section-1',
      status: 'active',
    })
    .mockResolvedValueOnce({
      ...mockSection,
      widgets: [{ ...mockSection.widgets[1], capacity: 3 }],
    })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ _id: 'a1', userId: 'u1', seatCount: 1, joinedAt: 't1' }])  // pre-check 看到 1 座
    .mockResolvedValueOnce([                                                              // re-check 发现另一并发请求已写入超容
      { _id: 'a1', userId: 'u1', seatCount: 1, joinedAt: 't1' },
      { _id: 'race', userId: 'u2', seatCount: 2, joinedAt: 't2' },
      { _id: 'new-id', userId: 'test-openid', seatCount: 2, joinedAt: 'now' },
    ])
  ;(db.create as jest.Mock).mockResolvedValue('new-id')

  await expect(handleJoinAttendance({
    postId: 'post-1',
    widgetId: 'attendance-widget',
    seatCount: 2,
  } as any, 'test-openid')).rejects.toThrow('已满员')
  expect(db.removeById).toHaveBeenCalledWith('post_attendance_members', 'new-id')
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

test('create: note_blocks can be submitted by regular members', async () => {
  ;(db.query as jest.Mock).mockReset()
  ;(db.getById as jest.Mock).mockReset()
  ;(db.create as jest.Mock).mockReset()
  const sectionWithNoteBlocks = {
    ...mockSection,
    widgets: [
      ...mockSection.widgets,
      {
        widgetId: 'note-widget',
        type: 'note_blocks',
        label: '图文笔记',
        fieldKey: 'note',
        required: false,
        order: 4,
        showInList: false,
      },
    ],
  }
  const blocks = [
    { blockId: 'b1', type: 'text', text: '第50期作业：\n1. 诵读《大学》10遍 😊' },
    { blockId: 'b2', type: 'image', fileID: 'cloud://env/posts/note-1.jpg' },
  ]
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.getById as jest.Mock).mockResolvedValue(sectionWithNoteBlocks)
  ;(db.create as jest.Mock).mockResolvedValue('post-1')

  const result = await handleCreate({
    communityId: 'community-1',
    sectionId: 'section-1',
    content: {
      'title-widget': '课程笔记',
      'note-widget': blocks,
    },
  } as any, 'test-openid')

  expect(result.postId).toBe('post-1')
  expect(db.create).toHaveBeenCalledWith('posts', expect.objectContaining({
    content: {
      'title-widget': '课程笔记',
      'note-widget': blocks,
    },
  }))
})

test('create: note_blocks rejects invalid image fileID', async () => {
  ;(db.query as jest.Mock).mockReset()
  ;(db.getById as jest.Mock).mockReset()
  ;(db.create as jest.Mock).mockReset()
  const sectionWithNoteBlocks = {
    ...mockSection,
    widgets: [
      ...mockSection.widgets,
      {
        widgetId: 'note-widget',
        type: 'note_blocks',
        label: '图文笔记',
        fieldKey: 'note',
        required: false,
        order: 4,
        showInList: false,
      },
    ],
  }
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.getById as jest.Mock).mockResolvedValue(sectionWithNoteBlocks)

  await expect(handleCreate({
    communityId: 'community-1',
    sectionId: 'section-1',
    content: {
      'title-widget': '课程笔记',
      'note-widget': [
        { blockId: 'b1', type: 'image', fileID: 'https://cdn.example.com/note-1.jpg' },
      ],
    },
  } as any, 'test-openid')).rejects.toThrow('cloud://')
  expect(db.create).not.toHaveBeenCalled()
})

test.each([
  ['empty blockId', { blockId: '', type: 'text', text: 'hello' }],
  ['unknown block type', { blockId: 'b1', type: 'link', url: 'https://example.com' }],
])('create: note_blocks rejects %s', async (_caseName, invalidBlock) => {
  ;(db.query as jest.Mock).mockReset()
  ;(db.getById as jest.Mock).mockReset()
  ;(db.create as jest.Mock).mockReset()
  const sectionWithNoteBlocks = {
    ...mockSection,
    widgets: [
      ...mockSection.widgets,
      {
        widgetId: 'note-widget',
        type: 'note_blocks',
        label: '图文笔记',
        fieldKey: 'note',
        required: false,
        order: 4,
        showInList: false,
      },
    ],
  }
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.getById as jest.Mock).mockResolvedValue(sectionWithNoteBlocks)

  await expect(handleCreate({
    communityId: 'community-1',
    sectionId: 'section-1',
    content: {
      'title-widget': '课程笔记',
      'note-widget': [invalidBlock],
    },
  } as any, 'test-openid')).rejects.toThrow()
  expect(db.create).not.toHaveBeenCalled()
})

test('create: rich_note can be submitted by regular members', async () => {
  ;(db.query as jest.Mock).mockReset()
  ;(db.getById as jest.Mock).mockReset()
  ;(db.create as jest.Mock).mockReset()
  const sectionWithRichNote = {
    ...mockSection,
    widgets: [
      ...mockSection.widgets,
      {
        widgetId: 'rich-note-widget',
        type: 'rich_note',
        label: '富图文',
        fieldKey: 'richNote',
        required: false,
        order: 4,
        showInList: false,
      },
    ],
  }
  const richNote = {
    format: 'markdown',
    markdown: '**Hello 😊**\n\n![图片](cloud://env/posts/rich-1.jpg)',
    html: '<p><strong>Hello 😊</strong></p><p><img src="cloud://env/posts/rich-1.jpg"></p>',
    text: 'Hello 😊',
    imageFileIDs: ['cloud://env/posts/rich-1.jpg'],
    schemaVersion: 1,
  }
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.getById as jest.Mock).mockResolvedValue(sectionWithRichNote)
  ;(db.create as jest.Mock).mockResolvedValue('post-rich-note')

  const result = await handleCreate({
    communityId: 'community-1',
    sectionId: 'section-1',
    content: {
      'title-widget': '课程笔记',
      'rich-note-widget': richNote,
    },
  } as any, 'test-openid')

  expect(result.postId).toBe('post-rich-note')
  expect(db.create).toHaveBeenCalledWith('posts', expect.objectContaining({
    content: {
      'title-widget': '课程笔记',
      'rich-note-widget': richNote,
    },
  }))
})

test.each([
  ['non-object value', 'plain text'],
  ['missing format', { markdown: 'bad', html: '<p>bad</p>', text: 'bad', imageFileIDs: [], schemaVersion: 1 }],
  ['script tag', { format: 'markdown', markdown: '<script>alert(1)</script>', html: '<p>bad</p>', text: 'bad', imageFileIDs: [], schemaVersion: 1 }],
  ['event handler attribute', { format: 'markdown', markdown: 'bad', html: '<p onclick="alert(1)">bad</p>', text: 'bad', imageFileIDs: [], schemaVersion: 1 }],
  ['iframe tag', { format: 'markdown', markdown: 'bad', html: '<iframe src="https://example.com"></iframe>', text: 'bad', imageFileIDs: [], schemaVersion: 1 }],
  ['external image fileID', { format: 'markdown', markdown: 'bad', html: '<p>bad</p>', text: 'bad', imageFileIDs: ['https://cdn.example.com/bad.jpg'], schemaVersion: 1 }],
  ['external markdown image', { format: 'markdown', markdown: '![x](https://cdn.example.com/bad.jpg)', html: '<p>bad</p>', text: 'bad', imageFileIDs: [], schemaVersion: 1 }],
])('create: rich_note rejects %s', async (_caseName, invalidRichNote) => {
  ;(db.query as jest.Mock).mockReset()
  ;(db.getById as jest.Mock).mockReset()
  ;(db.create as jest.Mock).mockReset()
  const sectionWithRichNote = {
    ...mockSection,
    widgets: [
      ...mockSection.widgets,
      {
        widgetId: 'rich-note-widget',
        type: 'rich_note',
        label: '富图文',
        fieldKey: 'richNote',
        required: false,
        order: 4,
        showInList: false,
      },
    ],
  }
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.getById as jest.Mock).mockResolvedValue(sectionWithRichNote)

  await expect(handleCreate({
    communityId: 'community-1',
    sectionId: 'section-1',
    content: {
      'title-widget': '课程笔记',
      'rich-note-widget': invalidRichNote,
    },
  } as any, 'test-openid')).rejects.toThrow()
  expect(db.create).not.toHaveBeenCalled()
})

test('create: required rich_note rejects empty editor content', async () => {
  ;(db.query as jest.Mock).mockReset()
  ;(db.getById as jest.Mock).mockReset()
  ;(db.create as jest.Mock).mockReset()
  const sectionWithRequiredRichNote = {
    ...mockSection,
    widgets: [
      ...mockSection.widgets,
      {
        widgetId: 'rich-note-widget',
        type: 'rich_note',
        label: '富图文',
        fieldKey: 'richNote',
        required: true,
        order: 4,
        showInList: false,
      },
    ],
  }
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.getById as jest.Mock).mockResolvedValue(sectionWithRequiredRichNote)

  await expect(handleCreate({
    communityId: 'community-1',
    sectionId: 'section-1',
    content: {
      'title-widget': '课程笔记',
      'rich-note-widget': { format: 'markdown', markdown: '', html: '<p><br></p>', text: '', imageFileIDs: [], schemaVersion: 1 },
    },
  } as any, 'test-openid')).rejects.toThrow()
  expect(db.create).not.toHaveBeenCalled()
})
