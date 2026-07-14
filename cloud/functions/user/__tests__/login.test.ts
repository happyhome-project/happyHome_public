jest.mock('../../../lib/db', () => ({
  getById: jest.fn(),
  create: jest.fn(),
  updateById: jest.fn(),
  query: jest.fn(),
}))
jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  getWXContext: jest.fn().mockReturnValue({ OPENID: 'test-openid' }),
  DYNAMIC_CURRENT_ENV: 'test'
}))

import { handleLogin, main } from '../index'
import * as db from '../../../lib/db'

beforeEach(() => jest.clearAllMocks())

test('新用户首次登录：创建 user 记录', async () => {
  const notFoundErr = Object.assign(new Error('not found'), { errCode: -502001 })
  ;(db.getById as jest.Mock).mockRejectedValue(notFoundErr)
  ;(db.create as jest.Mock).mockResolvedValue('test-openid')

  const result = await handleLogin({ nickName: '张三', avatarUrl: 'https://...' }, 'test-openid')

  expect(db.create).toHaveBeenCalledWith('users', expect.objectContaining({
    _id: 'test-openid',
    nickName: '张三',
    role: 'user',
    backgroundFetchToken: expect.stringMatching(/^hhpf_/),
    backgroundFetchTokenExpiresAt: expect.any(String),
  }))
  expect(result.user.backgroundFetchToken).toMatch(/^hhpf_/)
  expect(result.user.backgroundFetchTokenExpiresAt).toEqual(expect.any(String))
  expect(result.isNew).toBe(true)
})

test('老用户登录：更新 nickName 和 avatarUrl', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'test-openid',
    nickName: '旧名',
    role: 'user',
    backgroundFetchToken: 'hhpf_existing',
    backgroundFetchTokenExpiresAt: '2999-01-01T00:00:00.000Z',
  })
  ;(db.query as jest.Mock).mockResolvedValue([])
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result = await handleLogin({ nickName: '新名', avatarUrl: 'https://new' }, 'test-openid')

  expect(db.updateById).toHaveBeenCalledWith('users', 'test-openid', {
    nickName: '新名',
    avatarUrl: 'https://new',
  })
  expect(result.user.backgroundFetchToken).toBe('hhpf_existing')
  expect(result.isNew).toBe(false)
})

test('老用户登录：用户文档和管理员绑定并行读取', async () => {
  let resolveUser!: (value: any) => void
  const userPromise = new Promise((resolve) => { resolveUser = resolve })
  ;(db.getById as jest.Mock).mockReturnValue(userPromise)
  ;(db.query as jest.Mock).mockResolvedValue([])
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const loginPromise = handleLogin({ nickName: '并行', avatarUrl: '' }, 'test-openid')
  await Promise.resolve()

  expect(db.getById).toHaveBeenCalledWith('users', 'test-openid')
  expect(db.query).toHaveBeenCalledWith('admin_accounts', {
    userId: 'test-openid',
    status: 'active',
  }, { limit: 20 })

  resolveUser({
    _id: 'test-openid',
    role: 'user',
    backgroundFetchToken: 'hhpf_existing',
    backgroundFetchTokenExpiresAt: '2999-01-01T00:00:00.000Z',
  })
  await loginPromise
})

test('老用户 token 过期时与资料、角色合并为一次最终写入', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'test-openid',
    nickName: '旧名',
    role: 'user',
    backgroundFetchToken: 'hhpf_expired',
    backgroundFetchTokenExpiresAt: '2020-01-01T00:00:00.000Z',
  })
  ;(db.query as jest.Mock).mockResolvedValue([])
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result = await handleLogin({ nickName: '新名', avatarUrl: 'https://new' }, 'test-openid')

  expect(db.updateById).toHaveBeenCalledTimes(1)
  expect(db.updateById).toHaveBeenCalledWith('users', 'test-openid', expect.objectContaining({
    nickName: '新名',
    avatarUrl: 'https://new',
    backgroundFetchToken: expect.stringMatching(/^hhpf_/),
    backgroundFetchTokenExpiresAt: expect.any(String),
  }))
  expect(result.user.backgroundFetchToken).toMatch(/^hhpf_/)
})

test('后台 superAdmin 账号绑定的微信登录小程序时自动获得 superAdmin 角色', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'admin-openid',
    nickName: '一年',
    role: 'user',
  })
  ;(db.query as jest.Mock).mockResolvedValue([
    { _id: 'admin-account-1', userId: 'admin-openid', role: 'superAdmin', status: 'active' },
  ])
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result = await handleLogin({ nickName: '一年', avatarUrl: '' }, 'admin-openid')

  expect(db.query).toHaveBeenCalledWith('admin_accounts', {
    userId: 'admin-openid',
    status: 'active',
  }, { limit: 20 })
  expect(db.updateById).toHaveBeenCalledWith('users', 'admin-openid', expect.objectContaining({
    nickName: '一年',
    avatarUrl: '',
    role: 'superAdmin',
    roleSource: 'admin_account',
    backgroundFetchToken: expect.stringMatching(/^hhpf_/),
  }))
  expect(result.user.role).toBe('superAdmin')
  expect(result.isNew).toBe(false)
})

test('后台 superAdmin 账号先绑定、用户后登录时创建 superAdmin 用户记录', async () => {
  const notFoundErr = Object.assign(new Error('not found'), { errCode: -502001 })
  ;(db.getById as jest.Mock).mockRejectedValue(notFoundErr)
  ;(db.query as jest.Mock).mockResolvedValue([
    { _id: 'admin-account-1', userId: 'new-admin-openid', role: 'superAdmin', status: 'active' },
  ])
  ;(db.create as jest.Mock).mockResolvedValue('new-admin-openid')

  const result = await handleLogin({ nickName: '新管理员', avatarUrl: '' }, 'new-admin-openid')

  expect(db.create).toHaveBeenCalledWith('users', expect.objectContaining({
    _id: 'new-admin-openid',
    nickName: '新管理员',
    role: 'superAdmin',
    roleSource: 'admin_account',
  }))
  expect(result.user.role).toBe('superAdmin')
  expect(result.isNew).toBe(true)
})

test('数据库网络错误应向上抛出，不被当作新用户', async () => {
  const networkErr = Object.assign(new Error('network timeout'), { errCode: -505001 })
  ;(db.getById as jest.Mock).mockRejectedValue(networkErr)

  await expect(handleLogin({ nickName: '张三', avatarUrl: 'https://...' }, 'test-openid'))
    .rejects.toThrow('network timeout')
})

test('老用户 updateById 失败应向上抛出，不进入新建逻辑', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'test-openid', role: 'user' })
  ;(db.updateById as jest.Mock).mockRejectedValue(new Error('update failed'))

  await expect(handleLogin({ nickName: '新名', avatarUrl: '' }, 'test-openid'))
    .rejects.toThrow('update failed')
  expect(db.create).not.toHaveBeenCalled()
})

test('缺失 OPENID 时 handleLogin 直接抛错', async () => {
  await expect(handleLogin({ nickName: 'x', avatarUrl: '' }, ''))
    .rejects.toThrow('Missing OPENID')
})

test('_testOpenid 仅在 ALLOW_TEST_OPENID=true 时生效', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'test-openid', role: 'user' })
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  // 默认 env 未设置 → 回退到 wxContext 的 'test-openid'
  const res1 = await main({ action: 'login', nickName: '甲', avatarUrl: '', _testOpenid: 'injected-id' } as any)
  expect(db.updateById).toHaveBeenCalledWith('users', 'test-openid', expect.anything())
  expect(res1.isNew).toBe(false)

  // 开启 env → _testOpenid 覆盖
  process.env.ALLOW_TEST_OPENID = 'true'
  jest.clearAllMocks()
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'injected-id', role: 'user' })
  ;(db.updateById as jest.Mock).mockResolvedValue({})
  await main({ action: 'login', nickName: '乙', avatarUrl: '', _testOpenid: 'injected-id' } as any)
  expect(db.updateById).toHaveBeenCalledWith('users', 'injected-id', expect.anything())
  delete process.env.ALLOW_TEST_OPENID
})

test('main(): action=login 正确路由', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'test-openid', role: 'user' })
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result = await main({ action: 'login', nickName: '张三', avatarUrl: '' })
  expect(result).toHaveProperty('isNew')
})

test('main(): 未知 action 抛出错误', async () => {
  await expect(main({ action: 'unknown', nickName: '', avatarUrl: '' }))
    .rejects.toThrow('Unknown action: unknown')
})
