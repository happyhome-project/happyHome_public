jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  getWXContext: jest.fn().mockReturnValue({ OPENID: 'test-openid' }),
  DYNAMIC_CURRENT_ENV: 'test',
}))
jest.mock('../../../lib/db', () => ({
  getById: jest.fn(),
  create: jest.fn(),
  updateById: jest.fn(),
  updateWhere: jest.fn(),
  removeById: jest.fn(),
  query: jest.fn(),
  increment: jest.fn(),
  softDelete: jest.fn(),
}))

import {
  handleApply,
  handleLeave,
  handleMemberApprove,
  handleMyCommunities,
  handleMyStatus,
  handleMemberReject,
  handlePendingList,
  main,
} from '../index'
import * as db from '../../../lib/db'

beforeEach(() => jest.clearAllMocks())

test('申请加入开放社区：直接创建 active 记录并递增 memberCount', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([]) // no existing active member
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'c1', joinType: 'open' })
  ;(db.create as jest.Mock).mockResolvedValue('member-1')
  ;(db.increment as jest.Mock).mockResolvedValue({})

  const result = await handleApply({ communityId: 'c1' }, 'test-openid')

  expect(db.create).toHaveBeenCalledWith('community_members', expect.objectContaining({
    status: 'active',
    role: 'member',
  }))
  expect(db.increment).toHaveBeenCalledWith('communities', 'c1', 'memberCount', 1)
  expect(result.status).toBe('active')
})

test('申请加入审批社区：创建 pending 记录，不递增 memberCount', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([]) // no existing active member
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'c1', joinType: 'approval' })
  ;(db.create as jest.Mock).mockResolvedValue('member-1')

  const result = await handleApply({ communityId: 'c1' }, 'test-openid')

  expect(db.create).toHaveBeenCalledWith('community_members', expect.objectContaining({
    status: 'pending',
  }))
  expect(db.increment).not.toHaveBeenCalled()
  expect(result.status).toBe('pending')
})

test('申请加入：已是成员时抛出错误', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'm1', status: 'active' }])

  await expect(handleApply({ communityId: 'c1' }, 'test-openid')).rejects.toThrow('已是社区成员')
  expect(db.create).not.toHaveBeenCalled()
})

test('退出社区：物理删除成员记录，memberCount 原子递减', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.getById as jest.Mock).mockResolvedValueOnce({ _id: 'c1', creatorId: 'creator-openid' })
  ;(db.removeById as jest.Mock).mockResolvedValue({})
  ;(db.increment as jest.Mock).mockResolvedValue({})

  await handleLeave({ communityId: 'c1' }, 'test-openid')

  expect(db.removeById).toHaveBeenCalledWith('community_members', 'member-1')
  expect(db.increment).toHaveBeenCalledWith('communities', 'c1', 'memberCount', -1)
})

test('退出社区：社区创建者不能退出', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-creator', status: 'active' }])
  ;(db.getById as jest.Mock).mockResolvedValueOnce({ _id: 'c1', creatorId: 'test-openid' })

  await expect(handleLeave({ communityId: 'c1' }, 'test-openid')).rejects.toThrow('社区创建者不能退出社区')
  expect(db.removeById).not.toHaveBeenCalled()
  expect(db.increment).not.toHaveBeenCalled()
})

test('退出社区：不是成员时抛出错误', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([])

  await expect(handleLeave({ communityId: 'c1' }, 'test-openid')).rejects.toThrow('不是社区成员')
})

test('管理员审批通过：memberCount 原子递增', async () => {
  // assertCommunityAdmin
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'admin-member', role: 'admin', status: 'active' }])
  ;(db.updateWhere as jest.Mock).mockResolvedValue({ stats: { updated: 1 } })
  ;(db.increment as jest.Mock).mockResolvedValue({})

  await handleMemberApprove({ communityId: 'c1', memberId: 'applicant-member' }, 'test-openid')

  expect(db.updateWhere).toHaveBeenCalledWith('community_members', expect.objectContaining({
    _id: 'applicant-member',
    communityId: 'c1',
    status: 'pending',
  }), expect.objectContaining({
    status: 'active',
    joinedAt: expect.any(String),
  }))
  expect(db.increment).toHaveBeenCalledWith('communities', 'c1', 'memberCount', 1)
})

test('管理员审批通过：非管理员无权操作', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([]) // not admin

  await expect(handleMemberApprove({ communityId: 'c1', memberId: 'applicant-member' }, 'test-openid'))
    .rejects.toThrow('权限不足')
})

test('管理员拒绝申请：status 变为 rejected，设置 rejectedAt', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'admin-member', role: 'admin', status: 'active' }])
  ;(db.updateWhere as jest.Mock).mockResolvedValue({ stats: { updated: 1 } })

  await handleMemberReject({ communityId: 'c1', memberId: 'applicant-member' }, 'test-openid')

  expect(db.updateWhere).toHaveBeenCalledWith('community_members', expect.objectContaining({
    _id: 'applicant-member',
    communityId: 'c1',
    status: 'pending',
  }), expect.objectContaining({
    status: 'rejected',
    rejectedAt: expect.any(String),
  }))
})

test('管理员审批通过：已非 pending 时不重复递增', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'admin-member', role: 'admin', status: 'active' }])
  ;(db.updateWhere as jest.Mock).mockResolvedValue({ stats: { updated: 0 } })

  const result = await handleMemberApprove({ communityId: 'c1', memberId: 'applicant-member' }, 'test-openid')

  expect(db.increment).not.toHaveBeenCalled()
  expect(result.changed).toBe(false)
})

test('pendingList：返回社区所有待审批成员', async () => {
  ;(db.query as jest.Mock).mockResolvedValue([
    { _id: 'm1', status: 'pending' },
    { _id: 'm2', status: 'pending' },
  ])

  const result = await handlePendingList({ communityId: 'c1' }, 'test-openid')

  expect(db.query).toHaveBeenCalledWith('community_members', { communityId: 'c1', status: 'pending' })
  expect(result.members).toHaveLength(2)
})

test('myStatus：按最新 appliedAt 返回状态', async () => {
  ;(db.query as jest.Mock).mockResolvedValue([
    { _id: 'm2', status: 'pending', appliedAt: '2026-04-24T10:00:00.000Z' },
  ])

  const result = await handleMyStatus({ communityId: 'c1' }, 'test-openid')

  expect(db.query).toHaveBeenCalledWith('community_members', {
    communityId: 'c1',
    userId: 'test-openid',
  }, {
    orderBy: ['appliedAt', 'desc'],
    limit: 1,
  })
  expect(result).toEqual({ isMember: false, status: 'pending' })
})

test('myCommunities：只返回 active 成员且社区状态为 active 的社区', async () => {
  ;(db.query as jest.Mock).mockResolvedValue([
    { communityId: 'c1', status: 'active', joinedAt: '2026-04-24T10:00:00.000Z' },
    { communityId: 'c2', status: 'active', joinedAt: '2026-04-23T10:00:00.000Z' },
  ])
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({ _id: 'c1', name: '青山村', status: 'active' })
    .mockResolvedValueOnce({ _id: 'c2', name: '旧社区', status: 'disabled' })

  const result = await handleMyCommunities('test-openid')

  expect(result.communities).toEqual([{ _id: 'c1', name: '青山村', status: 'active' }])
})

test('main(): 未知 action 抛出错误', async () => {
  await expect(main({ action: 'unknown' })).rejects.toThrow('Unknown action: unknown')
})
