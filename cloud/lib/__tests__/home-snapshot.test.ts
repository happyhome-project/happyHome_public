jest.mock('../db', () => ({
  getById: jest.fn(),
  getByIds: jest.fn(),
  query: jest.fn(),
  updateById: jest.fn(),
}))
jest.mock('../background-fetch-token', () => ({
  ensureBackgroundFetchToken: jest.fn(),
}))
jest.mock('../content-audit', () => ({
  isPostVisibleToMembers: jest.fn(() => true),
}))
jest.mock('../guest-intro-config', () => ({
  getGuestIntroConfig: jest.fn(),
}))
jest.mock('../public-community', () => ({
  ensureCommunityReadable: jest.fn(),
  getActivePublicCommunity: jest.fn(),
  getDefaultPublicCommunityId: jest.fn(() => ''),
}))

import * as db from '../db'
import { buildHomeFeed, buildHomeSnapshot } from '../home-snapshot'
import { buildInitialCollaborationTemplates } from '../../shared/collaboration-templates'

beforeEach(() => {
  jest.clearAllMocks()
  ;(db.getById as jest.Mock).mockResolvedValue(null)
  ;(db.getByIds as jest.Mock).mockResolvedValue([])
  ;(db.query as jest.Mock).mockResolvedValue([])
})

test('buildHomeSnapshot 批量读取社区并复用已经确认的 membership', async () => {
  ;(db.query as jest.Mock).mockImplementation(async (collection: string, where: any) => {
    if (collection === 'community_members' && where.userId === 'viewer') {
      return [
        { communityId: 'c1', userId: 'viewer', status: 'active', joinedAt: '2026-07-14T10:00:00.000Z' },
        { communityId: 'c2', userId: 'viewer', status: 'active', joinedAt: '2026-07-13T10:00:00.000Z' },
      ]
    }
    if (collection === 'sections') return [{
      _id: 's1',
      communityId: 'c1',
      name: '动态',
      order: 1,
      widgets: [{ widgetId: 'member-note', type: 'rich_text', visibility: 'member' }],
    }]
    if (collection === 'posts') return [{
      _id: 'p1',
      communityId: 'c1',
      sectionId: 's1',
      authorId: '',
      status: 'active',
      auditStatus: 'pass',
      content: { 'member-note': '只给成员' },
      createdAt: '2026-07-14T10:00:00.000Z',
    }]
    return []
  })
  ;(db.getByIds as jest.Mock).mockResolvedValue([
    { _id: 'c1', name: '当前社区', status: 'active' },
    { _id: 'c2', name: '旧社区', status: 'disabled' },
  ])

  const result = await buildHomeSnapshot('viewer', {
    currentCommunityId: 'c1',
    user: { _id: 'viewer' } as any,
  })

  expect(db.getByIds).toHaveBeenCalledTimes(1)
  expect(db.getByIds).toHaveBeenCalledWith('communities', ['c1', 'c2'])
  expect(db.query).toHaveBeenCalledWith('community_members', {
    userId: 'viewer',
    status: 'active',
  }, {
    orderBy: ['joinedAt', 'desc'],
    limit: 100,
  })
  expect((db.query as jest.Mock).mock.calls.filter(([name]) => name === 'community_members')).toHaveLength(1)
  expect(result.communities.map((community) => community._id)).toEqual(['c1'])
  expect((result.postsBySection.s1[0].content as any)['member-note']).toBe('只给成员')
})

test('buildHomeFeed 对同一社群的并发帖子至多查询一次 ACL', async () => {
  ;(db.query as jest.Mock).mockImplementation(async (collection: string) => {
    if (collection === 'sections') return [{
      _id: 's1',
      communityId: 'c1',
      name: '动态',
      order: 1,
      widgets: [{ widgetId: 'member-note', type: 'rich_text', visibility: 'member' }],
    }]
    if (collection === 'posts') return ['p1', 'p2'].map((_id) => ({
      _id,
      communityId: 'c1',
      sectionId: 's1',
      authorId: '',
      status: 'active',
      auditStatus: 'pass',
      content: { 'member-note': '成员内容' },
      createdAt: '2026-07-14T10:00:00.000Z',
    }))
    if (collection === 'community_members') return [{ status: 'active' }]
    return []
  })

  await buildHomeFeed('c1', 'viewer', { skipMembershipCheck: true })

  expect((db.query as jest.Mock).mock.calls.filter(([name]) => name === 'community_members')).toHaveLength(1)
})

test('buildHomeFeed 将 101 位作者按每批最多 100 条读取，而不是退化为 N+1', async () => {
  const sections = Array.from({ length: 3 }, (_, index) => ({
    _id: `s${index}`,
    communityId: 'c1',
    name: `板块${index}`,
    order: index,
    widgets: [{ widgetId: 'title', type: 'rich_text' }],
  }))
  const postCounts = [40, 40, 21]
  ;(db.query as jest.Mock).mockImplementation(async (collection: string, where: any) => {
    if (collection === 'sections') return sections
    if (collection === 'posts') {
      const sectionIndex = Number(String(where.sectionId).slice(1))
      return Array.from({ length: postCounts[sectionIndex] }, (_, index) => ({
        _id: `${where.sectionId}-p${index}`,
        communityId: 'c1',
        sectionId: where.sectionId,
        authorId: `${where.sectionId}-author${index}`,
        status: 'active',
        auditStatus: 'pass',
        content: { title: '帖子' },
        createdAt: '2026-07-14T10:00:00.000Z',
      }))
    }
    return []
  })
  ;(db.getByIds as jest.Mock).mockImplementation(async (collection: string, ids: string[]) => {
    if (ids.length > 100) throw new Error('invalid document ids')
    return collection === 'users' ? ids.map((_id) => ({ _id, nickName: _id })) : []
  })

  const result = await buildHomeFeed('c1', 'viewer', {
    skipMembershipCheck: true,
    viewerIsMember: true,
    limitPerSection: 50,
  })

  expect(Object.values(result.postsBySection).flat()).toHaveLength(101)
  const userBatches = (db.getByIds as jest.Mock).mock.calls
    .filter(([collection]) => collection === 'users')
    .map(([, ids]) => ids.length)
  expect(userBatches).toEqual([100, 1])
})

test('buildHomeFeed 为所有社群返回同一组全局协作模板及当前社群帖子', async () => {
  const templates = buildInitialCollaborationTemplates()
  ;(db.query as jest.Mock).mockImplementation(async (collection: string, where: any) => {
    if (collection === 'sections') return []
    if (collection === 'collaboration_templates') return templates
    if (collection === 'posts' && where.area === 'collaboration') {
      return [{
        _id: `post-${where.collaborationTemplateId}`,
        communityId: 'community-1',
        area: 'collaboration',
        collaborationTemplateId: where.collaborationTemplateId,
        collaborationSystemKey: templates.find((template) => template._id === where.collaborationTemplateId)?.systemKey,
        authorId: '',
        status: 'active',
        auditStatus: 'pass',
        content: where.collaborationTemplateId === templates[0]._id
          ? { carpool_origin: '青山村', carpool_destination: '成都软件园' }
          : { activity_invite_title: '周末徒步' },
        createdAt: '2026-07-15T10:00:00.000Z',
      }]
    }
    return []
  })

  const result = await buildHomeFeed('community-1', 'viewer', {
    skipMembershipCheck: true,
    viewerIsMember: true,
  })

  expect(result.collaborationTemplates.map((template) => template.name)).toEqual(['拼车出行', '出游邀约'])
  expect(Object.keys(result.collaborationPostsByTemplate)).toEqual(templates.map((template) => template._id))
  expect(result.collaborationPostsByTemplate[templates[0]._id][0]).toEqual(expect.objectContaining({
    area: 'collaboration',
    collaborationTemplateId: templates[0]._id,
  }))
  expect(result.collaborationPostsByTemplate[templates[0]._id][0]).not.toHaveProperty('sectionId')
  expect((db.query as jest.Mock).mock.calls.filter(([collection, where]) => (
    collection === 'posts' && where.area === 'collaboration'
  ))).toHaveLength(2)
})
