/**
 * L2 integration tests for admin auth + session middleware.
 * Covers:
 *   - public actions (auth.login / auth.wxLogin) don't require session
 *   - session lookup blocks non-public actions without valid token
 *   - auth.login validates username/password and signs a session
 *   - legacy fallback honors ADMIN_LEGACY_TOKEN_FALLBACK=1
 */

process.env.BOOTSTRAP_ADMIN_ENABLED = 'true'
process.env.BOOTSTRAP_ADMIN_USERNAME = 'admin'
process.env.BOOTSTRAP_ADMIN_PASSWORD = 'happyhome2024'

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
import { generateSalt, hashPassword } from '../lib/auth'
import { main as _adminMain } from '../functions/admin/index'

const adminMain = _adminMain as (event: any) => Promise<any>

function httpEvent(action: string, params: Record<string, any> = {}, token?: string) {
  return {
    httpMethod: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: JSON.stringify({ action, ...params }),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.ADMIN_LEGACY_TOKEN_FALLBACK
})

describe('admin auth: public actions', () => {
  test('auth.login with correct password returns token + role', async () => {
    const salt = generateSalt()
    const hash = hashPassword('pw123456', salt)
    ;(db.query as jest.Mock).mockResolvedValue([{
      _id: 'acc-1', username: 'boss', passwordHash: hash, passwordSalt: salt,
      userId: 'u1', role: 'superAdmin', status: 'active',
    }])
    ;(db.create as jest.Mock).mockResolvedValue('session-token-xxx')

    const res = await adminMain(httpEvent('auth.login', { username: 'boss', password: 'pw123456' }))
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.role).toBe('superAdmin')
    expect(body.userId).toBe('u1')
    expect(typeof body.token).toBe('string')
    expect(db.create).toHaveBeenCalledWith('admin_sessions', expect.objectContaining({
      accountId: 'acc-1',
      role: 'superAdmin',
      userId: 'u1',
    }))
  })

  test('auth.login with wrong password returns error status', async () => {
    const salt = generateSalt()
    const hash = hashPassword('right', salt)
    ;(db.query as jest.Mock).mockResolvedValue([{
      _id: 'acc-1', username: 'boss', passwordHash: hash, passwordSalt: salt,
      userId: '', role: 'superAdmin', status: 'active',
    }])
    const res = await adminMain(httpEvent('auth.login', { username: 'boss', password: 'wrong' }))
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(JSON.parse(res.body).error).toMatch(/用户名或密码/)
  })

  test('auth.login with disabled account rejects', async () => {
    const salt = generateSalt()
    const hash = hashPassword('pw', salt)
    ;(db.query as jest.Mock).mockResolvedValue([{
      _id: 'a', username: 'x', passwordHash: hash, passwordSalt: salt,
      userId: '', role: 'superAdmin', status: 'disabled',
    }])
    const res = await adminMain(httpEvent('auth.login', { username: 'x', password: 'pw' }))
    expect(JSON.parse(res.body).error).toMatch(/停用/)
  })

  test('legacy auth.wxLogin is removed (replaced by 3 sub-actions)', async () => {
    // 旧 stub action 已删除；现在落到 session 守卫，无 token → 401
    const res = await adminMain(httpEvent('auth.wxLogin', { code: 'c' }))
    expect(res.statusCode).toBe(401)
  })
})

describe('admin auth: bootstrap on first login', () => {
  beforeEach(() => {
    process.env.BOOTSTRAP_ADMIN_USERNAME = 'admin'
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'happyhome2024'
  })

  test('admin_accounts empty + correct bootstrap creds → seed superAdmin and login', async () => {
    // findAccountByUsername → empty
    ;(db.query as jest.Mock)
      .mockResolvedValueOnce([])  // findAccountByUsername
      .mockResolvedValueOnce([])  // total empty check
    ;(db.create as jest.Mock).mockResolvedValueOnce('seeded-account-id') // admin_accounts.add
    ;(db.create as jest.Mock).mockResolvedValueOnce('any-session-id')    // admin_sessions.add

    const res = await adminMain(httpEvent('auth.login', { username: 'admin', password: 'happyhome2024' }))
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.role).toBe('superAdmin')
    // 验证 admin_accounts 上确有 seed 写入
    const accountWrites = (db.create as jest.Mock).mock.calls.filter((c) => c[0] === 'admin_accounts')
    expect(accountWrites.length).toBe(1)
    expect(accountWrites[0][1]).toEqual(expect.objectContaining({
      username: 'admin', role: 'superAdmin', status: 'active', createdBy: 'bootstrap',
    }))
  })

  test('admin_accounts NOT empty + bootstrap creds → does NOT seed (treated as wrong password)', async () => {
    ;(db.query as jest.Mock)
      .mockResolvedValueOnce([])  // findAccountByUsername (no exact match)
      .mockResolvedValueOnce([{ _id: 'someone-else' }]) // total check finds existing accounts
    const res = await adminMain(httpEvent('auth.login', { username: 'admin', password: 'happyhome2024' }))
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(JSON.parse(res.body).error).toMatch(/用户名或密码错误/)
  })

  test('wrong password against bootstrap username does not seed', async () => {
    ;(db.query as jest.Mock).mockResolvedValueOnce([]) // findAccountByUsername
    const res = await adminMain(httpEvent('auth.login', { username: 'admin', password: 'wrong' }))
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    // 不应该走到 total 检查、也不应有 create
    expect(db.create).not.toHaveBeenCalled()
  })
})

describe('admin auth: session middleware', () => {
  test('non-public action without token returns 401', async () => {
    const res = await adminMain(httpEvent('community.list'))
    expect(res.statusCode).toBe(401)
  })

  test('non-public action with unknown token returns 401', async () => {
    ;(db.getById as jest.Mock).mockRejectedValue(new Error('not found'))
    const res = await adminMain(httpEvent('community.list', {}, 'bogus'))
    expect(res.statusCode).toBe(401)
  })

  test('non-public action with expired session returns 401', async () => {
    ;(db.getById as jest.Mock).mockResolvedValue({
      _id: 't', accountId: 'a', role: 'superAdmin', userId: '',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    const res = await adminMain(httpEvent('community.list', {}, 't'))
    expect(res.statusCode).toBe(401)
    expect(db.removeById).toHaveBeenCalledWith('admin_sessions', 't')
  })

  test('valid session grants access and auth.me echoes ctx', async () => {
    ;(db.getById as jest.Mock).mockResolvedValue({
      _id: 't', accountId: 'a', role: 'superAdmin', userId: 'u-super', username: 'boss',
      expiresAt: new Date(Date.now() + 1e9).toISOString(),
    })
    const res = await adminMain(httpEvent('auth.me', {}, 't'))
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.role).toBe('superAdmin')
    expect(body.userId).toBe('u-super')
    expect(body.username).toBe('boss')
  })

  test('session without userId refreshes binding from admin account', async () => {
    ;(db.getById as jest.Mock)
      .mockResolvedValueOnce({
        _id: 't',
        accountId: 'acc-admin',
        role: 'superAdmin',
        userId: '',
        username: 'admin',
        expiresAt: new Date(Date.now() + 1e9).toISOString(),
      })
      .mockResolvedValueOnce({
        _id: 'acc-admin',
        role: 'superAdmin',
        userId: 'openid-year',
        username: 'admin',
        status: 'active',
      })
    ;(db.updateById as jest.Mock).mockResolvedValue({})

    const res = await adminMain(httpEvent('auth.me', {}, 't'))

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.userId).toBe('openid-year')
    expect(db.updateById).toHaveBeenCalledWith('admin_sessions', 't', { userId: 'openid-year' })
  })

  test('admin.bindWechat syncs existing sessions so binding takes effect immediately', async () => {
    ;(db.getById as jest.Mock)
      .mockResolvedValueOnce({
        _id: 'session-token',
        accountId: 'acc-admin',
        role: 'superAdmin',
        userId: '',
        username: 'admin',
        expiresAt: new Date(Date.now() + 1e9).toISOString(),
      })
      .mockResolvedValueOnce({
        _id: 'acc-admin',
        role: 'superAdmin',
        userId: '',
        username: 'admin',
        status: 'active',
      })
      .mockResolvedValueOnce({
        _id: 'acc-admin',
        role: 'superAdmin',
        userId: '',
        username: 'admin',
        status: 'active',
      })
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { errCode: -502001 }))
    ;(db.query as jest.Mock).mockResolvedValueOnce([])
    ;(db.updateById as jest.Mock).mockResolvedValue({})
    ;(db.create as jest.Mock).mockResolvedValue('openid-year')
    ;(db.updateWhere as jest.Mock).mockResolvedValue({})

    const res = await adminMain(httpEvent(
      'admin.bindWechat',
      { accountId: 'acc-admin', openId: 'openid-year' },
      'session-token',
    ))

    expect(res.statusCode).toBe(200)
    expect(db.updateById).toHaveBeenCalledWith('admin_accounts', 'acc-admin', { userId: 'openid-year' })
    expect(db.updateWhere).toHaveBeenCalledWith('admin_sessions', { accountId: 'acc-admin' }, { userId: 'openid-year' })
  })
})

describe('admin auth: legacy fallback', () => {
  test('with ADMIN_LEGACY_TOKEN_FALLBACK=1 and matching token, legacy request is honored as superAdmin', async () => {
    process.env.ADMIN_LEGACY_TOKEN_FALLBACK = '1'
    process.env.ADMIN_TOKEN = 'legacy-token-xyz'
    // community.list 会尝试查 communities；用空返回即可
    ;(db.query as jest.Mock).mockResolvedValue([])

    const res = await adminMain(httpEvent('community.list', {}, 'legacy-token-xyz'))
    expect(res.statusCode).toBe(200)
  })

  test('without fallback flag, legacy token is rejected', async () => {
    process.env.ADMIN_TOKEN = 'legacy-token-xyz'
    ;(db.getById as jest.Mock).mockRejectedValue(new Error('not found'))
    const res = await adminMain(httpEvent('community.list', {}, 'legacy-token-xyz'))
    expect(res.statusCode).toBe(401)
  })
})
