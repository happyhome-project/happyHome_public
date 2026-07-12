import http from 'http'
import { buildPostRagJobId, type PostRagJobDocument } from '../post-rag-jobs'
import { processClaimedPostRagJob } from '../post-rag-job-processor'
import { createPostRagV2RuntimeFromEnv } from '../post-rag-v2-runtime'

const NOW = '2099-07-12T04:00:00.000Z'
const EXPIRY = '2099-07-12T04:02:00.000Z'

test('isolated ES-compatible endpoint indexes, replaces and removes a v2 post', async () => {
  const esDocs = new Map<string, any>(); const requests: Array<{ url: string; body: string }> = []
  const server = http.createServer((req, res) => { const chunks: Buffer[] = []; req.on('data', c => chunks.push(Buffer.from(c))); req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8'); requests.push({ url: req.url || '', body })
    if (req.url?.includes('/_bulk')) {
      const lines = body.trim().split('\n'); const items: any[] = []
      for (let i = 0; i < lines.length; i += 2) { const action = JSON.parse(lines[i]); const doc = JSON.parse(lines[i + 1]); esDocs.set(action.create._id, doc); items.push({ create: { status: 201 } }) }
      res.end(JSON.stringify({ errors: false, items })); return
    }
    if (req.url?.endsWith('/_search')) {
      const query = JSON.parse(body); const filters = query.query.bool.filter; const postId = filters[0].term.postId; const sourceVersion = filters[1].term.sourceVersion
      const hits = [...esDocs.entries()].filter(([, doc]) => doc.postId === postId && doc.sourceVersion === sourceVersion).map(([id, doc]) => ({ _id: id, _source: doc }))
      res.end(JSON.stringify({ hits: { hits } })); return
    }
    if (req.url?.endsWith('/_delete_by_query')) {
      const ids: string[] = JSON.parse(body).query.ids.values; let deleted = 0
      ids.forEach(id => { if (esDocs.delete(id)) deleted++ }); res.end(JSON.stringify({ timed_out: false, deleted, failures: [] })); return
    }
    res.statusCode = 404; res.end('{}')
  }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))

  const collections = new Map<string, Map<string, any>>(); const coll = (name: string) => { if (!collections.has(name)) collections.set(name, new Map()); return collections.get(name)! }
  const database: any = {
    runTransaction: async (operation: any) => operation({ collection: (name: string) => ({ doc: (id: string) => ({
      get: async () => { const value = coll(name).get(id); if (!value) throw new Error('document not found'); return { data: structuredClone(value) } },
      set: async ({ data }: any) => { coll(name).set(id, { _id: id, ...structuredClone(data) }) },
    }) }) }),
    transactionGetByIdOrNull: async (transaction: any, name: string, id: string) => { try { return (await transaction.collection(name).doc(id).get()).data } catch { return null } },
    getById: async (name: string, id: string) => coll(name).get(id) || null,
    queryAfterId: async (name: string, where: any, afterId: string | null, limit: number) => [...coll(name).values()].filter(doc => Object.entries(where).every(([k, v]) => doc[k] === v) && (!afterId || doc._id > afterId)).sort((a, b) => a._id.localeCompare(b._id)).slice(0, limit),
    updateById: async (name: string, id: string, data: any) => { if (!coll(name).has(id)) return { stats: { updated: 0 } }; coll(name).set(id, { ...coll(name).get(id), ...structuredClone(data) }); return { stats: { updated: 1 } } },
    create: async (name: string, data: any) => { if (coll(name).has(data._id)) throw new Error('duplicate'); coll(name).set(data._id, structuredClone(data)); return data._id },
    removeById: async (name: string, id: string) => { coll(name).delete(id) },
  }
  const port = (server.address() as any).port
  const runtime = createPostRagV2RuntimeFromEnv({
    env: { TENCENT_RAG_ES_ENDPOINT: 'https://es.example.test', TENCENT_RAG_ES_USERNAME: 'elastic', TENCENT_RAG_ES_PASSWORD: 'pw', TENCENT_RAG_INDEX_NAME: 'rag-v2', TENCENT_RAG_ATOMIC_SECRET_ID: 'id', TENCENT_RAG_ATOMIC_SECRET_KEY: 'key', TENCENT_RAG_ATOMIC_REGION: 'ap-shanghai', TENCENT_RAG_EMBEDDING_MODEL: 'bge' },
    database,
    requestAtomicJson: (async (_config: any, _action: string, body: any) => ({ Data: body.Texts.map((_text: string, index: number) => ({ Embedding: [index + 1, 0.5] })) })) as any,
    requestJson: async (method: string, path: string, body?: unknown, options?: { contentType?: string }) => {
      const payload = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
      return new Promise((resolve, reject) => {
        const req = http.request(`http://127.0.0.1:${port}/${path.replace(/^\/+/, '')}`, { method, agent: false, headers: { Connection: 'close', 'Content-Type': options?.contentType || 'application/json' } }, res => {
          const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(Buffer.from(chunk))); res.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch (error) { reject(error) }
          })
        })
        req.setTimeout(2_000, () => req.destroy(new Error('local ES request timed out')))
        req.on('error', reject); if (payload) req.write(payload); req.end()
      })
    },
  })
  const makeJob = (sourceVersion: string, contentVersion: number, action: 'upsert' | 'delete' = 'upsert'): PostRagJobDocument => ({
    schemaVersion: 2, _id: buildPostRagJobId(`outbox-${contentVersion}`, 'post-1', action, sourceVersion, contentVersion), outboxId: `outbox-${contentVersion}`, postId: 'post-1', communityId: 'community-1', sectionId: 'section-1', action, sourceVersion, contentVersion, status: 'processing', attempts: 1, nextAttemptAt: NOW, leaseOwner: 'worker-1', leaseToken: `lease-${contentVersion}`, leaseExpiresAt: EXPIRY, createdAt: NOW, updatedAt: NOW, outcome: null, lastError: null,
  })
  let currentJob = makeJob('source-1', 1); let postExists = true
  coll('post_rag_jobs').set(currentJob._id, structuredClone(currentJob))
  const projection = (sourceVersion: string, text: string, eligible = true) => ({ eligible, sourceVersion, retrievalIndexVersion: 'post-rag-v2', chunks: eligible ? [{ chunkId: 'chunk-1', postId: 'post-1', communityId: 'community-1', sectionId: 'section-1', sourceVersion, retrievalIndexVersion: 'post-rag-v2', chunkChecksum: `chunk-${sourceVersion}`, text }] : [], chunkCount: eligible ? 1 : 0, chunkChecksum: eligible ? `projection-${sourceVersion}` : '' }) as any
  let currentProjection = projection('source-1', '一粥一饭，当思来处不易')
  const completed: string[] = []
  const deps: any = { sink: runtime.sink, loadPost: async () => postExists ? ({ _id: 'post-1', communityId: 'community-1', sectionId: 'section-1', status: 'active' }) : null, loadSection: async () => ({ _id: 'section-1', communityId: 'community-1', status: 'active' }), buildProjection: () => currentProjection, readJob: async () => currentJob, complete: async (_id: string, value: any) => { completed.push(value.outcome) }, fail: async () => { throw new Error('unexpected failure') } }
  try {
    await expect(processClaimedPostRagJob(currentJob, { workerId: 'worker-1', now: () => NOW }, deps)).resolves.toMatchObject({ status: 'completed', outcome: 'indexed' })
    expect([...esDocs.values()].map(doc => doc.text)).toEqual(['一粥一饭，当思来处不易'])
    currentJob = makeJob('source-2', 2); coll('post_rag_jobs').set(currentJob._id, structuredClone(currentJob)); currentProjection = projection('source-2', '勤俭持家，珍惜物力')
    await expect(processClaimedPostRagJob(currentJob, { workerId: 'worker-1', now: () => NOW }, deps)).resolves.toMatchObject({ status: 'completed', outcome: 'indexed' })
    expect([...esDocs.values()].map(doc => doc.text)).toEqual(['勤俭持家，珍惜物力'])
    currentJob = makeJob('removed-3', 3, 'delete'); coll('post_rag_jobs').set(currentJob._id, structuredClone(currentJob)); postExists = false
    await expect(processClaimedPostRagJob(currentJob, { workerId: 'worker-1', now: () => NOW }, deps)).resolves.toMatchObject({ status: 'completed', outcome: 'removed' })
    expect(esDocs.size).toBe(0); expect(completed).toEqual(['indexed', 'indexed', 'removed'])
    expect(requests.filter(item => item.url.endsWith('/_delete_by_query')).every(item => JSON.parse(item.body).query.ids.values.length > 0)).toBe(true)
  } finally {
    server.closeIdleConnections?.()
    server.closeAllConnections?.()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
