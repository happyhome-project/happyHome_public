// cloud/lib/__tests__/db.contract.test.ts
// 契约测试：验证 db.local.ts 与 db.ts 导出完全一致的函数签名
// 确保内存适配器可以安全替代云端实现

import * as dbLocal from '../db.local'

const expectedExports = [
  'getById',
  'create',
  'updateById',
  'updateWhere',
  'removeById',
  'softDelete',
  'increment',
  'replaceValue',
  'removeField',
  'query',
  'runTransaction',
]

test('db.local 导出与 db.ts 一一对应', () => {
  for (const name of expectedExports) {
    expect(typeof (dbLocal as any)[name]).toBe('function')
  }
})

test('db.local 没有遗漏 db.ts 的公开函数', () => {
  // 过滤掉 db.local 的私有函数（_ 开头）
  const publicExports = Object.keys(dbLocal).filter(k => !k.startsWith('_'))
  expect(publicExports.sort()).toEqual(expectedExports.sort())
})

// ---- 行为契约 ----

import { _resetAll } from '../db.local'

beforeEach(() => _resetAll())

test('create + getById 能正确存取', async () => {
  const id = await dbLocal.create('test_col', { name: 'hello' })
  expect(id).toBeTruthy()
  const doc = await dbLocal.getById('test_col', id)
  expect(doc.name).toBe('hello')
  expect(doc._id).toBe(id)
})

test('getById 不存在时抛出 errCode -502001', async () => {
  try {
    await dbLocal.getById('test_col', 'nonexistent')
    fail('should throw')
  } catch (err: any) {
    expect(err.errCode).toBe(-502001)
    expect(err.message).toContain('not found')
  }
})

test('updateById 更新字段', async () => {
  const id = await dbLocal.create('test_col', { name: 'old' })
  await dbLocal.updateById('test_col', id, { name: 'new' })
  const doc = await dbLocal.getById('test_col', id)
  expect(doc.name).toBe('new')
})

test('updateById 支持 replaceValue 整块替换对象和 removeField 删除字段', async () => {
  const id = await dbLocal.create('test_col', {
    pendingContent: null,
    content: { old: 'value', stale: 'should be removed' },
    staleField: 'remove me',
  })

  await dbLocal.updateById('test_col', id, {
    pendingContent: dbLocal.replaceValue({ guide_age: '8岁以上' }),
    content: dbLocal.replaceValue({ guide_title: '新标题' }),
    staleField: dbLocal.removeField(),
  })

  const doc = await dbLocal.getById('test_col', id)
  expect(doc.pendingContent).toEqual({ guide_age: '8岁以上' })
  expect(doc.content).toEqual({ guide_title: '新标题' })
  expect(doc).not.toHaveProperty('staleField')
})

test('softDelete 将 status 设为 deleted', async () => {
  const id = await dbLocal.create('test_col', { status: 'active' })
  await dbLocal.softDelete('test_col', id)
  const doc = await dbLocal.getById('test_col', id)
  expect(doc.status).toBe('deleted')
})

test('increment 原子递增', async () => {
  const id = await dbLocal.create('test_col', { count: 10 })
  await dbLocal.increment('test_col', id, 'count', 3)
  const doc = await dbLocal.getById('test_col', id)
  expect(doc.count).toBe(13)
})

test('increment 支持负数', async () => {
  const id = await dbLocal.create('test_col', { count: 10 })
  await dbLocal.increment('test_col', id, 'count', -2)
  const doc = await dbLocal.getById('test_col', id)
  expect(doc.count).toBe(8)
})

test('runTransaction 在回调抛错时回滚已写入的数据', async () => {
  await expect(dbLocal.runTransaction(async (transaction) => {
    await transaction.collection('items').doc('temporary').set({ data: { title: '临时数据' } })
    throw new Error('rollback')
  })).rejects.toThrow('rollback')

  await expect(dbLocal.getById('items', 'temporary')).rejects.toMatchObject({ errCode: -502001 })
})

test('query where 条件过滤', async () => {
  await dbLocal.create('items', { type: 'a', val: 1 })
  await dbLocal.create('items', { type: 'b', val: 2 })
  await dbLocal.create('items', { type: 'a', val: 3 })

  const results = await dbLocal.query('items', { type: 'a' })
  expect(results).toHaveLength(2)
  expect(results.every((r: any) => r.type === 'a')).toBe(true)
})

test('query orderBy + skip + limit', async () => {
  await dbLocal.create('items', { order: 3 })
  await dbLocal.create('items', { order: 1 })
  await dbLocal.create('items', { order: 2 })

  const results = await dbLocal.query('items', {}, {
    orderBy: ['order', 'asc'],
    skip: 1,
    limit: 1,
  })
  expect(results).toHaveLength(1)
  expect(results[0].order).toBe(2)
})

test('updateWhere 批量更新', async () => {
  await dbLocal.create('members', { communityId: 'c1', status: 'pending' })
  await dbLocal.create('members', { communityId: 'c1', status: 'pending' })
  await dbLocal.create('members', { communityId: 'c2', status: 'pending' })

  const res = await dbLocal.updateWhere('members', { communityId: 'c1', status: 'pending' }, { status: 'active' })
  expect((res as any).stats.updated).toBe(2)

  const remaining = await dbLocal.query('members', { communityId: 'c1', status: 'pending' })
  expect(remaining).toHaveLength(0)
})

test('removeById 硬删除', async () => {
  const id = await dbLocal.create('test_col', { name: 'temp' })
  await dbLocal.removeById('test_col', id)
  await expect(dbLocal.getById('test_col', id)).rejects.toThrow()
})

test('create 使用自定义 _id', async () => {
  const id = await dbLocal.create('users', { _id: 'custom-id', name: 'test' })
  expect(id).toBe('custom-id')
  const doc = await dbLocal.getById('users', 'custom-id')
  expect(doc.name).toBe('test')
})
