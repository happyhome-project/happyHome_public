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
}))

import { handleCreate, handleApprove, handleReject, handleList, handleGet, main } from '../index'
import * as db from '../../../lib/db'

beforeEach(() => jest.clearAllMocks())

test('创建社区：status 默认为 pending，creatorId 为 OPENID', async () => {
  ;(db.create as jest.Mock).mockResolvedValue('community-123')

  const result = await handleCreate({
    name: '测试社区',
    description: '描述',
    coverImage: 'https://cover.jpg',
    location: { address: '北京', lat: 39.9, lng: 116.3 },
    joinType: 'open',
  })

  expect(db.create).toHaveBeenCalledWith('communities', expect.objectContaining({
    status: 'pending',
    creatorId: 'test-openid',
    memberCount: 0,
  }))
  expect(result.communityId).toBe('community-123')
})

test('创建社区：同时为创建者创建 admin 成员记录', async () => {
  ;(db.create as jest.Mock).mockResolvedValue('community-123')

  await handleCreate({
    name: '测试社区',
    description: '描述',
    coverImage: '',
    location: { address: '北京', lat: 39.9, lng: 116.3 },
    joinType: 'open',
  })

  expect(db.create).toHaveBeenCalledTimes(2)
  expect(db.create).toHaveBeenCalledWith('community_members', expect.objectContaining({
    communityId: 'community-123',
    userId: 'test-openid',
    role: 'admin',
    status: 'active',
  }))
})

test('审批社区：只有 superAdmin 可以操作', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'test-openid', role: 'user' })

  await expect(handleApprove({ communityId: 'community-123' }))
    .rejects.toThrow('权限不足')
  expect(db.updateById).not.toHaveBeenCalled()
})

test('审批通过：社区 status 变为 active', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'test-openid', role: 'superAdmin' })
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  await handleApprove({ communityId: 'community-123' })

  expect(db.updateById).toHaveBeenCalledWith('communities', 'community-123', { status: 'active' })
})

test('审批拒绝：社区 status 变为 disabled', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'test-openid', role: 'superAdmin' })
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  await handleReject({ communityId: 'community-123' })

  expect(db.updateById).toHaveBeenCalledWith('communities', 'community-123', { status: 'disabled' })
})

test('list：默认只返回 active 社区', async () => {
  ;(db.query as jest.Mock).mockResolvedValue([{ _id: 'c1', status: 'active' }])

  const result = await handleList({})

  expect(db.query).toHaveBeenCalledWith('communities', { status: 'active' }, expect.any(Object))
  expect(result.communities).toHaveLength(1)
})

test('list：includeAll=true 时同时返回 active 和 pending', async () => {
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([{ _id: 'c1', status: 'active' }])
    .mockResolvedValueOnce([{ _id: 'c2', status: 'pending' }])

  const result = await handleList({ includeAll: true })

  expect(result.communities).toHaveLength(2)
})

test('get：返回单个社区', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'community-123', name: '测试' })

  const result = await handleGet({ communityId: 'community-123' })

  expect(db.getById).toHaveBeenCalledWith('communities', 'community-123')
  expect(result.community).toHaveProperty('_id', 'community-123')
})

test('main(): 未知 action 抛出错误', async () => {
  await expect(main({ action: 'unknown' }))
    .rejects.toThrow('Unknown action: unknown')
})
