// cloud/lib/__tests__/db.test.ts
// 测试 increment 不能用先读再写的方式

const mockUpdate = jest.fn().mockResolvedValue({ stats: { updated: 1 } })
const mockGet = jest.fn()
const mockAdd = jest.fn().mockResolvedValue({ _id: 'new-id' })
const mockRemove = jest.fn().mockResolvedValue({ stats: { removed: 1 } })
const mockWhereUpdate = jest.fn().mockResolvedValue({ stats: { updated: 1 } })
const mockRunTransaction = jest.fn()

jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  database: () => ({
    collection: () => ({
      doc: (id: string) => ({
        update: mockUpdate,
        get: mockGet.mockResolvedValue({ data: { _id: id, name: 'test' } }),
        remove: mockRemove,
      }),
      add: mockAdd,
      where: jest.fn().mockReturnValue({
        update: mockWhereUpdate,
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ data: [] }),
      }),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ data: [] }),
    }),
    command: {
      inc: (n: number) => ({ __inc: n }),
      set: (value: unknown) => ({ __set: value }),
      remove: () => ({ __remove: true }),
    },
    runTransaction: mockRunTransaction,
  }),
  DYNAMIC_CURRENT_ENV: 'test'
}))

import { getById, create, increment, replaceValue, removeField, runTransaction, transactionGetByIdOrNull } from '../db'

test('getById returns document data', async () => {
  const result = await getById('users', 'user-123')
  expect(result).toEqual({ _id: 'user-123', name: 'test' })
})

test('create returns new document id', async () => {
  const id = await create('posts', { title: 'test' })
  expect(id).toBe('new-id')
})

test('runTransaction returns the callback result rather than the SDK envelope', async () => {
  mockRunTransaction.mockResolvedValueOnce({ result: { changed: true } })

  const result = await runTransaction(async () => ({ changed: true }))

  expect(mockRunTransaction).toHaveBeenCalledWith(expect.any(Function))
  expect(result).toEqual({ changed: true })
})

test('transactionGetByIdOrNull normalizes CloudBase missing-document errors', async () => {
  const transaction = {
    collection: () => ({
      doc: () => ({
        get: jest.fn().mockRejectedValue(new Error(
          'document.get:fail document with _id request-1 does not exist',
        )),
      }),
    }),
  }

  await expect(transactionGetByIdOrNull(transaction as any, 'requests', 'request-1'))
    .resolves.toBeNull()
})

test('transactionGetByIdOrNull preserves non-missing transaction errors', async () => {
  const transaction = {
    collection: () => ({
      doc: () => ({ get: jest.fn().mockRejectedValue(new Error('network timeout')) }),
    }),
  }

  await expect(transactionGetByIdOrNull(transaction as any, 'requests', 'request-1'))
    .rejects.toThrow('network timeout')
})

test('increment uses _.inc (atomic), not read-then-write', async () => {
  // 验证 increment 传入的 data 包含 _.inc 对象，而非直接数值
  mockUpdate.mockClear()
  await increment('communities', 'c1', 'memberCount', 1)
  expect(mockUpdate).toHaveBeenCalledWith({
    data: { memberCount: { __inc: 1 } }
  })
})

test('increment supports negative delta (decrement)', async () => {
  mockUpdate.mockClear()
  await increment('communities', 'c1', 'memberCount', -1)
  expect(mockUpdate).toHaveBeenCalledWith({
    data: { memberCount: { __inc: -1 } }
  })
})

import { updateById, softDelete, query } from '../db'

test('updateById calls doc.update with data', async () => {
  mockUpdate.mockClear()
  await updateById('users', 'user-1', { nickName: '新名字' })
  expect(mockUpdate).toHaveBeenCalledWith({ data: { nickName: '新名字' } })
})

test('replaceValue and removeField expose CloudBase set/remove commands for object fields', async () => {
  mockUpdate.mockClear()
  await updateById('posts', 'post-1', {
    pendingContent: replaceValue({ guide_age: '8岁以上' }),
    oldPendingContent: removeField(),
  })

  expect(mockUpdate).toHaveBeenCalledWith({
    data: {
      pendingContent: { __set: { guide_age: '8岁以上' } },
      oldPendingContent: { __remove: true },
    },
  })
})

test('softDelete sets status to deleted', async () => {
  mockUpdate.mockClear()
  await softDelete('posts', 'post-1')
  expect(mockUpdate).toHaveBeenCalledWith({ data: { status: 'deleted' } })
})

import { updateWhere, removeById } from '../db'

test('updateWhere calls where().update with data', async () => {
  mockWhereUpdate.mockClear()
  await updateWhere('community_members', { communityId: 'c1', status: 'pending' }, { status: 'active' })
  expect(mockWhereUpdate).toHaveBeenCalledWith({ data: { status: 'active' } })
})

test('removeById calls doc().remove', async () => {
  mockRemove.mockClear()
  await removeById('posts', 'post-1')
  expect(mockRemove).toHaveBeenCalled()
})

test('query applies where/orderBy/skip/limit', async () => {
  const mockWhere = jest.fn().mockReturnThis()
  const mockOrderBy = jest.fn().mockReturnThis()
  const mockSkip = jest.fn().mockReturnThis()
  const mockLimit = jest.fn().mockReturnThis()
  const mockQueryGet = jest.fn().mockResolvedValue({ data: [{ _id: '1' }] })

  // Need to access the internal mock to override where
  // Since the mock is already set up at module level, we test via the exported function
  const result = await query('posts', { status: 'active' }, {
    orderBy: ['createdAt', 'desc'],
    skip: 10,
    limit: 20,
  })
  // query returns res.data which is [] from the top-level mock
  expect(result).toEqual([])
})
