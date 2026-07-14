jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  getWXContext: jest.fn().mockReturnValue({ OPENID: 'test-openid' }),
  openapi: {
    subscribeMessage: {
      send: jest.fn(),
    },
  },
  DYNAMIC_CURRENT_ENV: 'test',
}))
jest.mock('../../../lib/db', () => ({
  getById: jest.fn(),
  getByIds: jest.fn(),
  create: jest.fn(),
  updateById: jest.fn(),
  updateWhere: jest.fn(),
  removeById: jest.fn(),
  query: jest.fn(),
  increment: jest.fn(),
  softDelete: jest.fn(),
  runTransaction: jest.fn(),
  transactionGetByIdOrNull: jest.fn(async (transaction, collectionName, id) => {
    const response = await transaction.collection(collectionName).doc(id).get()
    return response?.data || null
  }),
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
import cloud from 'wx-server-sdk'

let applyTransaction: any

function useMembershipTransitionTransaction(options: {
  community?: Record<string, any> | null
  member?: Record<string, any> | null
} = {}) {
  const community = options.community === undefined
    ? { _id: 'c1', creatorId: 'creator-openid', memberCount: 2 }
    : options.community
  const member = options.member === undefined
    ? { _id: 'applicant-member', communityId: 'c1', userId: 'applicant', role: 'member', status: 'pending' }
    : options.member
  const memberUpdate = jest.fn().mockResolvedValue({ stats: { updated: 1 } })
  const memberRemove = jest.fn().mockResolvedValue({ stats: { removed: 1 } })
  const communityUpdate = jest.fn().mockResolvedValue({ stats: { updated: 1 } })
  const stateSet = jest.fn().mockResolvedValue({ stats: { updated: 1 } })
  const transaction = {
    collection: jest.fn((name: string) => ({
      doc: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ data: name === 'communities'
          ? community
          : name === 'community_members'
            ? member
            : null }),
        update: name === 'communities' ? communityUpdate : memberUpdate,
        remove: memberRemove,
        set: stateSet,
      })),
    })),
  }
  ;(db.runTransaction as jest.Mock).mockImplementationOnce(async (callback) => callback(transaction))
  return { memberUpdate, memberRemove, communityUpdate, stateSet }
}

function useApplyTransaction(options: {
  community?: Record<string, any> | null
  state?: Record<string, any> | null
  member?: Record<string, any> | null
  memberId?: string
} = {}) {
  const community = options.community === undefined
    ? { _id: 'c1', name: '青山村', status: 'active', joinType: 'open', memberCount: 0 }
    : options.community
  const state = options.state === undefined ? null : options.state
  const memberAdd = jest.fn().mockResolvedValue({ _id: options.memberId || 'member-1' })
  const stateSet = jest.fn().mockResolvedValue({})
  const communityUpdate = jest.fn().mockResolvedValue({})
  applyTransaction = {
    memberAdd,
    stateSet,
    communityUpdate,
    collection: jest.fn((collectionName: string) => ({
      doc: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({
          data: collectionName === 'communities'
            ? community
            : collectionName === 'community_members'
              ? (options.member === undefined ? state : options.member)
              : state,
        }),
        set: stateSet,
        update: communityUpdate,
        remove: jest.fn(),
      })),
      add: memberAdd,
    })),
  }
  ;(db.runTransaction as jest.Mock).mockImplementation(async (callback) => callback(applyTransaction))
}

beforeEach(() => {
  jest.resetAllMocks()
  ;(db.transactionGetByIdOrNull as jest.Mock).mockImplementation(async (transaction, collectionName, id) => {
    const response = await transaction.collection(collectionName).doc(id).get()
    return response?.data || null
  })
  ;(cloud.getWXContext as jest.Mock).mockReturnValue({ OPENID: 'test-openid' })
  delete process.env.APPROVAL_MEMBER_JOIN_TEMPLATE_ID
  delete process.env.APPROVAL_MEMBER_JOIN_TEMPLATE_FIELDS
  delete process.env.APPROVAL_COMMUNITY_CREATE_TEMPLATE_ID
  delete process.env.APPROVAL_COMMUNITY_CREATE_TEMPLATE_FIELDS
  ;(db.query as jest.Mock).mockResolvedValue([])
  useApplyTransaction()
})

test('申请加入开放社区：直接创建 active 记录并递增 memberCount', async () => {
  const result = await handleApply({ communityId: 'c1' }, 'test-openid')

  expect(applyTransaction.memberAdd).toHaveBeenCalledWith({ data: expect.objectContaining({
    status: 'active',
    role: 'member',
  }) })
  expect(applyTransaction.communityUpdate).toHaveBeenCalledWith({ data: { memberCount: 1 } })
  expect(result.status).toBe('active')
})

test('重复申请加入：事务内命中成员状态后复用结果，不重复创建或计数', async () => {
  useApplyTransaction({
    state: { communityId: 'c1', userId: 'test-openid', status: 'active', memberId: 'member-1' },
  })

  const result = await handleApply({ communityId: 'c1' }, 'test-openid')

  expect(result).toEqual({ status: 'active', alreadyApplied: true })
  expect(applyTransaction.memberAdd).not.toHaveBeenCalled()
  expect(applyTransaction.communityUpdate).not.toHaveBeenCalled()
})

test('成员状态滞后时：以真实成员记录为准并在事务内自修复', async () => {
  useApplyTransaction({
    state: { communityId: 'c1', userId: 'test-openid', status: 'pending', memberId: 'member-1' },
    member: { communityId: 'c1', userId: 'test-openid', status: 'active' },
  })

  const result = await handleApply({ communityId: 'c1' }, 'test-openid')

  expect(result).toEqual({ status: 'active', alreadyApplied: true })
  expect(applyTransaction.stateSet).toHaveBeenCalledWith({
    data: expect.objectContaining({ status: 'active' }),
  })
  expect(applyTransaction.memberAdd).not.toHaveBeenCalled()
})

test('申请加入审批社区：创建 pending 记录，不递增 memberCount', async () => {
  useApplyTransaction({
    community: { _id: 'c1', name: '青山村', status: 'active', joinType: 'approval', memberCount: 0 },
  })

  const result = await handleApply({ communityId: 'c1' }, 'test-openid')

  expect(applyTransaction.memberAdd).toHaveBeenCalledWith({ data: expect.objectContaining({
    status: 'pending',
  }) })
  expect(applyTransaction.communityUpdate).not.toHaveBeenCalled()
  expect(result.status).toBe('pending')
})

test('申请加入审批社区：创建成员审批通知记录，不因通知未配置而阻断申请', async () => {
  useApplyTransaction({
    community: { _id: 'c1', name: '青山村', status: 'active', joinType: 'approval', memberCount: 0 },
  })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([]) // legacy member state
    .mockResolvedValueOnce([{ userId: 'community-admin', role: 'admin', status: 'active' }])
    .mockResolvedValueOnce([{ userId: 'super-admin', role: 'superAdmin', status: 'active' }])
    .mockResolvedValue([]) // subscription lookups
  const result = await handleApply({ communityId: 'c1' }, 'applicant-openid')

  expect(result.status).toBe('pending')
  expect(db.create).toHaveBeenCalledWith('admin_notifications', expect.objectContaining({
    eventType: 'member_join_pending',
    communityId: 'c1',
    recipientUserId: 'community-admin',
    status: 'skipped',
  }))
  expect(db.create).toHaveBeenCalledWith('admin_notifications', expect.objectContaining({
    eventType: 'member_join_pending',
    communityId: 'c1',
    recipientUserId: 'super-admin',
    status: 'skipped',
  }))
})

test('通知订阅：保存当前管理员的审批提醒订阅状态', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([])
  ;(db.create as jest.Mock).mockResolvedValue('sub-1')

  const result = await main({
    action: 'saveNotificationSubscription',
    eventType: 'member_join_pending',
    templateId: 'tmpl-member',
    status: 'accept',
  })

  expect(db.create).toHaveBeenCalledWith('admin_notification_subscriptions', expect.objectContaining({
    userId: 'test-openid',
    eventType: 'member_join_pending',
    templateId: 'tmpl-member',
    status: 'accept',
  }))
  expect(result).toEqual({ success: true })
})

test('通知配置：从云函数 env 返回小程序订阅模板 ID', async () => {
  process.env.APPROVAL_MEMBER_JOIN_TEMPLATE_ID = 'tmpl-member'
  process.env.APPROVAL_COMMUNITY_CREATE_TEMPLATE_ID = 'tmpl-community'

  const result = await main({ action: 'notificationConfig' })

  expect(result).toEqual({
    templates: [
      { eventType: 'member_join_pending', templateId: 'tmpl-member' },
      { eventType: 'community_create_pending', templateId: 'tmpl-community' },
    ],
  })
})

test('通知状态：返回最近一次需要重新授权的审批提醒原因', async () => {
  process.env.APPROVAL_MEMBER_JOIN_TEMPLATE_ID = 'tmpl-member'
  process.env.APPROVAL_COMMUNITY_CREATE_TEMPLATE_ID = 'tmpl-community'
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([
      { eventType: 'member_join_pending', templateId: 'tmpl-member', status: 'accept' },
    ])
    .mockResolvedValueOnce([
      {
        eventType: 'community_create_pending',
        status: 'skipped',
        reason: 'not_subscribed',
        createdAt: '2026-06-03T01:00:00.000Z',
      },
    ])

  const result = await main({ action: 'notificationStatus' })

  expect(db.query).toHaveBeenCalledWith('admin_notifications', {
    recipientUserId: 'test-openid',
  }, {
    orderBy: ['createdAt', 'desc'],
    limit: 10,
  })
  expect(result).toEqual(expect.objectContaining({
    needsAuthorization: true,
    lastBlockingReason: 'not_subscribed',
    subscriptions: [
      { eventType: 'member_join_pending', templateId: 'tmpl-member', status: 'accept' },
    ],
  }))
})

test('通知状态：用户重新授权后不再被旧的未订阅记录误判为需要授权', async () => {
  process.env.APPROVAL_MEMBER_JOIN_TEMPLATE_ID = 'tmpl-shared'
  process.env.APPROVAL_COMMUNITY_CREATE_TEMPLATE_ID = 'tmpl-shared'
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([
      {
        eventType: 'member_join_pending',
        templateId: 'tmpl-shared',
        status: 'accept',
        updatedAt: '2026-06-03T02:00:00.000Z',
      },
      {
        eventType: 'community_create_pending',
        templateId: 'tmpl-shared',
        status: 'accept',
        updatedAt: '2026-06-03T02:00:00.000Z',
      },
    ])
    .mockResolvedValueOnce([
      {
        eventType: 'member_join_pending',
        status: 'skipped',
        reason: 'not_subscribed',
        createdAt: '2026-06-03T01:00:00.000Z',
      },
    ])

  const result = await main({ action: 'notificationStatus' })

  expect(result).toEqual(expect.objectContaining({
    needsAuthorization: false,
    lastBlockingReason: '',
  }))
})

test('成员申请通知：按 env 字段映射发送订阅消息', async () => {
  process.env.APPROVAL_MEMBER_JOIN_TEMPLATE_ID = 'tmpl-member'
  process.env.APPROVAL_MEMBER_JOIN_TEMPLATE_FIELDS = JSON.stringify({
    communityName: 'thing5',
    action: 'thing6',
    time: 'time7',
    status: 'phrase8',
  })
  useApplyTransaction({
    community: { _id: 'c1', name: '青山村', status: 'active', joinType: 'approval', memberCount: 0 },
  })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([]) // legacy member state
    .mockResolvedValueOnce([{ userId: 'community-admin', role: 'admin', status: 'active' }])
    .mockResolvedValueOnce([]) // no super admins
    .mockResolvedValueOnce([{ _id: 'sub-1', status: 'accept' }])
  ;((cloud as any).openapi.subscribeMessage.send as jest.Mock).mockResolvedValue({})

  const result = await handleApply({ communityId: 'c1' }, 'applicant-openid')

  expect(result.status).toBe('pending')
  expect((cloud as any).openapi.subscribeMessage.send).toHaveBeenCalledWith(expect.objectContaining({
    touser: 'community-admin',
    templateId: 'tmpl-member',
    data: expect.objectContaining({
      thing5: { value: '青山村' },
      thing6: { value: '成员加入申请' },
      time7: expect.objectContaining({ value: expect.any(String) }),
      phrase8: { value: '待审批' },
    }),
  }))
  expect(db.create).toHaveBeenCalledWith('admin_notifications', expect.objectContaining({
    eventType: 'member_join_pending',
    status: 'sent',
    templateId: 'tmpl-member',
  }))
})

test('申请加入：已是成员时返回已有结果，不把网络重试当作错误', async () => {
  useApplyTransaction({ state: {
    communityId: 'c1', userId: 'test-openid', status: 'active', memberId: 'm1',
  } })

  await expect(handleApply({ communityId: 'c1' }, 'test-openid'))
    .resolves.toEqual({ status: 'active', alreadyApplied: true })
  expect(applyTransaction.memberAdd).not.toHaveBeenCalled()
})

test('退出社区：物理删除成员记录，memberCount 原子递减', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  const transaction = useMembershipTransitionTransaction({
    member: { _id: 'member-1', communityId: 'c1', userId: 'test-openid', role: 'member', status: 'active' },
  })

  await handleLeave({ communityId: 'c1' }, 'test-openid')

  expect(transaction.memberRemove).toHaveBeenCalled()
  expect(transaction.communityUpdate).toHaveBeenCalledWith({ data: { memberCount: 1 } })
})

test('退出社区：社区创建者不能退出', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-creator', status: 'active' }])
  const transaction = useMembershipTransitionTransaction({
    community: { _id: 'c1', creatorId: 'test-openid', memberCount: 1 },
    member: { _id: 'member-creator', communityId: 'c1', userId: 'test-openid', role: 'member', status: 'active' },
  })

  await expect(handleLeave({ communityId: 'c1' }, 'test-openid')).rejects.toThrow('社区创建者不能退出社区')
  expect(transaction.memberRemove).not.toHaveBeenCalled()
  expect(transaction.communityUpdate).not.toHaveBeenCalled()
})

test('退出社区：不是成员时抛出错误', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([])

  await expect(handleLeave({ communityId: 'c1' }, 'test-openid')).rejects.toThrow('不是社区成员')
})

test('退出社区：成员、计数和幂等状态在同一事务内提交', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'member-1', status: 'active' }])
  const memberRemove = jest.fn().mockResolvedValue({ stats: { removed: 1 } })
  const communityUpdate = jest.fn().mockResolvedValue({ stats: { updated: 1 } })
  const stateSet = jest.fn().mockResolvedValue({ stats: { updated: 1 } })
  const transaction = {
    collection: jest.fn((name: string) => ({
      doc: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ data: name === 'communities'
          ? { _id: 'c1', creatorId: 'creator-openid', memberCount: 2 }
          : name === 'community_members'
            ? { _id: 'member-1', communityId: 'c1', userId: 'test-openid', status: 'active' }
            : null }),
        remove: memberRemove,
        update: communityUpdate,
        set: stateSet,
      })),
    })),
  }
  ;(db.runTransaction as jest.Mock).mockImplementationOnce(async (callback) => callback(transaction))

  await handleLeave({ communityId: 'c1' }, 'test-openid')

  expect(db.runTransaction).toHaveBeenCalledTimes(1)
  expect(memberRemove).toHaveBeenCalled()
  expect(communityUpdate).toHaveBeenCalledWith({ data: { memberCount: 1 } })
  expect(stateSet).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'none', memberId: '' }) })
  expect(db.removeById).not.toHaveBeenCalled()
  expect(db.increment).not.toHaveBeenCalled()
  expect(db.updateWhere).not.toHaveBeenCalled()
})

test('管理员审批通过：memberCount 原子递增', async () => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce({ _id: 'test-openid', role: 'user' })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([]) // admin_accounts：不是 superAdmin
    .mockResolvedValueOnce([{ _id: 'admin-member', role: 'admin', status: 'active' }])
  const transaction = useMembershipTransitionTransaction()

  await handleMemberApprove({ communityId: 'c1', memberId: 'applicant-member' }, 'test-openid')

  expect(transaction.memberUpdate).toHaveBeenCalledWith({ data: expect.objectContaining({
    status: 'active', joinedAt: expect.any(String),
  }) })
  expect(transaction.communityUpdate).toHaveBeenCalledWith({ data: { memberCount: 3 } })
})

test('管理员审批通过：成员、计数和幂等状态在同一事务内提交', async () => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce({ _id: 'test-openid', role: 'superAdmin' })
  const memberUpdate = jest.fn().mockResolvedValue({ stats: { updated: 1 } })
  const communityUpdate = jest.fn().mockResolvedValue({ stats: { updated: 1 } })
  const stateSet = jest.fn().mockResolvedValue({ stats: { updated: 1 } })
  const transaction = {
    collection: jest.fn((name: string) => ({
      doc: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ data: name === 'communities'
          ? { _id: 'c1', memberCount: 2 }
          : name === 'community_members'
            ? { _id: 'applicant-member', communityId: 'c1', userId: 'applicant', status: 'pending' }
            : null }),
        update: name === 'communities' ? communityUpdate : memberUpdate,
        set: stateSet,
      })),
    })),
  }
  ;(db.runTransaction as jest.Mock).mockImplementationOnce(async (callback) => callback(transaction))

  await handleMemberApprove({ communityId: 'c1', memberId: 'applicant-member' }, 'test-openid')

  expect(db.runTransaction).toHaveBeenCalledTimes(1)
  expect(memberUpdate).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'active' }) })
  expect(communityUpdate).toHaveBeenCalledWith({ data: { memberCount: 3 } })
  expect(stateSet).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'active' }) })
  expect(db.updateWhere).not.toHaveBeenCalled()
  expect(db.increment).not.toHaveBeenCalled()
})

test('superAdmin 可在小程序端审批任意社区成员申请', async () => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce({ _id: 'test-openid', role: 'superAdmin' })
  const transaction = useMembershipTransitionTransaction()

  await handleMemberApprove({ communityId: 'c1', memberId: 'applicant-member' }, 'test-openid')

  expect(db.query).not.toHaveBeenCalledWith('community_members', expect.objectContaining({
    userId: 'test-openid',
    role: 'admin',
  }))
  expect(transaction.communityUpdate).toHaveBeenCalledWith({ data: { memberCount: 3 } })
})

test('管理员审批通过：非管理员无权操作', async () => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce({ _id: 'test-openid', role: 'user' })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([]) // admin_accounts：不是 superAdmin
    .mockResolvedValueOnce([]) // community_members：不是社区管理员

  await expect(handleMemberApprove({ communityId: 'c1', memberId: 'applicant-member' }, 'test-openid'))
    .rejects.toThrow('权限不足')
})

test('管理员拒绝申请：status 变为 rejected，设置 rejectedAt', async () => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce({ _id: 'test-openid', role: 'user' })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([]) // admin_accounts：不是 superAdmin
    .mockResolvedValueOnce([{ _id: 'admin-member', role: 'admin', status: 'active' }])
  const transaction = useMembershipTransitionTransaction()

  await handleMemberReject({ communityId: 'c1', memberId: 'applicant-member' }, 'test-openid')

  expect(transaction.memberUpdate).toHaveBeenCalledWith({ data: expect.objectContaining({
    status: 'rejected', rejectedAt: expect.any(String),
  }) })
  expect(transaction.communityUpdate).not.toHaveBeenCalled()
})

test('管理员审批通过：已非 pending 时不重复递增', async () => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce({ _id: 'test-openid', role: 'user' })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([]) // admin_accounts：不是 superAdmin
    .mockResolvedValueOnce([{ _id: 'admin-member', role: 'admin', status: 'active' }])
  const transaction = useMembershipTransitionTransaction({
    member: { _id: 'applicant-member', communityId: 'c1', userId: 'applicant', role: 'member', status: 'active' },
  })

  const result = await handleMemberApprove({ communityId: 'c1', memberId: 'applicant-member' }, 'test-openid')

  expect(transaction.communityUpdate).not.toHaveBeenCalled()
  expect(result.changed).toBe(false)
})

test('pendingList：返回社区所有待审批成员', async () => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce({ _id: 'test-openid', role: 'user' })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([]) // admin_accounts：不是 superAdmin
    .mockResolvedValueOnce([{ _id: 'admin-member', role: 'admin', status: 'active' }])
    .mockResolvedValueOnce([
      { _id: 'm1', status: 'pending' },
      { _id: 'm2', status: 'pending' },
    ])

  const result = await handlePendingList({ communityId: 'c1' }, 'test-openid')

  expect(db.query).toHaveBeenCalledWith('community_members', { communityId: 'c1', status: 'pending' })
  expect(result.members).toHaveLength(2)
})

test('pendingList：superAdmin 可查看任意社区待审批成员', async () => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce({ _id: 'test-openid', role: 'superAdmin' })
  ;(db.query as jest.Mock).mockResolvedValueOnce([
    { _id: 'm1', status: 'pending' },
  ])

  const result = await handlePendingList({ communityId: 'c1' }, 'test-openid')

  expect(db.query).toHaveBeenCalledTimes(1)
  expect(db.query).toHaveBeenCalledWith('community_members', { communityId: 'c1', status: 'pending' })
  expect(result.members).toHaveLength(1)
})

test('pendingList：后台账号已绑定 superAdmin 时无需等待 users.role 同步', async () => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce({ _id: 'test-openid', role: 'user' })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([
      { _id: 'admin-account-1', userId: 'test-openid', role: 'superAdmin', status: 'active' },
    ])
    .mockResolvedValueOnce([
      { _id: 'm1', status: 'pending' },
    ])

  const result = await handlePendingList({ communityId: 'c1' }, 'test-openid')

  expect(db.query).toHaveBeenCalledWith('admin_accounts', {
    userId: 'test-openid',
    status: 'active',
  }, { limit: 20 })
  expect(result.members).toHaveLength(1)
})

test('myStatus：按最新 appliedAt 返回状态', async () => {
  ;(db.query as jest.Mock).mockResolvedValue([
    { _id: 'm2', status: 'pending', appliedAt: '2026-04-24T10:00:00.000Z' },
  ])
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'c1', status: 'active' })

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

test('申请加入：pending 社区在平台审核前不可加入', async () => {
  useApplyTransaction({ community: {
    _id: 'pending-community',
    name: '待审核社区',
    status: 'pending',
    joinType: 'open',
    memberCount: 0,
  } })

  await expect(handleApply({ communityId: 'pending-community' }, 'test-openid'))
    .rejects.toThrow('社区暂不可加入')
  expect(db.create).not.toHaveBeenCalled()
})

test('myStatus：即使成员记录 active，父社区 pending 时也不可作为已加入社区', async () => {
  ;(db.query as jest.Mock).mockResolvedValue([
    { _id: 'm1', status: 'active', appliedAt: '2026-07-10T10:00:00.000Z' },
  ])
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'c1', status: 'pending' })

  const result = await handleMyStatus({ communityId: 'c1' }, 'test-openid')

  expect(result).toEqual({ isMember: false, status: null })
})

test('myCommunities：只返回 active 成员且社区状态为 active 的社区', async () => {
  ;(db.query as jest.Mock).mockResolvedValue([
    { communityId: 'c1', status: 'active', joinedAt: '2026-04-24T10:00:00.000Z' },
    { communityId: 'c2', status: 'active', joinedAt: '2026-04-23T10:00:00.000Z' },
  ])
  ;(db.getByIds as jest.Mock).mockResolvedValue([
    { _id: 'c1', name: '青山村', status: 'active' },
    { _id: 'c2', name: '旧社区', status: 'disabled' },
  ])

  const result = await handleMyCommunities('test-openid')

  expect(result.communities).toEqual([{
    _id: 'c1',
    name: '青山村',
    status: 'active',
    viewerStatus: 'active',
    viewerRole: null,
  }])
  expect(db.getByIds).toHaveBeenCalledTimes(1)
  expect(db.getByIds).toHaveBeenCalledWith('communities', ['c1', 'c2'])
  expect(db.getById).not.toHaveBeenCalledWith('communities', expect.any(String))
})

test('myCommunities：成员仍可通过 main 看到 discoverable=false 的 active 社区', async () => {
  ;(db.query as jest.Mock).mockResolvedValue([
    { communityId: 'hidden', status: 'active', joinedAt: '2026-07-13T10:00:00.000Z' },
  ])
  ;(db.getByIds as jest.Mock).mockResolvedValue([{
    _id: 'hidden',
    name: '测试社区',
    status: 'active',
    discoverable: false,
  }])

  const result = await main({ action: 'myCommunities' })

  expect(result).toEqual({
    communities: [{
      _id: 'hidden',
      name: '测试社区',
      status: 'active',
      discoverable: false,
      viewerStatus: 'active',
      viewerRole: null,
    }],
  })
})

test('myCommunities：保留成员顺序并暴露管理员角色', async () => {
  ;(db.query as jest.Mock).mockResolvedValue([
    { communityId: 'c2', status: 'active', role: 'admin', joinedAt: '2026-07-14T10:00:00.000Z' },
    { communityId: 'c1', status: 'active', role: 'member', joinedAt: '2026-07-13T10:00:00.000Z' },
  ])
  ;(db.getByIds as jest.Mock).mockResolvedValue([
    { _id: 'c2', name: '管理社区', status: 'active' },
    { _id: 'c1', name: '普通社区', status: 'active' },
  ])

  const result = await handleMyCommunities('test-openid')

  expect(result.communities).toEqual([
    expect.objectContaining({ _id: 'c2', viewerStatus: 'active', viewerRole: 'admin' }),
    expect.objectContaining({ _id: 'c1', viewerStatus: 'active', viewerRole: 'member' }),
  ])
  expect(db.getByIds).toHaveBeenCalledTimes(1)
})

test('myCommunities：同一社群存在重复 active 记录时保留 joinedAt 最新的一条', async () => {
  ;(db.query as jest.Mock).mockResolvedValue([
    { communityId: 'c1', status: 'active', role: 'admin', joinedAt: '2026-07-14T10:00:00.000Z' },
    { communityId: 'c1', status: 'active', role: 'member', joinedAt: '2026-07-13T10:00:00.000Z' },
  ])
  ;(db.getByIds as jest.Mock).mockResolvedValue([
    { _id: 'c1', name: '管理社区', status: 'active' },
  ])

  const result = await handleMyCommunities('viewer')

  expect(result.communities).toEqual([
    expect.objectContaining({ _id: 'c1', viewerRole: 'admin' }),
  ])
})

test.each([0, 1, 5, 20])('myCommunities：%i 个已加入社群仍保持一次成员查询和一次批量读取', async (count) => {
  const memberships = Array.from({ length: count }, (_, index) => ({
    communityId: `c${index}`,
    status: 'active',
    role: 'member',
    joinedAt: `2026-07-14T10:${String(index).padStart(2, '0')}:00.000Z`,
  }))
  const communities = memberships.map((membership, index) => ({
    _id: membership.communityId,
    name: `社区${index}`,
    status: 'active',
  }))
  ;(db.query as jest.Mock).mockResolvedValue(memberships)
  ;(db.getByIds as jest.Mock).mockResolvedValue(communities)

  const result = await handleMyCommunities('viewer')

  expect(result.communities).toHaveLength(count)
  expect(db.query).toHaveBeenCalledTimes(1)
  expect(db.query).toHaveBeenCalledWith('community_members', {
    userId: 'viewer',
    status: 'active',
  }, {
    orderBy: ['joinedAt', 'desc'],
    limit: 100,
  })
  expect(db.getByIds).toHaveBeenCalledTimes(1)
})

test('myCommunities：未登录（openid 空）时返回空列表，不抛错（后端兜底）', async () => {
  const result = await handleMyCommunities('')
  expect(result).toEqual({ communities: [] })
  // 未登录时不应该触发任何数据库查询
  expect(db.query).not.toHaveBeenCalled()
})

test('main(): 未知 action 抛出错误', async () => {
  await expect(main({ action: 'unknown' })).rejects.toThrow('Unknown action: unknown')
})
