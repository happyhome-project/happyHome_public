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
  replaceValue: jest.fn((value) => ({ __set: value })),
  removeField: jest.fn(() => ({ __remove: true })),
}))

jest.mock('../../../lib/post-search', () => ({
  refreshPostSearchIndexById: jest.fn(),
  removePostSearchIndex: jest.fn(),
  searchPostIndex: jest.fn(),
}))

import {
  handleBootstrap,
  handleCreate,
  handleClientLog,
  handleDelete,
  handleGet,
  handleHome,
  handleJoinAttendance,
  handleListAttendanceMembers,
  handleList,
  handleSearch,
  handleUpdate,
} from '../index'
import * as db from '../../../lib/db'
import * as postSearch from '../../../lib/post-search'
import { DEFAULT_GUEST_INTRO_CONFIG, GUEST_INTRO_CONFIG_KEY } from '../../../shared/guest-intro-config'

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.DEFAULT_PUBLIC_COMMUNITY_ID
  delete process.env.PUBLIC_READ_COMMUNITY_IDS
})

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
  expect(postSearch.refreshPostSearchIndexById).toHaveBeenCalledWith('post-1')
})

test('create: rejects sections that do not belong to the requested community', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.getById as jest.Mock).mockResolvedValueOnce({
    ...mockSection,
    communityId: 'other-community',
  })

  await expect(handleCreate({
    communityId: 'community-1',
    sectionId: 'section-1',
    content: { 'title-widget': '跨社区发帖' },
  } as any, 'test-openid')).rejects.toThrow('板块不属于当前社区')
  expect(db.create).not.toHaveBeenCalled()
  expect(postSearch.refreshPostSearchIndexById).not.toHaveBeenCalled()
})

test('create: 旧图文攻略板块补齐驾车到达用时并按必填校验', async () => {
  const oldGuideSection = {
    ...mockSection,
    type: 'evergreen',
    displayTemplate: 'guide_note',
    widgets: [
      { widgetId: 'guide_title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true, locked: true },
      { widgetId: 'guide_images', type: 'image_group', label: '封面/图片', fieldKey: 'images', required: true, order: 1, showInList: false, locked: true },
      { widgetId: 'guide_body', type: 'rich_note', label: '正文', fieldKey: 'body', required: false, order: 2, showInList: false, locked: true },
      { widgetId: 'guide_location', type: 'location', label: '线路轨迹/地点', fieldKey: 'location', required: false, order: 3, showInList: false, locked: true },
    ],
  }
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.getById as jest.Mock).mockResolvedValue(oldGuideSection)

  await expect(handleCreate({
    communityId: 'community-1',
    sectionId: 'section-1',
    content: {
      guide_title: '太平水库亲子游',
      guide_images: ['cloud://env/posts/cover.jpg'],
    },
  } as any, 'test-openid')).rejects.toThrow('必填项未填写：驾车到达用时')
  expect(db.create).not.toHaveBeenCalled()

  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.getById as jest.Mock).mockResolvedValue(oldGuideSection)

  await expect(handleCreate({
    communityId: 'community-1',
    sectionId: 'section-1',
    content: {
      guide_title: '太平水库亲子游',
      guide_images: ['cloud://env/posts/cover.jpg'],
      guide_drive_duration: '青山村约35分钟到达水库入口',
    },
  } as any, 'test-openid')).rejects.toThrow('必填项未填写：目的地位置')
  expect(db.create).not.toHaveBeenCalled()
})

test('create: 图文攻略正文不允许提交富图文图片', async () => {
  const guideSection = {
    ...mockSection,
    type: 'evergreen',
    displayTemplate: 'guide_note',
    widgets: [
      { widgetId: 'guide_title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true, locked: true },
      { widgetId: 'guide_images', type: 'image_group', label: '封面/图片', fieldKey: 'images', required: true, order: 1, showInList: false, locked: true },
      { widgetId: 'guide_drive_duration', type: 'short_text', label: '驾车到达用时', fieldKey: 'driveDuration', required: true, order: 6, showInList: false, locked: true },
      { widgetId: 'guide_body', type: 'rich_note', label: '正文', fieldKey: 'body', required: false, order: 7, showInList: false, locked: true },
      { widgetId: 'guide_location', type: 'location', label: '目的地位置', fieldKey: 'location', required: true, order: 8, showInList: false, locked: true },
    ],
  }
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.getById as jest.Mock).mockResolvedValue(guideSection)

  await expect(handleCreate({
    communityId: 'community-1',
    sectionId: 'section-1',
    content: {
      guide_title: '太平水库亲子游',
      guide_images: ['cloud://env/posts/cover.jpg'],
      guide_drive_duration: '青山村约35分钟到达水库入口',
      guide_location: { address: '太平水库', lat: 30.1, lng: 104.1 },
      guide_body: {
        format: 'markdown',
        markdown: '第一段\n\n![图片](cloud://env/posts/body.jpg)\n\n第二段',
        html: '<p>第一段</p><p><img src="cloud://env/posts/body.jpg"></p><p>第二段</p>',
        text: '第一段 第二段',
        imageFileIDs: ['cloud://env/posts/body.jpg'],
        schemaVersion: 1,
      },
    },
  } as any, 'test-openid')).rejects.toThrow('图文攻略正文不支持插入图片')
  expect(db.create).not.toHaveBeenCalled()
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
    pendingContent: { __set: { 'title-widget': '更新后的标题' } },
    pendingAuditStatus: 'pending',
  }))
  expect(postSearch.refreshPostSearchIndexById).toHaveBeenCalledWith('post-1')
})

test('home: returns sections and grouped posts with one membership check', async () => {
  const sections = [
    {
      ...mockSection,
      _id: 'section-1',
      communityId: 'community-1',
      name: '活动',
      widgets: [mockSection.widgets[0]],
    },
    {
      ...mockSection,
      _id: 'section-2',
      communityId: 'community-1',
      name: '档案',
      type: 'evergreen',
      order: 2,
      widgets: [mockSection.widgets[0]],
    },
  ]
  const posts = [
    {
      _id: 'post-2',
      communityId: 'community-1',
      sectionId: 'section-2',
      authorId: 'user-2',
      status: 'active',
      content: { 'title-widget': '档案 B' },
      createdAt: '2024-01-02T00:00:00.000Z',
    },
    {
      _id: 'post-1',
      communityId: 'community-1',
      sectionId: 'section-1',
      authorId: 'user-1',
      status: 'active',
      content: { 'title-widget': '活动 A' },
      createdAt: '2024-01-01T00:00:00.000Z',
    },
  ]
  ;(db.query as jest.Mock).mockImplementation(async (collectionName: string, where: any) => {
    if (collectionName === 'community_members') return [{ _id: 'member-1', status: 'active' }]
    if (collectionName === 'sections') return sections
    if (collectionName === 'posts') return posts.filter((post) => post.sectionId === where.sectionId)
    return []
  })
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'users') return { _id: id, nickName: id === 'user-1' ? '一号' : '二号' }
    return null
  })

  const result = await handleHome({ communityId: 'community-1', limitPerSection: 10 }, 'test-openid')

  expect(result.sections.map((section: any) => section._id)).toEqual(['section-1', 'section-2'])
  expect(Object.keys(result.postsBySection).sort()).toEqual(['section-1', 'section-2'])
  expect(result.postsBySection['section-1'][0]).toEqual(expect.objectContaining({
    _id: 'post-1',
    authorNickname: '一号',
  }))
  expect(result.postsBySection['section-2'][0]).toEqual(expect.objectContaining({
    _id: 'post-2',
    authorNickname: '二号',
  }))
  expect((db.query as jest.Mock).mock.calls.filter(([collection]) => collection === 'community_members')).toHaveLength(1)
  expect((db.query as jest.Mock).mock.calls.filter(([collection]) => collection === 'posts')).toHaveLength(2)
  expect((db.query as jest.Mock).mock.calls.filter(([collection]) => collection === 'posts').map(([, where]) => where.sectionId).sort())
    .toEqual(['section-1', 'section-2'])
})

test('home: uses real author avatars first and fills missing avatars from the simulated pool', async () => {
  const sections = [
    {
      ...mockSection,
      _id: 'section-1',
      communityId: 'community-1',
      widgets: [mockSection.widgets[0]],
    },
  ]
  const posts = [
    {
      _id: 'post-with-real-avatar',
      communityId: 'community-1',
      sectionId: 'section-1',
      authorId: 'user-real',
      status: 'active',
      content: { 'title-widget': 'real avatar post' },
      createdAt: '2024-01-02T00:00:00.000Z',
    },
    {
      _id: 'post-needs-sim-avatar',
      communityId: 'community-1',
      sectionId: 'section-1',
      authorId: 'user-sim',
      status: 'active',
      content: { 'title-widget': 'sim avatar post' },
      createdAt: '2024-01-01T00:00:00.000Z',
    },
  ]
  ;(db.query as jest.Mock).mockImplementation(async (collectionName: string, where: any) => {
    if (collectionName === 'community_members') return [{ _id: 'member-1', status: 'active' }]
    if (collectionName === 'sections') return sections
    if (collectionName === 'posts') return posts.filter((post) => post.sectionId === where.sectionId)
    return []
  })
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'users' && id === 'user-real') return { _id: id, nickName: '真实邻居', avatarUrl: 'https://cdn.example.com/real.png' }
    if (collectionName === 'users' && id === 'user-sim') return { _id: id, nickName: 'AI整理员', avatarUrl: '' }
    return null
  })

  const result = await handleHome({ communityId: 'community-1', limitPerSection: 10 }, 'test-openid')
  const [realPost, simulatedPost] = result.postsBySection['section-1']

  expect(realPost.authorAvatarUrl).toBe('https://cdn.example.com/real.png')
  expect(simulatedPost.authorAvatarUrl).toMatch(/^\/static\/ai-avatars\/avatar-\d{2}\.svg$/)

  const secondResult = await handleHome({ communityId: 'community-1', limitPerSection: 10 }, 'test-openid')
  expect(secondResult.postsBySection['section-1'][1].authorAvatarUrl).toBe(simulatedPost.authorAvatarUrl)
})

test('bootstrap: returns active communities and the selected community home snapshot in one call', async () => {
  const sections = [
    {
      ...mockSection,
      _id: 'section-1',
      communityId: 'community-1',
      widgets: [mockSection.widgets[0]],
    },
  ]
  const posts = [
    {
      _id: 'post-1',
      communityId: 'community-1',
      sectionId: 'section-1',
      authorId: 'user-1',
      status: 'active',
      auditStatus: 'pass',
      content: { 'title-widget': '活动 A' },
      createdAt: '2024-01-01T00:00:00.000Z',
    },
  ]
  ;(db.query as jest.Mock).mockImplementation(async (collectionName: string, where: any) => {
    if (collectionName === 'community_members' && where.userId === 'test-openid') {
      return [
        { _id: 'member-1', communityId: 'community-1', userId: 'test-openid', status: 'active', joinedAt: '2024-01-02T00:00:00.000Z' },
        { _id: 'member-2', communityId: 'disabled-community', userId: 'test-openid', status: 'active', joinedAt: '2024-01-01T00:00:00.000Z' },
      ]
    }
    if (collectionName === 'community_members' && where.communityId === 'community-1') return [{ _id: 'member-1', status: 'active' }]
    if (collectionName === 'sections') return sections
    if (collectionName === 'posts') return posts.filter((post) => post.sectionId === where.sectionId)
    return []
  })
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'communities' && id === 'community-1') return { _id: 'community-1', name: '青山村', status: 'active' }
    if (collectionName === 'communities' && id === 'disabled-community') return { _id: 'disabled-community', name: '旧社区', status: 'disabled' }
    if (collectionName === 'users' && id === 'test-openid') return {
      _id: 'test-openid',
      nickName: '测试用户',
      role: 'user',
      backgroundFetchToken: 'hhpf_existing',
      backgroundFetchTokenExpiresAt: '2999-01-01T00:00:00.000Z',
    }
    if (collectionName === 'users' && id === 'user-1') return { _id: 'user-1', nickName: '作者一' }
    return null
  })

  const result = await handleBootstrap({ currentCommunityId: 'community-1', limitPerSection: 10 }, 'test-openid')

  expect(result.schemaVersion).toBe(1)
  expect(result.viewerOpenId).toBe('test-openid')
  expect(result.backgroundFetchToken).toBe('hhpf_existing')
  expect(result.communities.map((community: any) => community._id)).toEqual(['community-1'])
  expect(result.currentCommunityId).toBe('community-1')
  expect(result.sections.map((section: any) => section._id)).toEqual(['section-1'])
  expect(result.postsBySection['section-1'][0]).toEqual(expect.objectContaining({
    _id: 'post-1',
    authorNickname: '作者一',
  }))
  expect(db.updateById).toHaveBeenCalledWith('users', 'test-openid', expect.objectContaining({
    lastHomeCommunityId: 'community-1',
    lastHomeCommunityAt: expect.any(String),
  }))
})

test('bootstrap: unauthenticated viewer lands on the configured public community', async () => {
  ;(db.getById as jest.Mock).mockReset()
  ;(db.query as jest.Mock).mockReset()
  process.env.DEFAULT_PUBLIC_COMMUNITY_ID = 'public-community'
  process.env.PUBLIC_READ_COMMUNITY_IDS = 'public-community'
  const publicCommunity = { _id: 'public-community', name: '阳光花园小区', status: 'active' }
  const sections = [{
    ...mockSection,
    _id: 'public-section',
    communityId: 'public-community',
    widgets: [mockSection.widgets[0]],
  }]
  const posts = [{
    _id: 'public-post',
    communityId: 'public-community',
    sectionId: 'public-section',
    authorId: 'author-1',
    status: 'active',
    auditStatus: 'pass',
    content: { 'title-widget': '公开帖子' },
    createdAt: '2024-01-01T00:00:00.000Z',
  }]

  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'communities' && id === 'public-community') return publicCommunity
    if (collectionName === 'users' && id === 'author-1') return { _id: 'author-1', nickName: '作者一' }
    return null
  })
  ;(db.query as jest.Mock).mockImplementation(async (collectionName: string, where: any) => {
    if (collectionName === 'app_configs') {
      return [{
        _id: 'intro-1',
        key: GUEST_INTRO_CONFIG_KEY,
        ...DEFAULT_GUEST_INTRO_CONFIG,
        title: '样板弹窗标题',
      }]
    }
    if (collectionName === 'sections') return sections
    if (collectionName === 'posts') return posts.filter((post) => post.sectionId === where.sectionId)
    return []
  })

  const result = await handleBootstrap({ limitPerSection: 10 }, '')

  expect(result.viewerOpenId).toBe('')
  expect(result.currentCommunityId).toBe('public-community')
  expect((result as any).currentCommunity).toEqual(expect.objectContaining(publicCommunity))
  expect(result.communities).toEqual([])
  expect(result.sections.map((section: any) => section._id)).toEqual(['public-section'])
  expect(result.postsBySection['public-section'][0]).toEqual(expect.objectContaining({
    _id: 'public-post',
    authorNickname: '作者一',
  }))
  expect(result.backgroundFetchToken).toBe('')
  expect((result as any).guestIntroConfig).toEqual(expect.objectContaining({
    title: '样板弹窗标题',
    secondaryActionText: '登录后加入或创建社群',
  }))
  expect((db.query as jest.Mock).mock.calls.some(([collection]) => collection === 'community_members')).toBe(false)
})

test('bootstrap: guest mode ignores WeChat injected openid and returns guest public snapshot', async () => {
  ;(db.getById as jest.Mock).mockReset()
  ;(db.query as jest.Mock).mockReset()
  process.env.DEFAULT_PUBLIC_COMMUNITY_ID = 'public-community'
  process.env.PUBLIC_READ_COMMUNITY_IDS = 'public-community'
  const publicCommunity = { _id: 'public-community', name: '阳光花园小区', status: 'active' }
  const sections = [{
    ...mockSection,
    _id: 'public-section',
    communityId: 'public-community',
  }]
  const posts = [{
    _id: 'public-post',
    communityId: 'public-community',
    sectionId: 'public-section',
    authorId: 'author-1',
    status: 'active',
    auditStatus: 'pass',
    content: { 'title-widget': '公开活动' },
    createdAt: '2024-01-01T00:00:00.000Z',
  }]

  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'communities' && id === 'public-community') return publicCommunity
    return null
  })
  ;(db.query as jest.Mock).mockImplementation(async (collectionName: string, where: any) => {
    if (collectionName === 'sections') return sections
    if (collectionName === 'posts') return posts.filter((post) => post.sectionId === where.sectionId)
    if (collectionName === 'post_attendance_members') {
      return [{ _id: 'a1', postId: 'public-post', widgetId: 'attendance-widget', userId: 'attendee-1', seatCount: 1 }]
    }
    if (collectionName === 'community_members' && where.userId === 'wx-injected-openid') {
      return [{ _id: 'member-1', communityId: 'private-community', status: 'active' }]
    }
    return []
  })

  const result = await handleBootstrap({ asGuest: true, limitPerSection: 10 } as any, 'wx-injected-openid')

  expect(result.viewerOpenId).toBe('')
  expect(result.currentCommunityId).toBe('public-community')
  expect(result.communities).toEqual([])
  const publicPost: any = result.postsBySection['public-section'][0]
  expect(publicPost.attendanceSummaryByWidget['attendance-widget'])
    .toEqual(expect.objectContaining({
      count: 1,
      occupiedSeats: 1,
      isJoined: false,
      previewUsers: [],
    }))
})

test('bootstrap: logged-in viewer with active communities does not get stuck on public community preference', async () => {
  ;(db.getById as jest.Mock).mockReset()
  ;(db.query as jest.Mock).mockReset()
  process.env.DEFAULT_PUBLIC_COMMUNITY_ID = 'public-community'
  process.env.PUBLIC_READ_COMMUNITY_IDS = 'public-community'
  const publicCommunity = { _id: 'public-community', name: '阳光花园小区', status: 'active' }
  const joinedCommunity = { _id: 'joined-community', name: '明士班', status: 'active' }
  const joinedSection = {
    ...mockSection,
    _id: 'joined-section',
    communityId: 'joined-community',
    widgets: [mockSection.widgets[0]],
  }

  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'users' && id === 'user-1') {
      return { _id: 'user-1', lastHomeCommunityId: 'public-community' }
    }
    if (collectionName === 'communities' && id === 'public-community') return publicCommunity
    if (collectionName === 'communities' && id === 'joined-community') return joinedCommunity
    return null
  })
  ;(db.query as jest.Mock).mockImplementation(async (collectionName: string, where: any) => {
    if (collectionName === 'community_members') {
      return [{ _id: 'member-1', communityId: 'joined-community', userId: 'user-1', status: 'active' }]
    }
    if (collectionName === 'sections' && where.communityId === 'joined-community') return [joinedSection]
    if (collectionName === 'posts') return []
    return []
  })

  const result = await handleBootstrap({ limitPerSection: 10 }, 'user-1')

  expect(result.currentCommunityId).toBe('joined-community')
  expect((result as any).currentCommunity).toEqual(expect.objectContaining(joinedCommunity))
  expect(result.communities.map((community: any) => community._id)).toEqual(['joined-community'])
  expect((result as any).guestIntroConfig).toBeUndefined()
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

test('list: unauthenticated viewer can read posts in an active public community', async () => {
  ;(db.getById as jest.Mock).mockReset()
  ;(db.query as jest.Mock).mockReset()
  process.env.PUBLIC_READ_COMMUNITY_IDS = 'community-1'
  const sectionWithoutAttendance = {
    ...mockSection,
    widgets: mockSection.widgets.filter((widget) => widget.type !== 'attendance'),
  }
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'sections' && id === 'section-1') return sectionWithoutAttendance
    if (collectionName === 'communities' && id === 'community-1') return { _id: 'community-1', status: 'active' }
    if (collectionName === 'users' && id === 'author-1') return { _id: 'author-1', nickName: '作者一' }
    return null
  })
  ;(db.query as jest.Mock).mockResolvedValueOnce([{
    _id: 'post-public',
    communityId: 'community-1',
    sectionId: 'section-1',
    authorId: 'author-1',
    status: 'active',
    auditStatus: 'pass',
    content: { 'title-widget': '公开内容' },
    createdAt: '2024-01-01T00:00:00.000Z',
  }])

  const result = await handleList({ sectionId: 'section-1' }, '')

  expect(result.posts.map((post: any) => post._id)).toEqual(['post-public'])
  expect((db.query as jest.Mock).mock.calls.some(([collection]) => collection === 'community_members')).toBe(false)
})

test('list: disabled public community is not readable by unauthenticated viewers', async () => {
  ;(db.getById as jest.Mock).mockReset()
  ;(db.query as jest.Mock).mockReset()
  process.env.PUBLIC_READ_COMMUNITY_IDS = 'community-1'
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'sections' && id === 'section-1') return mockSection
    if (collectionName === 'communities' && id === 'community-1') return { _id: 'community-1', status: 'disabled' }
    return null
  })
  ;(db.query as jest.Mock).mockResolvedValue([])

  await expect(handleList({ sectionId: 'section-1' }, '')).rejects.toThrow('需要先加入社区后查看内容')
})

test('list: guest mode does not use injected openid membership for private sections', async () => {
  ;(db.getById as jest.Mock).mockReset()
  ;(db.query as jest.Mock).mockReset()
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'sections' && id === 'section-1') return mockSection
    return null
  })
  ;(db.query as jest.Mock).mockImplementation(async (collectionName: string, where: any) => {
    if (collectionName === 'community_members' && where.userId === 'wx-injected-openid') {
      return [{ _id: 'member-1', communityId: 'community-1', status: 'active' }]
    }
    return []
  })

  await expect(handleList({ sectionId: 'section-1', asGuest: true } as any, 'wx-injected-openid'))
    .rejects.toThrow('需要先加入社区后查看内容')
})

test('list：板块内置顶帖优先，其余按发布时间倒序', async () => {
  ;(db.getById as jest.Mock).mockReset()
  ;(db.query as jest.Mock).mockReset()
  const sectionWithoutAttendance = {
    ...mockSection,
    widgets: mockSection.widgets.filter((widget) => widget.type !== 'attendance'),
  }
  ;(db.getById as jest.Mock).mockImplementation(async (_collectionName: string, id: string) => {
    if (id === 'section-1') return sectionWithoutAttendance
    if (id === 'author-1') return { _id: 'author-1', nickName: 'Author', avatarUrl: '' }
    return null
  })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
    .mockResolvedValueOnce([
      {
        _id: 'review-post',
        sectionId: 'section-1',
        communityId: 'community-1',
        authorId: 'author-1',
        status: 'active',
        auditStatus: 'review',
        createdAt: '2026-05-04T00:00:00.000Z',
        content: { 'title-widget': '待审核帖子' },
      },
      {
        _id: 'normal-new',
        sectionId: 'section-1',
        communityId: 'community-1',
        authorId: 'author-1',
        status: 'active',
        createdAt: '2026-05-03T00:00:00.000Z',
        content: { 'title-widget': '普通新帖' },
      },
      {
        _id: 'pinned-old',
        sectionId: 'section-1',
        communityId: 'community-1',
        authorId: 'author-1',
        status: 'active',
        isPinned: true,
        pinnedAt: '2026-05-01T00:00:00.000Z',
        createdAt: '2026-05-01T00:00:00.000Z',
        content: { 'title-widget': '较早置顶帖' },
      },
      {
        _id: 'pinned-new',
        sectionId: 'section-1',
        communityId: 'community-1',
        authorId: 'author-1',
        status: 'active',
        isPinned: true,
        pinnedAt: '2026-05-02T00:00:00.000Z',
        createdAt: '2026-05-02T00:00:00.000Z',
        content: { 'title-widget': '较新置顶帖' },
      },
      {
        _id: 'normal-old',
        sectionId: 'section-1',
        communityId: 'community-1',
        authorId: 'author-1',
        status: 'active',
        createdAt: '2026-05-01T00:00:00.000Z',
        content: { 'title-widget': '普通旧帖' },
      },
    ])

  const result = await handleList({ sectionId: 'section-1' }, 'member-openid')

  expect(result.posts.map((post: any) => post._id)).toEqual([
    'pinned-new',
    'pinned-old',
    'normal-new',
    'normal-old',
  ])
})

test('delete: clears pin and featured flags', async () => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce({
    _id: 'post-flagged',
    authorId: 'test-openid',
    status: 'active',
    isPinned: true,
    isFeatured: true,
  })
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result = await handleDelete({ postId: 'post-flagged' }, 'test-openid')

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
  expect(postSearch.removePostSearchIndex).toHaveBeenCalledWith('post-flagged')
})

test('search: checks community readability and delegates to post search index', async () => {
  ;(postSearch.searchPostIndex as jest.Mock).mockResolvedValue({
    query: '鲲鹏',
    communityId: 'community-1',
    sectionId: '',
    total: 1,
    skip: 0,
    limit: 20,
    items: [{ postId: 'post-1', title: '视频帖' }],
  })
  ;(db.query as jest.Mock).mockResolvedValueOnce([
    { _id: 'member-1', communityId: 'community-1', userId: 'member-openid', status: 'active' },
  ])

  const result = await handleSearch({
    communityId: 'community-1',
    q: '鲲鹏',
    limit: 20,
  }, 'member-openid')

  expect(postSearch.searchPostIndex).toHaveBeenCalledWith({
    communityId: 'community-1',
    query: '鲲鹏',
    sectionId: '',
    skip: 0,
    limit: 20,
  })
  expect(result.items).toEqual([{ postId: 'post-1', title: '视频帖' }])
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

test('get: unauthenticated viewer can read post detail in an active public community', async () => {
  ;(db.getById as jest.Mock).mockReset()
  ;(db.query as jest.Mock).mockReset()
  process.env.PUBLIC_READ_COMMUNITY_IDS = 'community-1'
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'posts' && id === 'post-1') return {
      _id: 'post-1',
      communityId: 'community-1',
      sectionId: 'section-1',
      authorId: 'author-1',
      status: 'active',
      auditStatus: 'pass',
      content: { 'title-widget': '公开详情' },
      createdAt: '2024-01-01T00:00:00.000Z',
    }
    if (collectionName === 'communities' && id === 'community-1') return { _id: 'community-1', status: 'active' }
    if (collectionName === 'sections' && id === 'section-1') return {
      ...mockSection,
      widgets: mockSection.widgets.filter((widget) => widget.type !== 'attendance'),
    }
    if (collectionName === 'users' && id === 'author-1') return { _id: 'author-1', nickName: '作者一' }
    return null
  })

  const result = await handleGet({ postId: 'post-1' }, '')

  expect(result.post).toEqual(expect.objectContaining({
    _id: 'post-1',
    authorNickname: '作者一',
  }))
  expect((db.query as jest.Mock).mock.calls.some(([collection]) => collection === 'community_members')).toBe(false)
})

test('get: guest public detail returns attendance count without preview identities', async () => {
  ;(db.getById as jest.Mock).mockReset()
  ;(db.query as jest.Mock).mockReset()
  process.env.PUBLIC_READ_COMMUNITY_IDS = 'community-1'
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'posts' && id === 'post-1') return {
      _id: 'post-1',
      communityId: 'community-1',
      sectionId: 'section-1',
      authorId: 'author-1',
      status: 'active',
      auditStatus: 'pass',
      content: { 'title-widget': '公开活动详情' },
      createdAt: '2024-01-01T00:00:00.000Z',
    }
    if (collectionName === 'communities' && id === 'community-1') return { _id: 'community-1', status: 'active' }
    if (collectionName === 'sections' && id === 'section-1') return mockSection
    return null
  })
  ;(db.query as jest.Mock).mockImplementation(async (collectionName: string) => {
    if (collectionName === 'post_attendance_members') {
      return [{ _id: 'a1', postId: 'post-1', widgetId: 'attendance-widget', userId: 'attendee-1', seatCount: 2 }]
    }
    return []
  })

  const result = await handleGet({ postId: 'post-1', asGuest: true } as any, 'wx-injected-openid')
  const summary = result.post.attendanceSummaryByWidget['attendance-widget']

  expect(summary).toEqual(expect.objectContaining({
    count: 1,
    occupiedSeats: 2,
    isJoined: false,
    previewUsers: [],
  }))
  expect((db.getById as jest.Mock).mock.calls.some(([collection, id]) => collection === 'users' && id === 'attendee-1')).toBe(false)
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
