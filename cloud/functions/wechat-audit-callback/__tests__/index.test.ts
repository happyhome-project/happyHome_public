jest.mock('../../../lib/content-audit', () => ({
  applyWechatMediaAuditResult: jest.fn(),
}))

import { createHash } from 'crypto'
import { applyWechatMediaAuditResult } from '../../../lib/content-audit'
import { main } from '../index'

const token = 'message-token'
const appId = 'wx123'
let logSpy: jest.SpyInstance
let errorSpy: jest.SpyInstance

function signature(timestamp = '1700000000', nonce = 'nonce') {
  return createHash('sha1').update([token, timestamp, nonce].sort().join('')).digest('hex')
}

function query(extra: Record<string, string> = {}) {
  return { signature: signature(), timestamp: '1700000000', nonce: 'nonce', ...extra }
}

function mediaEvent(suggest = 'pass') {
  return {
    Event: 'wxa_media_check',
    appid: appId,
    trace_id: 'trace-1',
    result: { suggest, label: 100 },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  process.env.WX_MESSAGE_TOKEN = token
  process.env.WX_APPID = appId
  ;(applyWechatMediaAuditResult as jest.Mock).mockResolvedValue({ success: true, matched: 1, status: 'pass', refreshed: 1 })
})

afterEach(() => {
  logSpy.mockRestore()
  errorSpy.mockRestore()
  delete process.env.WX_MESSAGE_TOKEN
  delete process.env.WX_APPID
})

test('GET verifies WeChat signature and returns echostr as plain text', async () => {
  const response = await main({ httpMethod: 'GET', queryStringParameters: query({ echostr: 'verified' }) })
  expect(response).toEqual(expect.objectContaining({ statusCode: 200, body: 'verified' }))
  expect(response.headers['content-type']).toContain('text/plain')
})

test('GET rejects an invalid signature', async () => {
  const response = await main({ httpMethod: 'GET', queryStringParameters: query({ signature: '0'.repeat(40), echostr: 'no' }) })
  expect(response.statusCode).toBe(403)
  expect(response.body).not.toContain(token)
})

test('POST applies a verified media audit result', async () => {
  const response = await main({ httpMethod: 'POST', queryStringParameters: query(), body: JSON.stringify(mediaEvent()) })
  expect(response.statusCode).toBe(200)
  expect(JSON.parse(response.body)).toEqual({ success: true, matched: 1, status: 'pass' })
  expect(applyWechatMediaAuditResult).toHaveBeenCalledWith({ traceId: 'trace-1', suggest: 'pass', label: 100 })
  expect(JSON.stringify(logSpy.mock.calls)).not.toContain('trace-1')
  expect(JSON.stringify(logSpy.mock.calls)).not.toContain(token)
})

test('POST acknowledges an unknown trace without exposing the payload', async () => {
  ;(applyWechatMediaAuditResult as jest.Mock).mockResolvedValue({ success: true, matched: 0, status: 'pass', refreshed: 0 })
  const response = await main({ httpMethod: 'POST', queryStringParameters: query(), body: JSON.stringify(mediaEvent()) })
  expect(response.statusCode).toBe(200)
  expect(JSON.parse(response.body)).toEqual({ success: true, matched: 0, status: 'pass' })
  expect(response.body).not.toContain('trace-1')
})

test('POST rejects malformed JSON without touching audit state', async () => {
  const response = await main({ httpMethod: 'POST', queryStringParameters: query(), body: '{bad' })
  expect(response.statusCode).toBe(400)
  expect(applyWechatMediaAuditResult).not.toHaveBeenCalled()
})

test('POST rejects invalid signatures before parsing callback state', async () => {
  const response = await main({
    httpMethod: 'POST',
    queryStringParameters: query({ signature: '0'.repeat(40) }),
    body: JSON.stringify(mediaEvent()),
  })
  expect(response.statusCode).toBe(403)
  expect(applyWechatMediaAuditResult).not.toHaveBeenCalled()
})

test('POST returns 400 for unsupported callback events', async () => {
  const response = await main({
    httpMethod: 'POST',
    queryStringParameters: query(),
    body: JSON.stringify({ ...mediaEvent(), Event: 'other_event' }),
  })
  expect(response.statusCode).toBe(400)
  expect(applyWechatMediaAuditResult).not.toHaveBeenCalled()
})

test('POST returns retryable 500 when persistence fails', async () => {
  ;(applyWechatMediaAuditResult as jest.Mock).mockRejectedValue(new Error('database unavailable'))
  const response = await main({ httpMethod: 'POST', queryStringParameters: query(), body: JSON.stringify(mediaEvent()) })
  expect(response.statusCode).toBe(500)
  expect(response.body).not.toContain('database unavailable')
})

test('non-HTTP invocation and missing secrets fail closed', async () => {
  expect((await main({})).statusCode).toBe(404)
  delete process.env.WX_MESSAGE_TOKEN
  expect((await main({ httpMethod: 'GET', queryStringParameters: query({ echostr: 'no' }) })).statusCode).toBe(503)
})
