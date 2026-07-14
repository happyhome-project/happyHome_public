import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import test from 'node:test'

import { createH5WebLauncher } from '../h5-web.mjs'
import { resolveCleanupIntent, runH5WebSmoke, sanitizeEvidence, validateReadEvidence } from '../test-h5-web-smoke.mjs'

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
  assert.equal(running.pid, 4242)
  assert.deepEqual(Object.fromEntries(Object.entries(calls[0].options.env).filter(([key]) => key.startsWith('VITE_'))), {
    VITE_CLOUDBASE_ENV_ID: 'env-public', VITE_CLOUDBASE_ACCESS_KEY: 'key-public',
  })
  assert.equal(calls[0].options.env.HH_H5_WEB_PASSWORD, undefined)
  assert.equal(calls[0].options.env.TENCENT_SECRET_KEY, undefined)
  assert.equal(calls[0].options.env.GH_TOKEN, undefined)
  assert.match(calls[0].args.join(' '), /--strictPort/)
  await running.stop()
  assert.deepEqual(calls.at(-1), { killed: 4242 })
})

test('launcher runs npm.cmd through cmd.exe on Windows', async () => {
  const home = await machineHome({ HH_CLOUDBASE_ENV_ID: 'env-public', HH_CLOUDBASE_ACCESS_KEY: 'key-public' })
  const calls = []
  const child = { pid: 4243, once() {}, stdout: { on() {} }, stderr: { on() {} } }
  const launcher = createH5WebLauncher({
    home,
    platform: 'win32',
    inspectGit: async () => ({ cwd: 'C:/repo', branch: 'codex/test', head: 'abc' }),
    findPort: async () => 54323,
    spawnChild: (command, args, options) => { calls.push({ command, args, options }); return child },
    waitUntilReady: async () => {},
    killTree: async () => {},
    log() {},
  })

  await launcher.start()

  assert.equal(calls[0].command, 'cmd.exe')
  assert.deepEqual(calls[0].args.slice(0, 4), ['/d', '/s', '/c', 'npm.cmd'])
  assert.match(calls[0].args.join(' '), /--workspace miniprogram run dev:h5/)
  assert.equal(calls[0].options.shell, false)
})

test('launcher reports missing machine config precisely', async () => {
  const home = await mkdtemp(join(tmpdir(), 'hh-h5-web-missing-'))
  await assert.rejects(() => createH5WebLauncher({ home }).start(), /missing machine config: .*h5-web\.env/)
})

test('launcher drains child pipes and reports sanitized bounded tail on early exit', async () => {
  const home = await machineHome({ HH_CLOUDBASE_ENV_ID: 'env-public', HH_CLOUDBASE_ACCESS_KEY: 'secret-public-key' })
  const child = new EventEmitter()
  Object.assign(child, { pid: 4343, exitCode: null, stdout: new PassThrough(), stderr: new PassThrough() })
  const launcher = createH5WebLauncher({ home, findPort: async () => 54322, inspectGit: async () => ({ cwd: 'C:/repo', branch: 'codex/test', head: 'abc' }), spawnChild: () => child, killTree: async () => {}, log() {} })
  const started = launcher.start()
  child.stderr.write(`${'x'.repeat(20_000)} compile failed secret-public-key`)
  await new Promise((resolve) => setImmediate(resolve))
  child.exitCode = 1
  child.emit('exit', 1)
  await assert.rejects(started, (error) => !error.message.includes('secret-public-key') && error.message.length < 10_000 && /compile failed/.test(error.message))
})

test('read smoke runs doctor and browser without a validation lease', async () => {
  const calls = []
  const result = await runH5WebSmoke({ mode: 'read', runId: 'read-1', deps: fakeDeps(calls) })
  assert.equal(calls.filter((x) => x === 'lease').length, 0)
  assert.deepEqual(calls.slice(0, 2), ['doctor', 'start'])
  assert.equal(result.mode, 'read')
})

test('read evidence combines exact stored doctor counts 30/1/0 with exact visible counts 20/1/0', () => {
  assert.doesNotThrow(() => validateReadEvidence({
    doctor: { counts: { activePostsBySection: [30, 1, 0] } },
    visible: { long: 20, short: 1, empty: 0 },
  }))
  assert.throws(() => validateReadEvidence({ doctor: { counts: { activePostsBySection: [30, 1, 0] } }, visible: { long: 21, short: 1, empty: 0 } }), /visible long count/)
  assert.throws(() => validateReadEvidence({ doctor: { counts: { activePostsBySection: [29, 1, 0] } }, visible: { long: 20, short: 1, empty: 0 } }), /stored counts/)
})

test('write smoke takes exactly one lease, uses a unique run id, and requires cleanup', async () => {
  const calls = []
  const result = await runH5WebSmoke({ mode: 'write', deps: fakeDeps(calls) })
  assert.equal(calls.filter((x) => x === 'lease').length, 1)
  assert.match(result.runId, /^[0-9a-f-]{36}$/)
  assert.ok(calls.includes(`write:${result.runId}`))
  assert.ok(calls.includes(`cleanup:${result.runId}`))
  assert.ok(calls.indexOf('lease') < calls.indexOf('doctor'))
  assert.ok(calls.indexOf(`cleanup:${result.runId}`) < calls.indexOf('evidence:passed:true'))
})

test('write smoke propagates cleanup failure and still stops its own server', async () => {
  const calls = []
  const deps = fakeDeps(calls)
  deps.browseWrite = async () => ({ cleanup: async () => { throw new Error('exact cleanup failed') } })
  await assert.rejects(() => runH5WebSmoke({ mode: 'write', deps }), /exact cleanup failed/)
  assert.equal(calls.filter((x) => x === 'lease').length, 1)
  assert.ok(calls.includes('stop'))
  assert.ok(calls.includes('evidence:failed:false'))
})

test('cleanup intent locates and deletes an exact UUID post even when submit click throws', async () => {
  const calls = []
  const intent = { runId: 'uuid-1', content: 'H5 smoke uuid-1' }
  await resolveCleanupIntent({ intent, capturedPostId: async () => 'post-captured', capturedFileIDs: async () => ['cloud://env/exact.png'], locate: async () => { calls.push('locator'); return '' }, remove: async (postId) => calls.push(`remove:${postId}`), removeFiles: async (fileIDs) => calls.push(`remove-files:${fileIDs.join(',')}`) })
  assert.deepEqual(calls, ['remove:post-captured', 'remove-files:cloud://env/exact.png'])
})

test('cleanup intent fails closed when neither session capture nor UUID locator confirms an exact post', async () => {
  await assert.rejects(() => resolveCleanupIntent({ intent: { content: 'H5 smoke uuid-2' }, capturedPostId: async () => '', locate: async () => '', remove: async () => {}, removeFiles: async () => {} }), /cleanup unconfirmed/)
})

test('cleanup intent fails closed when the exact uploaded storage object is missing', async () => {
  await assert.rejects(() => resolveCleanupIntent({ intent: { runId: 'uuid-3', content: 'H5 smoke uuid-3' }, capturedPostId: async () => 'post-3', capturedFileIDs: async () => [], locate: async () => '', remove: async () => {}, removeFiles: async () => {} }), /storage cleanup unconfirmed/)
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
    writeEvidence: async (evidence) => calls.push(`evidence:${evidence.status}:${evidence.cleanupOk}`),
  }
}
