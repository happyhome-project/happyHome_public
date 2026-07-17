jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  getWXContext: jest.fn().mockReturnValue({ OPENID: 'test-openid' }),
  DYNAMIC_CURRENT_ENV: 'test',
}))

jest.mock('../../../lib/db', () => ({
  getById: jest.fn(),
  getByIds: jest.fn(async (collectionName: string, ids: string[]) => {
    const getById = require('../../../lib/db').getById as jest.Mock
    const values = await Promise.all(ids.map((id) => getById(collectionName, id).catch(() => null)))
    return values.filter(Boolean)
  }),
  create: jest.fn(),
  setById: jest.fn(),
  getByIdOrNull: jest.fn().mockResolvedValue(null),
  updateById: jest.fn(),
  updateWhere: jest.fn(),
  query: jest.fn(),
  queryAfterId: jest.fn(),
  queryBefore: jest.fn(),
  removeById: jest.fn(),
  softDelete: jest.fn(),
  replaceValue: jest.fn((value) => ({ __set: value })),
  removeField: jest.fn(() => ({ __remove: true })),
  runTransaction: jest.fn(async (callback) => callback({
    collection: (name: string) => ({
      doc: (id: string) => ({
        set: async ({ data }: any) => (require('../../../lib/db').setById)(name, id, data),
        update: async ({ data }: any) => (require('../../../lib/db').updateById)(name, id, data),
      }),
      add: async ({ data }: any) => ({ _id: await (require('../../../lib/db').create)(name, data) }),
    }),
  })),
  transactionGetByIdOrNull: jest.fn(async (_transaction, name, id) => (require('../../../lib/db').getById)(name, id)),
}))

jest.mock('../../../lib/post-rag-outbox', () => ({ appendPostRagOutboxEvent: jest.fn() }))

jest.mock('../../../lib/post-search', () => ({
  refreshPostSearchIndexById: jest.fn(),
  removePostSearchIndex: jest.fn(),
  searchPostIndex: jest.fn(),
}))

jest.mock('../../../lib/post-rag', () => ({
  enqueuePostRagJob: jest.fn(),
  enqueuePostRagDeleteJobInTransaction: jest.fn(),
  searchPostsWithRag: jest.fn(),
}))

jest.mock('../../../lib/post-semantic-search', () => ({
  createPostSemanticSearchServiceFromEnv: jest.fn(),
}))

import { createHmac } from 'crypto'
import {
  handleBootstrap,
  handleCreate,
  handleCreateCollaboration,
  handleClientLog,
  handleDelete,
  handleGet,
  handleGetActivityInviteState,
  handleHome,
  handleJoinAttendance,
  handleListAttendanceMembers,
  handleList,
  handleListCollaboration,
  handleListMyActivities,
  handleListMine,
  handleListArchive,
  handleListArchiveTabs,
  handleCreateActivityInvite,
  handleSearch,
  handleUpdate,
  main,
  resetPostSemanticSearchServiceForTests,
} from '../index'
import * as db from '../../../lib/db'
import * as postSearch from '../../../lib/post-search'
import * as postRag from '../../../lib/post-rag'
import * as postSemanticSearch from '../../../lib/post-semantic-search'
import { DEFAULT_GUEST_INTRO_CONFIG, GUEST_INTRO_CONFIG_KEY } from '../../../shared/guest-intro-config'
import { buildInitialCollaborationTemplates } from '../../../shared/collaboration-templates'

const POST_RAG_SMOKE_SECRET = 'r'.repeat(48)

const carpoolTemplate = {
  _id: 'collaboration-template-carpool',
  systemKey: 'carpool',
  name: '拼车出行',
  icon: '🚗',
  order: 0,
  status: 'active',
  enableComment: true,
  enableLike: true,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  widgets: [
    { widgetId: 'carpool_origin', type: 'short_text', label: '出发地', fieldKey: 'origin', required: true, order: 0, showInList: true },
    { widgetId: 'carpool_destination', type: 'short_text', label: '目的地', fieldKey: 'destination', required: true, order: 1, showInList: true },
    { widgetId: 'carpool_departure_time', type: 'datetime', label: '出发时间', fieldKey: 'departureTime', required: true, order: 2, showInList: true },
    { widgetId: 'carpool_location', type: 'location', label: '地图位置', fieldKey: 'location', required: true, order: 3, showInList: false },
    { widgetId: 'carpool_note', type: 'note_blocks', label: '补充说明', fieldKey: 'note', required: false, order: 4, showInList: false },
  ],
}
const activityInviteTemplate = buildInitialCollaborationTemplates().find((template) => template.systemKey === 'activity_invite')!

function createSignedPostRagSmokeIdentity(overrides: Partial<{
  version: number
  action: string
  communityId: string
  runId: string
  userId: string
  expiresAt: number
}> = {}) {
  const claims = {
    version: 1,
    action: 'search',
    communityId: 'community-1',
    runId: 'rag-run-1',
    userId: 'rag-smoke-user',
    expiresAt: Date.now() + 60_000,
    ...overrides,
  }
  return {
    ...claims,
    signature: createHmac('sha256', POST_RAG_SMOKE_SECRET)
      .update(JSON.stringify(claims), 'utf8')
      .digest('hex'),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  resetPostSemanticSearchServiceForTests()
  delete process.env.DEFAULT_PUBLIC_COMMUNITY_ID
  delete process.env.PUBLIC_READ_COMMUNITY_IDS
  delete process.env.POST_RAG_SMOKE_IDENTITY_SECRET
})

test('createCollaboration writes a community-owned post without sectionId and accepts optional note images', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string) => {
    if (collectionName === 'collaboration_templates') return carpoolTemplate
    if (collectionName === 'posts') return {
      _id: 'collaboration-post-1',
      communityId: 'community-1',
      area: 'collaboration',
      collaborationTemplateId: carpoolTemplate._id,
      collaborationSystemKey: 'carpool',
      authorId: 'test-openid',
      status: 'active',
      content: {},
    }
    return null
  })
  ;(db.create as jest.Mock).mockResolvedValue('collaboration-post-1')

  const result = await handleCreateCollaboration({
    communityId: 'community-1',
    collaborationTemplateId: carpoolTemplate._id,
    content: {
      carpool_origin: '青山村',
      carpool_destination: '成都软件园',
      carpool_departure_time: '2026-07-16T08:30:00.000Z',
      carpool_location: { address: '青山村东门', lat: 30.1, lng: 104.1 },
      carpool_note: [
        { blockId: 'text-1', type: 'text', text: '可带一人' },
        { blockId: 'image-1', type: 'image', fileID: 'cloud://env/posts/carpool-note.jpg' },
      ],
    },
  }, 'test-openid')

  expect(result.postId).toBe('collaboration-post-1')
  expect(db.create).toHaveBeenCalledWith('posts', expect.objectContaining({
    area: 'collaboration',
    communityId: 'community-1',
    collaborationTemplateId: carpoolTemplate._id,
    collaborationSystemKey: 'carpool',
  }))
  const stored = (db.create as jest.Mock).mock.calls.find(([collection]) => collection === 'posts')?.[1]
  expect(stored).not.toHaveProperty('sectionId')
  expect(stored.content.carpool_note).toHaveLength(2)
})

test('createCollaboration rejects disabled templates before writing', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.getById as jest.Mock).mockResolvedValueOnce({ ...carpoolTemplate, status: 'disabled' })

  await expect(handleCreateCollaboration({
    communityId: 'community-1',
    collaborationTemplateId: carpoolTemplate._id,
    content: {},
  }, 'test-openid')).rejects.toThrow('协作板块已停用')
  expect(db.create).not.toHaveBeenCalled()
})

test('listCollaboration is scoped by community and template without querying sections', async () => {
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'communities') return { _id: 'community-1', status: 'active' }
    if (collectionName === 'collaboration_templates' && id === carpoolTemplate._id) return carpoolTemplate
    if (collectionName === 'users') return { _id: id, nickName: '小明', avatarUrl: '' }
    return null
  })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
    .mockResolvedValueOnce([{ _id: 'post-1', communityId: 'community-1', area: 'collaboration', collaborationTemplateId: carpoolTemplate._id, authorId: 'user-1', status: 'active', auditStatus: 'pass', content: {}, createdAt: '2026-07-15T00:00:00.000Z' }])
    .mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])

  const result = await handleListCollaboration({
    communityId: 'community-1',
    collaborationTemplateId: carpoolTemplate._id,
  }, 'test-openid')

  expect(db.query).toHaveBeenCalledWith('posts', {
    communityId: 'community-1',
    area: 'collaboration',
    collaborationTemplateId: carpoolTemplate._id,
    status: 'active',
  }, { orderBy: ['createdAt', 'desc'] })
  expect((db.getById as jest.Mock).mock.calls.some(([collection]) => collection === 'sections')).toBe(false)
  expect(result.posts.map((post: any) => post._id)).toEqual(['post-1'])
})

test('get resolves a collaboration post through its global template without reading sections', async () => {
  const collaborationPost = {
    _id: 'collaboration-post-1',
    communityId: 'community-1',
    area: 'collaboration',
    collaborationTemplateId: carpoolTemplate._id,
    collaborationSystemKey: 'carpool',
    authorId: 'user-1',
    status: 'active',
    auditStatus: 'pass',
    content: { carpool_origin: '青山村' },
  }
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'posts') return collaborationPost
    if (collectionName === 'communities') return { _id: 'community-1', status: 'active' }
    if (collectionName === 'collaboration_templates') return carpoolTemplate
    if (collectionName === 'users') return { _id: id, nickName: '小明', avatarUrl: '' }
    return null
  })
  ;(db.query as jest.Mock).mockImplementation(async (collectionName: string) => {
    if (collectionName === 'community_members') return [{ _id: 'member-1', status: 'active' }]
    if (collectionName === 'post_attendance_members') return []
    return []
  })

  const result: any = await handleGet({ postId: collaborationPost._id }, 'user-1')

  expect(result.post._id).toBe(collaborationPost._id)
  expect(result.collaborationTemplate).toEqual(expect.objectContaining({ systemKey: 'carpool' }))
  expect((db.getById as jest.Mock).mock.calls.some(([collection]) => collection === 'sections')).toBe(false)
})

test('update validates a collaboration post against the global template without reading sections', async () => {
  const collaborationPost = {
    _id: 'collaboration-post-1',
    communityId: 'community-1',
    area: 'collaboration',
    collaborationTemplateId: carpoolTemplate._id,
    authorId: 'test-openid',
    status: 'active',
    auditStatus: 'review',
    content: {},
  }
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string) => {
    if (collectionName === 'posts') return collaborationPost
    if (collectionName === 'collaboration_templates') return carpoolTemplate
    return null
  })

  await handleUpdate({
    postId: collaborationPost._id,
    content: {
      carpool_origin: '青山村',
      carpool_destination: '成都软件园',
      carpool_departure_time: '2026-07-16T08:30:00.000Z',
      carpool_location: { address: '青山村东门', lat: 30.1, lng: 104.1 },
    },
  }, 'test-openid')

  expect(db.updateById).toHaveBeenCalledWith('posts', collaborationPost._id, expect.objectContaining({
    content: { __set: expect.objectContaining({ carpool_origin: '青山村' }) },
  }))
  expect((db.getById as jest.Mock).mock.calls.some(([collection]) => collection === 'sections')).toBe(false)
})

test('listMine: only returns the caller owned non-deleted posts newest first with display metadata', async () => {
  ;(db.queryAfterId as jest.Mock)
    .mockResolvedValueOnce([
      { _id: 'mine-old', authorId: 'author-1', communityId: 'community-1', sectionId: 'section-1', status: 'active', auditStatus: 'pass', content: { title: '旧帖' }, createdAt: '2026-07-10T08:00:00.000Z' },
      { _id: 'mine-new', authorId: 'author-1', communityId: 'community-2', sectionId: 'section-2', status: 'active', auditStatus: 'pending', content: { title: '新帖' }, createdAt: '2026-07-15T08:00:00.000Z' },
      { _id: 'mine-carpool', authorId: 'author-1', communityId: 'community-1', area: 'collaboration', collaborationTemplateId: carpoolTemplate._id, status: 'active', auditStatus: 'pass', content: { carpool_origin: '青山村' }, createdAt: '2026-07-16T08:00:00.000Z' },
      { _id: 'mine-deleted', authorId: 'author-1', communityId: 'community-1', sectionId: 'section-1', status: 'deleted', content: { title: '已删除' }, createdAt: '2026-07-14T08:00:00.000Z' },
    ])
    .mockResolvedValueOnce([])
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'communities') return { _id: id, name: id === 'community-1' ? '阳光花园' : '河畔社区' }
    if (collectionName === 'sections') return { _id: id, name: id === 'section-1' ? '通知公告' : '图文_new', displayTemplate: id === 'section-2' ? 'image_note' : 'default', widgets: [] }
    if (collectionName === 'collaboration_templates' && id === carpoolTemplate._id) return carpoolTemplate
    throw new Error('missing fixture')
  })

  const result = await handleListMine({ skip: 0, limit: 20 }, 'author-1')

  expect(db.queryAfterId).toHaveBeenNthCalledWith(1, 'posts', { authorId: 'author-1' }, null, 100)
  expect(result.posts.map((post: any) => post._id)).toEqual(['mine-carpool', 'mine-new', 'mine-old'])
  expect(result.posts[0]).toEqual(expect.objectContaining({
    communityName: '阳光花园',
    sectionName: '拼车出行',
    displayTemplate: 'default',
    collaborationTemplate: expect.objectContaining({ _id: carpoolTemplate._id, systemKey: 'carpool' }),
  }))
  expect(result.posts[1]).toEqual(expect.objectContaining({
    communityName: '河畔社区',
    sectionName: '图文_new',
    displayTemplate: 'image_note',
  }))
  expect(result).toEqual(expect.objectContaining({ total: 3, skip: 0, limit: 20, hasMore: false }))
})

test('listMine: requires an authenticated identity', async () => {
  await expect(handleListMine({}, '')).rejects.toThrow('Missing OPENID')
  expect(db.queryAfterId).not.toHaveBeenCalled()
})

test('listMine: resolves archive video metadata without degrading it to image-text', async () => {
  const previousQueryAfterId = (db.queryAfterId as jest.Mock).getMockImplementation()
  const previousGetById = (db.getById as jest.Mock).getMockImplementation()
  ;(db.queryAfterId as jest.Mock).mockReset()
  ;(db.getById as jest.Mock).mockReset()
  ;(db.queryAfterId as jest.Mock)
    .mockResolvedValueOnce([{
      _id: 'archive-video-1', authorId: 'author-1', communityId: 'community-1', area: 'archive',
      format: 'video', status: 'active', auditStatus: 'pass', content: { title: '家庭影像' },
      createdAt: '2026-07-17T08:00:00.000Z',
    }])
  ;(db.getById as jest.Mock).mockResolvedValueOnce({ _id: 'community-1', name: '阳光花园' })

  const result = await handleListMine({}, 'author-1')

  expect(result.posts[0]).toEqual(expect.objectContaining({
    format: 'video',
    sectionName: '视频',
    displayTemplate: 'video_note',
  }))
  ;(db.queryAfterId as jest.Mock).mockReset().mockImplementation(previousQueryAfterId)
  ;(db.getById as jest.Mock).mockReset().mockImplementation(previousGetById)
})

test('listMyActivities merges authored and joined collaboration posts, dedupes, and sorts newest first', async () => {
  ;(db.queryAfterId as jest.Mock).mockReset()
  const authored = {
    _id: 'authored-activity',
    authorId: 'user-1',
    communityId: 'community-1',
    area: 'collaboration',
    collaborationTemplateId: carpoolTemplate._id,
    status: 'active',
    auditStatus: 'review',
    createdAt: '2026-07-16T08:00:00.000Z',
    content: { carpool_origin: '青山村' },
  }
  const joined = {
    _id: 'joined-activity',
    authorId: 'user-2',
    communityId: 'community-1',
    area: 'collaboration',
    collaborationTemplateId: carpoolTemplate._id,
    status: 'active',
    auditStatus: 'pass',
    createdAt: '2026-07-17T08:00:00.000Z',
    content: { carpool_origin: '画匠村' },
  }
  ;(db.queryAfterId as jest.Mock)
    .mockResolvedValueOnce([
        authored,
        { _id: 'ordinary-post', authorId: 'user-1', area: 'archive', status: 'active' },
      ])
    .mockResolvedValueOnce([
        { _id: 'attendance-1', userId: 'user-1', postId: joined._id },
        { _id: 'attendance-2', userId: 'user-1', postId: authored._id },
      ])
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'posts') return id === joined._id ? joined : authored
    if (collectionName === 'communities') return { _id: id, name: '阳光花园' }
    if (collectionName === 'collaboration_templates') return carpoolTemplate
    throw new Error('missing fixture')
  })

  const result = await handleListMyActivities({ skip: 0, limit: 20 }, 'user-1')

  expect(result.posts.map((post: any) => post._id)).toEqual(['joined-activity', 'authored-activity'])
  expect(result.posts[0]).toEqual(expect.objectContaining({
    communityName: '阳光花园',
    sectionName: '拼车出行',
    collaborationTemplate: expect.objectContaining({ systemKey: 'carpool' }),
  }))
  expect(result).toEqual(expect.objectContaining({ total: 2, hasMore: false }))
})

test('listMyActivities excludes deleted or unapproved joined posts while retaining the author own pending activity', async () => {
  ;(db.queryAfterId as jest.Mock).mockReset()
  const ownPending = {
    _id: 'own-pending', authorId: 'user-1', communityId: 'community-1', area: 'collaboration',
    collaborationTemplateId: carpoolTemplate._id, status: 'active', auditStatus: 'pending',
    createdAt: '2026-07-17T08:00:00.000Z', content: {},
  }
  const joinedReview = {
    _id: 'joined-review', authorId: 'user-2', communityId: 'community-1', area: 'collaboration',
    collaborationTemplateId: carpoolTemplate._id, status: 'active', auditStatus: 'review',
    createdAt: '2026-07-18T08:00:00.000Z', content: {},
  }
  const joinedDeleted = { ...joinedReview, _id: 'joined-deleted', status: 'deleted', auditStatus: 'pass' }
  ;(db.queryAfterId as jest.Mock).mockImplementation(async (collectionName: string) => {
    if (collectionName === 'posts') return [ownPending]
    if (collectionName === 'post_attendance_members') return [
      { _id: 'a-1', postId: joinedReview._id, userId: 'user-1' },
      { _id: 'a-2', postId: joinedDeleted._id, userId: 'user-1' },
    ]
    return []
  })
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'posts') return id === joinedReview._id ? joinedReview : joinedDeleted
    if (collectionName === 'communities') return { _id: id, name: '阳光花园' }
    if (collectionName === 'collaboration_templates') return carpoolTemplate
    throw new Error('missing fixture')
  })

  const result = await handleListMyActivities({}, 'user-1')

  expect(result.posts.map((post: any) => post._id)).toEqual(['own-pending'])
})

test('listMyActivities requires an authenticated identity', async () => {
  await expect(handleListMyActivities({}, '')).rejects.toThrow('Missing OPENID')
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

test('create: 实时活动帖缺少首页标题来源时拒绝保存并给出清晰提示', async () => {
  const activityWithoutTitleSection = {
    ...mockSection,
    widgets: [
      {
        widgetId: 'attendance-widget',
        type: 'attendance',
        label: '羽毛球活动',
        fieldKey: 'attendance',
        required: false,
        order: 0,
        showInList: true,
      },
      {
        widgetId: 'location-widget',
        type: 'location',
        label: '地点',
        fieldKey: 'location',
        required: true,
        order: 1,
        showInList: false,
      },
      {
        widgetId: 'time-widget',
        type: 'datetime',
        label: '时间',
        fieldKey: 'time',
        required: true,
        order: 2,
        showInList: false,
      },
    ],
  }
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.getById as jest.Mock).mockResolvedValue(activityWithoutTitleSection)

  await expect(handleCreate({
    communityId: 'community-1',
    sectionId: 'section-1',
    content: {
      'location-widget': { name: '体育馆', address: '社区体育馆', lat: 30.1, lng: 104.1 },
      'time-widget': '2026-06-24T20:00:00.000Z',
    },
  } as any, 'test-openid')).rejects.toThrow('该板块缺少可用于首页标题的字段')
  expect(db.create).not.toHaveBeenCalled()
})

test('create: activity_invite 控件不会进入普通帖子内容', async () => {
  const sectionWithInviteWidget = {
    ...mockSection,
    type: 'evergreen',
    widgets: [
      mockSection.widgets[0],
      {
        widgetId: 'invite-widget',
        type: 'activity_invite',
        label: '活动召集',
        fieldKey: 'activityInvite',
        required: false,
        order: 4,
        showInList: false,
      },
    ],
  }
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.getById as jest.Mock).mockResolvedValue(sectionWithInviteWidget)
  ;(db.create as jest.Mock).mockResolvedValue('post-1')

  await handleCreate({
    communityId: 'community-1',
    sectionId: 'section-1',
    content: {
      'title-widget': '云盖村攻略',
      'invite-widget': 'should-be-removed',
    },
  } as any, 'test-openid')

  expect(db.create).toHaveBeenCalledWith('posts', expect.objectContaining({
    content: { 'title-widget': '云盖村攻略' },
  }))
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

test('update: archive image note updates content and normalized topics without loading a section', async () => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce({
    _id: 'archive-post-1',
    communityId: 'community-1',
    authorId: 'test-openid',
    status: 'active',
    auditStatus: 'pass',
    area: 'archive',
    format: 'image_text',
    topics: ['旧话题'],
    createdAt: '2026-07-15T01:00:00.000Z',
  })
  ;(db.query as jest.Mock).mockResolvedValue([])

  const result = await handleUpdate({
    postId: 'archive-post-1',
    topics: [' #新话题 ', 'ＮＥＷ', 'new'],
    content: {
      title: ' 更新后的图文 ',
      images: [' cloud://env/updated.jpg '],
      body: { format: 'markdown', markdown: '正文', html: '<p>正文</p>', text: '正文', imageFileIDs: [], schemaVersion: 1 },
    } as any,
  }, 'test-openid')

  expect(result.auditStatus).toBe('review')
  expect(db.getById).not.toHaveBeenCalledWith('sections', expect.anything())
  expect(db.updateById).toHaveBeenCalledWith('posts', 'archive-post-1', expect.objectContaining({
    pendingContent: { __set: expect.objectContaining({
      title: '更新后的图文',
      images: ['cloud://env/updated.jpg'],
    }) },
    pendingTopics: { __set: ['新话题', 'NEW'] },
  }))
  expect(db.updateById).not.toHaveBeenCalledWith('posts', 'archive-post-1', { topics: ['新话题', 'NEW'] })
})

test('createActivityInvite: 使用全局出游邀约模板创建无 section 关联帖子', async () => {
  const sourcePost = {
    _id: 'source-post-1',
    communityId: 'community-1',
    sectionId: 'guide-section-1',
    authorId: 'guide-author',
    status: 'active',
    auditStatus: 'pass',
    content: {
      guide_title: '云盖村亲子游',
      guide_location: { name: '云盖村', address: '云盖村游客中心', lat: 31.1, lng: 104.2 },
    },
    createdAt: '2026-06-01T00:00:00.000Z',
  }
  const sourceSection = {
    ...mockSection,
    _id: 'guide-section-1',
    type: 'evergreen',
    displayTemplate: 'guide_note',
    widgets: [
      { widgetId: 'guide_title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true, locked: true },
      { widgetId: 'guide_location', type: 'location', label: '目的地位置', fieldKey: 'location', required: true, order: 9, showInList: false, locked: true },
      { widgetId: 'guide_activity_invite', type: 'activity_invite', label: '活动召集', fieldKey: 'activityInvite', required: false, order: 10, showInList: false, locked: true },
    ],
  }
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'posts' && id === 'source-post-1') return sourcePost
    if (collectionName === 'posts' && id === 'activity-post-1') return {
      _id: 'activity-post-1',
      communityId: 'community-1',
      area: 'collaboration',
      collaborationTemplateId: activityInviteTemplate._id,
      authorId: 'test-openid',
      status: 'active',
      content: {},
    }
    if (collectionName === 'communities' && id === 'community-1') return { _id: 'community-1', status: 'active' }
    if (collectionName === 'sections' && id === 'guide-section-1') return sourceSection
    if (collectionName === 'collaboration_templates' && id === activityInviteTemplate._id) return activityInviteTemplate
    return null
  })
  ;(db.query as jest.Mock).mockImplementation(async (collectionName: string, where: any) => {
    if (collectionName === 'community_members') return [{ _id: 'member-1', status: 'active' }]
    if (collectionName === 'posts' && where.originPostId === 'source-post-1') return []
    return []
  })
  ;(db.create as jest.Mock).mockImplementation(async (collectionName: string) => {
    if (collectionName === 'posts') return 'activity-post-1'
    return 'audit-task-1'
  })

  const result = await handleCreateActivityInvite({
    sourcePostId: 'source-post-1',
    content: {
      activity_invite_title: '周六去云盖村',
      activity_invite_starts_at: '2026-07-01T01:30:00.000Z',
      activity_invite_location: { name: '云盖村', address: '云盖村游客中心', lat: 31.1, lng: 104.2 },
      activity_invite_contact: '13800000000',
      activity_invite_capacity: 6,
      activity_invite_note: [{ blockId: 'n1', type: 'text', text: '带娃轻徒步' }],
    },
  } as any, 'test-openid')

  expect(result).toEqual(expect.objectContaining({ postId: 'activity-post-1', alreadyExists: false }))
  expect((db.create as jest.Mock).mock.calls.some(([collection]) => collection === 'sections')).toBe(false)
  expect(db.create).toHaveBeenCalledWith('posts', expect.objectContaining({
    communityId: 'community-1',
    area: 'collaboration',
    collaborationTemplateId: activityInviteTemplate._id,
    collaborationSystemKey: 'activity_invite',
    authorId: 'test-openid',
    originPostId: 'source-post-1',
    originSectionId: 'guide-section-1',
    originCommunityId: 'community-1',
    originTitle: '云盖村亲子游',
    originLinkType: 'activity_invite',
    eventStartsAt: '2026-07-01T01:30:00.000Z',
    content: expect.objectContaining({
      activity_invite_title: '周六去云盖村',
      activity_invite_contact: '13800000000',
      activity_invite_capacity: 6,
    }),
  }))
  const stored = (db.create as jest.Mock).mock.calls.find(([collection]) => collection === 'posts')?.[1]
  expect(stored).not.toHaveProperty('sectionId')
  expect((db.create as jest.Mock).mock.calls.some(([collection]) => collection === 'post_attendance_members')).toBe(false)
})

test('createActivityInvite: 同一源帖存在未过期邀约时直接返回现有邀约', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({
      _id: 'source-post-1',
      communityId: 'community-1',
      sectionId: 'guide-section-1',
      status: 'active',
      auditStatus: 'pass',
      content: { guide_title: '云盖村亲子游' },
    })
    .mockResolvedValueOnce({
      ...mockSection,
      _id: 'guide-section-1',
      type: 'evergreen',
      displayTemplate: 'guide_note',
      widgets: [
        { widgetId: 'guide_title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true, locked: true },
        { widgetId: 'guide_activity_invite', type: 'activity_invite', label: '活动召集', fieldKey: 'activityInvite', required: false, order: 10, showInList: false, locked: true },
      ],
    })
  ;(db.query as jest.Mock).mockImplementation(async (collectionName: string, where: any) => {
    if (collectionName === 'community_members') return [{ _id: 'member-1', status: 'active' }]
    if (collectionName === 'posts' && where.originPostId === 'source-post-1') {
      return [{
        _id: 'existing-invite-1',
        status: 'active',
        auditStatus: 'review',
        eventStartsAt: '2999-01-01T00:00:00.000Z',
        content: { activity_invite_title: '已有邀约' },
      }]
    }
    return []
  })

  const result = await handleCreateActivityInvite({
    sourcePostId: 'source-post-1',
    content: {
      activity_invite_title: '重复发起',
      activity_invite_starts_at: '2026-07-01T01:30:00.000Z',
      activity_invite_contact: '13800000000',
      activity_invite_capacity: 6,
    },
  } as any, 'test-openid')

  expect(result).toEqual(expect.objectContaining({ postId: 'existing-invite-1', alreadyExists: true }))
  expect(db.create).not.toHaveBeenCalledWith('posts', expect.anything())
})

test('getActivityInviteState: 返回源帖预填信息和当前进行中邀约', async () => {
  const sourcePost = {
      _id: 'source-post-1',
      communityId: 'community-1',
      sectionId: 'guide-section-1',
      status: 'active',
      auditStatus: 'pass',
      content: {
        guide_title: '云盖村亲子游',
        guide_location: { name: '云盖村', address: '云盖村游客中心', lat: 31.1, lng: 104.2 },
      },
    }
  const sourceSection = {
      ...mockSection,
      _id: 'guide-section-1',
      type: 'evergreen',
      displayTemplate: 'guide_note',
      widgets: [
        { widgetId: 'guide_title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true, locked: true },
        { widgetId: 'guide_location', type: 'location', label: '目的地位置', fieldKey: 'location', required: true, order: 9, showInList: false, locked: true },
        { widgetId: 'guide_activity_invite', type: 'activity_invite', label: '活动召集', fieldKey: 'activityInvite', required: false, order: 10, showInList: false, locked: true },
      ],
    }
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'posts' && id === 'source-post-1') return sourcePost
    if (collectionName === 'communities' && id === 'community-1') return { _id: 'community-1', status: 'active' }
    if (collectionName === 'sections' && id === 'guide-section-1') return sourceSection
    if (collectionName === 'collaboration_templates' && id === activityInviteTemplate._id) return activityInviteTemplate
    if (collectionName === 'users') return { _id: id, nickName: '成员', avatarUrl: '' }
    return null
  })
  ;(db.query as jest.Mock).mockImplementation(async (collectionName: string, where: any) => {
    if (collectionName === 'community_members') return [{ _id: 'member-1', status: 'active' }]
    if (collectionName === 'posts' && where.originPostId === 'source-post-1') {
      return [{
        _id: 'existing-invite-1',
        status: 'active',
        auditStatus: 'pass',
        eventStartsAt: '2999-01-01T00:00:00.000Z',
        content: { activity_invite_title: '已有邀约', activity_invite_capacity: 6 },
      }]
    }
    if (collectionName === 'post_attendance_members') return [{ _id: 'a1', userId: 'u1', seatCount: 2 }]
    return []
  })

  const result = await handleGetActivityInviteState({ sourcePostId: 'source-post-1' } as any, 'test-openid')

  expect(result.prefill).toEqual(expect.objectContaining({
    title: '云盖村亲子游',
    location: { name: '云盖村', address: '云盖村游客中心', lat: 31.1, lng: 104.2 },
  }))
  expect(result.invite).toEqual(expect.objectContaining({
    postId: 'existing-invite-1',
    eventStartsAt: '2999-01-01T00:00:00.000Z',
    occupiedSeats: 2,
    capacity: 6,
  }))
  expect(result.targetSection).toEqual(expect.objectContaining({
    sectionId: '',
    collaborationTemplateId: activityInviteTemplate._id,
    systemKey: 'activity_invite',
  }))
  expect((db.query as jest.Mock).mock.calls.some(([collection]) => collection === 'sections')).toBe(false)
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
    if (collectionName === 'communities') return { _id: id, status: 'active' }
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
    if (collectionName === 'communities') return { _id: id, status: 'active' }
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
    secondaryActionText: '创建我自己的社群',
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
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'communities') return { _id: id, status: 'active' }
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

test('joinAttendance: attendance 可从当前帖子内容读取动态人数上限', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({
      _id: 'invite-post-1',
      communityId: 'community-1',
      sectionId: 'invite-section-1',
      status: 'active',
      content: {
        activity_invite_capacity: 3,
      },
    })
    .mockResolvedValueOnce({
      ...mockSection,
      _id: 'invite-section-1',
      widgets: [
        { ...mockSection.widgets[1], capacity: undefined, capacityWidgetId: 'activity_invite_capacity' },
      ],
    })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      { _id: 'a1', userId: 'u1', seatCount: 2, joinedAt: 't1' },
    ])

  await expect(handleJoinAttendance({
    postId: 'invite-post-1',
    widgetId: 'attendance-widget',
    seatCount: 2,
  } as any, 'test-openid')).rejects.toThrow('剩余 1 座，无法容纳 2 位')
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
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'communities') return { _id: id, status: 'active' }
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
    communityId: 'community-1',
    sectionId: 'section-1',
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
  expect(postRag.enqueuePostRagDeleteJobInTransaction).toHaveBeenCalledWith(expect.anything(), {
    postId: 'post-flagged',
    communityId: 'community-1',
    sectionId: 'section-1',
    reason: 'post.delete',
  })
  expect(postSearch.removePostSearchIndex).toHaveBeenCalledWith('post-flagged')
})

function mockSemanticResult(result: Record<string, unknown>) {
  const search = jest.fn().mockResolvedValue(result)
  ;(postSemanticSearch.createPostSemanticSearchServiceFromEnv as jest.Mock).mockReturnValue({ search })
  return search
}

test('delete: retries legacy cleanup for an authorized already-deleted post without repeating the v2 mutation', async () => {
  const post = {
    _id: 'post-retry',
    authorId: 'test-openid',
    status: 'active',
    communityId: 'community-1',
    sectionId: 'section-1',
  }
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce(post)
    .mockResolvedValueOnce({ ...post, status: 'deleted' })
  ;(db.updateById as jest.Mock).mockResolvedValue({})
  ;(postSearch.removePostSearchIndex as jest.Mock)
    .mockRejectedValueOnce(new Error('legacy search unavailable'))
    .mockResolvedValueOnce({ removedDocumentCount: 1 })

  await expect(handleDelete({ postId: 'post-retry' }, 'test-openid')).rejects.toThrow('legacy search unavailable')
  await expect(handleDelete({ postId: 'post-retry' }, 'test-openid')).resolves.toEqual({ success: true, alreadyDeleted: true })

  const { appendPostRagOutboxEvent } = require('../../../lib/post-rag-outbox')
  expect(appendPostRagOutboxEvent).toHaveBeenCalledTimes(1)
  expect(db.updateById).toHaveBeenCalledTimes(1)
  expect(postSearch.removePostSearchIndex).toHaveBeenCalledTimes(2)
})

test('search: checks community readability and delegates to formal RAG search', async () => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce({ _id: 'community-1', status: 'active' })
  const semanticSearch = mockSemanticResult({
    query: '鲲鹏',
    communityId: 'community-1',
    sectionId: '',
    total: 1,
    skip: 0,
    limit: 20,
    items: [{ postId: 'post-1', title: '视频帖' }],
  })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([
      { _id: 'member-1', communityId: 'community-1', userId: 'member-openid', status: 'active' },
    ])
    .mockResolvedValueOnce([
      { _id: 'member-1', communityId: 'community-1', userId: 'member-openid', status: 'active' },
    ])

  const result = await handleSearch({
    communityId: 'community-1',
    q: '鲲鹏',
    limit: 20,
  }, 'member-openid')

  expect(semanticSearch).toHaveBeenCalledWith(expect.objectContaining({
    communityId: 'community-1',
    query: '鲲鹏',
    sectionId: undefined,
    skip: 0,
    limit: 20,
    includeMemberOnly: true,
  }))
  expect(postSearch.searchPostIndex).not.toHaveBeenCalled()
  expect(postRag.searchPostsWithRag).not.toHaveBeenCalled()
  expect(result.mode).toBe('rag')
  expect(result.answer).toBe('')
  expect(result.citations).toEqual([])
  expect(result.items).toEqual([{ postId: 'post-1', title: '视频帖' }])
})

test('search: accepts a short-lived signed RAG smoke identity only for its fixture run and community', async () => {
  const cloud = require('wx-server-sdk')
  cloud.getWXContext.mockReturnValueOnce({ OPENID: '' })
  process.env.POST_RAG_SMOKE_IDENTITY_SECRET = POST_RAG_SMOKE_SECRET
  const identity = createSignedPostRagSmokeIdentity()

  ;(db.query as jest.Mock).mockImplementation(async (collection: string, where: Record<string, string>) => {
    if (
      collection === 'post_rag_smoke_runs'
      && where.runId === identity.runId
      && where.communityId === identity.communityId
      && where.userId === identity.userId
      && where.status === 'active'
    ) {
      return [{ ...where, expiresAt: identity.expiresAt }]
    }
    if (
      collection === 'community_members'
      && where.communityId === identity.communityId
      && where.userId === identity.userId
      && where.status === 'active'
    ) {
      return [{ _id: 'fixture-member', ...where }]
    }
    return []
  })
  const semanticSearch = mockSemanticResult({
    items: [{ postId: 'fixture-post', title: '朱子治家格言' }],
    query: '勤俭持家', communityId: identity.communityId, total: 1, skip: 0, limit: 20,
  })

  await expect(main({
    action: 'search',
    communityId: identity.communityId,
    q: '勤俭持家',
    __happyhomeSmokeIdentity: identity,
  })).resolves.toMatchObject({ mode: 'rag' })

  expect(db.query).toHaveBeenCalledWith('post_rag_smoke_runs', {
    runId: identity.runId,
    communityId: identity.communityId,
    userId: identity.userId,
    status: 'active',
  }, { limit: 1 })
  expect(semanticSearch).toHaveBeenCalledWith(expect.objectContaining({
    communityId: identity.communityId,
    query: '勤俭持家',
    includeMemberOnly: true,
  }))
})

test('search: smoke identity audit logs validation state without leaking signed claims', async () => {
  const cloud = require('wx-server-sdk')
  cloud.getWXContext.mockReturnValueOnce({ OPENID: '' })
  process.env.POST_RAG_SMOKE_IDENTITY_SECRET = POST_RAG_SMOKE_SECRET
  const identity = createSignedPostRagSmokeIdentity()
  const log = jest.spyOn(console, 'info').mockImplementation(() => undefined)

  ;(db.query as jest.Mock).mockImplementation(async (collection: string, where: Record<string, string>) => {
    if (collection === 'post_rag_smoke_runs' && where.runId === identity.runId) {
      return [{ ...where, expiresAt: identity.expiresAt }]
    }
    if (collection === 'community_members' && where.userId === identity.userId) {
      return [{ _id: 'fixture-member', ...where }]
    }
    return []
  })
  mockSemanticResult({ query: '勤俭持家', communityId: identity.communityId, total: 0, skip: 0, limit: 20, items: [] })

  await main({
    action: 'search',
    communityId: identity.communityId,
    q: '勤俭持家',
    __happyhomeSmokeIdentity: identity,
  })

  const audit = log.mock.calls.find(([label]) => label === '[post.rag.smoke.identity]')?.[1]
  expect(audit).toEqual(expect.stringContaining('"present":true'))
  expect(audit).toEqual(expect.stringContaining('"accepted":true'))
  expect(audit).not.toContain(POST_RAG_SMOKE_SECRET)
  expect(audit).not.toContain(identity.signature)
  expect(audit).not.toContain(identity.userId)
  expect(audit).not.toContain(identity.runId)
  expect(audit).not.toContain(identity.communityId)
  log.mockRestore()
})

test('search: smoke identity audit records an absent smoke identity', async () => {
  const cloud = require('wx-server-sdk')
  cloud.getWXContext.mockReturnValueOnce({ OPENID: '' })
  const log = jest.spyOn(console, 'info').mockImplementation(() => undefined)

  await expect(main({
    action: 'search',
    communityId: 'fixture-community',
    q: '勤俭持家',
    happyhomeSmokeAudit: true,
  })).rejects.toThrow('需要先加入社区后查看内容')

  const audit = log.mock.calls.find(([label]) => label === '[post.rag.smoke.identity]')?.[1]
  expect(audit).toEqual(expect.stringContaining('"present":false'))
  expect(audit).toEqual(expect.stringContaining('"accepted":false'))
  log.mockRestore()
})

test('search: rejects a fixture run whose expiry differs from the signed identity', async () => {
  const cloud = require('wx-server-sdk')
  cloud.getWXContext.mockReturnValueOnce({ OPENID: '' })
  process.env.POST_RAG_SMOKE_IDENTITY_SECRET = POST_RAG_SMOKE_SECRET
  const identity = createSignedPostRagSmokeIdentity()

  ;(db.query as jest.Mock).mockImplementation(async (collection: string, where: Record<string, string>) => {
    if (collection === 'post_rag_smoke_runs' && where.runId === identity.runId) {
      return [{ ...where, expiresAt: identity.expiresAt + 60_000 }]
    }
    if (collection === 'community_members' && where.userId === identity.userId) {
      return [{ _id: 'fixture-member', ...where }]
    }
    return []
  })

  await expect(main({
    action: 'search',
    communityId: identity.communityId,
    q: '勤俭持家',
    __happyhomeSmokeIdentity: identity,
  })).rejects.toThrow('Invalid RAG smoke identity')
})

test('search: public guest readers do not receive member-only RAG evidence', async () => {
  process.env.PUBLIC_READ_COMMUNITY_IDS = 'community-1'
  ;(db.getById as jest.Mock).mockResolvedValueOnce({ _id: 'community-1', status: 'active' })
  const semanticSearch = mockSemanticResult({
    query: '联系方式',
    communityId: 'community-1',
    sectionId: '',
    total: 0,
    skip: 0,
    limit: 20,
    items: [],
  })

  await handleSearch({
    communityId: 'community-1',
    q: '联系方式',
    asGuest: true,
  }, 'member-openid')

  expect(semanticSearch).toHaveBeenCalledWith(expect.objectContaining({
    communityId: 'community-1',
    query: '联系方式',
    includeMemberOnly: false,
  }))
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

test('get: author can open their own post while it is still under audit', async () => {
  ;(db.getById as jest.Mock).mockReset()
  ;(db.query as jest.Mock).mockReset()
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'posts' && id === 'pending-mine') return {
      _id: 'pending-mine', communityId: 'community-1', area: 'archive', format: 'text',
      authorId: 'author-1', status: 'active', auditStatus: 'review',
      content: { title: '待审核内容', body: { text: '正文' } },
      createdAt: '2026-07-15T01:00:00.000Z',
    }
    if (collectionName === 'communities') return { _id: id, status: 'active' }
    if (collectionName === 'users') return { _id: id, nickName: '作者一' }
    return null
  })
  ;(db.query as jest.Mock).mockResolvedValue([{ _id: 'member-1', status: 'active' }])

  const result = await handleGet({ postId: 'pending-mine' }, 'author-1')

  expect(result.post).toEqual(expect.objectContaining({ _id: 'pending-mine', auditStatus: 'review' }))
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

test('get: public guest detail masks member-only contact fields', async () => {
  ;(db.getById as jest.Mock).mockReset()
  ;(db.query as jest.Mock).mockReset()
  process.env.PUBLIC_READ_COMMUNITY_IDS = 'community-1'
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'posts' && id === 'invite-post-1') return {
      _id: 'invite-post-1',
      communityId: 'community-1',
      sectionId: 'invite-section-1',
      authorId: 'author-1',
      status: 'active',
      auditStatus: 'pass',
      content: {
        activity_invite_title: '周六去云盖村',
        activity_invite_contact: '13800000000',
      },
      createdAt: '2024-01-01T00:00:00.000Z',
    }
    if (collectionName === 'communities' && id === 'community-1') return { _id: 'community-1', status: 'active' }
    if (collectionName === 'sections' && id === 'invite-section-1') return {
      ...mockSection,
      _id: 'invite-section-1',
      widgets: [
        { widgetId: 'activity_invite_title', type: 'short_text', label: '邀约主题', fieldKey: 'title', required: true, order: 0, showInList: true },
        { widgetId: 'activity_invite_contact', type: 'short_text', label: '联系电话', fieldKey: 'contact', required: true, order: 3, showInList: false, visibility: 'member' },
      ],
    }
    if (collectionName === 'users' && id === 'author-1') return { _id: 'author-1', nickName: '作者一' }
    return null
  })

  const result = await handleGet({ postId: 'invite-post-1', asGuest: true } as any, 'wx-injected-openid')

  expect(result.post.content.activity_invite_title).toBe('周六去云盖村')
  expect(result.post.content.activity_invite_contact).toBe('')
  expect((db.query as jest.Mock).mock.calls.some(([collection]) => collection === 'community_members')).toBe(false)
})

test('get: admin-created posts use public admin identity instead of bound WeChat nickname', async () => {
  ;(db.getById as jest.Mock).mockReset()
  ;(db.query as jest.Mock).mockReset()
  process.env.PUBLIC_READ_COMMUNITY_IDS = 'community-1'
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'posts' && id === 'post-admin-created') return {
      _id: 'post-admin-created',
      communityId: 'community-1',
      sectionId: 'section-1',
      authorId: 'admin-openid',
      adminCreatedAt: '2026-06-24T09:53:23.529Z',
      adminCreatedByAccountId: 'admin-account',
      adminCreatedByUsername: 'admin',
      status: 'active',
      auditStatus: 'pass',
      content: { 'title-widget': '后台代发活动' },
      createdAt: '2026-06-24T09:53:23.529Z',
    }
    if (collectionName === 'communities' && id === 'community-1') return { _id: 'community-1', status: 'active' }
    if (collectionName === 'sections' && id === 'section-1') return {
      ...mockSection,
      widgets: mockSection.widgets.filter((widget) => widget.type !== 'attendance'),
    }
    if (collectionName === 'users' && id === 'admin-openid') return { _id: 'admin-openid', nickName: '一年' }
    return null
  })

  const result = await handleGet({ postId: 'post-admin-created' }, '')

  expect(result.post).toEqual(expect.objectContaining({
    _id: 'post-admin-created',
    authorNickname: '社区管理员',
  }))
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

const textNoteContent = {
  text_title: '山间随笔',
  text_body: { format: 'markdown', markdown: '今天很好。', html: '<p>今天很好。</p>', text: '今天很好。', imageFileIDs: [], schemaVersion: 1 },
}

function mockTextNoteSection() {
  return {
    ...mockSection,
    type: 'evergreen',
    displayTemplate: 'text_note',
    widgets: [
      { widgetId: 'text_title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 1, showInList: true, locked: true },
      { widgetId: 'text_body', type: 'rich_note', label: '正文', fieldKey: 'body', required: true, order: 2, showInList: false, locked: true },
    ],
  }
}

test.each(['paper', 'mint', 'slate', 'headline', 'quote', 'notice'])(
  'create: persists text note theme %s',
  async (theme) => {
    ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
    ;(db.getById as jest.Mock).mockResolvedValue(mockTextNoteSection())
    ;(db.create as jest.Mock).mockResolvedValue('post-text-note')
    await handleCreate({ communityId: 'community-1', sectionId: 'section-1', content: textNoteContent, presentation: { textNoteTheme: theme } } as any, 'test-openid')
    expect(db.create).toHaveBeenCalledWith('posts', expect.objectContaining({ content: textNoteContent, presentation: { textNoteTheme: theme } }))
  },
)

test('create: defaults missing text note theme to paper', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.getById as jest.Mock).mockResolvedValue(mockTextNoteSection())
  ;(db.create as jest.Mock).mockResolvedValue('post-text-note')
  await handleCreate({ communityId: 'community-1', sectionId: 'section-1', content: textNoteContent } as any, 'test-openid')
  expect(db.create).toHaveBeenCalledWith('posts', expect.objectContaining({ presentation: { textNoteTheme: 'paper' } }))
})

test('create: rejects an explicitly invalid text note theme', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.getById as jest.Mock).mockResolvedValue(mockTextNoteSection())
  await expect(handleCreate({ communityId: 'community-1', sectionId: 'section-1', content: textNoteContent, presentation: { textNoteTheme: 'neon' } } as any, 'test-openid'))
    .rejects.toThrow('不支持的纯文字笔记主题')
  expect(db.create).not.toHaveBeenCalled()
})

test('create: ignores presentation for non-text templates', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.getById as jest.Mock).mockResolvedValue(mockSection)
  ;(db.create as jest.Mock).mockResolvedValue('post-1')
  await handleCreate({ communityId: 'community-1', sectionId: 'section-1', content: { 'title-widget': '活动' }, presentation: { textNoteTheme: 'quote' } } as any, 'test-openid')
  expect(db.create).toHaveBeenCalledWith('posts', expect.not.objectContaining({ presentation: expect.anything() }))
})

test.each(['active', 'deleted'])('delete: searchable archive post with status %s stays in the RAG delete lifecycle', async status => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce({
    _id: 'archive-post',
    authorId: 'test-openid',
    status,
    communityId: 'community-1',
    area: 'archive',
  })

  const result = await handleDelete({ postId: 'archive-post' }, 'test-openid')

  const { appendPostRagOutboxEvent } = require('../../../lib/post-rag-outbox')
  expect(postRag.enqueuePostRagDeleteJobInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    postId: 'archive-post', communityId: 'community-1', sectionId: undefined,
  }))
  if (status === 'active') expect(appendPostRagOutboxEvent).toHaveBeenCalled()
  else expect(appendPostRagOutboxEvent).not.toHaveBeenCalled()
  expect(postSearch.removePostSearchIndex).toHaveBeenCalledWith('archive-post')
  if (status === 'active') {
    expect(db.updateById).toHaveBeenCalledWith('posts', 'archive-post', expect.objectContaining({ status: 'deleted' }))
    expect(result).toEqual({ success: true })
  } else {
    expect(db.updateById).not.toHaveBeenCalled()
    expect(result).toEqual({ success: true, alreadyDeleted: true })
  }
})

test('create: persists an image-text archive post without loading or storing a section', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.create as jest.Mock).mockResolvedValue('archive-image-1')

  const result = await handleCreate({
    communityId: 'community-1',
    area: 'archive',
    format: 'image_text',
    topics: [' #亲子出游 ', 'ＰＥＴ', 'pet'],
    content: {
      title: ' 春游 ',
      images: [' cloud://env/one.jpg '],
      body: { format: 'markdown', markdown: '正文', html: '<p>正文</p>', text: '正文', imageFileIDs: [], schemaVersion: 1 },
      location: { address: '湖畔', lat: 30, lng: 120 },
    },
  } as any, 'test-openid')

  expect(result).toEqual(expect.objectContaining({ postId: 'archive-image-1' }))
  expect(db.getById).not.toHaveBeenCalledWith('sections', expect.anything())
  expect(db.create).toHaveBeenCalledWith('posts', expect.objectContaining({
    communityId: 'community-1',
    area: 'archive',
    format: 'image_text',
    topics: ['亲子出游', 'PET'],
    content: expect.objectContaining({
      title: '春游',
      images: ['cloud://env/one.jpg'],
    }),
  }))
  expect((db.create as jest.Mock).mock.calls[0][1]).not.toHaveProperty('sectionId')

  const { appendPostRagOutboxEvent } = require('../../../lib/post-rag-outbox')
  expect(appendPostRagOutboxEvent).toHaveBeenCalled()
  expect(postRag.enqueuePostRagJob).toHaveBeenCalledWith(expect.objectContaining({
    postId: 'archive-image-1', communityId: 'community-1', sectionId: '',
    action: result.auditStatus === 'pass' ? 'upsert' : 'delete',
  }))
  expect(postSearch.refreshPostSearchIndexById).toHaveBeenCalledWith('archive-image-1')
  expect(db.setById).toHaveBeenCalledWith('archive_post_topics', expect.stringMatching(/^apt_/), expect.objectContaining({
    communityId: 'community-1', postId: 'archive-image-1', topicKey: '亲子出游', auditStatus: result.auditStatus,
  }))
  expect(db.setById).toHaveBeenCalledWith('archive_topics', expect.stringMatching(/^at_/), expect.objectContaining({
    recentScore: result.auditStatus === 'pass' ? 1 : 0,
    recentPostCount: result.auditStatus === 'pass' ? 1 : 0,
  }))
})

test('create: persists and audits one archive video through the synthetic video section', async () => {
  const previousQuery = (db.query as jest.Mock).getMockImplementation()
  const previousCreate = (db.create as jest.Mock).getMockImplementation()
  ;(db.query as jest.Mock).mockReset()
  ;(db.create as jest.Mock).mockReset()
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.create as jest.Mock).mockImplementation(async (collectionName: string) => (
    collectionName === 'posts' ? 'archive-video-1' : 'audit-task-1'
  ))
  const video = {
    source: 'cos', itemId: 'video-1', title: '家庭影像',
    fileID: 'cloud://env/archive/video-1.mp4', description: '湖畔散步',
  }

  const result = await handleCreate({
    communityId: 'community-1',
    area: 'archive',
    format: 'video',
    topics: ['成长'],
    content: {
      title: '周末记录',
      body: { format: 'markdown', markdown: '正文', html: '<p>正文</p>', text: '正文', imageFileIDs: [], schemaVersion: 1 },
      videos: [video],
      location: { address: '湖畔', lat: 30, lng: 120 },
    },
  } as any, 'test-openid')

  expect(result).toEqual(expect.objectContaining({ postId: 'archive-video-1' }))
  expect(db.create).toHaveBeenCalledWith('posts', expect.objectContaining({
    area: 'archive',
    format: 'video',
    content: expect.objectContaining({ videos: [video] }),
  }))
  expect(db.create).toHaveBeenCalledWith('content_audit_tasks', expect.objectContaining({
    postId: 'archive-video-1',
    widgetId: 'videos',
    targetType: 'video',
    targetRef: video.fileID,
  }))
  ;(db.query as jest.Mock).mockReset().mockImplementation(previousQuery)
  ;(db.create as jest.Mock).mockReset().mockImplementation(previousCreate)
})

test('update: keeps the stored archive video format and audits pending video content', async () => {
  const post = {
    _id: 'archive-video-1', communityId: 'community-1', authorId: 'test-openid',
    status: 'active', auditStatus: 'pass', area: 'archive', format: 'video', topics: ['成长'],
    createdAt: '2026-07-15T01:00:00.000Z',
  }
  const previousGetById = (db.getById as jest.Mock).getMockImplementation()
  const previousQuery = (db.query as jest.Mock).getMockImplementation()
  const previousCreate = (db.create as jest.Mock).getMockImplementation()
  ;(db.getById as jest.Mock).mockReset()
  ;(db.query as jest.Mock).mockReset()
  ;(db.create as jest.Mock).mockReset()
  ;(db.getById as jest.Mock).mockResolvedValueOnce(post).mockResolvedValueOnce(post)
  ;(db.query as jest.Mock).mockResolvedValue([])
  ;(db.create as jest.Mock).mockResolvedValue('audit-task-1')
  const video = {
    source: 'cos', itemId: 'video-2', title: '更新影像', fileID: 'cloud://env/archive/video-2.mp4',
  }

  await handleUpdate({
    postId: 'archive-video-1',
    format: 'image_text',
    topics: ['新话题'],
    content: { title: '更新记录', videos: [video] },
  } as any, 'test-openid')

  expect(db.updateById).toHaveBeenCalledWith('posts', 'archive-video-1', expect.objectContaining({
    pendingContent: { __set: { title: '更新记录', videos: [video] } },
    pendingTopics: { __set: ['新话题'] },
  }))
  const pendingWrite = (db.updateById as jest.Mock).mock.calls.find(([, id, data]) => (
    id === 'archive-video-1' && data?.pendingContent
  ))?.[2]
  expect(pendingWrite).not.toHaveProperty('format')
  expect(db.create).toHaveBeenCalledWith('content_audit_tasks', expect.objectContaining({
    postId: 'archive-video-1', contentSlot: 'pendingContent', widgetId: 'videos', targetType: 'video',
  }))
  ;(db.getById as jest.Mock).mockReset().mockImplementation(previousGetById)
  ;(db.query as jest.Mock).mockReset().mockImplementation(previousQuery)
  ;(db.create as jest.Mock).mockReset().mockImplementation(previousCreate)
})

test('create: persists a text archive post with its normalized cover theme', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.create as jest.Mock).mockResolvedValue('archive-text-1')

  await handleCreate({
    communityId: 'community-1',
    area: 'archive',
    format: 'text',
    topics: ['成长'],
    content: {
      title: '家风',
      body: { format: 'markdown', markdown: '正文', html: '<p>正文</p>', text: '正文', imageFileIDs: [], schemaVersion: 1 },
    },
    presentation: { textNoteTheme: 'quote' },
  } as any, 'test-openid')

  expect(db.create).toHaveBeenCalledWith('posts', expect.objectContaining({
    area: 'archive',
    format: 'text',
    topics: ['成长'],
    presentation: { textNoteTheme: 'quote' },
  }))
  expect((db.create as jest.Mock).mock.calls[0][1]).not.toHaveProperty('sectionId')
})

test('listArchiveTabs: returns All plus legacy, admin, then active topics', async () => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce({ _id: 'community-1', status: 'active' })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
    .mockResolvedValueOnce([
      { communityId: 'community-1', topicKey: 'hot', displayName: '热门', origins: ['organic'], enabled: true, recentScore: 99, recentPostCount: 9 },
      { communityId: 'community-1', topicKey: 'manual', displayName: '手动', origins: ['admin'], enabled: true, adminOrder: 1, recentScore: 0, recentPostCount: 0 },
      { communityId: 'community-1', topicKey: 'legacy', displayName: '历史', origins: ['legacy'], enabled: true, legacyOrder: 1, recentScore: 0, recentPostCount: 0 },
    ])

  await expect(handleListArchiveTabs({ communityId: 'community-1' }, 'test-openid')).resolves.toEqual({
    tabs: [
      { topicKey: '', displayName: '全部' },
      { topicKey: 'legacy', displayName: '历史' },
      { topicKey: 'manual', displayName: '手动' },
      { topicKey: 'hot', displayName: '热门' },
    ],
  })
})

test('listArchive: returns a cursor-paginated archive feed without section reads', async () => {
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({ _id: 'community-1', status: 'active' })
  ;(db.queryBefore as jest.Mock).mockResolvedValueOnce([
    { _id: 'archive-2', communityId: 'community-1', area: 'archive', format: 'text', topics: ['成长'], authorId: 'author-2', status: 'active', auditStatus: 'pass', content: { title: '二' }, createdAt: '2026-07-14T11:00:00.000Z', sortKey: '2026-07-14T11:00:00.000Z_archive-2' },
    { _id: 'archive-1', communityId: 'community-1', area: 'archive', format: 'image_text', topics: ['亲子出游', 'PET'], authorId: 'author-1', status: 'active', auditStatus: 'pass', content: { title: '一', images: ['cloud://one'] }, createdAt: '2026-07-14T10:00:00.000Z', sortKey: '2026-07-14T10:00:00.000Z_archive-1' },
  ])
  const result = await handleListArchive({ communityId: 'community-1', limit: 1 }, 'test-openid')

  expect(result.posts.map((post: any) => post._id)).toEqual(['archive-2'])
  expect(result).toEqual(expect.objectContaining({ hasMore: true, nextCursor: expect.any(String) }))
  expect(db.queryBefore).toHaveBeenCalledWith('posts', {
    communityId: 'community-1', area: 'archive', status: 'active', auditStatus: 'pass',
  }, 'sortKey', null, 2)
  expect(db.getById).not.toHaveBeenCalledWith('sections', expect.anything())
})

test('listArchive: hydrates a topic page in projection order', async () => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce({ _id: 'community-1', status: 'active' })
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.getByIdOrNull as jest.Mock).mockResolvedValueOnce({ topicKey: '成长', status: 'active' })
  ;(db.queryBefore as jest.Mock).mockResolvedValueOnce([
    { postId: 'archive-2', sortKey: '2026-07-14T11:00:00.000Z_archive-2' },
    { postId: 'archive-1', sortKey: '2026-07-14T10:00:00.000Z_archive-1' },
  ])
  ;(db.getByIds as jest.Mock)
    .mockResolvedValueOnce([
      { _id: 'archive-1', authorId: 'author-1', status: 'active', auditStatus: 'pass' },
      { _id: 'archive-2', authorId: 'author-2', status: 'active', auditStatus: 'pass' },
    ])
    .mockResolvedValueOnce([])

  const result = await handleListArchive({ communityId: 'community-1', topicKey: ' #成长 ', limit: 20 }, 'test-openid')

  expect(result.posts.map((post: any) => post._id)).toEqual(['archive-2', 'archive-1'])
  expect(db.queryBefore).toHaveBeenCalledWith('archive_post_topics', {
    communityId: 'community-1', topicKey: '成长', status: 'active', auditStatus: 'pass',
  }, 'sortKey', null, 21)
})

test('listArchive: reports topicUnavailable before reading links for a deleted topic', async () => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce({ _id: 'community-1', status: 'active' })
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.getByIdOrNull as jest.Mock).mockResolvedValueOnce({ topicKey: '成长', status: 'deleted' })

  await expect(handleListArchive({ communityId: 'community-1', topicKey: '成长' }, 'test-openid')).resolves.toEqual({
    topicUnavailable: true, posts: [], hasMore: false, nextCursor: '',
  })
  expect(db.queryBefore).not.toHaveBeenCalled()
})

test('get: reads an archive post without loading a section', async () => {
  const archivePost = {
    _id: 'archive-1', communityId: 'community-1', area: 'archive', format: 'text', topics: ['成长'],
    authorId: 'author-1', status: 'active', auditStatus: 'pass', content: { title: '家风' },
  }
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce(archivePost)
    .mockResolvedValueOnce({ _id: 'community-1', status: 'active' })
    .mockResolvedValue(null)
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])

  const result = await handleGet({ postId: 'archive-1' }, 'test-openid')

  expect(result.post).toEqual(expect.objectContaining({ _id: 'archive-1', area: 'archive', format: 'text' }))
  expect(db.getById).not.toHaveBeenCalledWith('sections', expect.anything())
})
