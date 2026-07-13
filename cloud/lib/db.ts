
// cloud/lib/db.ts
// 封装微信云数据库所有操作，迁移时只改此文件

import cloud from 'wx-server-sdk'

cloud.init({ env: process.env.TCB_ENV || cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

export type DbTransaction = {
  collection: (collectionName: string) => {
    doc: (id: string) => {
      get: () => Promise<{ data: any }>
      set: (options: { data: object }) => Promise<any>
      update: (options: { data: object }) => Promise<any>
      remove: () => Promise<any>
    }
    add: (options: { data: object }) => Promise<{ _id: string }>
  }
}

// _ 和 collection 仅在适配层内部使用，不对外导出，保持迁移边界清晰
function collection(name: string) {
  return db.collection(name)
}

export function replaceValue<T>(value: T) {
  return _.set(value)
}

export function removeField() {
  return _.remove()
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
export async function getByIdOrNull<T = any>(collectionName: string, id: string): Promise<T | null> {
  try {
    return await getById(collectionName, id) as T
  } catch (error) {
    if (isMissingDocumentError(error)) return null
    throw error
  }
}
export async function getByIds(collectionName: string, ids: string[]) {
  if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string' || !id)) throw new Error('invalid document ids')
  if (ids.length === 0) return []
  const res = await collection(collectionName).where({ _id: _.in([...new Set(ids)]) }).limit(100).get()
  const byId = new Map(res.data.map((document: any) => [document._id, document]))
  return [...new Set(ids)].map(id => byId.get(id)).filter(Boolean)
}
export async function queryAfterId(collectionName:string,where:Record<string,any>,afterId:string|null,limit:number){let query:any=collection(collectionName).where(afterId?{...where,_id:_.gt(afterId)}:where).orderBy('_id','asc').limit(limit);const res=await query.get();return res.data}

export async function create(collectionName: string, data: object) {
  const res = await collection(collectionName).add({ data })
  return res._id as string
}
export async function setById(collectionName:string,id:string,data:object){return collection(collectionName).doc(id).set({data})}

/**
 * CloudBase transactions make a multi-document decision atomic. The SDK wraps
 * the callback result in `{ result }`; callers only need the callback value.
 */
export async function runTransaction<T>(callback: (transaction: DbTransaction) => Promise<T>): Promise<T> {
  const response = await (db as any).runTransaction(callback)
  return (response && typeof response === 'object' && 'result' in response ? response.result : response) as T
}

function isMissingDocumentError(error: unknown) {
  const value = error as { errCode?: number; code?: number; message?: string }
  const message = String(value?.message || '')
  return /document(?:\.get)?:fail[\s\S]*does not exist|document not found/i.test(message)
}

export async function transactionGetByIdOrNull<T = any>(
  transaction: DbTransaction,
  collectionName: string,
  id: string,
): Promise<T | null> {
  try {
    const response = await transaction.collection(collectionName).doc(id).get()
    return (response?.data || null) as T | null
  } catch (error) {
    if (isMissingDocumentError(error)) return null
    throw error
  }
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

export async function count(collectionName: string, where: object): Promise<number> {
  const res = await collection(collectionName).where(where).count()
  return (res as any).total as number
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
