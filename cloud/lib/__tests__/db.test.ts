// cloud/lib/__tests__/db.test.ts
// 测试 increment 不能用先读再写的方式

const mockUpdate = jest.fn().mockResolvedValue({ stats: { updated: 1 } })
const mockGet = jest.fn()
const mockAdd = jest.fn().mockResolvedValue({ _id: 'new-id' })

jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  database: () => ({
    collection: () => ({
      doc: (id: string) => ({
        update: mockUpdate,
        get: mockGet.mockResolvedValue({ data: { _id: id, name: 'test' } }),
      }),
      add: mockAdd,
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ data: [] }),
    }),
    command: { inc: (n: number) => ({ __inc: n }) }
  }),
  DYNAMIC_CURRENT_ENV: 'test'
}))

import { getById, create, increment } from '../db'

test('getById returns document data', async () => {
  const result = await getById('users', 'user-123')
  expect(result).toEqual({ _id: 'user-123', name: 'test' })
})

test('create returns new document id', async () => {
  const id = await create('posts', { title: 'test' })
  expect(id).toBe('new-id')
})

test('increment uses _.inc (atomic), not read-then-write', async () => {
  // 验证 increment 传入的 data 包含 _.inc 对象，而非直接数值
  mockUpdate.mockClear()
  await increment('communities', 'c1', 'memberCount', 1)
  expect(mockUpdate).toHaveBeenCalledWith({
    data: { memberCount: { __inc: 1 } }
  })
})
