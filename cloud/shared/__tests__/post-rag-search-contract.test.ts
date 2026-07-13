import {
  parsePostRagEsResponse,
  parsePostRagProtocolV2Item,
  parsePostRagSearchRequest,
  toPublicPostRagSearchResponse,
} from '../post-rag-search-contract'

const rawItem = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 2,
  postId: 'post-1',
  communityId: 'community-1',
  sectionId: 'section-1',
  sourceVersion: 'source-1',
  chunkId: 'chunk-1',
  visibility: 'public',
  widgetId: 'widget-1',
  fieldKey: 'body',
  title: '亲子活动',
  text: '周六上午九点集合',
  preview: '周六上午九点',
  fieldLabel: '正文',
  sectionName: '活动',
  ...overrides,
})

describe('public semantic post search contract', () => {
  test('normalizes Unicode query text before measuring the 1..80 character boundary', () => {
    expect(parsePostRagSearchRequest({
      communityId: 'community-1',
      query: '  Ａ\u3000勤俭\n持家  ',
    })).toEqual({ communityId: 'community-1', query: 'A 勤俭 持家', skip: 0, limit: 10 })

    expect(parsePostRagSearchRequest({ communityId: 'c1', query: '😀'.repeat(80) }).query)
      .toHaveLength(160)
    expect(() => parsePostRagSearchRequest({ communityId: 'c1', query: '' })).toThrow('invalid query')
    expect(() => parsePostRagSearchRequest({ communityId: 'c1', query: 'x'.repeat(81) })).toThrow('invalid query')
    expect(() => parsePostRagSearchRequest({ communityId: 'c1', query: '勤俭\u0000' })).toThrow('invalid query')
    expect(() => parsePostRagSearchRequest({ communityId: 'c1', query: '勤俭\uD800' })).toThrow('invalid query')
  })

  test('accepts bounded launch pagination and rejects malformed pagination', () => {
    expect(parsePostRagSearchRequest({ communityId: 'c1', sectionId: 's1', query: '家风', skip: 10, limit: 10 }))
      .toMatchObject({ sectionId: 's1', skip: 10, limit: 10 })

    for (const input of [
      { skip: -1, limit: 10 }, { skip: 20, limit: 10 }, { skip: 0, limit: 0 },
      { skip: 0, limit: 11 }, { skip: 10, limit: 11 }, { skip: 1.5, limit: 10 },
    ]) {
      expect(() => parsePostRagSearchRequest({ communityId: 'c1', query: '家风', ...input }))
        .toThrow('invalid pagination')
    }
  })

  test('strictly parses protocol-v2 items including canonical repeated body fields', () => {
    expect(parsePostRagProtocolV2Item(rawItem({ fieldKey: 'body.2' }))).toMatchObject({
      schemaVersion: 2,
      postId: 'post-1',
      fieldKey: 'body.2',
    })
    for (const fieldKey of ['body.02', 'body.1', 'body.foo']) {
      expect(() => parsePostRagProtocolV2Item(rawItem({ fieldKey }))).toThrow('invalid fieldKey')
    }
    expect(() => parsePostRagProtocolV2Item(rawItem({ schemaVersion: 1 }))).toThrow('invalid schemaVersion')
  })

  test('rejects malformed identifiers in requests and protocol items', () => {
    for (const communityId of ['', ' community-1', 'community/1', 'x'.repeat(129)]) {
      expect(() => parsePostRagSearchRequest({ communityId, query: '家风' })).toThrow('invalid communityId')
    }
    expect(() => parsePostRagProtocolV2Item(rawItem({ chunkId: '../secret' }))).toThrow('invalid chunkId')
  })

  test('requires a strict Elasticsearch response envelope and rejects one malformed hit', () => {
    const envelope = {
      took: 7,
      timed_out: false,
      _shards: { total: 3, successful: 3, skipped: 0, failed: 0 },
      hits: { total: { value: 1, relation: 'eq' }, max_score: null, hits: [
        { _index: 'post-rag-v2', _id: 'post-1:source-1:chunk-1', _score: null, _rank: 1, _source: rawItem() },
      ] },
    }
    expect(parsePostRagEsResponse(envelope)).toMatchObject({
      _shards: { total: 3, successful: 3, skipped: 0, failed: 0 },
      hits: { hits: [expect.objectContaining({ _id: 'post-1:source-1:chunk-1' })] },
    })
    expect(() => parsePostRagEsResponse({ ...envelope, secret: true })).toThrow('invalid Elasticsearch response')
    expect(() => parsePostRagEsResponse({
      ...envelope,
      _shards: { total: 3, successful: 4, skipped: 0, failed: 0 },
    })).toThrow('invalid Elasticsearch shards')
    expect(() => parsePostRagEsResponse({
      ...envelope,
      _shards: { ...envelope._shards, failures: [] },
    })).toThrow('invalid Elasticsearch shards')
    expect(() => parsePostRagEsResponse({ ...envelope, hits: { ...envelope.hits, hits: [
      envelope.hits.hits[0], { _id: 'bad', _source: { postId: 'post-1' } },
    ] } })).toThrow('invalid Elasticsearch hit')
  })

  test('maps only safe public fields and keeps non-generative compatibility fields empty', () => {
    const response = toPublicPostRagSearchResponse({
      query: '家风', communityId: 'community-1', sectionId: 'section-1', skip: 0, limit: 10,
      total: 1, tookMs: 7, mode: 'rag', items: [{
        postId: 'post-1', sectionId: 'section-1', sectionName: '活动', title: '亲子活动',
        matchedSnippet: '周六上午九点', matchedField: '正文', score: 0.98,
        coverImage: 'cloud://cover.jpg', authorName: '社区助理',
        sourceVersion: 'must-not-leak', chunkId: 'must-not-leak', visibility: 'public',
      }],
    })

    expect(response).toEqual({
      protocolVersion: 2, answer: '', citations: [], mode: 'rag', query: '家风',
      communityId: 'community-1', sectionId: 'section-1', skip: 0, limit: 10, total: 1, tookMs: 7,
      items: [{ postId: 'post-1', sectionId: 'section-1', sectionName: '活动', title: '亲子活动',
        matchedSnippet: '周六上午九点', matchedField: '正文', score: 0.98,
        coverImage: 'cloud://cover.jpg', authorName: '社区助理' }],
    })
    expect(() => toPublicPostRagSearchResponse({ ...response, mode: 'fallback' as never })).toThrow('invalid mode')
  })
})
