jest.mock('../../../lib/db', () => ({
  getById: jest.fn(),
  getByIds: jest.fn(async (collectionName: string, ids: string[]) => {
    const getById = require('../../../lib/db').getById as jest.Mock
    const values = await Promise.all(ids.map((id) => getById(collectionName, id).catch(() => null)))
    return values.filter(Boolean)
  }),
  create: jest.fn(),
  updateById: jest.fn(),
  query: jest.fn(),
}))

jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  DYNAMIC_CURRENT_ENV: 'test',
}))

import { main } from '../index'
import * as db from '../../../lib/db'

const TEST_PUBLIC_COMMUNITY_ID = 'community-public-test'
const ORIGINAL_PUBLIC_COMMUNITY_ID = process.env.DEFAULT_PUBLIC_COMMUNITY_ID

function getEvent(queryStringParameters: Record<string, string> = {}) {
  return {
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: {
      appid: 'wx-test',
      timestamp: '1710000000000',
      ...queryStringParameters,
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.DEFAULT_PUBLIC_COMMUNITY_ID = TEST_PUBLIC_COMMUNITY_ID
})

afterAll(() => {
  if (ORIGINAL_PUBLIC_COMMUNITY_ID === undefined) delete process.env.DEFAULT_PUBLIC_COMMUNITY_ID
  else process.env.DEFAULT_PUBLIC_COMMUNITY_ID = ORIGINAL_PUBLIC_COMMUNITY_ID
})

test('valid token returns a JSON string home snapshot for that user', async () => {
  ;(db.query as jest.Mock).mockImplementation(async (collectionName: string, where: any) => {
    if (collectionName === 'users' && where.backgroundFetchToken === 'hhpf_valid') {
      return [{
        _id: 'user-1',
        nickName: '一年',
        role: 'user',
        backgroundFetchToken: 'hhpf_valid',
        backgroundFetchTokenExpiresAt: '2999-01-01T00:00:00.000Z',
      }]
    }
    if (collectionName === 'community_members' && where.userId === 'user-1') {
      return [{ _id: 'member-1', communityId: 'community-1', userId: 'user-1', status: 'active', joinedAt: '2024-01-01T00:00:00.000Z' }]
    }
    if (collectionName === 'community_members' && where.communityId === 'community-1') {
      return [{ _id: 'member-1', status: 'active' }]
    }
    if (collectionName === 'sections') return []
    if (collectionName === 'posts') return []
    return []
  })
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'communities' && id === 'community-1') return { _id: 'community-1', name: '青山村', status: 'active' }
    if (collectionName === 'users' && id === 'user-1') return {
      _id: 'user-1',
      role: 'user',
      backgroundFetchToken: 'hhpf_valid',
      backgroundFetchTokenExpiresAt: '2999-01-01T00:00:00.000Z',
    }
    return null
  })

  const res = await main(getEvent({ token: 'hhpf_valid' }))

  expect(res.statusCode).toBe(200)
  expect(res.headers['content-type']).toContain('text/plain')
  const snapshot = JSON.parse(res.body)
  expect(snapshot.schemaVersion).toBe(1)
  expect(snapshot.viewerOpenId).toBe('user-1')
  expect(snapshot.communities).toEqual([expect.objectContaining({ _id: 'community-1' })])
})

test('cloud development invocation with top-level token returns the same snapshot contract', async () => {
  ;(db.query as jest.Mock).mockImplementation(async (collectionName: string, where: any) => {
    if (collectionName === 'users' && where.backgroundFetchToken === 'hhpf_valid') {
      return [{
        _id: 'user-1',
        nickName: '一年',
        role: 'user',
        backgroundFetchToken: 'hhpf_valid',
        backgroundFetchTokenExpiresAt: '2999-01-01T00:00:00.000Z',
      }]
    }
    if (collectionName === 'community_members' && where.userId === 'user-1') {
      return [{ _id: 'member-1', communityId: 'community-1', userId: 'user-1', status: 'active', joinedAt: '2024-01-01T00:00:00.000Z' }]
    }
    if (collectionName === 'community_members' && where.communityId === 'community-1') {
      return [{ _id: 'member-1', status: 'active' }]
    }
    if (collectionName === 'sections') return []
    if (collectionName === 'posts') return []
    return []
  })
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'communities' && id === 'community-1') return { _id: 'community-1', name: '青山村', status: 'active' }
    return null
  })

  const res = await main({
    token: 'hhpf_valid',
    appid: 'wx-test',
    timestamp: '1710000000000',
    path: 'pages/index/index',
    query: '',
    scene: 1001,
  })

  const snapshot = JSON.parse(res.body)
  expect(res.statusCode).toBe(200)
  expect(snapshot.viewerOpenId).toBe('user-1')
  expect(snapshot.communities).toEqual([expect.objectContaining({ _id: 'community-1' })])
})

test('valid token prefers the user last home community for background snapshots', async () => {
  ;(db.query as jest.Mock).mockImplementation(async (collectionName: string, where: any) => {
    if (collectionName === 'users' && where.backgroundFetchToken === 'hhpf_valid') {
      return [{
        _id: 'user-1',
        nickName: '一年',
        role: 'user',
        backgroundFetchToken: 'hhpf_valid',
        backgroundFetchTokenExpiresAt: '2999-01-01T00:00:00.000Z',
        lastHomeCommunityId: 'community-2',
      }]
    }
    if (collectionName === 'community_members' && where.userId === 'user-1') {
      return [
        { _id: 'member-1', communityId: 'community-1', userId: 'user-1', status: 'active', joinedAt: '2024-02-01T00:00:00.000Z' },
        { _id: 'member-2', communityId: 'community-2', userId: 'user-1', status: 'active', joinedAt: '2024-01-01T00:00:00.000Z' },
      ]
    }
    if (collectionName === 'community_members') return [{ _id: 'member-any', status: 'active' }]
    if (collectionName === 'sections') return []
    if (collectionName === 'posts') return []
    return []
  })
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'communities' && id === 'community-1') return { _id: 'community-1', name: '青山村', status: 'active' }
    if (collectionName === 'communities' && id === 'community-2') return { _id: 'community-2', name: '阳光花园', status: 'active' }
    if (collectionName === 'users' && id === 'user-1') return {
      _id: 'user-1',
      role: 'user',
      backgroundFetchToken: 'hhpf_valid',
      backgroundFetchTokenExpiresAt: '2999-01-01T00:00:00.000Z',
      lastHomeCommunityId: 'community-2',
    }
    return null
  })

  const res = await main({ token: 'hhpf_valid' })
  const snapshot = JSON.parse(res.body)

  expect(snapshot.currentCommunityId).toBe('community-2')
})

test('invalid or expired token returns a safe empty snapshot without member content', async () => {
  ;(db.query as jest.Mock).mockResolvedValue([])

  const res = await main(getEvent({ token: 'bad-token' }))
  const snapshot = JSON.parse(res.body)

  expect(res.statusCode).toBe(200)
  expect(snapshot.schemaVersion).toBe(1)
  expect(snapshot.viewerOpenId).toBe('')
  expect(snapshot.communities).toEqual([])
  expect(snapshot.sections).toEqual([])
  expect(snapshot.postsBySection).toEqual({})
})

test('first-open cloud development pre-fetch with a generated code returns the public home snapshot', async () => {
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'communities' && id === TEST_PUBLIC_COMMUNITY_ID) {
      return {
        _id: id,
        name: '阳光花园社区',
        status: 'active',
      }
    }
    return null
  })
  ;(db.query as jest.Mock).mockImplementation(async (collectionName: string) => {
    if (collectionName === 'sections') return []
    if (collectionName === 'collaboration_templates') return []
    return []
  })

  const res = await main({
    code: 'wechat-generated-prefetch-code',
    appid: 'wx-test',
    timestamp: '1710000000000',
    path: 'pages/index/index',
    query: '',
    scene: 1001,
  })
  const snapshot = JSON.parse(res.body)

  expect(res.statusCode).toBe(200)
  expect(snapshot.viewerOpenId).toBe('')
  expect(snapshot.currentCommunityId).toBe(TEST_PUBLIC_COMMUNITY_ID)
  expect(snapshot.currentCommunity).toEqual(expect.objectContaining({
    _id: TEST_PUBLIC_COMMUNITY_ID,
    status: 'active',
  }))
  expect(db.query).not.toHaveBeenCalledWith(
    'community_members',
    expect.anything(),
    expect.anything(),
  )
})

test('public HTTP requests cannot turn an arbitrary code into a database-backed guest snapshot', async () => {
  const res = await main(getEvent({ code: 'caller-controlled-code' }))
  const snapshot = JSON.parse(res.body)

  expect(res.statusCode).toBe(200)
  expect(snapshot.viewerOpenId).toBe('')
  expect(snapshot.currentCommunityId).toBe('')
  expect(snapshot.communities).toEqual([])
  expect(snapshot.sections).toEqual([])
  expect(snapshot.postsBySection).toEqual({})
  expect(db.getById).not.toHaveBeenCalled()
  expect(db.query).not.toHaveBeenCalled()
})
