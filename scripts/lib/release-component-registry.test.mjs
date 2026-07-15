import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import test from 'node:test'

import './archive-migration.test.mjs'
import './archive-migration-node-sdk.test.mjs'
import './archive-legacy-projection.test.mjs'
import './archive-legacy-projection-node-sdk.test.mjs'

import {
  CLOUD_COMPONENT_CONFIG_INPUTS,
  CLOUD_RELEASE_COMPONENTS,
  RELEASE_ACTION_KINDS,
  RELEASE_COMPONENTS,
  classifyReleaseActionKind,
  classifyReleaseOperations,
  createMigrationInputDigest,
  assertConfinedMigrationRealpath,
  readVerifiedMigrationInputFile,
  verifyMigrationInputFile,
} from './release-component-registry.mjs'

test('release component registry contains exactly ten formal cloud functions plus admin and miniprogram', () => {
  assert.deepEqual(CLOUD_RELEASE_COMPONENTS, [
    'admin', 'community', 'home-prefetch', 'http-gateway', 'member',
    'post', 'post-rag-worker', 'post-video-rag-worker', 'section', 'user',
  ])
  assert.deepEqual(RELEASE_COMPONENTS, [...CLOUD_RELEASE_COMPONENTS.map((name) => `cloud:${name}`), 'admin-web', 'miniprogram'])
  assert.equal(RELEASE_COMPONENTS.some((name) => name.includes('cloudfunctions')), false)
})

test('cloud component digest common inputs bind builder probe package lock and project configuration', () => {
  for (const required of [
    'cloud/build.mjs', 'cloud/package.json', 'cloud/tsconfig.json',
    'scripts/lib/cloud-release-probe.mjs', 'package.json', 'project.config.json',
  ]) assert(CLOUD_COMPONENT_CONFIG_INPUTS.includes(required), required)
})

test('cloud build emits the exact lockfile wx-server-sdk version instead of a floating dependency', async () => {
  const source = await readFile(new URL('../../cloud/build.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /'wx-server-sdk': 'latest'/)
  assert.match(source, /wxServerSdkVersion/)
})

test('cloud runtime integrity includes the release wrapper as well as the business handler', async () => {
  const source = await readFile(new URL('../../cloud/build.mjs', import.meta.url), 'utf8')
  const writeWrapper = source.indexOf("writeFileSync(join(outDir, 'index.js'), createCloudReleaseProbeWrapper())")
  const createManifest = source.indexOf('const runtimeManifest = await createRuntimeFileManifest', writeWrapper)
  assert.ok(writeWrapper >= 0 && writeWrapper < createManifest)
  const manifestBlock = source.slice(createManifest, source.indexOf("writeFileSync(join(outDir, '.happyhome-runtime-manifest.json')", createManifest))
  assert.doesNotMatch(manifestBlock, /'index\.js'/)
})

test('release operation kinds are closed and preserve replay semantics', () => {
  assert.deepEqual(new Set(Object.values(RELEASE_ACTION_KINDS)), new Set(['desired-state', 'verification']))
  for (const action of [
    'ensure-indexes', 'ensure-tencent-rag-index', 'configure-rag-network',
    'configure-rag-workers', 'update-rag-env', 'backfill-post-rag-v2',
  ]) assert.equal(classifyReleaseActionKind(action), 'desired-state', action)
  for (const action of ['verify-post-rag-timer', 'eval-post-semantic-search']) {
    assert.equal(classifyReleaseActionKind(action), 'verification', action)
  }
  assert.throws(() => classifyReleaseActionKind('shell-anything'), /unknown action/i)
  assert.deepEqual(classifyReleaseOperations([{
    actions: ['eval-post-semantic-search', 'backfill-post-rag-v2', 'ensure-indexes'],
    migrations: [{ id: 'one-time-v1' }],
  }]), {
    'desired-state': ['backfill-post-rag-v2', 'ensure-indexes'],
    migration: ['one-time-v1'],
    verification: ['eval-post-semantic-search'],
  })
})

test('release planner reads migration bytes only after confinement and ordinary-file checks', async () => {
  const source = await readFile(new URL('../release-plan.mjs', import.meta.url), 'utf8')
  assert.match(source, /readVerifiedMigrationInputFile\(\{ root, migration \}\)/)
})

test('migration execution rechecks confined actual module bytes against the pinned digest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'happyhome-migration-input-'))
  try {
    const module = 'release/migrations/one.mjs'
    const modulePath = join(root, 'release', 'migrations', 'one.mjs')
    await mkdir(join(root, 'release', 'migrations'), { recursive: true })
    const original = 'export async function up() {}\n'
    await writeFile(modulePath, original)
    const migration = { id: 'one', module, inputDigest: createMigrationInputDigest({ id: 'one', module, moduleBytes: original }) }
    assert.equal(verifyMigrationInputFile({ root, migration }), modulePath)
    await writeFile(modulePath, 'export async function up() { throw new Error("tampered") }\n')
    assert.throws(() => verifyMigrationInputFile({ root, migration }), /actual module bytes/i)
    assert.throws(() => verifyMigrationInputFile({ root, migration: { ...migration, module: 'release/migrations/../../escape.mjs' } }), /confined/i)
    assert.throws(() => verifyMigrationInputFile({ root, migration: { ...migration, module: 'release/migrations/%2e%2e/escape.mjs' } }), /confined/i)

    assert.throws(() => assertConfinedMigrationRealpath('C:\\repo\\release\\migrations', 'D:\\outside\\one.mjs', module, win32), /escapes/i)

    const outside = join(root, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'linked.mjs'), original)
    await symlink(outside, join(root, 'release', 'migrations', 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    const linkedModule = 'release/migrations/linked/linked.mjs'
    const linkedMigration = { id: 'linked', module: linkedModule, inputDigest: createMigrationInputDigest({ id: 'linked', module: linkedModule, moduleBytes: original }) }
    assert.throws(() => readVerifiedMigrationInputFile({ root, migration: linkedMigration }), /symbolic link junction or reparse/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
