jest.mock('../../../lib/db', () => ({
  getById: jest.fn(),
  create: jest.fn(),
  updateById: jest.fn(),
  collection: jest.fn(),
  query: jest.fn(),
}))
jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  getWXContext: jest.fn().mockReturnValue({ OPENID: 'test-openid' }),
  DYNAMIC_CURRENT_ENV: 'test'
}))

import { handleLogin } from '../index'
import * as db from '../../../lib/db'

test('新用户首次登录：创建 user 记录', async () => {
  ;(db.getById as jest.Mock).mockRejectedValue(new Error('not found'))
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
