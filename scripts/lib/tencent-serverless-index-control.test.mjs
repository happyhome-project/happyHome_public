import assert from 'node:assert/strict'
import test from 'node:test'
import { readTencentServerlessIndexMappings } from './tencent-serverless-index-control.mjs'

const fixedNow = Date.parse('2026-07-13T08:30:45.000Z')
const secretId = 'AKIDEXAMPLE'
const secretKey = 'never-expose-this-secret'

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() { return body },
  }
}

function options(overrides = {}) {
  return {
    secretId,
    secretKey,
    region: 'ap-beijing',
    indexName: 'happyhome_post_rag_chunks',
    now: () => fixedNow,
    ...overrides,
  }
}

test('signs DescribeServerlessInstances and returns the exact index mappings', async () => {
  let request
  const mappings = { properties: { postId: { type: 'keyword' } } }
  const fetchImpl = async (url, init) => {
    request = { url, init }
    return jsonResponse({
      Response: {
        IndexMetaFields: [
          { IndexName: 'other-index', IndexMetaJson: JSON.stringify({ mappings: { properties: {} } }) },
          { IndexName: 'happyhome_post_rag_chunks', IndexMetaJson: JSON.stringify({ mappings }) },
        ],
        RequestId: 'request-id',
      },
    })
  }

  const actual = await readTencentServerlessIndexMappings(options({ fetchImpl }))

  assert.deepEqual(actual, mappings)
  assert.equal(request.url, 'https://es.tencentcloudapi.com/')
  assert.equal(request.init.method, 'POST')
  assert.deepEqual(JSON.parse(request.init.body), {
    IndexNames: ['happyhome_post_rag_chunks'],
    Limit: 1,
  })
  assert.equal(request.init.headers.Host, 'es.tencentcloudapi.com')
  assert.equal(request.init.headers['X-TC-Action'], 'DescribeServerlessInstances')
  assert.equal(request.init.headers['X-TC-Version'], '2018-04-16')
  assert.equal(request.init.headers['X-TC-Region'], 'ap-beijing')
  assert.equal(request.init.headers['X-TC-Timestamp'], String(fixedNow / 1000))
  assert.equal(
    request.init.headers.Authorization,
    'TC3-HMAC-SHA256 Credential=AKIDEXAMPLE/2026-07-13/es/tc3_request, SignedHeaders=content-type;host, Signature=d3b46296922f91b8ebbf1324b32005b8be93997ab443830f5d8695adfa171a74',
  )
  assert.equal(request.init.headers.Authorization.includes(secretKey), false)
})

test('fails closed for timeout, HTTP errors, and provider errors without exposing secrets', async (t) => {
  await t.test('timeout', async () => {
    const fetchImpl = async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    await assert.rejects(
      () => readTencentServerlessIndexMappings(options({ fetchImpl, timeoutMs: 5 })),
      /timed out/i,
    )
  })

  await t.test('response body timeout', async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => new Promise(() => {}) })
    const guard = new Promise((_, reject) => setTimeout(() => reject(new Error('test guard expired')), 30))
    await assert.rejects(
      () => Promise.race([
        readTencentServerlessIndexMappings(options({ fetchImpl, timeoutMs: 5 })),
        guard,
      ]),
      /timed out/i,
    )
  })

  await t.test('HTTP error', async () => {
    const fetchImpl = async () => jsonResponse({ secretKey }, { ok: false, status: 503 })
    await assert.rejects(
      () => readTencentServerlessIndexMappings(options({ fetchImpl })),
      (error) => /HTTP 503/.test(error.message) && !error.message.includes(secretKey),
    )
  })

  await t.test('provider error', async () => {
    const fetchImpl = async () => jsonResponse({
      Response: { Error: { Code: 'InternalError', Message: `leaked ${secretKey}` }, RequestId: 'request-id' },
    })
    await assert.rejects(
      () => readTencentServerlessIndexMappings(options({ fetchImpl })),
      (error) => /provider error.*InternalError/i.test(error.message) && !error.message.includes(secretKey),
    )
  })
})

test('fails closed when the exact index or a valid IndexMetaJson mappings object is absent', async (t) => {
  async function rejectsFields(fields, pattern) {
    const fetchImpl = async () => jsonResponse({ Response: { IndexMetaFields: fields, RequestId: 'request-id' } })
    await assert.rejects(() => readTencentServerlessIndexMappings(options({ fetchImpl })), pattern)
  }

  await t.test('missing exact index', () => rejectsFields([
    { IndexName: 'happyhome_post_rag_chunks-copy', IndexMetaJson: JSON.stringify({ mappings: {} }) },
  ], /exact index.*not found/i))
  await t.test('missing IndexMetaJson', () => rejectsFields([
    { IndexName: 'happyhome_post_rag_chunks' },
  ], /IndexMetaJson/i))
  await t.test('malformed IndexMetaJson', () => rejectsFields([
    { IndexName: 'happyhome_post_rag_chunks', IndexMetaJson: '{not-json' },
  ], /IndexMetaJson/i))
  await t.test('missing mappings', () => rejectsFields([
    { IndexName: 'happyhome_post_rag_chunks', IndexMetaJson: JSON.stringify({ settings: {} }) },
  ], /mappings/i))
  await t.test('non-object mappings', () => rejectsFields([
    { IndexName: 'happyhome_post_rag_chunks', IndexMetaJson: JSON.stringify({ mappings: [] }) },
  ], /mappings/i))
})
