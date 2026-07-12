
import { createVersionedTencentEsRagSink, PostRagVersionedSinkError } from '../post-rag-versioned-index-sink'

type Doc = Record<string, any>

function projection() {
  return {
    eligible: true, sourceVersion: 'source-2', retrievalIndexVersion: 'rag-v2', chunkCount: 2, chunkChecksum: 'projection-sum',
    chunks: [0, 1].map((chunkIndex) => ({
      postId: 'post-1', communityId: 'community-1', sectionId: 'section-1', widgetId: `widget-${chunkIndex}`,
      fieldKey: `field-${chunkIndex}`, fieldLabel: `Field ${chunkIndex}`, fieldType: 'text', visibility: 'public' as const,
      title: 'Title', sectionName: 'Section', text: `private text ${chunkIndex}`, preview: `preview ${chunkIndex}`,
      sourceUpdatedAt: '2026-07-12T00:00:00.000Z', chunkIndex, sourceVersion: 'source-2', retrievalIndexVersion: 'rag-v2',
      chunkId: `chunk-${chunkIndex}`, chunkChecksum: `chunk-sum-${chunkIndex}`,
    })),
  }
}

function job() { return { schemaVersion: 2 as const, _id: 'job-2', postId: 'post-1', communityId: 'community-1', sectionId: 'section-1', sourceVersion: 'source-2', contentVersion: 2 } as any }

function fakeDatabase(seed: Record<string, Doc> = {}) {
  const collections = new Map<string, Map<string, Doc>>()
  for (const [key, value] of Object.entries(seed)) {
    const [collection, id] = key.split('/')
    if (!collections.has(collection)) collections.set(collection, new Map())
    collections.get(collection)!.set(id, structuredClone(value))
  }
  const coll = (name: string) => { if (!collections.has(name)) collections.set(name, new Map()); return collections.get(name)! }
  const api = {
    collections,
    runTransaction: async (fn: any) => fn({
      getById: async (name: string, id: string) => structuredClone(coll(name).get(id) || null),
      setById: async (name: string, id: string, data: Doc) => { coll(name).set(id, structuredClone(data)) },
    }),
    setById: async (name: string, id: string, data: Doc) => { coll(name).set(id, structuredClone(data)) },
    query: async (name: string, where: Doc, options: { limit: number; skip?: number }) => [...coll(name).values()].filter((d) => Object.entries(where).every(([k, v]) => d[k] === v)).slice(options.skip || 0, (options.skip || 0) + options.limit).map((value) => structuredClone(value)),
    removeById: async (name: string, id: string) => { coll(name).delete(id) },
  }
  return api
}

function makeSink(options: any = {}) {
  const database = options.database || fakeDatabase()
  const calls: any[] = []
  const requestJson = options.requestJson || (async (method: string, path: string, body?: any, requestOptions?: any) => {
    calls.push({ method, path, body, requestOptions })
    if (path.endsWith('/_search')) return { hits: { hits: projection().chunks.map((chunk) => ({ _source: { ...chunk, projectionChecksum: 'projection-sum' } })) } }
    return { errors: false, items: [{ index: { status: 201 } }, { index: { status: 201 } }] }
  })
  return { database, calls, sink: createVersionedTencentEsRagSink({ database, requestJson, embedTexts: options.embedTexts || (async (texts: string[]) => texts.map((_, i) => [i, i + 1])), indexName: options.indexName || 'rag-index', embeddingBatchSize: options.embeddingBatchSize || 1, mirrorPageSize: options.mirrorPageSize || 1, deleteBatchSize: options.deleteBatchSize }) }
}

test('stageUpsert writes bounded embeddings, immutable bulk ids and idempotent versioned mirrors', async () => {
  const embedded: string[][] = []
  const { sink, calls, database } = makeSink({ embedTexts: async (texts: string[]) => { embedded.push(texts); return texts.map(() => [0.1, 0.2]) } })
  await sink.stageUpsert({ projection: projection() as any, job: job() })
  expect(embedded).toEqual([['private text 0'], ['private text 1']])
  const bulk = calls[0]
  expect(bulk).toMatchObject({ method: 'POST', path: 'rag-index/_bulk?refresh=wait_for', requestOptions: { contentType: 'application/x-ndjson' } })
  const lines = bulk.body.trim().split('\n').map(JSON.parse)
  expect(lines[0]).toEqual({ index: { _id: 'post-1:source-2:chunk-0' } })
  expect(lines[1]).toMatchObject({ postId: 'post-1', sourceVersion: 'source-2', chunkId: 'chunk-0', chunkChecksum: 'chunk-sum-0', projectionChecksum: 'projection-sum', embedding: [0.1, 0.2] })
  expect(database.collections.get('post_rag_index_versions')?.size).toBe(2)
  expect(database.collections.get('post_rag_index_versions')?.get('post-1:source-2:chunk-0')).toMatchObject({
    esDocumentId: 'post-1:source-2:chunk-0', activationOrder: { contentVersion: 2, jobId: 'job-2' },
  })
  await sink.stageUpsert({ projection: projection() as any, job: job() })
  expect(database.collections.get('post_rag_index_versions')?.size).toBe(2)
})

test('stageUpsert rejects partial ES bulk failures with an authenticated typed error', async () => {
  const { sink } = makeSink({ requestJson: async () => ({ errors: true, items: [{ index: { status: 429, error: { reason: 'secret' } } }] }) })
  await expect(sink.stageUpsert({ projection: projection() as any, job: job() })).rejects.toMatchObject({ name: 'PostRagVersionedSinkError', code: 'ES_BULK_FAILED' })
  try { await sink.stageUpsert({ projection: projection() as any, job: job() }) } catch (error) { expect(error).toBeInstanceOf(PostRagVersionedSinkError) }
})

test('inspectStaged trusts ES and requires exact count and a single projection checksum', async () => {
  const { sink } = makeSink()
  await expect(sink.inspectStaged({ postId: 'post-1', sourceVersion: 'source-2' })).resolves.toEqual({ chunkCount: 2, chunkChecksum: 'projection-sum' })
  const mismatch = makeSink({ requestJson: async () => ({ hits: { hits: [{ _source: { projectionChecksum: 'a' } }, { _source: { projectionChecksum: 'b' } }] } }) }).sink
  await expect(mismatch.inspectStaged({ postId: 'post-1', sourceVersion: 'source-2' })).rejects.toMatchObject({ code: 'ES_INSPECTION_FAILED' })
})

test('activate CAS rejects older and equal conflict, is idempotent for equal source, and accepts newer', async () => {
  const database = fakeDatabase({ 'post_rag_index_state_v2/post-1': { schemaVersion: 2, postId: 'post-1', state: 'active', sourceVersion: 'source-2', activationOrder: { contentVersion: 2, jobId: 'job-2' } } })
  const { sink } = makeSink({ database })
  await expect(sink.activate({ postId: 'post-1', sourceVersion: 'source-1', activationOrder: { contentVersion: 1, jobId: 'job-1' } })).resolves.toEqual({ activated: false })
  await expect(sink.activate({ postId: 'post-1', sourceVersion: 'source-2', activationOrder: { contentVersion: 2, jobId: 'job-2' } })).resolves.toEqual({ activated: true })
  await expect(sink.activate({ postId: 'post-1', sourceVersion: 'evil', activationOrder: { contentVersion: 2, jobId: 'job-2' } })).rejects.toMatchObject({ code: 'ACTIVATION_CONFLICT' })
  await expect(sink.activate({ postId: 'post-1', sourceVersion: 'source-3', activationOrder: { contentVersion: 3, jobId: 'job-3' } })).resolves.toEqual({ activated: true })
})

test('cleanup deletes only explicitly older IDs across stable pages and cannot delete a concurrently staged newer version', async () => {
  const database = fakeDatabase({
    'post_rag_index_state_v2/post-1': { schemaVersion: 2, postId: 'post-1', state: 'active', sourceVersion: 'source-2', activationOrder: { contentVersion: 2, jobId: 'job-2' } },
    'post_rag_index_versions/keep-a': { _id: 'keep-a', esDocumentId: 'keep-a', schemaVersion: 2, postId: 'post-1', sourceVersion: 'source-2', activationOrder: { contentVersion: 2, jobId: 'job-2' } },
    'post_rag_index_versions/keep-b': { _id: 'keep-b', esDocumentId: 'keep-b', schemaVersion: 2, postId: 'post-1', sourceVersion: 'source-2', activationOrder: { contentVersion: 2, jobId: 'job-2' } },
    'post_rag_index_versions/old-a': { _id: 'old-a', esDocumentId: 'old-a', schemaVersion: 2, postId: 'post-1', sourceVersion: 'old', activationOrder: { contentVersion: 1, jobId: 'job-1' } },
    'post_rag_index_versions/old-b': { _id: 'old-b', esDocumentId: 'old-b', schemaVersion: 2, postId: 'post-1', sourceVersion: 'older', activationOrder: { contentVersion: 1, jobId: 'job-0' } },
  })
  const calls: any[] = []
  const requestJson = async (method: string, path: string, body: any) => {
    database.collections.get('post_rag_index_versions')!.set('newer', { _id: 'newer', esDocumentId: 'newer', schemaVersion: 2, postId: 'post-1', sourceVersion: 'source-3', activationOrder: { contentVersion: 3, jobId: 'job-3' } })
    database.collections.get('post_rag_index_state_v2')!.set('post-1', { schemaVersion: 2, postId: 'post-1', state: 'active', sourceVersion: 'source-3', activationOrder: { contentVersion: 3, jobId: 'job-3' } })
    calls.push({ method, path, body })
    return { deleted: body.query.ids.values.length, timed_out: false, failures: [] }
  }
  const { sink } = makeSink({ database, requestJson, mirrorPageSize: 1, deleteBatchSize: 1 })
  await sink.cleanupOldVersions({ postId: 'post-1', keepSourceVersion: 'source-2', activationOrder: { contentVersion: 2, jobId: 'job-2' } })
  expect(calls.flatMap((call) => call.body.query.ids.values).sort()).toEqual(['old-a', 'old-b'])
  expect(calls.flatMap((call) => call.body.query.ids.values)).not.toContain('newer')
  expect([...database.collections.get('post_rag_index_versions')!.keys()].sort()).toEqual(['keep-a', 'keep-b', 'newer', 'old-a', 'old-b'])
  await sink.cleanupOldVersions({ postId: 'post-1', keepSourceVersion: 'source-2', activationOrder: { contentVersion: 2, jobId: 'job-2' } })
  expect(calls).toHaveLength(2)
})

test('remove writes tombstone before deleting explicit IDs at or below its order while preserving newer mirrors', async () => {
  const database = fakeDatabase({
    'post_rag_index_state_v2/post-1': { schemaVersion: 2, postId: 'post-1', state: 'active', sourceVersion: 'source-1', activationOrder: { contentVersion: 1, jobId: 'job-1' } },
    'post_rag_index_versions/old': { _id: 'old', esDocumentId: 'old', schemaVersion: 2, postId: 'post-1', sourceVersion: 'source-1', activationOrder: { contentVersion: 1, jobId: 'job-1' } },
    'post_rag_index_versions/equal': { _id: 'equal', esDocumentId: 'equal', schemaVersion: 2, postId: 'post-1', sourceVersion: 'source-2', activationOrder: { contentVersion: 2, jobId: 'job-2' } },
    'post_rag_index_versions/newer': { _id: 'newer', esDocumentId: 'newer', schemaVersion: 2, postId: 'post-1', sourceVersion: 'source-3', activationOrder: { contentVersion: 3, jobId: 'job-3' } },
  })
  let fails = true
  const deletedIds: string[][] = []
  const requestJson = jest.fn(async (_method: string, _path: string, body: any) => { deletedIds.push(body.query.ids.values); if (fails) throw new Error('ES unavailable'); return { deleted: 2, timed_out: false, failures: [] } })
  const { sink } = makeSink({ database, requestJson })
  await expect(sink.remove({ postId: 'post-1', sourceVersion: 'removed-2', activationOrder: { contentVersion: 2, jobId: 'job-2' } })).rejects.toMatchObject({ code: 'ES_DELETE_FAILED' })
  expect(database.collections.get('post_rag_index_state_v2')!.get('post-1')).toMatchObject({ state: 'removed', sourceVersion: 'removed-2' })
  fails = false
  await expect(sink.remove({ postId: 'post-1', sourceVersion: 'removed-2', activationOrder: { contentVersion: 2, jobId: 'job-2' } })).resolves.toEqual({ removed: true })
  await expect(sink.remove({ postId: 'post-1', sourceVersion: 'old', activationOrder: { contentVersion: 1, jobId: 'old' } })).resolves.toEqual({ removed: false })
  expect(requestJson).toHaveBeenCalledTimes(2)
  expect(deletedIds).toEqual([['old', 'equal'], ['old', 'equal']])
  expect(deletedIds.flat()).not.toContain('newer')
})

test('fails closed on malformed identifiers, state schema, embeddings, and does not log source text', async () => {
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  const { sink } = makeSink({ database: fakeDatabase({ 'post_rag_index_state_v2/post-1': { schemaVersion: 1 } }), embedTexts: async () => [[Infinity]] })
  await expect(sink.activate({ postId: 'post-1', sourceVersion: 'x', activationOrder: { contentVersion: 2, jobId: 'job-2' } })).rejects.toMatchObject({ code: 'STATE_INVALID' })
  await expect(sink.inspectStaged({ postId: ' bad', sourceVersion: 'x' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  await expect(sink.stageUpsert({ projection: projection() as any, job: job() })).rejects.toMatchObject({ code: 'EMBEDDING_INVALID' })
  expect(consoleSpy).not.toHaveBeenCalled()
  consoleSpy.mockRestore()
})

test('rejects unsafe ES index paths and projections that do not belong to the claimed job', async () => {
  expect(() => makeSink({ indexName: '../other-index' })).toThrow()
  const { sink } = makeSink()
  await expect(sink.stageUpsert({ projection: projection() as any, job: { ...job(), sourceVersion: 'other' } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  await expect(sink.stageUpsert({ projection: projection() as any, job: { ...job(), communityId: 'other' } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  await expect(sink.stageUpsert({ projection: projection() as any, job: { ...job(), contentVersion: 1.5 } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
})

test.each([
  ['timed out', { deleted: 0, timed_out: true, failures: [] }],
  ['reported failures', { deleted: 0, timed_out: false, failures: [{ shard: 0 }] }],
])('retains mirrors when delete-by-query %s and equal-order retry can finish cleanup', async (_label, failedResponse) => {
  const database = fakeDatabase({
    'post_rag_index_state_v2/post-1': { schemaVersion: 2, postId: 'post-1', state: 'active', sourceVersion: 'source-1', activationOrder: { contentVersion: 1, jobId: 'job-1' } },
    'post_rag_index_versions/old': { _id: 'old', esDocumentId: 'old', schemaVersion: 2, postId: 'post-1', sourceVersion: 'source-1', activationOrder: { contentVersion: 1, jobId: 'job-1' } },
  })
  const responses = [failedResponse, { deleted: 1, timed_out: false, failures: [] }]
  const { sink } = makeSink({ database, requestJson: async () => responses.shift() })
  const input = { postId: 'post-1', sourceVersion: 'removed-2', activationOrder: { contentVersion: 2, jobId: 'job-2' } }
  await expect(sink.remove(input)).rejects.toMatchObject({ code: 'ES_DELETE_FAILED' })
  expect(database.collections.get('post_rag_index_versions')!.has('old')).toBe(true)
  await expect(sink.remove(input)).resolves.toEqual({ removed: true })
  expect(database.collections.get('post_rag_index_versions')!.has('old')).toBe(false)
})
test('keeps legacy index state untouched while activating and removing through isolated v2 state', async () => {
  const legacy = { _id: 'post-1', postId: 'post-1', status: 'indexed', indexedAt: '2026-01-01T00:00:00.000Z', chunkCount: 7 }
  const database = fakeDatabase({ 'post_rag_index_state/post-1': legacy })
  const { sink } = makeSink({ database })
  await expect(sink.activate({ postId: 'post-1', sourceVersion: 'source-2', activationOrder: { contentVersion: 2, jobId: 'job-2' } })).resolves.toEqual({ activated: true })
  await expect(sink.remove({ postId: 'post-1', sourceVersion: 'removed-3', activationOrder: { contentVersion: 3, jobId: 'job-3' } })).resolves.toEqual({ removed: true })
  expect(database.collections.get('post_rag_index_state')!.get('post-1')).toEqual(legacy)
  expect(database.collections.get('post_rag_index_state_v2')!.get('post-1')).toMatchObject({
    schemaVersion: 2, state: 'removed', sourceVersion: 'removed-3', activationOrder: { contentVersion: 3, jobId: 'job-3' },
  })
})

test.each([
  ['missing timed_out', { deleted: 0, failures: [] }],
  ['wrong timed_out type', { deleted: 0, timed_out: 'false', failures: [] }],
  ['missing deleted', { timed_out: false, failures: [] }],
  ['wrong deleted type', { deleted: '0', timed_out: false, failures: [] }],
  ['negative deleted', { deleted: -1, timed_out: false, failures: [] }],
  ['noninteger deleted', { deleted: 0.5, timed_out: false, failures: [] }],
  ['unsafe deleted integer', { deleted: Number.MAX_SAFE_INTEGER + 1, timed_out: false, failures: [] }],
  ['missing failures', { deleted: 0, timed_out: false }],
  ['wrong failures type', { deleted: 0, timed_out: false, failures: 'none' }],
])('rejects malformed delete response with %s, retains mirror, and permits equal-order retry', async (_label, malformedResponse) => {
  const database = fakeDatabase({
    'post_rag_index_state_v2/post-1': { schemaVersion: 2, postId: 'post-1', state: 'active', sourceVersion: 'source-1', activationOrder: { contentVersion: 1, jobId: 'job-1' } },
    'post_rag_index_versions/old': { _id: 'old', esDocumentId: 'old', schemaVersion: 2, postId: 'post-1', sourceVersion: 'source-1', activationOrder: { contentVersion: 1, jobId: 'job-1' } },
  })
  const responses = [malformedResponse, { deleted: 0, timed_out: false, failures: [] }]
  const { sink } = makeSink({ database, requestJson: async () => responses.shift() })
  const input = { postId: 'post-1', sourceVersion: 'removed-2', activationOrder: { contentVersion: 2, jobId: 'job-2' } }
  await expect(sink.remove(input)).rejects.toBeInstanceOf(PostRagVersionedSinkError)
  expect(database.collections.get('post_rag_index_versions')!.has('old')).toBe(true)
  await expect(sink.remove(input)).resolves.toEqual({ removed: true })
  expect(database.collections.get('post_rag_index_versions')!.has('old')).toBe(false)
})
