import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { FIXTURE_KEY } from './h5-test-tenant.mjs'
import { runCli } from '../h5-test-tenant.mjs'

const source = readFileSync(new URL('../h5-test-tenant.mjs', import.meta.url), 'utf8')

test('CLI apply requires both fixture prefix and an existing prepare manifest', () => {
  assert.match(source, /HAPPYHOME_FIXTURE_PREFIX/)
  assert.match(source, /prepare\.json/)
  assert.match(source, /applyTenant/)
})

test('CLI doctor uses read-only inspection and never calls a mutation helper directly', () => {
  const doctorBranch = source.slice(source.indexOf("case 'doctor'"), source.indexOf("case 'apply'"))
  assert.match(doctorBranch, /doctorTenant/)
  assert.doesNotMatch(doctorBranch, /setDocument|createEndUser|applyTenant/)
})

async function cliFixture() {
  const root = await mkdtemp(join(tmpdir(), 'h5-tenant-cli-'))
  const home = join(root, 'home')
  await mkdir(join(home, '.happyhome'), { recursive: true })
  await writeFile(join(home, '.happyhome', 'h5-web.env'), [
    'HH_CLOUDBASE_ENV_ID=env-test', 'HH_CLOUDBASE_ACCESS_KEY=public-key',
    'HH_H5_WEB_USERNAME=user', 'HH_H5_WEB_PASSWORD=password', 'HH_WECHAT_TEST_OPENID=openid',
  ].join('\n'))
  return { root, home }
}

test('runCli wraps direct apply in exactly one validation lease while prepare and doctor do not lease', async () => {
  const { root, home } = await cliFixture()
  await mkdir(join(root, '.codex-local', 'h5-test-tenant'), { recursive: true })
  await writeFile(join(root, '.codex-local', 'h5-test-tenant', 'prepare.json'), '{}')
  const calls = []
  const leaseWrapper = async (options, fn) => { calls.push(options); return await fn() }
  const storeFactory = async () => ({})
  const operations = {
    prepare: async () => ({ version: 1, envId: 'env-test', expected: {}, diff: {}, fingerprint: 'x' }),
    apply: async () => ({ ok: true }),
    doctor: async () => ({ ok: true }),
  }
  await runCli({ argv: ['prepare'], root, home, env: {}, stdout() {}, storeFactory, leaseWrapper, operations })
  await runCli({ argv: ['doctor'], root, home, env: {}, stdout() {}, storeFactory, leaseWrapper, operations })
  await runCli({ argv: ['apply', `--manifest=${join(root, '.codex-local', 'h5-test-tenant', 'prepare.json')}`], root, home, env: { HAPPYHOME_FIXTURE_PREFIX: FIXTURE_KEY }, stdout() {}, storeFactory, leaseWrapper, operations })
  assert.deepEqual(calls, [{ command: 'h5-test-tenant:apply' }])
})

test('runCli rejects apply without prefix or explicit manifest before taking a lease', async () => {
  const { root, home } = await cliFixture()
  const calls = []
  const options = { argv: ['apply'], root, home, env: {}, stdout() {}, storeFactory: async () => ({}), leaseWrapper: async (...args) => { calls.push(args); return await args[1]() } }
  await assert.rejects(runCli(options), /HAPPYHOME_FIXTURE_PREFIX/)
  await assert.rejects(runCli({ ...options, env: { HAPPYHOME_FIXTURE_PREFIX: FIXTURE_KEY } }), /--manifest/)
  assert.equal(calls.length, 0)
})
