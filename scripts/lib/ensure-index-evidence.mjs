export function createEnsureIndexEvidence({ collectionsChecked, indexesChecked, failures }) {
  if (failures !== 0) throw new Error(`ensure-indexes readback failures=${failures}`)
  return {
    schemaVersion: 1,
    action: 'ensure-indexes',
    invocationCount: 1,
    collectionsChecked,
    indexesChecked,
    failures,
    status: 'passed',
  }
}

export async function readEnsureIndexState({ db, collections, indexes }) {
  const missing = []
  for (const collection of collections) {
    try {
      if (!(await db.checkCollectionExists(collection))?.Exists) missing.push(`collection:${collection}`)
    } catch {
      missing.push(`collection:${collection}:indeterminate`)
    }
  }
  for (const index of indexes) {
    try {
      if (!(await db.checkIndexExists(index.coll, index.name))?.Exists) missing.push(`index:${index.coll}.${index.name}`)
    } catch {
      missing.push(`index:${index.coll}.${index.name}:indeterminate`)
    }
  }
  return { collectionsChecked: collections.length, indexesChecked: indexes.length, failures: missing.length, missing }
}
