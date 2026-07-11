import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const RELEASE_LOCKS_COLLECTION = 'release_locks'
export const RELEASE_RUNS_COLLECTION = 'release_runs'
export const RELEASE_STATE_COLLECTION = 'release_state'
export const PRODUCTION_DOCUMENT_ID = 'production'

function clone(value) {
  return value == null ? value : structuredClone(value)
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isMissingDocumentError(error) {
  const message = String(error?.message || error || '')
  return /document(?:\.get)?:fail[\s\S]*(?:does not exist|not found)|document not found|\bdb or table not exist\b/i.test(message)
}

async function readDocument(transaction, collectionName, documentId) {
  try {
    const response = await transaction.collection(collectionName).doc(documentId).get()
    const raw = response?.data || null
    const record = Array.isArray(raw) ? raw[0] || null : raw
    const value = record && typeof record.data === 'object' && record.data !== null ? record.data : record
    const oldWrapper = value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === 1 && typeof value.data === 'object' && value.data !== null
    return clone(oldWrapper ? value.data : value)
  } catch (error) {
    if (isMissingDocumentError(error)) return null
    throw error
  }
}

async function writeDocument(transaction, collectionName, documentId, before, after) {
  if (equal(before, after)) return
  const document = transaction.collection(collectionName).doc(documentId)
  if (after == null) {
    if (before != null) await document.remove()
    return
  }
  const data = clone(after)
  if (data && typeof data === 'object') delete data._id
  await document.set(data)
}

function parseDotEnvFile(filePath) {
  if (!existsSync(filePath)) return {}
  const values = {}
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 0) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

export class CloudBaseReleaseStore {
  constructor({ db, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), transactionAttempts = 4 }) {
    if (!db?.runTransaction || !db?.collection) throw new Error('CloudBaseReleaseStore requires a CloudBase database client')
    this.db = db
    this.sleep = sleep
    this.transactionAttempts = transactionAttempts
  }

  async transact({ runId }, callback) {
    if (!runId) throw new Error('release store transaction requires runId')
    const execute = async () => await this.db.runTransaction(async (transaction) => {
      const [lock, run, persistedState] = await Promise.all([
        readDocument(transaction, RELEASE_LOCKS_COLLECTION, PRODUCTION_DOCUMENT_ID),
        readDocument(transaction, RELEASE_RUNS_COLLECTION, runId),
        readDocument(transaction, RELEASE_STATE_COLLECTION, PRODUCTION_DOCUMENT_ID),
      ])
      const state = persistedState || { nextFencingToken: 1 }
      const model = { lock, run, state }
      const before = clone(model)
      const result = await callback(model)
      await writeDocument(transaction, RELEASE_LOCKS_COLLECTION, PRODUCTION_DOCUMENT_ID, before.lock, model.lock)
      await writeDocument(transaction, RELEASE_RUNS_COLLECTION, runId, before.run, model.run)
      await writeDocument(transaction, RELEASE_STATE_COLLECTION, PRODUCTION_DOCUMENT_ID, before.state, model.state)
      return result
    })
    for (let attempt = 1; attempt <= this.transactionAttempts; attempt += 1) {
      try {
        return await execute()
      } catch (error) {
        if (!/TransactionBusy|Transaction is busy|DATABASE_TRANSACTION_FAIL/i.test(String(error?.message || error)) || attempt >= this.transactionAttempts) throw error
        await this.sleep(attempt * 250)
      }
    }
    throw new Error('release transaction retry exhausted')
  }

  async readProductionState() {
    return await readDocument(this.db, RELEASE_STATE_COLLECTION, PRODUCTION_DOCUMENT_ID)
  }

  async inspect({ runId } = {}) {
    const [lock, state, run] = await Promise.all([
      readDocument(this.db, RELEASE_LOCKS_COLLECTION, PRODUCTION_DOCUMENT_ID),
      readDocument(this.db, RELEASE_STATE_COLLECTION, PRODUCTION_DOCUMENT_ID),
      runId ? readDocument(this.db, RELEASE_RUNS_COLLECTION, runId) : Promise.resolve(null),
    ])
    return { lock, run, state }
  }
}

export function resolveCloudBaseReleaseCredentials({ env = process.env, home = homedir() } = {}) {
  const fileValues = parseDotEnvFile(join(home, '.happyhome', 'cam.env'))
  const secretId = env.TENCENTCLOUD_SECRETID || fileValues.TENCENTCLOUD_SECRETID || ''
  const secretKey = env.TENCENTCLOUD_SECRETKEY || fileValues.TENCENTCLOUD_SECRETKEY || ''
  const envId = env.TCB_ENV || fileValues.TCB_ENV || 'cloudbase-3gh862acb1505ff3'
  if (!secretId || !secretKey) {
    throw new Error('Missing CloudBase release credentials: set TENCENTCLOUD_SECRETID and TENCENTCLOUD_SECRETKEY or configure ~/.happyhome/cam.env')
  }
  return { envId, secretId, secretKey }
}

export function createProductionReleaseStore({ root = process.cwd(), env = process.env, home = homedir() } = {}) {
  const credentials = resolveCloudBaseReleaseCredentials({ env, home })
  const workspaceRequire = createRequire(resolve(root, 'cloud', 'package.json'))
  const sdk = workspaceRequire('@cloudbase/node-sdk')
  const app = sdk.init({
    env: credentials.envId,
    secretId: credentials.secretId,
    secretKey: credentials.secretKey,
  })
  return new CloudBaseReleaseStore({ db: app.database() })
}
