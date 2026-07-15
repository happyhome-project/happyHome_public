export function createArchiveMigrationNodeSdkDeps(database, { removeMalformedWrapper = false } = {}) {
  if (!database?.collection) throw new Error('CloudBase database is required')
  if (removeMalformedWrapper && typeof database.command?.remove !== 'function') {
    throw new Error('CloudBase database command.remove is required for malformed wrapper repair')
  }

  return {
    set(collectionName, id, data) {
      return database.collection(collectionName).doc(id).set(data)
    },
    update(collectionName, id, data) {
      const payload = removeMalformedWrapper
        ? { ...data, data: database.command.remove() }
        : data
      return database.collection(collectionName).doc(id).update(payload)
    },
  }
}
