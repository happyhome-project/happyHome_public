import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

import { sendWeComNotification } from '../notify-wecom.mjs'

async function withServer(handler, run) {
  const server = http.createServer(handler)
  const sockets = new Set()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  try {
    return await run(`http://127.0.0.1:${port}/webhook`)
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

const summary = {
  status: 'passed',
  branch: 'codex/test',
  startedAt: '2026-07-12T00:00:00.000Z',
  finishedAt: '2026-07-12T00:01:00.000Z',
  stages: [],
  cleanupIssues: [],
}

test('skips delivery when the webhook is empty', async () => {
  const result = await sendWeComNotification({ webhook: '', summary, env: {} })

  assert.deepEqual(result, { status: 'skipped' })
})

test('sends the summary to a successful webhook', async () => {
  let received
  const result = await withServer((req, res) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      received = JSON.parse(raw)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ errcode: 0, errmsg: 'ok' }))
    })
  }, (webhook) => sendWeComNotification({ webhook, summary, env: {} }))

  assert.deepEqual(result, { status: 'sent' })
  assert.equal(received.msgtype, 'markdown')
  assert.match(received.markdown.content, /HappyHome Nightly SUCCESS/)
})

test('uses an empty environment when env is omitted', async () => {
  const result = await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ errcode: 0, errmsg: 'ok' }))
  }, (webhook) => sendWeComNotification({ webhook, summary }))

  assert.deepEqual(result, { status: 'sent' })
})

test('does not leak a failed webhook response body', async () => {
  await withServer((_req, res) => {
    res.writeHead(500, { 'content-type': 'text/plain' })
    res.end('sensitive upstream response')
  }, async (webhook) => {
    await assert.rejects(
      sendWeComNotification({ webhook, summary, env: {} }),
      (error) => {
        assert.equal(error.message, 'WeCom webhook failed with status 500')
        assert.doesNotMatch(error.message, /sensitive upstream response/)
        return true
      }
    )
  })
})

test('rejects a successful HTTP response with a nonzero errcode', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ errcode: 40001, errmsg: 'sensitive token detail' }))
  }, async (webhook) => {
    await assert.rejects(
      sendWeComNotification({ webhook, summary }),
      { message: 'WeCom webhook response invalid' }
    )
  })
})

test('rejects malformed JSON in a successful HTTP response', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{not-json sensitive-token')
  }, async (webhook) => {
    await assert.rejects(
      sendWeComNotification({ webhook, summary }),
      { message: 'WeCom webhook response invalid' }
    )
  })
})

test('rejects an empty successful HTTP response', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end()
  }, async (webhook) => {
    await assert.rejects(
      sendWeComNotification({ webhook, summary }),
      { message: 'WeCom webhook response invalid' }
    )
  })
})

test('rejects an oversized response declared by content-length', async () => {
  const oversizedBody = 'x'.repeat(65_537)
  await withServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(oversizedBody),
    })
    res.end(oversizedBody)
  }, async (webhook) => {
    await assert.rejects(
      sendWeComNotification({ webhook, summary }),
      { message: 'WeCom webhook response invalid' }
    )
  })
})

test('rejects an oversized chunked response while streaming', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.write('x'.repeat(32_768))
    res.end('x'.repeat(32_769))
  }, async (webhook) => {
    await assert.rejects(
      sendWeComNotification({ webhook, summary }),
      { message: 'WeCom webhook response invalid' }
    )
  })
})

test('rejects when the webhook response is aborted', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.write('partial sensitive response')
    setTimeout(() => res.destroy(), 10)
  }, async (webhook) => {
    await assert.rejects(
      Promise.race([
        sendWeComNotification({ webhook, summary, timeoutMs: 50 }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('notification did not settle within 100ms')), 100)
        }),
      ]),
      { message: 'WeCom webhook request failed' }
    )
  })
})

test('times out a webhook request that never responds', async () => {
  await withServer(() => {}, async (webhook) => {
    await assert.rejects(
      Promise.race([
        sendWeComNotification({
          webhook: `${webhook}?key=sensitive-token`,
          summary,
          timeoutMs: 25,
        }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('notification did not settle within 100ms')), 100)
        }),
      ]),
      { message: 'WeCom webhook request failed' }
    )
  })
})
