// 微信扫码登录 — auth.wxLoginStart / wxLoginPoll / wxLoginConfirm 三段
//
// 关键 mock：
//   wx-openapi.getWxacodeUnlimited → 返回 fake PNG buffer（HTTP fallback）
//   wx-server-sdk.getWXContext → 返回 { OPENID: 'mock-openid-x' }
//   db: 模拟 admin_login_tickets / admin_accounts / admin_sessions
//
// 注意：测试通过 main(event) 入口（参考 feedback_test_through_main.md）

const mockGetWxacodeUnlimited = jest.fn()
const mockGetWXContext = jest.fn(() => ({ OPENID: '' }))

jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  DYNAMIC_CURRENT_ENV: 'test',
  getWXContext: mockGetWXContext,
}))

jest.mock('../../../lib/wx-openapi', () => ({
  getWxacodeUnlimited: mockGetWxacodeUnlimited,
  getAccessToken: jest.fn(),
}))

jest.mock('../../../lib/db', () => ({
  getById: jest.fn(),
  create: jest.fn(),
  updateById: jest.fn(),
  updateWhere: jest.fn(),
  removeById: jest.fn(),
  softDelete: jest.fn(),
  query: jest.fn(),
  increment: jest.fn(),
}))

jest.mock('../../../lib/storage', () => ({
  deleteFile: jest.fn(),
  requestUploadMetadata: jest.fn(),
}))

jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mocked-uuid'),
}))

import { main } from '../index'
import * as db from '../../../lib/db'

beforeEach(() => {
  jest.clearAllMocks()
  mockGetWXContext.mockReturnValue({ OPENID: '' })
})

// ─────────────────────────────────────────────────────────
// auth.wxLoginStart — admin-web 端发起扫码登录
// ─────────────────────────────────────────────────────────

describe('auth.wxLoginStart', () => {
  test('生成 32 hex chars ticket + base64 PNG，写入 admin_login_tickets', async () => {
    mockGetWxacodeUnlimited.mockResolvedValue(Buffer.from('FAKE_PNG_BYTES'))

    const result: any = await main({ action: 'auth.wxLoginStart', httpMethod: 'POST', body: JSON.stringify({ action: 'auth.wxLoginStart' }) })
    const payload = JSON.parse(result.body)

    expect(payload.ticket).toMatch(/^[0-9a-f]{32}$/)
    expect(payload.qrCodeBase64).toMatch(/^data:image\/png;base64,/)
    expect(payload.expiresAt).toEqual(expect.any(String))

    // getWxacodeUnlimited 调用参数（HTTP fallback 实现的入参形状）
    expect(mockGetWxacodeUnlimited).toHaveBeenCalledWith(expect.objectContaining({
      scene: payload.ticket,
      page: 'pages/admin-login/index',
      width: 280,
    }))

    // ticket 写入 db
    const createCalls = (db.create as jest.Mock).mock.calls
    const ticketWrite = createCalls.find(([col]) => col === 'admin_login_tickets')
    expect(ticketWrite).toBeTruthy()
    expect(ticketWrite![1]).toMatchObject({
      _id: payload.ticket,
      status: 'pending',
    })
  })

  test('getWxacodeUnlimited 抛错 → 整个 start 失败，不写 ticket', async () => {
    mockGetWxacodeUnlimited.mockRejectedValue(new Error('WX_APPID 未配置'))

    const result: any = await main({ action: 'auth.wxLoginStart', httpMethod: 'POST', body: JSON.stringify({ action: 'auth.wxLoginStart' }) })
    expect(result.statusCode).toBe(500)
    const payload = JSON.parse(result.body)
    expect(payload.error).toMatch(/生成小程序码失败/)

    // 没有写 ticket
    const createCalls = (db.create as jest.Mock).mock.calls
    const ticketWrite = createCalls.find(([col]) => col === 'admin_login_tickets')
    expect(ticketWrite).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────
// auth.wxLoginPoll — admin-web 轮询 ticket
// ─────────────────────────────────────────────────────────

describe('auth.wxLoginPoll', () => {
  test('ticket 不存在 → 返回 expired', async () => {
    ;(db.getById as jest.Mock).mockRejectedValueOnce(new Error('not found'))

    const result: any = await main({
      action: 'auth.wxLoginPoll',
      httpMethod: 'POST',
      body: JSON.stringify({ action: 'auth.wxLoginPoll', ticket: 'no-such-ticket' }),
    })
    expect(JSON.parse(result.body)).toEqual({ status: 'expired' })
  })

  test('ticket 仍 pending 但过期 → 自动标 expired', async () => {
    const longAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    ;(db.getById as jest.Mock).mockResolvedValueOnce({
      _id: 't1', status: 'pending', createdAt: longAgo, expiresAt: longAgo,
    })

    const result: any = await main({
      action: 'auth.wxLoginPoll',
      httpMethod: 'POST',
      body: JSON.stringify({ action: 'auth.wxLoginPoll', ticket: 't1' }),
    })
    expect(JSON.parse(result.body)).toEqual({ status: 'expired' })
    expect(db.updateById).toHaveBeenCalledWith('admin_login_tickets', 't1', { status: 'expired' })
  })

  test('pending 未过期 → 透传 status', async () => {
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    ;(db.getById as jest.Mock).mockResolvedValueOnce({
      _id: 't2', status: 'pending', createdAt: new Date().toISOString(), expiresAt: future,
    })

    const result: any = await main({
      action: 'auth.wxLoginPoll',
      httpMethod: 'POST',
      body: JSON.stringify({ action: 'auth.wxLoginPoll', ticket: 't2' }),
    })
    expect(JSON.parse(result.body)).toMatchObject({ status: 'pending' })
  })

  test('no_account → 透传 + 带 userId 提示', async () => {
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    ;(db.getById as jest.Mock).mockResolvedValueOnce({
      _id: 't3', status: 'no_account', userId: 'openid-xyz', createdAt: '...', expiresAt: future,
    })

    const result: any = await main({
      action: 'auth.wxLoginPoll',
      httpMethod: 'POST',
      body: JSON.stringify({ action: 'auth.wxLoginPoll', ticket: 't3' }),
    })
    expect(JSON.parse(result.body)).toEqual({ status: 'no_account', userId: 'openid-xyz' })
  })

  test('success → 返回 token + role + invalidate ticket', async () => {
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    ;(db.getById as jest.Mock).mockResolvedValueOnce({
      _id: 't4', status: 'success',
      token: 'session-token-abc',
      role: 'superAdmin',
      userId: 'openid-admin-1',
      username: 'super',
      createdAt: '...', expiresAt: future,
    })

    const result: any = await main({
      action: 'auth.wxLoginPoll',
      httpMethod: 'POST',
      body: JSON.stringify({ action: 'auth.wxLoginPoll', ticket: 't4' }),
    })
    expect(JSON.parse(result.body)).toEqual({
      status: 'success',
      token: 'session-token-abc',
      role: 'superAdmin',
      userId: 'openid-admin-1',
      username: 'super',
    })
    expect(db.removeById).toHaveBeenCalledWith('admin_login_tickets', 't4')
  })
})

// ─────────────────────────────────────────────────────────
// auth.wxLoginConfirm — 小程序内 admin 点确认
// ─────────────────────────────────────────────────────────

describe('auth.wxLoginConfirm', () => {
  test('从 HTTP 触发调 → 拒绝（缺 OPENID）', async () => {
    const result: any = await main({
      action: 'auth.wxLoginConfirm',
      httpMethod: 'POST',
      body: JSON.stringify({ action: 'auth.wxLoginConfirm', ticket: 't5' }),
    })
    expect(result.statusCode).toBe(500)
    expect(JSON.parse(result.body).error).toMatch(/Missing OPENID/)
  })

  test('小程序触发但 ticket 不存在 → 抛错', async () => {
    mockGetWXContext.mockReturnValue({ OPENID: 'openid-admin-1' })
    ;(db.getById as jest.Mock).mockRejectedValueOnce(new Error('not found'))

    await expect(main({
      action: 'auth.wxLoginConfirm',
      ticket: 't-nope',
    })).rejects.toThrow(/登录会话不存在或已过期/)
  })

  test('ticket 已过期 → 标记 + 抛错', async () => {
    mockGetWXContext.mockReturnValue({ OPENID: 'openid-admin-1' })
    const longAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    ;(db.getById as jest.Mock).mockResolvedValueOnce({
      _id: 't6', status: 'pending', createdAt: longAgo, expiresAt: longAgo,
    })

    await expect(main({
      action: 'auth.wxLoginConfirm',
      ticket: 't6',
    })).rejects.toThrow(/已过期/)
    expect(db.updateById).toHaveBeenCalledWith('admin_login_tickets', 't6', { status: 'expired' })
  })

  test('openid 没绑过 admin 账号 → 写 no_account 状态返回', async () => {
    mockGetWXContext.mockReturnValue({ OPENID: 'openid-stranger' })
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    ;(db.getById as jest.Mock).mockResolvedValueOnce({
      _id: 't7', status: 'pending', createdAt: '...', expiresAt: future,
    })
    // findAccountByUserId → query admin_accounts
    ;(db.query as jest.Mock).mockResolvedValueOnce([])  // 没找到

    const result: any = await main({
      action: 'auth.wxLoginConfirm',
      ticket: 't7',
    })
    expect(result).toEqual({
      success: false,
      reason: 'no_account',
      message: expect.stringContaining('未绑定管理员账号'),
    })
    expect(db.updateById).toHaveBeenCalledWith('admin_login_tickets', 't7', {
      status: 'no_account',
      userId: 'openid-stranger',
    })
  })

  test('openid 已绑 admin → 创建 session + 写 success + 返回', async () => {
    mockGetWXContext.mockReturnValue({ OPENID: 'openid-admin-1' })
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    ;(db.getById as jest.Mock).mockResolvedValueOnce({
      _id: 't8', status: 'pending', createdAt: '...', expiresAt: future,
    })
    ;(db.query as jest.Mock).mockResolvedValueOnce([
      {
        _id: 'acct-1', username: 'super', role: 'superAdmin', status: 'active',
        userId: 'openid-admin-1', passwordHash: 'h', passwordSalt: 's',
      },
    ])
    ;(db.create as jest.Mock).mockResolvedValueOnce('session-token-xyz')

    const result: any = await main({
      action: 'auth.wxLoginConfirm',
      ticket: 't8',
    })
    expect(result).toEqual({ success: true, role: 'superAdmin', username: 'super' })

    // session 写入 admin_sessions
    const sessionCreate = (db.create as jest.Mock).mock.calls.find(([col]) => col === 'admin_sessions')
    expect(sessionCreate).toBeTruthy()
    expect(sessionCreate![1]).toMatchObject({
      accountId: 'acct-1',
      role: 'superAdmin',
      userId: 'openid-admin-1',
      username: 'super',
    })

    // ticket 状态被写入完整 success 信息
    const updateTicketCall = (db.updateById as jest.Mock).mock.calls.find(([col]) => col === 'admin_login_tickets')
    expect(updateTicketCall).toBeTruthy()
    expect(updateTicketCall![2]).toMatchObject({
      status: 'success',
      accountId: 'acct-1',
      role: 'superAdmin',
      userId: 'openid-admin-1',
      username: 'super',
    })
    expect(updateTicketCall![2].token).toEqual(expect.any(String))
  })

  test('admin 账号被停用 → 抛错（不创建 session）', async () => {
    mockGetWXContext.mockReturnValue({ OPENID: 'openid-disabled-admin' })
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    ;(db.getById as jest.Mock).mockResolvedValueOnce({
      _id: 't9', status: 'pending', createdAt: '...', expiresAt: future,
    })
    ;(db.query as jest.Mock).mockResolvedValueOnce([
      {
        _id: 'acct-disabled', username: 'old', role: 'communityAdmin', status: 'disabled',
        userId: 'openid-disabled-admin', passwordHash: 'h', passwordSalt: 's',
      },
    ])

    await expect(main({
      action: 'auth.wxLoginConfirm',
      ticket: 't9',
    })).rejects.toThrow(/已停用/)

    // 不应该创建 session
    const sessionCreate = (db.create as jest.Mock).mock.calls.find(([col]) => col === 'admin_sessions')
    expect(sessionCreate).toBeUndefined()
  })
})
