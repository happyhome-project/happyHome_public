import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { createTestApi } from './test-api.mjs'

async function withServer(handler, run) {
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    await handler(req, res, body)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    await run(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

function json(res, statusCode, body) {
  res.writeHead(statusCode, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

test('admin calls login once and reuse the issued session token', async () => {
  const requests = []
  await withServer((req, res, body) => {
    requests.push({ path: req.url, auth: req.headers.authorization || '', body })
    if (body.action === 'auth.login') return json(res, 200, { token: 'session-token' })
    return json(res, 200, { ok: true })
  }, async (base) => {
    const api = createTestApi({
      CLOUD_API_URL: base,
      VITE_ADMIN_USERNAME: 'nightly-admin',
      VITE_ADMIN_PASSWORD: 'secret-password',
      GATEWAY_TOKEN: 'gateway-secret',
      TEST_ADMIN_SESSION_TOKEN: 'stale-runner-session',
    })

    await api.callAdmin('community.list')
    await api.callAdmin('community.listDisabled')
  })

  assert.deepEqual(requests, [
    {
      path: '/admin',
      auth: '',
      body: { action: 'auth.login', username: 'nightly-admin', password: 'secret-password' },
    },
    { path: '/admin', auth: 'Bearer session-token', body: { action: 'community.list' } },
    { path: '/admin', auth: 'Bearer session-token', body: { action: 'community.listDisabled' } },
  ])
})

test('gateway calls use GATEWAY_TOKEN and never an admin session', async () => {
  let captured
  await withServer((req, res, body) => {
    captured = { path: req.url, auth: req.headers.authorization, openid: req.headers['x-test-openid'], body }
    json(res, 200, { ok: true })
  }, async (base) => {
    const api = createTestApi({
      CLOUD_API_URL: base,
      VITE_ADMIN_USERNAME: 'nightly-admin',
      VITE_ADMIN_PASSWORD: 'secret-password',
      GATEWAY_TOKEN: 'gateway-secret',
    })
    await api.callAs('test-user', 'user', 'login', { nickName: 'Nightly' })
  })

  assert.deepEqual(captured, {
    path: '/http-gateway',
    auth: 'Bearer gateway-secret',
    openid: 'test-user',
    body: { _fn: 'user', action: 'login', nickName: 'Nightly' },
  })
})

test('admin and gateway calls fail closed when their credentials are missing', async () => {
  const api = createTestApi({ CLOUD_API_URL: 'http://127.0.0.1:1' })
  await assert.rejects(() => api.callAdmin('community.list'), /VITE_ADMIN_USERNAME and VITE_ADMIN_PASSWORD are required/)
  await assert.rejects(() => api.callAs('user', 'user', 'login'), /GATEWAY_TOKEN is required/)
})

test('admin login rejects a successful response without a session token', async () => {
  await withServer((_req, res) => json(res, 200, { role: 'superAdmin' }), async (base) => {
    const api = createTestApi({
      CLOUD_API_URL: base,
      VITE_ADMIN_USERNAME: 'nightly-admin',
      VITE_ADMIN_PASSWORD: 'secret-password',
    })
    await assert.rejects(() => api.callAdmin('community.list'), /auth\.login response did not include a session token/)
  })
})
