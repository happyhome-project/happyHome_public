
// cloud/lib/db.local.ts
// 内存数据库适配器，与 db.ts 签名完全一致
// 用于 L2 本地集成测试，不依赖 wx-server-sdk

const store = new Map<string, Map<string, any>>()

let idCounter = 0
let transactionTail: Promise<void> = Promise.resolve()
let resetGeneration = 0

function collection(name: string): Map<string, any> {
  if (!store.has(name)) store.set(name, new Map())
  return store.get(name)!
}

type LocalDbCommand =
  | { __happyHomeDbCommand: 'set'; value: any }
  | { __happyHomeDbCommand: 'remove' }

function isLocalDbCommand(value: any): value is LocalDbCommand {
  return value && typeof value === 'object' && typeof value.__happyHomeDbCommand === 'string'
}

function cloneValue<T>(value: T): T {
  if (value === undefined || value === null) return value
  return JSON.parse(JSON.stringify(value))
}

export function replaceValue<T>(value: T) {
  return { __happyHomeDbCommand: 'set', value } as LocalDbCommand
}

export function removeField() {
  return { __happyHomeDbCommand: 'remove' } as LocalDbCommand
}

function applyUpdate(existing: any, data: Record<string, any>) {
  const next = { ...existing }
  for (const [key, value] of Object.entries(data)) {
    if (isLocalDbCommand(value)) {
      if (value.__happyHomeDbCommand === 'remove') delete next[key]
      else next[key] = cloneValue(value.value)
      continue
    }
    next[key] = value
  }
  return next
}

/** 清空所有数据，测试间隔调用 */
export function _resetAll() {
  resetGeneration += 1
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

export async function setById(collectionName: string, id: string, data: object) {
  collection(collectionName).set(id, { _id: id, ...cloneValue(data) })
  return { stats: { updated: 1 } }
}

export async function create(collectionName: string, data: any) {
  const id = data._id || `auto-${++idCounter}`
  const doc = { _id: id, ...data }
  collection(collectionName).set(id, doc)
  return id
}

type LocalTransaction = {
  collection: (collectionName: string) => {
    doc: (id: string) => {
      get: () => Promise<{ data: any }>
      set: (options: { data: object }) => Promise<{ stats: { updated: number } }>
      update: (options: { data: object }) => Promise<{ stats: { updated: number } }>
      remove: () => Promise<{ stats: { removed: number } }>
    }
    add: (options: { data: object }) => Promise<{ _id: string }>
  }
}

function snapshotStore() {
  return new Map(
    Array.from(store.entries(), ([collectionName, documents]) => [
      collectionName,
      new Map(Array.from(documents.entries(), ([id, doc]) => [id, cloneValue(doc)])),
    ]),
  )
}

function restoreStore(snapshot: Map<string, Map<string, any>>) {
  store.clear()
  for (const [collectionName, documents] of snapshot) {
    store.set(collectionName, documents)
  }
}

/**
 * The integration adapter mirrors CloudBase's callback transaction contract.
 * Callbacks are serialized to mirror the conflict isolation callers rely on
 * from CloudBase while retaining snapshot rollback for the in-memory adapter.
 */
export function runTransaction<T>(callback: (transaction: LocalTransaction) => Promise<T>): Promise<T> {
  const transactionGeneration = resetGeneration
  const assertActiveGeneration = () => {
    if (transactionGeneration !== resetGeneration) throw new Error('database reset during transaction')
  }
  const result = transactionTail.then(async () => {
    assertActiveGeneration()
    const snapshot = snapshotStore()
    const transaction: LocalTransaction = {
      collection: (collectionName) => ({
        doc: (id) => ({
          get: async () => {
            assertActiveGeneration()
            return { data: cloneValue(collection(collectionName).get(id) || null) }
          },
          set: async ({ data }) => {
            assertActiveGeneration()
            collection(collectionName).set(id, { _id: id, ...cloneValue(data) })
            return { stats: { updated: 1 } }
          },
          update: async ({ data }) => {
            assertActiveGeneration()
            return updateById(collectionName, id, data)
          },
          remove: async () => {
            assertActiveGeneration()
            return removeById(collectionName, id)
          },
        }),
        add: async ({ data }) => {
          assertActiveGeneration()
          return { _id: await create(collectionName, data) }
        },
      }),
    }

    try {
      const value = await callback(transaction)
      assertActiveGeneration()
      return value
    } catch (error) {
      assertActiveGeneration()
      restoreStore(snapshot)
      throw error
    }
  })
  transactionTail = result.then(() => undefined, () => undefined)
  return result
}

export async function getByIds(collectionName: string, ids: string[]) {
  if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string' || !id)) throw new Error('invalid document ids')
  const col = collection(collectionName)
  return [...new Set(ids)].map(id => col.get(id)).filter(Boolean).map(doc => cloneValue(doc))
}

export async function transactionGetByIdOrNull<T = any>(
  transaction: LocalTransaction,
  collectionName: string,
  id: string,
): Promise<T | null> {
  try {
    const response = await transaction.collection(collectionName).doc(id).get()
    return (response?.data || null) as T | null
  } catch (error: any) {
    if (Number(error?.errCode) === -502001 || /document(?:\.get)?:fail[\s\S]*does not exist|document not found/i.test(String(error?.message || ''))) {
      return null
    }
    throw error
  }
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
  col.set(id, applyUpdate(existing, data as Record<string, any>))
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
      col.set(id, applyUpdate(doc, data as Record<string, any>))
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
export async function queryAfterId(collectionName:string,where:Record<string,any>,afterId:string|null,limit:number){const rows=await query(collectionName,where,{orderBy:['_id','asc'],limit:10000});return rows.filter(row=>!afterId||row._id>afterId).slice(0,limit)}

// ---- 内部工具 ----

function matchesWhere(doc: any, where: Record<string, any>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (doc[key] !== value) return false
  }
  return true
}
