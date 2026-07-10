jest.mock('../db', () => ({
  getById: jest.fn(),
  query: jest.fn(),
}))

import * as db from '../db'
import { ensureCommunityReadable } from '../public-community'

beforeEach(() => {
  jest.resetAllMocks()
})

test('active 成员也不能读取 pending 父社区', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'pending-community', status: 'pending' })
  ;(db.query as jest.Mock).mockResolvedValue([{ _id: 'member-1', status: 'active' }])

  await expect(ensureCommunityReadable(
    'pending-community',
    'creator-openid',
    '需要先加入社区后查看内容',
  )).rejects.toThrow('需要先加入社区后查看内容')
})

test('active 私有社区的 active 成员仍可读取', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'active-community', status: 'active' })
  ;(db.query as jest.Mock).mockResolvedValue([{ _id: 'member-1', status: 'active' }])

  await expect(ensureCommunityReadable(
    'active-community',
    'member-openid',
    '需要先加入社区后查看内容',
  )).resolves.toBeUndefined()
})
