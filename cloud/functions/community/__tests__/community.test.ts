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
  increment: jest.fn(),
  softDelete: jest.fn(),
  runTransaction: jest.fn(),
  transactionGetByIdOrNull: jest.fn(async (transaction, collectionName, id) => {
    const response = await transaction.collection(collectionName).doc(id).get()
    return response?.data || null
  }),
}))
jest.mock('../../../lib/post-rag-outbox', () => ({ appendPostRagOutboxEvent: jest.fn() }))

import {
  handleCreate,
  handleApprove,
  handleReject,
  handlePendingList,
  handleList,
  handleGet,
  handleListDiscoverable,
  main,
} from '../index'
import * as db from '../../../lib/db'
import cloud from 'wx-server-sdk'

let createTransaction: any

function useCreateTransaction(existingCommunityId = '') {
  const communityAdd = jest.fn().mockResolvedValue({ _id: 'community-123' })
  const memberAdd = jest.fn().mockResolvedValue({ _id: 'creator-member-1' })
  const requestSet = jest.fn().mockResolvedValue({})
  createTransaction = {
    communityAdd,
    memberAdd,
    requestSet,
    collection: jest.fn((collectionName: string) => ({
      doc: jest.fn((id: string) => ({
        get: jest.fn().mockResolvedValue({
          data: collectionName === 'community_create_requests' && existingCommunityId
            ? { communityId: existingCommunityId }
            : null,
        }),
        set: requestSet,
        update: async ({ data }: any) => (db.updateById as jest.Mock)(collectionName, id, data),
      })),
      add: collectionName === 'communities' ? communityAdd : memberAdd,
    })),
  }
  ;(db.runTransaction as jest.Mock).mockImplementation(async (callback) => callback(createTransaction))
}

beforeEach(() => {
  jest.resetAllMocks()
  ;(db.transactionGetByIdOrNull as jest.Mock).mockImplementation(async (transaction, collectionName, id) => {
    const response = await transaction.collection(collectionName).doc(id).get()
    return response?.data || null
  })
  ;(cloud.getWXContext as jest.Mock).mockReturnValue({ OPENID: 'test-openid' })
  ;(db.query as jest.Mock).mockResolvedValue([])
  useCreateTransaction()
})

test('创建社区：status 默认为 pending，creatorId 为 OPENID', async () => {
  const result = await handleCreate({
    name: '测试社区',
    description: '描述',
    coverImage: 'https://cover.jpg',
    location: { address: '北京', lat: 39.9, lng: 116.3 },
    joinType: 'open',
  }, 'test-openid')

  expect(createTransaction.communityAdd).toHaveBeenCalledWith({ data: expect.objectContaining({
    status: 'pending',
    creatorId: 'test-openid',
    memberCount: 0,
  }) })
  expect(result.communityId).toBe('community-123')
})

test('创建社区：同时为创建者创建 admin 成员记录', async () => {
  await handleCreate({
    name: '测试社区',
    description: '描述',
    coverImage: '',
    location: { address: '北京', lat: 39.9, lng: 116.3 },
    joinType: 'open',
  }, 'test-openid')

  expect(createTransaction.memberAdd).toHaveBeenCalledWith({ data: expect.objectContaining({
    communityId: 'community-123',
    userId: 'test-openid',
    role: 'admin',
    status: 'active',
  }) })
})

test('相同提交标识重试：复用已创建社区，不再次写入社区或创建者成员', async () => {
  useCreateTransaction('community-123')

  const result = await handleCreate({
    name: '测试社区',
    description: '描述',
    coverImage: '',
    location: { address: '', lat: 0, lng: 0 },
    joinType: 'open',
    requestId: 'retry-key-1',
  }, 'test-openid')

  expect(result).toEqual({ communityId: 'community-123', alreadyCreated: true })
  expect(createTransaction.communityAdd).not.toHaveBeenCalled()
  expect(createTransaction.memberAdd).not.toHaveBeenCalled()
})

test('创建社区：创建社区审批通知记录给 superAdmin，不因通知未配置而阻断创建', async () => {
  ;(db.create as jest.Mock).mockResolvedValue('community-123')
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([{ userId: 'super-admin', role: 'superAdmin', status: 'active' }])
    .mockResolvedValue([]) // subscription lookups

  const result = await handleCreate({
    name: '测试社区',
    description: '描述',
    coverImage: '',
    location: { address: '北京', lat: 39.9, lng: 116.3 },
    joinType: 'open',
  }, 'creator-openid')

  expect(result.communityId).toBe('community-123')
  expect(db.create).toHaveBeenCalledWith('admin_notifications', expect.objectContaining({
    eventType: 'community_create_pending',
    communityId: 'community-123',
    recipientUserId: 'super-admin',
    status: 'skipped',
  }))
})

test('审批社区：只有 superAdmin 可以操作', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'test-openid', role: 'user' })

  await expect(handleApprove({ communityId: 'community-123' }, 'test-openid'))
    .rejects.toThrow('权限不足')
  expect(db.updateById).not.toHaveBeenCalled()
})

test('审批通过：社区 status 变为 active', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'test-openid', role: 'superAdmin' })
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  await handleApprove({ communityId: 'community-123' }, 'test-openid')

  expect(db.updateById).toHaveBeenCalledWith('communities', 'community-123', { status: 'active' })
})

test('审批拒绝：社区 status 变为 rejected', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'test-openid', role: 'superAdmin' })
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  await handleReject({ communityId: 'community-123' }, 'test-openid')

  expect(db.updateById).toHaveBeenCalledWith('communities', 'community-123', { status: 'rejected' })
})

test('待审批社区列表：只有 superAdmin 可以查看', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'test-openid', role: 'user' })

  await expect(handlePendingList('test-openid')).rejects.toThrow('权限不足')
  expect(db.query).not.toHaveBeenCalledWith('communities', { status: 'pending' }, expect.any(Object))
})

test('待审批社区列表：superAdmin 按创建时间倒序返回 pending 社区', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'test-openid', role: 'superAdmin' })
  ;(db.query as jest.Mock).mockResolvedValue([{ _id: 'c1', status: 'pending' }])

  const result = await handlePendingList('test-openid')

  expect(db.query).toHaveBeenCalledWith('communities', { status: 'pending' }, {
    orderBy: ['createdAt', 'desc'],
  })
  expect(result.communities).toEqual([{ _id: 'c1', status: 'pending' }])
})

test('list：默认只返回 active 社区', async () => {
  ;(db.query as jest.Mock).mockResolvedValue([
    { _id: 'c1', status: 'active' },
    { _id: 'hidden', status: 'active', discoverable: false },
  ])

  const result = await handleList({})

  expect(db.query).toHaveBeenCalledWith('communities', { status: 'active' }, expect.any(Object))
  expect(result.communities).toEqual([{ _id: 'c1', status: 'active' }])
})

test('list：includeAll=true 只有 superAdmin 可查看 active 和 pending', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'super-openid', role: 'superAdmin' })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([
      { _id: 'c1', status: 'active' },
      { _id: 'hidden', status: 'active', discoverable: false },
    ])
    .mockResolvedValueOnce([{ _id: 'c2', status: 'pending' }])

  const result = await handleList({ includeAll: true }, 'super-openid')

  expect(result.communities).toEqual([
    { _id: 'c1', status: 'active' },
    { _id: 'hidden', status: 'active', discoverable: false },
    { _id: 'c2', status: 'pending' },
  ])
})

test('list：普通用户不能通过 includeAll 读取 pending 社区', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'user-openid', role: 'user' })
  ;(db.query as jest.Mock).mockResolvedValue([])

  await expect(handleList({ includeAll: true }, 'user-openid')).rejects.toThrow('权限不足')
})

test('get：返回单个社区', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'community-123', name: '测试', status: 'active' })

  const result = await handleGet({ communityId: 'community-123' })

  expect(db.getById).toHaveBeenCalledWith('communities', 'community-123')
  expect(result.community).toHaveProperty('_id', 'community-123')
})

test('get：pending 社区不能通过公开接口提前读取', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'community-pending',
    name: '待审核社区',
    status: 'pending',
  })

  await expect(handleGet({ communityId: 'community-pending' }))
    .rejects.toThrow('社区不存在或尚未开放')
})

test('listDiscoverable：未加入用户可见 active 社区且 viewerStatus 为 null', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([
    { _id: 'c1', name: '青山村', status: 'active' },
    { _id: 'hidden', name: '测试社区', status: 'active', discoverable: false },
  ])

  const result = await handleListDiscoverable('')

  expect(result.communities).toEqual([{ _id: 'c1', name: '青山村', status: 'active', viewerStatus: null }])
})

test('listDiscoverable：只返回 active 社区，并回填包括已加入在内的成员状态', async () => {
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([
      { _id: 'c1', name: '青山村', status: 'active' },
      { _id: 'c2', name: '绿水村', status: 'active' },
      { _id: 'c3', name: '花海村', status: 'active' },
    ])
    .mockResolvedValueOnce([{ status: 'pending', appliedAt: '2026-04-24T10:00:00.000Z' }])
    .mockResolvedValueOnce([{ status: 'rejected', appliedAt: '2026-04-24T09:00:00.000Z' }])
    .mockResolvedValueOnce([{ status: 'active', appliedAt: '2026-04-24T08:00:00.000Z' }])

  const result = await handleListDiscoverable('test-openid')

  expect(result.communities).toEqual([
    { _id: 'c1', name: '青山村', status: 'active', viewerStatus: 'pending' },
    { _id: 'c2', name: '绿水村', status: 'active', viewerStatus: 'rejected' },
    { _id: 'c3', name: '花海村', status: 'active', viewerStatus: 'active' },
  ])
})

test('listDiscoverable：创建者自己的 pending 社区也不对小程序目录展示', async () => {
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ _id: 'pending-created', status: 'pending', creatorId: 'creator-openid' }])

  const result = await handleListDiscoverable('creator-openid')

  expect(result.communities).toEqual([])
  expect(db.query).not.toHaveBeenCalledWith('communities', {
    status: 'pending',
    creatorId: 'creator-openid',
  }, expect.any(Object))
})

test('main(): 未知 action 抛出错误', async () => {
  await expect(main({ action: 'unknown' }))
    .rejects.toThrow('Unknown action: unknown')
})
