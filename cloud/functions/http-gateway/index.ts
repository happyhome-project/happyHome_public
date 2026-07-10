// cloud/functions/http-gateway/index.ts
// HTTP-triggered gateway that forwards requests to other cloud functions,
// injecting a test OPENID for dev/test (H5 preview, Postman, automated tests).
//
// Security:
//   - Requires Bearer token (GATEWAY_TOKEN env, falls back to admin token)
//   - Target function must have ALLOW_TEST_OPENID=true env to honor the injection
//   - Production deploys MUST NOT set ALLOW_TEST_OPENID
//
// Request:
//   POST https://<cloud-host>/http-gateway
//   Authorization: Bearer <token>
//   x-test-openid: <fake-openid>         (or body._testOpenid)
//   Body: { "_fn": "user", "action": "login", ...params }

import cloud from 'wx-server-sdk'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const GATEWAY_ENABLED = process.env.GATEWAY_ENABLED === 'true'
const GATEWAY_TOKEN = String(process.env.GATEWAY_TOKEN || '').trim()
const ALLOWED_FNS = ['user', 'community', 'member', 'section', 'post']

const BASE_HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type,authorization,x-test-openid',
  'access-control-allow-methods': 'POST,OPTIONS',
}

export const main = async (event: any) => {
  // Must be HTTP-triggered. Reject direct cloud.callFunction calls to avoid
  // someone else forwarding traffic through the gateway internally.
  if (!event.httpMethod) {
    return { error: 'http-gateway is HTTP only' }
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: BASE_HEADERS, body: '' }
  }

  try {
    if (!GATEWAY_ENABLED || !GATEWAY_TOKEN) {
      return { statusCode: 503, headers: BASE_HEADERS, body: JSON.stringify({ error: 'Gateway disabled' }) }
    }
    const auth = String(event.headers?.authorization || event.headers?.Authorization || '')
    if (auth !== `Bearer ${GATEWAY_TOKEN}`) {
      return { statusCode: 403, headers: BASE_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) }
    }

    let body: any = {}
    try {
      body = event.body ? JSON.parse(event.body) : {}
    } catch {
      return { statusCode: 400, headers: BASE_HEADERS, body: JSON.stringify({ error: 'Invalid JSON body' }) }
    }

    const { _fn, ...rest } = body
    if (!_fn || !ALLOWED_FNS.includes(_fn)) {
      return {
        statusCode: 400,
        headers: BASE_HEADERS,
        body: JSON.stringify({ error: `Invalid _fn "${_fn}". Allowed: ${ALLOWED_FNS.join(',')}` }),
      }
    }

    const headerOpenid = event.headers?.['x-test-openid'] || event.headers?.['X-Test-Openid']
    const testOpenid = String(headerOpenid || rest._testOpenid || '').trim()
    if (!testOpenid) {
      return {
        statusCode: 400,
        headers: BASE_HEADERS,
        body: JSON.stringify({ error: 'Missing x-test-openid header' }),
      }
    }

    const res = await cloud.callFunction({
      name: _fn,
      data: { ...rest, _testOpenid: testOpenid },
    })

    return {
      statusCode: 200,
      headers: BASE_HEADERS,
      body: JSON.stringify(res.result),
    }
  } catch (e: any) {
    return {
      statusCode: 500,
      headers: BASE_HEADERS,
      body: JSON.stringify({ error: e?.message || String(e) }),
    }
  }
}
