// Unit tests for http-gateway: auth, routing, header parsing, payload forwarding
// Mock cloud.callFunction to capture what gets forwarded to target functions.

const mockCallFunction = jest.fn()
process.env.GATEWAY_ENABLED = 'true'
process.env.GATEWAY_TOKEN = 'unit-gateway-token'
jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  callFunction: (...args: any[]) => mockCallFunction(...args),
  DYNAMIC_CURRENT_ENV: 'test',
}))

import { main as _main } from '../index'
// Gateway's main returns a union of shapes; we always assert on statusCode/body in HTTP branches.
const main = _main as (event: any) => Promise<any>

const TOKEN = 'unit-gateway-token'
const BEARER = `Bearer ${TOKEN}`

function httpEvent(opts: {
  method?: string
  auth?: string
  testOpenid?: string
  body?: any
}) {
  return {
    httpMethod: opts.method ?? 'POST',
    headers: {
      authorization: opts.auth ?? BEARER,
      ...(opts.testOpenid !== undefined ? { 'x-test-openid': opts.testOpenid } : {}),
    },
    body: opts.body === undefined ? undefined : (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)),
  }
}

beforeEach(() => {
  mockCallFunction.mockReset()
  mockCallFunction.mockResolvedValue({ result: { ok: true } })
})

describe('HTTP method handling', () => {
  test('non-HTTP event is rejected (prevents internal forwarding abuse)', async () => {
    const res = await main({ action: 'x', _fn: 'user' } as any)
    expect(res).toEqual({ error: 'http-gateway is HTTP only' })
    expect(mockCallFunction).not.toHaveBeenCalled()
  })

  test('OPTIONS preflight returns 200 with CORS headers, no forward', async () => {
    const res = await main(httpEvent({ method: 'OPTIONS' }))
    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-methods']).toContain('POST')
    expect(mockCallFunction).not.toHaveBeenCalled()
  })
})

describe('Authorization', () => {
  test('missing token → 403', async () => {
    const res = await main(httpEvent({ auth: '', testOpenid: 'u', body: { _fn: 'user', action: 'login' } }))
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).error).toBe('Unauthorized')
    expect(mockCallFunction).not.toHaveBeenCalled()
  })

  test('wrong token → 403', async () => {
    const res = await main(httpEvent({ auth: 'Bearer wrong', testOpenid: 'u', body: { _fn: 'user', action: 'login' } }))
    expect(res.statusCode).toBe(403)
    expect(mockCallFunction).not.toHaveBeenCalled()
  })

  test('raw token without Bearer prefix → 403', async () => {
    const res = await main(httpEvent({ auth: TOKEN, testOpenid: 'u', body: { _fn: 'user', action: 'login' } }))
    expect(res.statusCode).toBe(403)
  })
})

describe('Body / payload validation', () => {
  test('invalid JSON body → 400', async () => {
    const res = await main(httpEvent({ body: 'not-json{{', testOpenid: 'u' }))
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toMatch(/Invalid JSON/i)
  })

  test('missing _fn → 400', async () => {
    const res = await main(httpEvent({ testOpenid: 'u', body: { action: 'login' } }))
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toMatch(/Invalid _fn/)
  })

  test('_fn not in allow list → 400', async () => {
    const res = await main(httpEvent({ testOpenid: 'u', body: { _fn: 'admin', action: 'x' } }))
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toMatch(/Invalid _fn/)
  })

  test.each(['user', 'community', 'member', 'section', 'post'])('_fn=%s is allowed', async (fn) => {
    const res = await main(httpEvent({ testOpenid: 'u', body: { _fn: fn, action: 'list' } }))
    expect(res.statusCode).toBe(200)
    expect(mockCallFunction).toHaveBeenCalledWith(expect.objectContaining({ name: fn }))
  })
})

describe('OPENID injection', () => {
  test('missing x-test-openid AND body._testOpenid → 400', async () => {
    const res = await main(httpEvent({ body: { _fn: 'user', action: 'login' } }))
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toMatch(/Missing x-test-openid/)
  })

  test('x-test-openid header is forwarded as _testOpenid in data', async () => {
    await main(httpEvent({ testOpenid: 'alice-123', body: { _fn: 'user', action: 'login', nickName: 'A' } }))
    expect(mockCallFunction).toHaveBeenCalledWith({
      name: 'user',
      data: { action: 'login', nickName: 'A', _testOpenid: 'alice-123' },
    })
  })

  test('body._testOpenid works as fallback when header absent', async () => {
    await main(httpEvent({ body: { _fn: 'user', action: 'login', _testOpenid: 'bob-from-body', nickName: 'B' } }))
    expect(mockCallFunction).toHaveBeenCalledWith({
      name: 'user',
      data: expect.objectContaining({ _testOpenid: 'bob-from-body' }),
    })
  })

  test('header takes precedence over body._testOpenid', async () => {
    await main(httpEvent({ testOpenid: 'from-header', body: { _fn: 'user', action: 'login', _testOpenid: 'from-body' } }))
    expect(mockCallFunction).toHaveBeenCalledWith({
      name: 'user',
      data: expect.objectContaining({ _testOpenid: 'from-header' }),
    })
  })

  test('_fn is stripped before forwarding', async () => {
    await main(httpEvent({ testOpenid: 'x', body: { _fn: 'post', action: 'create', sectionId: 's1' } }))
    const forwarded = mockCallFunction.mock.calls[0][0].data
    expect(forwarded).not.toHaveProperty('_fn')
  })
})

describe('Response shaping', () => {
  test('target function result is JSON-encoded in response body', async () => {
    mockCallFunction.mockResolvedValue({ result: { user: { _id: 'x' }, isNew: true } })
    const res = await main(httpEvent({ testOpenid: 'u', body: { _fn: 'user', action: 'login' } }))
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ user: { _id: 'x' }, isNew: true })
  })

  test('target function error is mapped to 500 without exposing a stack', async () => {
    mockCallFunction.mockRejectedValue(Object.assign(new Error('boom'), { stack: 'stack-trace' }))
    const res = await main(httpEvent({ testOpenid: 'u', body: { _fn: 'user', action: 'login' } }))
    expect(res.statusCode).toBe(500)
    const body = JSON.parse(res.body)
    expect(body.error).toBe('boom')
    expect(body).not.toHaveProperty('stack')
  })

  test('all responses include CORS headers', async () => {
    const res = await main(httpEvent({ testOpenid: 'u', body: { _fn: 'user', action: 'login' } }))
    expect(res.headers['access-control-allow-origin']).toBe('*')
  })
})
