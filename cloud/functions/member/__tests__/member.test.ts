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

import {
  handleApply,
  handleLeave,
  handleMemberApprove,
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

  const result = await handleApply({ communityId: 'c1' })

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

  const result = await handleApply({ communityId: 'c1' })

  expect(db.create).toHaveBeenCalledWith('community_members', expect.objectContaining({
    status: 'pending',
  }))
  expect(db.increment).not.toHaveBeenCalled()
  expect(result.status).toBe('pending')
})

test('申请加入：已是成员时抛出错误', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'm1', status: 'active' }])

  await expect(handleApply({ communityId: 'c1' })).rejects.toThrow('已是社区成员')
  expect(db.create).not.toHaveBeenCalled()
})

test('退出社区：status 变为 left，memberCount 原子递减', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  ;(db.updateById as jest.Mock).mockResolvedValue({})
  ;(db.increment as jest.Mock).mockResolvedValue({})

  await handleLeave({ communityId: 'c1' })

  expect(db.updateById).toHaveBeenCalledWith('community_members', 'member-1', expect.objectContaining({
    status: 'left',
    leftAt: expect.any(String),
  }))
  expect(db.increment).toHaveBeenCalledWith('communities', 'c1', 'memberCount', -1)
})

test('退出社区：不是成员时抛出错误', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([])

  await expect(handleLeave({ communityId: 'c1' })).rejects.toThrow('不是社区成员')
})

test('管理员审批通过：memberCount 原子递增', async () => {
  // assertCommunityAdmin
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'admin-member', role: 'admin', status: 'active' }])
  ;(db.updateById as jest.Mock).mockResolvedValue({})
  ;(db.increment as jest.Mock).mockResolvedValue({})

  await handleMemberApprove({ communityId: 'c1', memberId: 'applicant-member' })

  expect(db.updateById).toHaveBeenCalledWith('community_members', 'applicant-member', expect.objectContaining({
    status: 'active',
    joinedAt: expect.any(String),
  }))
  expect(db.increment).toHaveBeenCalledWith('communities', 'c1', 'memberCount', 1)
})

test('管理员审批通过：非管理员无权操作', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([]) // not admin

  await expect(handleMemberApprove({ communityId: 'c1', memberId: 'applicant-member' }))
    .rejects.toThrow('权限不足')
})

test('管理员拒绝申请：status 变为 rejected，设置 rejectedAt', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'admin-member', role: 'admin', status: 'active' }])
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  await handleMemberReject({ communityId: 'c1', memberId: 'applicant-member' })

  expect(db.updateById).toHaveBeenCalledWith('community_members', 'applicant-member', expect.objectContaining({
    status: 'rejected',
    rejectedAt: expect.any(String),
  }))
})

test('pendingList：返回社区所有待审批成员', async () => {
  ;(db.query as jest.Mock).mockResolvedValue([
    { _id: 'm1', status: 'pending' },
    { _id: 'm2', status: 'pending' },
  ])

  const result = await handlePendingList({ communityId: 'c1' })

  expect(db.query).toHaveBeenCalledWith('community_members', { communityId: 'c1', status: 'pending' })
  expect(result.members).toHaveLength(2)
})

test('main(): 未知 action 抛出错误', async () => {
  await expect(main({ action: 'unknown' })).rejects.toThrow('Unknown action: unknown')
})
