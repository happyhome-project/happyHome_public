import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createH5WebLauncher } from '../h5-web.mjs'
import { runH5WebSmoke, sanitizeEvidence } from '../test-h5-web-smoke.mjs'

async function machineHome(values = {}) {
  const home = await mkdtemp(join(tmpdir(), 'hh-h5-web-'))
  await mkdir(join(home, '.happyhome'))
  await writeFile(join(home, '.happyhome', 'h5-web.env'), Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n'))
  return home
}

test('launcher injects only public CloudBase config, selects an available port, and stops only its child tree', async () => {
  const home = await machineHome({ HH_CLOUDBASE_ENV_ID: 'env-public', HH_CLOUDBASE_ACCESS_KEY: 'key-public', HH_H5_WEB_PASSWORD: 'private' })
  const calls = []
  const child = { pid: 4242, once() {}, stdout: { on() {} }, stderr: { on() {} } }
  const launcher = createH5WebLauncher({
    home,
    inspectGit: async () => ({ cwd: 'C:/repo', branch: 'codex/test', head: 'abc' }),
    findPort: async () => 54321,
    spawnChild: (command, args, options) => { calls.push({ command, args, options }); return child },
    waitUntilReady: async () => {},
    killTree: async (pid) => calls.push({ killed: pid }),
    log() {},
  })
  const running = await launcher.start()
  assert.equal(running.port, 54321)
  assert.deepEqual(Object.fromEntries(Object.entries(calls[0].options.env).filter(([key]) => key.startsWith('VITE_'))), {
    VITE_CLOUDBASE_ENV_ID: 'env-public', VITE_CLOUDBASE_ACCESS_KEY: 'key-public',
  })
  assert.match(calls[0].args.join(' '), /--strictPort/)
  await running.stop()
  assert.deepEqual(calls.at(-1), { killed: 4242 })
})

test('launcher reports missing machine config precisely', async () => {
  const home = await mkdtemp(join(tmpdir(), 'hh-h5-web-missing-'))
  await assert.rejects(() => createH5WebLauncher({ home }).start(), /missing machine config: .*h5-web\.env/)
})

test('read smoke runs doctor and browser without a validation lease', async () => {
  const calls = []
  const result = await runH5WebSmoke({ mode: 'read', runId: 'read-1', deps: fakeDeps(calls) })
  assert.equal(calls.filter((x) => x === 'lease').length, 0)
  assert.deepEqual(calls.slice(0, 2), ['doctor', 'start'])
  assert.equal(result.mode, 'read')
})

test('write smoke takes exactly one lease, uses a unique run id, and requires cleanup', async () => {
  const calls = []
  const result = await runH5WebSmoke({ mode: 'write', deps: fakeDeps(calls) })
  assert.equal(calls.filter((x) => x === 'lease').length, 1)
  assert.match(result.runId, /^[0-9a-f-]{36}$/)
  assert.ok(calls.includes(`write:${result.runId}`))
  assert.ok(calls.includes(`cleanup:${result.runId}`))
})

test('write smoke propagates cleanup failure and still stops its own server', async () => {
  const calls = []
  const deps = fakeDeps(calls)
  deps.browseWrite = async () => ({ cleanup: async () => { throw new Error('exact cleanup failed') } })
  await assert.rejects(() => runH5WebSmoke({ mode: 'write', deps }), /exact cleanup failed/)
  assert.equal(calls.filter((x) => x === 'lease').length, 1)
  assert.ok(calls.includes('stop'))
})

test('evidence removes credentials, raw content, openids, and storage URLs', () => {
  const safe = sanitizeEvidence({ password: 'secret', openid: 'wx-raw', content: 'private text', storageUrl: 'https://secret', counts: { posts: 31 }, geometry: { top: 12 } })
  assert.deepEqual(safe, { counts: { posts: 31 }, geometry: { top: 12 } })
})

function fakeDeps(calls) {
  return {
    doctor: async () => { calls.push('doctor') },
    launcher: { start: async () => { calls.push('start'); return { port: 45678, url: 'http://127.0.0.1:45678', git: { cwd: 'C:/repo', branch: 'codex/test', head: 'abc' }, stop: async () => calls.push('stop') } } },
    browseRead: async () => ({ counts: { long: 30, short: 1, empty: 0 }, geometry: { stickyTop: 0 } }),
    browseWrite: async ({ runId }) => { calls.push(`write:${runId}`); return { cleanup: async () => calls.push(`cleanup:${runId}`), counts: { created: 1 }, geometry: {} } },
    lease: async (_options, fn) => { calls.push('lease'); return fn() },
    writeEvidence: async () => {},
  }
}
