/**
 * L2 tests for admin role-scoped authorization.
 * Covers:
 *   - superAdmin-only actions blocked for communityAdmin
 *   - community.list filters by ownership for communityAdmin
 *   - community-scoped actions (section/member/post) enforce ownership
 */

jest.mock('../lib/db', () => ({
  getById: jest.fn(),
  create: jest.fn(),
  updateById: jest.fn(),
  updateWhere: jest.fn(),
  removeById: jest.fn(),
  softDelete: jest.fn(),
  query: jest.fn(),
  increment: jest.fn(),
}))
jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  getWXContext: jest.fn().mockReturnValue({ OPENID: '' }),
  DYNAMIC_CURRENT_ENV: 'test',
}))
jest.mock('uuid', () => ({ v4: jest.fn().mockReturnValue('mocked-uuid') }))

import * as db from '../lib/db'
import { main as _adminMain } from '../functions/admin/index'

const adminMain = _adminMain as (event: any) => Promise<any>

function internalCall(action: string, params: Record<string, any>, actAs: any) {
  return adminMain({ action, _actAs: actAs, ...params })
}

const ADMIN_CTX_SUPER = {
  accountId: 'acc-s', role: 'superAdmin', userId: 'u-super', username: 'boss',
}
const ADMIN_CTX_COMMUNITY = {
  accountId: 'acc-c', role: 'communityAdmin', userId: 'u-c1', username: 'alice',
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('superAdmin-only gate', () => {
  const blockedActions: Array<[string, Record<string, any>]> = [
    ['community.approve', { communityId: 'c1' }],
    ['community.reject', { communityId: 'c1' }],
    ['community.disable', { communityId: 'c1' }],
    ['community.restore', { communityId: 'c1' }],
    ['community.hardDelete', { communityId: 'c1' }],
    ['community.listDisabled', {}],
    ['user.setSuperAdmin', { openId: 'u' }],
    ['admin.listAccounts', {}],
    ['admin.createAccount', { username: 'x', password: '123456' }],
    ['admin.deleteAccount', { accountId: 'a' }],
    ['appConfig.getGuestIntro', {}],
    ['appConfig.updateGuestIntro', { config: { title: 'x' } }],
  ]
  test.each(blockedActions)('communityAdmin cannot call %s', async (action, params) => {
    await expect(internalCall(action, params, ADMIN_CTX_COMMUNITY)).rejects.toThrow(/权限不足/)
  })
})

describe('community.list ownership filter', () => {
  test('superAdmin sees all', async () => {
    ;(db.query as jest.Mock).mockResolvedValue([])
    await internalCall('community.list', {}, ADMIN_CTX_SUPER)
    const calls = (db.query as jest.Mock).mock.calls.filter(c => c[0] === 'communities')
    // 分四种 status 查，一共 4 次
    expect(calls.length).toBe(4)
  })

  test('communityAdmin with no owned ids returns empty', async () => {
    ;(db.query as jest.Mock)
      .mockResolvedValueOnce([]) // communities where creatorId=u-c1
      .mockResolvedValueOnce([]) // community_members where role=admin
    const res = await internalCall('community.list', {}, ADMIN_CTX_COMMUNITY)
    expect(res.communities).toEqual([])
  })

  test('communityAdmin sees union of creator + member-admin', async () => {
    ;(db.query as jest.Mock)
      .mockResolvedValueOnce([{ _id: 'c1' }]) // creator
      .mockResolvedValueOnce([{ communityId: 'c2' }]) // admin member
    ;(db.getById as jest.Mock)
      .mockResolvedValueOnce({ _id: 'c1', status: 'active', createdAt: '2026-04-01' })
      .mockResolvedValueOnce({ _id: 'c2', status: 'pending', createdAt: '2026-04-20' })
    const res = await internalCall('community.list', {}, ADMIN_CTX_COMMUNITY)
    expect(res.communities.map((c: any) => c._id).sort()).toEqual(['c1', 'c2'])
  })
})

describe('community-scoped ownership', () => {
  test('communityAdmin section.list rejects when not owner/admin', async () => {
    ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'c9', creatorId: 'someone-else' })
    ;(db.query as jest.Mock).mockResolvedValue([]) // not an admin member
    await expect(
      internalCall('section.list', { communityId: 'c9' }, ADMIN_CTX_COMMUNITY)
    ).rejects.toThrow(/权限不足/)
  })

  test('communityAdmin section.list allowed when creator matches', async () => {
    ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'c1', creatorId: 'u-c1' })
    ;(db.query as jest.Mock).mockResolvedValue([])
    await expect(
      internalCall('section.list', { communityId: 'c1' }, ADMIN_CTX_COMMUNITY)
    ).resolves.toHaveProperty('sections')
  })

  test('section.updateWidgets resolves communityId via sectionId and enforces ownership', async () => {
    ;(db.getById as jest.Mock).mockImplementation((coll: string, id: string) => {
      if (coll === 'sections' && id === 's-foreign') return Promise.resolve({ _id: 's-foreign', communityId: 'c-foreign', type: 'evergreen', widgets: [] })
      if (coll === 'communities' && id === 'c-foreign') return Promise.resolve({ _id: 'c-foreign', creatorId: 'other' })
      return Promise.reject(new Error('not found'))
    })
    ;(db.query as jest.Mock).mockResolvedValue([])
    await expect(
      internalCall('section.updateWidgets', { sectionId: 's-foreign', widgets: [] }, ADMIN_CTX_COMMUNITY)
    ).rejects.toThrow(/权限不足/)
  })
})

describe('community.approve auto-creates communityAdmin', () => {
  test('creator without existing admin account → new account created with userId=openId', async () => {
    ;(db.updateById as jest.Mock).mockResolvedValue(undefined)
    // getById('communities', id) → community with creatorId
    ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'c1', creatorId: 'open-id-abcdef1234' })
    // findAccountByUserId → none, findAccountByUsername (collision check) → none
    ;(db.query as jest.Mock)
      .mockResolvedValueOnce([])  // findAccountByUserId
      .mockResolvedValueOnce([])  // findAccountByUsername (collision check)
    ;(db.create as jest.Mock).mockResolvedValue('new-admin-acc')

    const res = await internalCall('community.approve', { communityId: 'c1' }, ADMIN_CTX_SUPER)
    expect(res.success).toBe(true)
    expect(res.adminAccount.alreadyExisted).toBe(false)
    expect(res.adminAccount.username).toMatch(/^c-/)
    expect(typeof res.adminAccount.password).toBe('string')

    const adminCreate = (db.create as jest.Mock).mock.calls.find((c) => c[0] === 'admin_accounts')
    expect(adminCreate).toBeTruthy()
    expect(adminCreate[1]).toEqual(expect.objectContaining({
      userId: 'open-id-abcdef1234',
      role: 'communityAdmin',
      status: 'active',
    }))
  })

  test('creator already has admin account → no duplicate, returns alreadyExisted=true', async () => {
    ;(db.updateById as jest.Mock).mockResolvedValue(undefined)
    ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'c2', creatorId: 'open-id-xyz' })
    ;(db.query as jest.Mock).mockResolvedValueOnce([{
      _id: 'existing', username: 'c-old', userId: 'open-id-xyz', role: 'communityAdmin', status: 'active',
    }])

    const res = await internalCall('community.approve', { communityId: 'c2' }, ADMIN_CTX_SUPER)
    expect(res.adminAccount.alreadyExisted).toBe(true)
    expect(res.adminAccount.username).toBe('c-old')
    expect(res.adminAccount.password).toBeUndefined()
    // 不应再次写入 admin_accounts
    const adminCreates = (db.create as jest.Mock).mock.calls.filter((c) => c[0] === 'admin_accounts')
    expect(adminCreates.length).toBe(0)
  })

  test('community without creatorId returns adminAccount=null', async () => {
    ;(db.updateById as jest.Mock).mockResolvedValue(undefined)
    ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'c3', creatorId: '' })
    const res = await internalCall('community.approve', { communityId: 'c3' }, ADMIN_CTX_SUPER)
    expect(res.success).toBe(true)
    expect(res.adminAccount).toBeNull()
  })
})

describe('community.createAdmin', () => {
  test('communityAdmin create goes to pending and sets creatorId', async () => {
    ;(db.create as jest.Mock).mockResolvedValue('c-new')
    ;(db.updateById as jest.Mock).mockResolvedValue(undefined)

    await internalCall('community.createAdmin', {
      name: 'hood', description: 'd', coverImage: '', location: { address: '', lat: 0, lng: 0 }, joinType: 'open',
    }, ADMIN_CTX_COMMUNITY)

    const createCall = (db.create as jest.Mock).mock.calls.find(c => c[0] === 'communities')
    expect(createCall[1]).toEqual(expect.objectContaining({
      creatorId: 'u-c1',
      status: 'pending',
    }))
    // communityAdmin 不应被升级为 active
    expect(db.updateById).not.toHaveBeenCalledWith('communities', 'c-new', { status: 'active' })
  })

  test('superAdmin create auto-activates', async () => {
    ;(db.create as jest.Mock).mockResolvedValue('c-new')
    ;(db.updateById as jest.Mock).mockResolvedValue(undefined)

    await internalCall('community.createAdmin', {
      name: 'hood', description: 'd', coverImage: '', location: { address: '', lat: 0, lng: 0 }, joinType: 'open',
    }, ADMIN_CTX_SUPER)

    expect(db.updateById).toHaveBeenCalledWith('communities', 'c-new', { status: 'active' })
    expect(db.create).not.toHaveBeenCalledWith('admin_notifications', expect.anything())
  })
})

describe('community.updateMeta joinType', () => {
  test('updates joinType to open', async () => {
    ;(db.updateById as jest.Mock).mockResolvedValue(undefined)

    await internalCall('community.updateMeta', {
      communityId: 'c1',
      joinType: 'open',
    }, ADMIN_CTX_SUPER)

    expect(db.updateById).toHaveBeenCalledWith('communities', 'c1', { joinType: 'open' })
  })

  test('rejects invalid joinType', async () => {
    await expect(internalCall('community.updateMeta', {
      communityId: 'c1',
      joinType: 'wxid',
    }, ADMIN_CTX_SUPER)).rejects.toThrow('joinType must be open or approval')
  })
})
