// cloud/lib/db.local.ts
// 内存数据库适配器，与 db.ts 签名完全一致
// 用于 L2 本地集成测试，不依赖 wx-server-sdk

const store = new Map<string, Map<string, any>>()

let idCounter = 0

function collection(name: string): Map<string, any> {
  if (!store.has(name)) store.set(name, new Map())
  return store.get(name)!
}

/** 清空所有数据，测试间隔调用 */
export function _resetAll() {
  store.clear()
  idCounter = 0
}

/** 获取集合所有文档（调试用） */
export function _dump(collectionName: string): any[] {
  return Array.from(collection(collectionName).values())
}

export async function getById(collectionName: string, id: string) {
  const doc = collection(collectionName).get(id)
  if (!doc) {
    const err: any = new Error(`document not found: ${collectionName}/${id}`)
    err.errCode = -502001
    throw err
  }
  return { ...doc }
}

export async function create(collectionName: string, data: any) {
  const id = data._id || `auto-${++idCounter}`
  const doc = { _id: id, ...data }
  collection(collectionName).set(id, doc)
  return id
}

export async function updateById(
  collectionName: string,
  id: string,
  data: object
) {
  const col = collection(collectionName)
  const existing = col.get(id)
  if (!existing) {
    const err: any = new Error(`document not found: ${collectionName}/${id}`)
    err.errCode = -502001
    throw err
  }
  col.set(id, { ...existing, ...data })
  return { stats: { updated: 1 } }
}

export async function updateWhere(
  collectionName: string,
  where: Record<string, any>,
  data: object
) {
  const col = collection(collectionName)
  let updated = 0
  for (const [id, doc] of col) {
    if (matchesWhere(doc, where)) {
      col.set(id, { ...doc, ...data })
      updated++
    }
  }
  return { stats: { updated } }
}

export async function removeById(collectionName: string, id: string) {
  const col = collection(collectionName)
  const existed = col.delete(id)
  return { stats: { removed: existed ? 1 : 0 } }
}

export async function softDelete(collectionName: string, id: string) {
  return updateById(collectionName, id, { status: 'deleted' })
}

export async function increment(
  collectionName: string,
  docId: string,
  field: string,
  delta: number
) {
  const col = collection(collectionName)
  const existing = col.get(docId)
  if (!existing) {
    const err: any = new Error(`document not found: ${collectionName}/${docId}`)
    err.errCode = -502001
    throw err
  }
  col.set(docId, { ...existing, [field]: (existing[field] || 0) + delta })
  return { stats: { updated: 1 } }
}

export async function query(
  collectionName: string,
  where: Record<string, any>,
  options: { orderBy?: [string, 'asc' | 'desc']; limit?: number; skip?: number } = {}
) {
  const col = collection(collectionName)
  let results: any[] = []

  for (const doc of col.values()) {
    if (matchesWhere(doc, where)) {
      results.push({ ...doc })
    }
  }

  if (options.orderBy) {
    const [field, dir] = options.orderBy
    results.sort((a, b) => {
      if (a[field] < b[field]) return dir === 'asc' ? -1 : 1
      if (a[field] > b[field]) return dir === 'asc' ? 1 : -1
      return 0
    })
  }

  if (options.skip !== undefined) {
    results = results.slice(options.skip)
  }
  if (options.limit !== undefined) {
    results = results.slice(0, options.limit)
  }

  return results
}

// ---- 内部工具 ----

function matchesWhere(doc: any, where: Record<string, any>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (doc[key] !== value) return false
  }
  return true
}
