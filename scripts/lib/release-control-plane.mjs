export const RELEASE_CONTROL_PLANE_COLLECTIONS = ['release_locks', 'release_runs', 'release_state']

export async function verifyReleaseControlPlane(db, { log = () => {} } = {}) {
  for (const collection of RELEASE_CONTROL_PLANE_COLLECTIONS) {
    const exists = await db.checkCollectionExists(collection)
    if (!exists?.Exists) {
      throw new Error(`Release control plane collection ${collection} is missing; provision it separately before formal release.`)
    }
    log(`[release-control-plane] ${collection} exists`)
  }
}

export async function ensureReleaseControlPlane(db, { log = () => {} } = {}) {
  for (const collection of RELEASE_CONTROL_PLANE_COLLECTIONS) {
    const exists = await db.checkCollectionExists(collection)
    if (exists?.Exists) {
      log(`[release-control-plane] ${collection} exists`)
      continue
    }
    try {
      await db.createCollection(collection)
      log(`[release-control-plane] ${collection} created`)
    } catch (error) {
      if (!/exist|已存在/i.test(String(error?.message || error))) throw error
      log(`[release-control-plane] ${collection} exists`)
    }
  }
}
