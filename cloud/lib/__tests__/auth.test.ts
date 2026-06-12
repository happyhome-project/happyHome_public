jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  database: () => ({
    collection: () => ({}),
    command: {},
  }),
  DYNAMIC_CURRENT_ENV: 'test',
}))
jest.mock('../db', () => ({
  getById: jest.fn(),
  query: jest.fn(),
}))

import { assertSuperAdmin, assertCommunityAdmin } from '../auth'
import * as db from '../db'

beforeEach(() => jest.clearAllMocks())

describe('assertSuperAdmin', () => {
  test('superAdmin 角色通过校验', async () => {
    ;(db.getById as jest.Mock).mockResolvedValue({ role: 'superAdmin' })
    await expect(assertSuperAdmin('admin-openid')).resolves.toBeUndefined()
    expect(db.getById).toHaveBeenCalledWith('users', 'admin-openid')
  })

  test('users 仍是普通角色但后台账号已绑定 superAdmin 时通过校验', async () => {
    ;(db.getById as jest.Mock).mockResolvedValue({ role: 'user' })
    ;(db.query as jest.Mock).mockResolvedValue([
      { _id: 'admin-account-1', userId: 'admin-openid', role: 'superAdmin', status: 'active' },
    ])

    await expect(assertSuperAdmin('admin-openid')).resolves.toBeUndefined()
    expect(db.query).toHaveBeenCalledWith('admin_accounts', {
      userId: 'admin-openid',
      status: 'active',
    }, { limit: 20 })
  })

  test('用户记录缺失但后台账号已绑定 superAdmin 时通过校验', async () => {
    ;(db.getById as jest.Mock).mockRejectedValue(new Error('not found'))
    ;(db.query as jest.Mock).mockResolvedValue([
      { _id: 'admin-account-1', userId: 'admin-openid', role: 'superAdmin', status: 'active' },
    ])

    await expect(assertSuperAdmin('admin-openid')).resolves.toBeUndefined()
  })

  test('普通 user 角色抛出权限不足', async () => {
    ;(db.getById as jest.Mock).mockResolvedValue({ role: 'user' })
    ;(db.query as jest.Mock).mockResolvedValue([])
    await expect(assertSuperAdmin('user-openid')).rejects.toThrow('权限不足')
  })

  test('用户不存在时 getById 抛出错误向上传播', async () => {
    ;(db.getById as jest.Mock).mockRejectedValue(new Error('not found'))
    ;(db.query as jest.Mock).mockResolvedValue([])
    await expect(assertSuperAdmin('nonexistent')).rejects.toThrow('not found')
  })
})

describe('assertCommunityAdmin', () => {
  test('社区管理员通过校验', async () => {
    ;(db.query as jest.Mock).mockResolvedValue([{ role: 'admin', status: 'active' }])
    await expect(assertCommunityAdmin('admin-id', 'c1')).resolves.toBeUndefined()
    expect(db.query).toHaveBeenCalledWith('community_members', {
      communityId: 'c1',
      userId: 'admin-id',
      role: 'admin',
      status: 'active',
    })
  })

  test('非管理员（普通成员）抛出权限不足', async () => {
    ;(db.query as jest.Mock).mockResolvedValue([])
    await expect(assertCommunityAdmin('member-id', 'c1')).rejects.toThrow('权限不足')
  })

  test('query 返回 null 时抛出权限不足', async () => {
    ;(db.query as jest.Mock).mockResolvedValue(null)
    await expect(assertCommunityAdmin('member-id', 'c1')).rejects.toThrow('权限不足')
  })
})
