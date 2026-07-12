
// cloud/lib/__tests__/db.contract.test.ts
// 契约测试：验证 db.local.ts 与 db.ts 导出完全一致的函数签名
// 确保内存适配器可以安全替代云端实现

import * as dbLocal from '../db.local'

const expectedExports = [
  'getById',
  'getByIds',
  'create',
  'setById',
  'updateById',
  'updateWhere',
  'removeById',
  'softDelete',
  'increment',
  'replaceValue',
  'removeField',
  'query',
  'queryAfterId',
  'runTransaction',
  'transactionGetByIdOrNull',
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

test('runTransaction serializes concurrent callbacks', async () => {
  await dbLocal.create('counters', { _id: 'one', value: 0 })

  await Promise.all(Array.from({ length: 8 }, () => dbLocal.runTransaction(async (transaction) => {
    const current = await dbLocal.transactionGetByIdOrNull<any>(transaction, 'counters', 'one')
    await Promise.resolve()
    await transaction.collection('counters').doc('one').update({ data: { value: current.value + 1 } })
  })))

  await expect(dbLocal.getById('counters', 'one')).resolves.toMatchObject({ value: 8 })
})

test('reset fences an in-flight transaction from writing or rolling back the new generation', async () => {
  let release!: () => void
  let entered!: () => void
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve })
  const releasePromise = new Promise<void>((resolve) => { release = resolve })
  await dbLocal.create('items', { _id: 'old', value: 'old' })

  const stale = dbLocal.runTransaction(async (transaction) => {
    entered()
    await releasePromise
    await transaction.collection('items').doc('stale').set({ data: { value: 'stale' } })
    throw new Error('stale rollback')
  })
  await enteredPromise

  dbLocal._resetAll()
  await dbLocal.create('items', { _id: 'new', value: 'new' })
  release()

  await expect(stale).rejects.toThrow('database reset during transaction')
  await expect(dbLocal.getById('items', 'new')).resolves.toMatchObject({ value: 'new' })
  await expect(dbLocal.getById('items', 'old')).rejects.toMatchObject({ errCode: -502001 })
  await expect(dbLocal.getById('items', 'stale')).rejects.toMatchObject({ errCode: -502001 })
})

test('transactions queued after reset still serialize without lost updates', async () => {
  await dbLocal.create('counters', { _id: 'after-reset', value: 0 })
  await Promise.all(Array.from({ length: 12 }, () => dbLocal.runTransaction(async (transaction) => {
    const current = await dbLocal.transactionGetByIdOrNull<any>(transaction, 'counters', 'after-reset')
    await Promise.resolve()
    await transaction.collection('counters').doc('after-reset').update({ data: { value: current.value + 1 } })
  })))
  await expect(dbLocal.getById('counters', 'after-reset')).resolves.toMatchObject({ value: 12 })
})

test('ordinary mutations serialize with transactions so rollback cannot erase a concurrent successful write', async () => {
  let release!: () => void
  let entered!: () => void
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve })
  const releasePromise = new Promise<void>((resolve) => { release = resolve })
  const transaction = dbLocal.runTransaction(async (tx) => {
    await tx.collection('items').doc('temporary').set({ data: { value: 'temporary' } })
    entered()
    await releasePromise
    throw new Error('rollback')
  })
  await enteredPromise

  const concurrentCreate = dbLocal.create('items', { _id: 'survivor', value: 'survivor' })
  release()

  await expect(transaction).rejects.toThrow('rollback')
  await expect(concurrentCreate).resolves.toBe('survivor')
  await expect(dbLocal.getById('items', 'survivor')).resolves.toMatchObject({ value: 'survivor' })
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

test('getByIds 去重并只返回存在的文档', async () => {
  await dbLocal.create('items', { _id: 'b', value: 2 })
  await dbLocal.create('items', { _id: 'a', value: 1 })
  await expect(dbLocal.getByIds('items', ['b', 'missing', 'b', 'a'])).resolves.toEqual([
    expect.objectContaining({ _id: 'b', value: 2 }),
    expect.objectContaining({ _id: 'a', value: 1 }),
  ])
})

test('queryAfterId 使用稳定 _id 游标分页', async () => {
  await dbLocal.create('items', { _id: 'c', type: 'x' })
  await dbLocal.create('items', { _id: 'a', type: 'x' })
  await dbLocal.create('items', { _id: 'b', type: 'x' })
  await expect(dbLocal.queryAfterId('items', { type: 'x' }, 'a', 1)).resolves.toEqual([
    expect.objectContaining({ _id: 'b' }),
  ])
})

test('queryAfterId filters the complete local store before limiting beyond 10000 rows', async () => {
  await Promise.all(Array.from({ length: 10005 }, (_, index) => dbLocal.setById('large', `id-${String(index).padStart(5, '0')}`, { type: 'x' })))
  await expect(dbLocal.queryAfterId('large', { type: 'x' }, 'id-10001', 3)).resolves.toEqual([
    expect.objectContaining({ _id: 'id-10002' }),
    expect.objectContaining({ _id: 'id-10003' }),
    expect.objectContaining({ _id: 'id-10004' }),
  ])
})

test('setById 以显式 ID 整体写入文档', async () => {
  await dbLocal.setById('items', 'fixed', { value: 1, stale: true })
  await dbLocal.setById('items', 'fixed', { value: 2 })
  await expect(dbLocal.getById('items', 'fixed')).resolves.toEqual({ _id: 'fixed', value: 2 })
})
