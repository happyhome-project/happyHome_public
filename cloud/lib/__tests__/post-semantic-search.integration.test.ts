import http from 'http'
import { AddressInfo } from 'net'
import * as database from '../db.local'
import { createPostSemanticSearchService } from '../post-semantic-search'

beforeEach(() => database._resetAll())

test('local HTTP hybrid ES candidates become current posts while stale and deleted rows are filtered', async () => {
  const requests: any[] = []
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ hits: { hits: [
        { _score: 3, _source: { postId: 'current', communityId: 'c1', sectionId: 's1', sourceVersion: 'sv1', chunkId: 'ch1', visibility: 'public', widgetId: 'w1', fieldKey: 'body', title: '一粥一饭', text: '当思来处不易', preview: '一粥一饭，当思来处不易', fieldLabel: '正文', sectionName: '家风' } },
        { _score: 2, _source: { postId: 'stale', communityId: 'c1', sectionId: 's1', sourceVersion: 'old', chunkId: 'ch2', visibility: 'public', widgetId: 'w1', fieldKey: 'body', title: '旧内容', text: '旧内容', preview: '旧内容', fieldLabel: '正文', sectionName: '家风' } },
        { _score: 1, _source: { postId: 'deleted', communityId: 'c1', sectionId: 's1', sourceVersion: 'sv1', chunkId: 'ch3', visibility: 'public', widgetId: 'w1', fieldKey: 'body', title: '已删除', text: '已删除', preview: '已删除', fieldLabel: '正文', sectionName: '家风' } },
      ] } }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await database.create('rag_community_versions', { _id: 'c1', communityId: 'c1', contentVersion: 1, aclVersion: 1 })
    await database.create('sections', { _id: 's1', communityId: 'c1', status: 'active', name: '家风', widgets: [{ widgetId: 'w1', fieldKey: 'body', visibility: 'public' }] })
    for (const [id, status] of [['current', 'active'], ['stale', 'active'], ['deleted', 'deleted']]) {
      await database.create('posts', { _id: id, communityId: 'c1', sectionId: 's1', status, auditStatus: 'pass', createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-02T00:00:00.000Z' })
      await database.create('post_rag_index_state_v2', { _id: id, schemaVersion: 2, postId: id, state: 'active', sourceVersion: id === 'stale' ? 'new' : 'sv1' })
    }
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const requestJson = async (_method: string, path: string, body?: unknown) => new Promise<any>((resolve, reject) => {
      const payload = JSON.stringify(body ?? {})
      const req = http.request(`${endpoint}/${path.replace(/^\/+/, '')}`, { method: 'POST', agent: false, headers: { Connection: 'close', 'Content-Type': 'application/json' } }, response => {
        const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (error) { reject(error) }
        })
      })
      req.on('error', reject); req.write(payload); req.end()
    })
    const service = createPostSemanticSearchService({ database, requestJson, embedTexts: async () => [[0.2, 0.4]], indexName: 'rag-index', vectorField: 'embedding', embeddingModel: 'bge-base-zh-v1.5' })
    const result = await service.search({ communityId: 'c1', query: '勤俭持家', includeMemberOnly: false })
    expect(requests).toHaveLength(1)
    // This local boundary proves the payload shape; release still requires an isolated real Tencent ES smoke.
    expect(requests[0]).toMatchObject({ knn: { query_vector: [0.2, 0.4] }, rank: { rrf: { rank_window_size: 40, rank_constant: 60 } } })
    expect(result.items).toEqual([expect.objectContaining({ postId: 'current', title: '一粥一饭' })])
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
