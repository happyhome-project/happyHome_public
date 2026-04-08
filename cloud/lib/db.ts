// cloud/lib/db.ts
// 封装微信云数据库所有操作，迁移时只改此文件

import cloud from 'wx-server-sdk'

cloud.init({ env: process.env.TCB_ENV || cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// _ 和 collection 仅在适配层内部使用，不对外导出，保持迁移边界清晰
function collection(name: string) {
  return db.collection(name)
}

// 原子递增，必须用此方法更新计数器，禁止先读再写
export async function increment(
  collectionName: string,
  docId: string,
  field: string,
  delta: number
) {
  return collection(collectionName).doc(docId).update({
    data: { [field]: _.inc(delta) }
  })
}

export async function getById(collectionName: string, id: string) {
  const res = await collection(collectionName).doc(id).get()
  return res.data
}

export async function create(collectionName: string, data: object) {
  const res = await collection(collectionName).add({ data })
  return res._id as string
}

export async function updateById(
  collectionName: string,
  id: string,
  data: object
) {
  return collection(collectionName).doc(id).update({ data })
}

export async function updateWhere(
  collectionName: string,
  where: object,
  data: object
) {
  return collection(collectionName).where(where).update({ data })
}

export async function removeById(collectionName: string, id: string) {
  return collection(collectionName).doc(id).remove()
}

export async function softDelete(collectionName: string, id: string) {
  return updateById(collectionName, id, { status: 'deleted' })
}

export async function query(
  collectionName: string,
  where: object,
  options: { orderBy?: [string, 'asc' | 'desc']; limit?: number; skip?: number } = {}
) {
  let q = collection(collectionName).where(where)
  if (options.orderBy) q = q.orderBy(options.orderBy[0], options.orderBy[1])
  if (options.skip !== undefined) q = q.skip(options.skip)
  if (options.limit !== undefined) q = q.limit(options.limit)
  const res = await q.get()
  return res.data
}
