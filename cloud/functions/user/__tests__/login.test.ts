jest.mock('../../../lib/db', () => ({
  getById: jest.fn(),
  create: jest.fn(),
  updateById: jest.fn(),
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

  const result = await handleLogin({ nickName: '张三', avatarUrl: 'https://...' })

  expect(db.create).toHaveBeenCalledWith('users', expect.objectContaining({
    _id: 'test-openid',
    nickName: '张三',
    role: 'user'
  }))
  expect(result.isNew).toBe(true)
})

test('老用户登录：更新 nickName 和 avatarUrl', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'test-openid', nickName: '旧名', role: 'user'
  })
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result = await handleLogin({ nickName: '新名', avatarUrl: 'https://new' })

  expect(db.updateById).toHaveBeenCalledWith('users', 'test-openid', {
    nickName: '新名', avatarUrl: 'https://new'
  })
  expect(result.isNew).toBe(false)
})

test('数据库网络错误应向上抛出，不被当作新用户', async () => {
  const networkErr = Object.assign(new Error('network timeout'), { errCode: -505001 })
  ;(db.getById as jest.Mock).mockRejectedValue(networkErr)

  await expect(handleLogin({ nickName: '张三', avatarUrl: 'https://...' }))
    .rejects.toThrow('network timeout')
})

test('老用户 updateById 失败应向上抛出，不进入新建逻辑', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'test-openid', role: 'user' })
  ;(db.updateById as jest.Mock).mockRejectedValue(new Error('update failed'))

  await expect(handleLogin({ nickName: '新名', avatarUrl: '' }))
    .rejects.toThrow('update failed')
  expect(db.create).not.toHaveBeenCalled()
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
