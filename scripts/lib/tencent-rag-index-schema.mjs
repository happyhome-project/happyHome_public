export function buildPostSemanticIndexDefinition({ vectorField, dims }) {
  if (vectorField !== 'embedding') throw new Error('v2 writer requires vector field embedding')
  if (!/^[A-Za-z0-9_.-]+$/.test(String(vectorField || ''))) throw new Error('invalid vector field')
  if (!Number.isSafeInteger(dims) || dims <= 0) throw new Error('invalid embedding dimensions')
  const keyword = { type: 'keyword' }
  const text = { type: 'text' }
  return { mappings: { properties: {
    collection: keyword, postId: keyword, communityId: keyword, sectionId: keyword,
    sourceVersion: keyword, retrievalIndexVersion: keyword, chunkId: keyword, widgetId: keyword,
    fieldKey: keyword, fieldLabel: text, fieldType: keyword, visibility: keyword, status: keyword,
    title: text, sectionName: text, text, preview: text, searchText: text, compactText: text,
    terms: keyword, sparseVector: { type: 'object', enabled: false }, createdAt: { type: 'date' },
    updatedAt: { type: 'date' }, sourceUpdatedAt: { type: 'date' },
    chunkIndex: { type: 'integer' }, chunkChecksum: keyword, projectionChecksum: keyword,
    [vectorField]: { type: 'dense_vector', dims, index: true, similarity: 'cosine' },
  } } }
}

export function assertPostSemanticIndexCompatible(mappings, options) {
  const expected = buildPostSemanticIndexDefinition(options).mappings.properties
  const actual = mappings?.properties
  if (!actual || typeof actual !== 'object') throw new Error('existing index has no mappings.properties')
  for (const [name, definition] of Object.entries(expected)) {
    const candidate = actual[name]
    if (!candidate) throw new Error(`existing index is missing ${name}`)
    if (candidate.type !== definition.type) throw new Error(`existing index field ${name} has incompatible type`)
    if (definition.type === 'dense_vector' && (candidate.dims !== definition.dims || candidate.index !== true || candidate.similarity !== 'cosine')) {
      throw new Error(`existing index field ${name} has incompatible vector settings`)
    }
  }
}
