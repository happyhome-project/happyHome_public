export const RELEASE_CONTROL_PLANE_COLLECTIONS = ['release_locks', 'release_runs', 'release_state']

function isKnownMissingCollection(message) {
  return /ResourceNotFound|TableNotExist|Table not exist|does not exist|\bnot exist\b|不存在|CollectionNotExists/i.test(message)
}

function isAlreadyExistsError(error) {
  const message = String(error?.message || error)
  if (/not exist|does not exist|不存在|CollectionNotExists/i.test(message)) return false
  return /Table exist|already exists|collection .*exists|index .*exists|已存在/i.test(message)
}

function getCollectionStatus(collection, result) {
  if (result?.Exists === true) return 'exists'
  const message = String(result?.Msg || '').trim()
  if (result?.Exists === false && isKnownMissingCollection(message)) return 'missing'
  throw new Error(`Release control plane collection ${collection} has indeterminate verification: ${message || 'empty probe message'}`)
}

export function parseReleaseControlPlaneMode(args) {
  if (args.length !== 1 || !['--verify-only', '--provision'].includes(args[0])) {
    throw new Error('Release control plane requires exactly one mode: --verify-only or --provision')
  }
  return args[0] === '--verify-only' ? 'verify' : 'provision'
}

export async function verifyReleaseControlPlane(db, { log = () => {} } = {}) {
  for (const collection of RELEASE_CONTROL_PLANE_COLLECTIONS) {
    const status = getCollectionStatus(collection, await db.checkCollectionExists(collection))
    if (status === 'missing') {
      throw new Error(`Release control plane collection ${collection} is missing; provision it separately before formal release.`)
    }
    log(`[release-control-plane] ${collection} exists`)
  }
}

export async function ensureReleaseControlPlane(db, { log = () => {} } = {}) {
  for (const collection of RELEASE_CONTROL_PLANE_COLLECTIONS) {
    const status = getCollectionStatus(collection, await db.checkCollectionExists(collection))
    if (status === 'exists') {
      log(`[release-control-plane] ${collection} exists`)
      continue
    }
    try {
      await db.createCollection(collection)
      log(`[release-control-plane] ${collection} created`)
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error
      log(`[release-control-plane] ${collection} exists`)
    }
  }
}
