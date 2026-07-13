import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import {
  assertSafeReleasePathSegment,
  attestAdminWebArtifact,
  attestCloudArtifacts,
  attestMiniprogramReceipt,
  assertPinnedAdminArtifact,
  computeFileSha256,
  createDeterministicFileManifest,
  createPinnedCloudDeployAttemptGuard,
  createImmutableArtifactSnapshots,
  createMiniprogramReceiptIdentity,
  createReleaseArtifactManifest,
  orchestrateCloudArtifactRelease,
  runPinnedAdminArtifactMutation,
  runPinnedAdminArchiveMutation,
  summarizeArtifactOutcomes,
  toPublicCloudArtifactIdentity,
} from './release-artifact-attestation.mjs'

test('release artifact path segments reject traversal and Windows aliases', () => {
  for (const value of ['.', '..', 'run.', 'run ', 'CON', 'aux.json', 'COM1']) {
    assert.throws(() => assertSafeReleasePathSegment(value), /safe/i, value)
  }
  assert.equal(assertSafeReleasePathSegment('20260713-release_1'), '20260713-release_1')
})
import { normalizeMiniprogramUploadReceipt } from './miniprogram-receipt-identity.mjs'
import { computeDirectoryDigest } from './release-run-ledger.mjs'
import { createRuntimeFileManifest } from './release-component-digest.mjs'
import { abortableDelay, runAbortableShellCapture } from './abortable-process.mjs'

async function fixtureRoot() {
  const root = join(tmpdir(), `happyhome-artifacts-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await mkdir(root, { recursive: true })
  return root
}

const execFileAsync = promisify(execFile)

async function windowsShortPath(path) {
  if (process.platform !== 'win32') return ''
  const { stdout } = await execFileAsync('cmd.exe', ['/d', '/c', `for %I in ("${path}") do @echo %~sI`], { windowsVerbatimArguments: true })
  return stdout.trim().replace(/^"|"$/g, '')
}

test('release artifact manifest binds the run identity and never serializes cloud probe tokens', async () => {
  const root = await fixtureRoot()
  try {
    const cloudRoot = join(root, 'cloud', 'admin')
    const adminRoot = join(root, 'admin-web')
    const miniRoot = join(root, 'miniprogram')
    await mkdir(cloudRoot, { recursive: true })
    await mkdir(adminRoot, { recursive: true })
    await mkdir(miniRoot, { recursive: true })
    const probeToken = 'a'.repeat(64)
    await writeFile(join(cloudRoot, '__release.info.json'), JSON.stringify({
      buildId: 'cloud-abcdef-admin-build', functionName: 'admin', probeToken,
      response: { buildId: 'cloud-abcdef-admin-build', functionName: 'admin', sourceSha: 'abcdef' }, sourceSha: 'abcdef',
    }))
    await writeFile(join(cloudRoot, 'index.js'), 'cloud')
    await writeFile(join(adminRoot, 'index.html'), 'admin')
    await writeFile(join(miniRoot, 'app.js'), 'mini')

    const manifest = await createReleaseArtifactManifest({
      root,
      runId: 'run-1', gitSha: 'abcdef', envId: 'env-1', version: '1.2.3', desc: 'release',
      plan: { targets: { cloud: { functions: ['admin'] }, adminWeb: true, miniprogram: true } },
      componentDigests: { adminWeb: 'b'.repeat(64), miniprogram: 'c'.repeat(64) },
      toolchain: { node: 'v24.0.0', npm: '11.0.0', cloudBuilder: 'esbuild', adminBuilder: 'vite', miniprogramBuilder: 'uni-app' },
      paths: { cloudRoot: join(root, 'cloud'), adminWebRoot: adminRoot, miniprogramRoot: miniRoot },
    })

    assert.equal(manifest.runId, 'run-1')
    assert.equal(manifest.gitSha, 'abcdef')
    assert.equal(manifest.envId, 'env-1')
    assert.deepEqual(manifest.targets.cloudFunctions, ['admin'])
    assert.match(manifest.artifacts.cloud.admin.contentDigest, /^[a-f0-9]{64}$/)
    assert.match(manifest.artifacts.cloud.admin.probeTokenHash, /^[a-f0-9]{64}$/)
    assert.equal(manifest.artifacts.cloud.admin.buildId, 'cloud-abcdef-admin-build')
    assert.equal(manifest.artifacts.adminWeb.componentDigest, 'b'.repeat(64))
    assert.equal(manifest.artifacts.miniprogram.componentDigest, 'c'.repeat(64))
    assert.doesNotMatch(JSON.stringify(manifest), new RegExp(probeToken))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('fresh cloud attestation skips all exact artifacts and deploys only a tampered or mismatched function', async () => {
  const root = await fixtureRoot()
  try {
    const functions = Array.from({ length: 10 }, (_, index) => `fn-${index}`)
    for (const fn of functions) {
      const fnRoot = join(root, 'cloud', fn)
      await mkdir(fnRoot, { recursive: true })
      await writeFile(join(fnRoot, '__release.info.json'), JSON.stringify({
        buildId: `build-${fn}`, functionName: fn, probeToken: `${functions.indexOf(fn)}`.repeat(64).slice(0, 64),
        response: { buildId: `build-${fn}`, functionName: fn, sourceSha: 'abcdef' }, sourceSha: 'abcdef',
      }))
      await writeFile(join(fnRoot, 'index.js'), fn)
    }
    const manifest = await createReleaseArtifactManifest({
      root, runId: 'run-1', gitSha: 'abcdef', envId: 'env-1', version: '1', desc: 'd',
      plan: { targets: { cloud: { functions }, adminWeb: false, miniprogram: false } },
      toolchain: { node: 'v24', cloudBuilder: 'esbuild' },
      paths: { cloudRoot: join(root, 'cloud') },
    })
    const exact = await attestCloudArtifacts({
      root, manifest,
      invoke: async ({ artifact }) => ({ buildId: artifact.buildId, functionName: artifact.functionName, sourceSha: artifact.sourceSha }),
    })
    assert.equal(exact.deployFunctions.length, 0)
    assert.equal(exact.attestations.filter((item) => item.status === 'attested').length, 10)

    await writeFile(join(root, 'cloud', 'fn-3', 'index.js'), 'tampered')
    const tampered = await attestCloudArtifacts({
      root, manifest,
      invoke: async ({ artifact }) => ({ buildId: artifact.buildId, functionName: artifact.functionName, sourceSha: artifact.sourceSha }),
    })
    assert.deepEqual(tampered.deployFunctions, ['fn-3'])
    assert.match(tampered.attestations.find((item) => item.functionName === 'fn-3').skipReason, /digest/i)

    await writeFile(join(root, 'cloud', 'fn-3', 'index.js'), 'fn-3')
    const mismatched = await attestCloudArtifacts({
      root, manifest,
      invoke: async ({ artifact }) => artifact.functionName === 'fn-7'
        ? { buildId: 'wrong', functionName: artifact.functionName, sourceSha: artifact.sourceSha }
        : { buildId: artifact.buildId, functionName: artifact.functionName, sourceSha: artifact.sourceSha },
    })
    assert.deepEqual(mismatched.deployFunctions, ['fn-7'])
    assert.match(mismatched.attestations.find((item) => item.functionName === 'fn-7').skipReason, /response/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('stable cloud component digests skip across release SHAs while mismatch and force redeploy only override mutation decisions', async () => {
  const root = await fixtureRoot()
  try {
    const functions = ['post', 'user']
    for (const functionName of functions) {
      const fnRoot = join(root, '.codex-local', 'release-artifacts', 'new-run', 'cloud', functionName)
      await mkdir(fnRoot, { recursive: true })
      const componentDigest = functionName === 'post' ? 'a'.repeat(64) : 'b'.repeat(64)
      await writeFile(join(fnRoot, 'index.js'), functionName)
      const runtimeManifest = await createRuntimeFileManifest(fnRoot, { exclude: ['.happyhome-runtime-manifest.json', '__release.info.json'] })
      const runtimeDigest = runtimeManifest.runtimeDigest
      await writeFile(join(fnRoot, '.happyhome-runtime-manifest.json'), JSON.stringify(runtimeManifest))
      await writeFile(join(fnRoot, '__release.info.json'), JSON.stringify({
        buildId: `new-build-${functionName}`, componentDigest, functionName, probeToken: 'e'.repeat(64), runtimeDigest,
        response: { buildId: `new-build-${functionName}`, componentDigest, functionName, runtimeDigest, runtimeVerified: true, sourceSha: 'new-sha' },
        sourceSha: 'new-sha',
      }))
    }
    const manifest = await createReleaseArtifactManifest({
      root, runId: 'new-run', gitSha: 'new-sha', envId: 'env-1', version: '1', desc: 'd',
      plan: { targets: { cloud: { functions }, adminWeb: false, miniprogram: false } },
      toolchain: { node: 'v24', cloudBuilder: 'builder-v1' },
      paths: { cloudRoot: join(root, '.codex-local', 'release-artifacts', 'new-run', 'cloud') },
    })
    assert.equal(manifest.artifacts.cloud.post.componentDigest, 'a'.repeat(64))

    const calls = { attest: [], deploy: [], verify: [] }
    const run = (overrides = {}) => orchestrateCloudArtifactRelease({
      root, manifest,
      attest: async ({ artifact, functionName }) => {
        calls.attest.push(functionName)
        return {
          buildId: `old-build-${functionName}`,
          componentDigest: overrides[functionName] || artifact.componentDigest,
          functionName,
          runtimeDigest: artifact.runtimeDigest,
          runtimeVerified: true,
          sourceSha: 'old-sha',
        }
      },
      deploy: async ({ functionName }) => calls.deploy.push(functionName),
      verify: async ({ functionName }) => calls.verify.push(functionName),
    })
    const exact = await run()
    assert.deepEqual(exact.deployFunctions, [])
    assert.deepEqual(calls, { attest: functions, deploy: [], verify: functions })

    calls.attest.length = calls.deploy.length = calls.verify.length = 0
    const mismatch = await run({ post: 'f'.repeat(64) })
    assert.deepEqual(mismatch.deployFunctions, ['post'])
    assert.deepEqual(calls.deploy, ['post'])
    assert.deepEqual(calls.verify, functions)

    calls.attest.length = calls.deploy.length = calls.verify.length = 0
    const forced = await orchestrateCloudArtifactRelease({
      root, manifest, forceRedeployCurrent: true,
      attest: async ({ artifact }) => artifact.response || {
        componentDigest: artifact.componentDigest, functionName: artifact.functionName,
        runtimeDigest: artifact.runtimeDigest, runtimeVerified: true,
      },
      deploy: async ({ functionName }) => calls.deploy.push(functionName),
      verify: async ({ functionName }) => calls.verify.push(functionName),
    })
    assert.deepEqual(forced.deployFunctions, functions)
    assert.deepEqual(calls.deploy, functions)
    assert.deepEqual(calls.verify, functions)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('admin exact match attests while mismatch and unreadable remote state deploy fail closed', async () => {
  const artifact = { contentDigest: 'digest', runId: 'run-1', versionId: 'release-1' }
  assert.equal((await attestAdminWebArtifact({ artifact, inspectRemote: async () => ({ contentDigest: 'digest', runId: 'run-1', versionId: 'release-1' }) })).status, 'attested')
  assert.equal((await attestAdminWebArtifact({ artifact, inspectRemote: async () => ({ contentDigest: 'other', runId: 'run-1', versionId: 'release-1' }) })).status, 'deploy-required')
  assert.equal((await attestAdminWebArtifact({ artifact, inspectRemote: async () => ({ contentDigest: 'digest', runId: 'other-run', versionId: 'release-1' }) })).status, 'deploy-required')
  const unknown = await attestAdminWebArtifact({ artifact, inspectRemote: async () => { throw new Error('ssh unavailable') } })
  assert.equal(unknown.status, 'unattestable')
  assert.equal(unknown.shouldDeploy, true)
})

test('admin cross-run skip requires stable digest plus fresh remote byte verification and force only overrides mutation', async () => {
  const artifact = { componentDigest: 'a'.repeat(64), contentDigest: 'new-content', runId: 'new-run', versionId: 'new-version' }
  const priorRemote = {
    componentDigest: artifact.componentDigest,
    contentDigest: 'old-content',
    fileManifestDigestVerified: true,
    fileManifestDigest: 'f'.repeat(64),
    runId: 'old-run',
    runtimeVerified: true,
    versionId: 'old-version',
  }
  const priorBinding = { artifactRunId: 'old-artifact-run', ...priorRemote }
  const priorFileManifestDigest = priorRemote.fileManifestDigest
  const exact = await attestAdminWebArtifact({ artifact, inspectRemote: async () => priorRemote, priorBinding, priorFileManifestDigest })
  assert.equal(exact.status, 'attested')
  assert.equal(exact.shouldDeploy, false)
  assert.equal((await attestAdminWebArtifact({ artifact, inspectRemote: async () => ({ ...priorRemote, runtimeVerified: false }), priorBinding, priorFileManifestDigest })).shouldDeploy, true)
  assert.equal((await attestAdminWebArtifact({ artifact, inspectRemote: async () => ({ ...priorRemote, fileManifestDigestVerified: false }), priorBinding, priorFileManifestDigest })).shouldDeploy, true)
  assert.equal((await attestAdminWebArtifact({ artifact, inspectRemote: async () => ({ ...priorRemote, componentDigest: 'b'.repeat(64) }), priorBinding, priorFileManifestDigest })).shouldDeploy, true)
  assert.equal((await attestAdminWebArtifact({ artifact, inspectRemote: async () => ({ ...priorRemote, contentDigest: 'unexpected' }), priorBinding, priorFileManifestDigest })).shouldDeploy, true)
  assert.equal((await attestAdminWebArtifact({ artifact, inspectRemote: async () => ({ ...priorRemote, fileManifestDigest: 'e'.repeat(64) }), priorBinding, priorFileManifestDigest })).shouldDeploy, true)
  assert.equal((await attestAdminWebArtifact({ artifact, inspectRemote: async () => priorRemote })).shouldDeploy, true)
  const forced = await attestAdminWebArtifact({ artifact, forceRedeployCurrent: true, inspectRemote: async () => priorRemote, priorBinding, priorFileManifestDigest })
  assert.equal(forced.status, 'deploy-required')
  assert.equal(forced.shouldDeploy, true)
})

test('admin attestation rejects a changed local artifact before trusting remote identity', async () => {
  const root = await fixtureRoot()
  try {
    const artifactRoot = join(root, '.codex-local', 'release-artifacts', 'run-1', 'admin-web')
    await mkdir(artifactRoot, { recursive: true })
    await writeFile(join(artifactRoot, 'index.html'), 'prepared')
    const manifest = await createReleaseArtifactManifest({
      root, runId: 'run-1', gitSha: 'abcdef', envId: 'env', version: '1', desc: 'd',
      plan: { targets: { cloud: { functions: [] }, adminWeb: true, miniprogram: false } },
      paths: { adminWebRoot: artifactRoot },
    })
    await writeFile(join(artifactRoot, 'index.html'), 'changed')
    let remoteReadCount = 0
    await assert.rejects(() => attestAdminWebArtifact({
      root,
      artifact: manifest.artifacts.adminWeb,
      inspectRemote: async () => {
        remoteReadCount += 1
        return manifest.artifacts.adminWeb
      },
    }), /immutable admin-web artifact digest mismatch/i)
    assert.equal(remoteReadCount, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('missing prior admin snapshot makes cross-run proof deploy-required without weakening current snapshot validation', async () => {
  const root = await fixtureRoot()
  try {
    const currentRoot = join(root, '.codex-local', 'release-artifacts', 'current-run', 'admin-web')
    await mkdir(currentRoot, { recursive: true })
    await writeFile(join(currentRoot, 'index.html'), 'current')
    const artifact = {
      artifactPath: relative(root, currentRoot), componentDigest: 'a'.repeat(64),
      contentDigest: await computeDirectoryDigest(currentRoot), runId: 'current-run', versionId: 'current-version',
    }
    const priorBinding = {
      artifactRunId: 'missing-prior', componentDigest: artifact.componentDigest,
      contentDigest: 'b'.repeat(64), runId: 'prior-run', versionId: 'prior-version',
    }
    const result = await attestAdminWebArtifact({
      root, artifact, priorBinding,
      inspectRemote: async () => ({ ...priorBinding, fileManifestDigest: 'c'.repeat(64), fileManifestDigestVerified: true, runtimeVerified: true }),
    })
    assert.equal(result.shouldDeploy, true)
    assert.equal(result.status, 'deploy-required')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('admin attestation rejects a digest-matching path outside the run snapshot before any remote read', async () => {
  const root = await fixtureRoot()
  try {
    const outside = join(root, 'outside-admin')
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'index.html'), 'matching-but-outside')
    const outsideDigest = await computeDirectoryDigest(outside)
    let remoteReadCount = 0
    await assert.rejects(() => attestAdminWebArtifact({
      root,
      artifact: {
        artifactPath: outside,
        contentDigest: outsideDigest,
        runId: 'run-evil',
        sourceSha: 'abcdef',
        versionId: 'version',
      },
      inspectRemote: async () => {
        remoteReadCount += 1
        return {}
      },
    }), /immutable admin-web artifact path is invalid/i)
    assert.equal(remoteReadCount, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('directory digest and snapshot creation reject symlink or junction entries', async (t) => {
  const root = await fixtureRoot()
  try {
    const source = join(root, 'admin-source')
    const target = join(root, 'linked-target')
    await mkdir(source, { recursive: true })
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'secret.txt'), 'outside')
    try {
      await symlink(target, join(source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (['EPERM', 'EACCES'].includes(error.code)) return t.skip(`symlink unavailable: ${error.code}`)
      throw error
    }
    await assert.rejects(() => computeDirectoryDigest(source), /symbolic link|reparse/i)
    await assert.rejects(() => computeDirectoryDigest(join(source, 'linked')), /symbolic link|junction|reparse/i)
    await assert.rejects(() => createImmutableArtifactSnapshots({
      root,
      runId: 'run-link',
      plan: { targets: { cloud: { functions: [] }, adminWeb: true, miniprogram: false } },
      paths: { adminWebRoot: source },
    }), /symbolic link|reparse/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('directory digest accepts a Windows 8.3 alias for an ordinary directory', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows 8.3 alias behavior')
  const root = await fixtureRoot()
  try {
    await writeFile(join(root, 'index.html'), 'same-directory')
    const shortRoot = await windowsShortPath(root)
    if (!shortRoot || shortRoot.toLowerCase() === resolve(root).toLowerCase()) return t.skip('8.3 aliases are unavailable')
    assert.equal(await computeDirectoryDigest(shortRoot), await computeDirectoryDigest(root))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('snapshot attestation accepts equivalent Windows aliases while retaining the exact run path', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows 8.3 alias behavior')
  const root = await fixtureRoot()
  try {
    const shortRoot = await windowsShortPath(root)
    if (!shortRoot || shortRoot.toLowerCase() === resolve(root).toLowerCase()) return t.skip('8.3 aliases are unavailable')
    const artifactRoot = join(root, '.codex-local', 'release-artifacts', 'run-alias', 'admin-web')
    await mkdir(artifactRoot, { recursive: true })
    await writeFile(join(artifactRoot, 'index.html'), 'pinned')
    const contentDigest = await computeDirectoryDigest(artifactRoot)
    await assert.doesNotReject(() => assertPinnedAdminArtifact(join(shortRoot, '.codex-local', 'release-artifacts', 'run-alias', 'admin-web'), contentDigest))
    const manifest = await createReleaseArtifactManifest({
      root: shortRoot,
      runId: 'run-alias', gitSha: 'abcdef', envId: 'env', version: '1', desc: 'alias',
      plan: { targets: { cloud: { functions: [] }, adminWeb: true, miniprogram: false } },
      paths: { adminWebRoot: await realpath(artifactRoot) },
    })
    assert.equal(manifest.artifacts.adminWeb.artifactPath, '.codex-local/release-artifacts/run-alias/admin-web')
    const artifact = { ...manifest.artifacts.adminWeb, artifactPath: await realpath(artifactRoot) }
    const result = await attestAdminWebArtifact({
      root: shortRoot,
      artifact,
      inspectRemote: async () => artifact,
    })
    assert.equal(result.status, 'attested')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('pinned admin backend runners reject TOCTOU tampering before hosting tar or ssh mutation', async () => {
  const root = await fixtureRoot()
  try {
    const artifactRoot = join(root, '.codex-local', 'release-artifacts', 'run-1', 'admin-web')
    await mkdir(artifactRoot, { recursive: true })
    await writeFile(join(artifactRoot, 'index.html'), 'prepared')
    const manifest = await createReleaseArtifactManifest({
      root, runId: 'run-1', gitSha: 'abcdef', envId: 'env', version: '1', desc: 'd',
      plan: { targets: { cloud: { functions: [] }, adminWeb: true, miniprogram: false } },
      paths: { adminWebRoot: artifactRoot },
    })
    const artifact = manifest.artifacts.adminWeb
    const attestation = await attestAdminWebArtifact({ root, artifact, inspectRemote: async () => ({ ...artifact, versionId: 'old' }) })
    assert.equal(attestation.shouldDeploy, true)

    await writeFile(join(artifactRoot, 'index.html'), 'tampered-after-attestation')
    const calls = { hosting: 0, tar: 0, ssh: 0 }
    await assert.rejects(() => runPinnedAdminArtifactMutation({
      artifactRoot,
      expectedDigest: artifact.contentDigest,
      runners: [async () => { calls.hosting += 1 }],
    }), /immutable admin-web artifact digest mismatch/i)
    await assert.rejects(() => runPinnedAdminArtifactMutation({
      artifactRoot,
      expectedDigest: artifact.contentDigest,
      runners: [async () => { calls.tar += 1 }, async () => { calls.ssh += 1 }],
    }), /immutable admin-web artifact digest mismatch/i)
    assert.deepEqual(calls, { hosting: 0, tar: 0, ssh: 0 })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('pinned admin backend runners execute in order for an exact snapshot', async () => {
  const root = await fixtureRoot()
  try {
    const artifactRoot = join(root, 'admin-snapshot')
    await mkdir(artifactRoot, { recursive: true })
    await writeFile(join(artifactRoot, 'index.html'), 'prepared')
    const expectedDigest = await computeDirectoryDigest(artifactRoot)
    await assert.doesNotReject(() => assertPinnedAdminArtifact(artifactRoot, expectedDigest))
    const calls = []
    const results = await runPinnedAdminArtifactMutation({
      artifactRoot,
      expectedDigest,
      runners: [async () => { calls.push('tar'); return 'tarred' }, async () => { calls.push('ssh'); return 'deployed' }],
    })
    assert.deepEqual(calls, ['tar', 'ssh'])
    assert.deepEqual(results, ['tarred', 'deployed'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('pinned admin backend rechecks the snapshot immediately before every injected runner', async () => {
  const root = await fixtureRoot()
  try {
    const artifactRoot = join(root, 'admin-snapshot')
    await mkdir(artifactRoot, { recursive: true })
    await writeFile(join(artifactRoot, 'index.html'), 'prepared')
    const expectedDigest = await computeDirectoryDigest(artifactRoot)
    const calls = []
    await assert.rejects(() => runPinnedAdminArtifactMutation({
      artifactRoot,
      expectedDigest,
      runners: [
        async () => {
          calls.push('tar')
          await writeFile(join(artifactRoot, 'index.html'), 'changed-between-runners')
        },
        async () => calls.push('ssh'),
      ],
    }), /immutable admin-web artifact digest mismatch/i)
    assert.deepEqual(calls, ['tar'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Aliyun archive mutation rejects a replaced packed archive before scp or ssh', async () => {
  const root = await fixtureRoot()
  try {
    const artifactRoot = join(root, 'admin-snapshot')
    const archivePath = join(root, 'admin.tgz')
    await mkdir(artifactRoot, { recursive: true })
    await writeFile(join(artifactRoot, 'index.html'), 'prepared')
    await writeFile(join(artifactRoot, 'assets.js'), 'asset')
    const expectedDigest = await computeDirectoryDigest(artifactRoot)
    const manifest = await createDeterministicFileManifest(artifactRoot)
    assert.match(manifest, /^[a-f0-9]{64}  assets\.js\n[a-f0-9]{64}  index\.html\n$/)
    await writeFile(archivePath, 'packed-archive')
    const expectedArchiveDigest = await computeFileSha256(archivePath)
    await writeFile(archivePath, 'replaced-after-pack')
    const calls = { scp: 0, ssh: 0 }
    await assert.rejects(() => runPinnedAdminArchiveMutation({
      artifactRoot,
      expectedDigest,
      archivePath,
      expectedArchiveDigest,
      runners: [async () => { calls.scp += 1 }, async () => { calls.ssh += 1 }],
    }), /immutable admin-web archive digest mismatch/i)
    assert.deepEqual(calls, { scp: 0, ssh: 0 })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Aliyun archive mutation rechecks the archive before every scp or ssh runner', async () => {
  const root = await fixtureRoot()
  try {
    const artifactRoot = join(root, 'admin-snapshot')
    const archivePath = join(root, 'admin.tgz')
    await mkdir(artifactRoot, { recursive: true })
    await writeFile(join(artifactRoot, 'index.html'), 'prepared')
    await writeFile(archivePath, 'packed-archive')
    const expectedDigest = await computeDirectoryDigest(artifactRoot)
    const expectedArchiveDigest = await computeFileSha256(archivePath)
    const calls = []
    await assert.rejects(() => runPinnedAdminArchiveMutation({
      artifactRoot, expectedDigest, archivePath, expectedArchiveDigest,
      runners: [
        async () => {
          calls.push('scp')
          await writeFile(archivePath, 'changed-between-scp-and-ssh')
        },
        async () => calls.push('ssh'),
      ],
    }), /immutable admin-web archive digest mismatch/i)
    assert.deepEqual(calls, ['scp'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Aliyun deployment rejects a replaced local deploy script before script scp or ssh', async () => {
  const root = await fixtureRoot()
  try {
    const artifactRoot = join(root, 'admin-snapshot')
    const archivePath = join(root, 'admin.tgz')
    const scriptPath = join(root, 'deploy.sh')
    await mkdir(artifactRoot, { recursive: true })
    await writeFile(join(artifactRoot, 'index.html'), 'prepared')
    await writeFile(archivePath, 'packed-archive')
    await writeFile(scriptPath, '#!/bin/sh\necho safe\n')
    const expectedDigest = await computeDirectoryDigest(artifactRoot)
    const expectedArchiveDigest = await computeFileSha256(archivePath)
    const expectedScriptDigest = await computeFileSha256(scriptPath)
    await writeFile(scriptPath, '#!/bin/sh\necho replaced\n')
    const calls = { scriptScp: 0, ssh: 0 }
    await assert.rejects(() => runPinnedAdminArchiveMutation({
      artifactRoot, expectedDigest, archivePath, expectedArchiveDigest, scriptPath, expectedScriptDigest,
      runners: [async () => { calls.scriptScp += 1 }, async () => { calls.ssh += 1 }],
    }), /immutable admin-web deploy script digest mismatch/i)
    assert.deepEqual(calls, { scriptScp: 0, ssh: 0 })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('admin file manifest rejects reserved manifest and release marker paths', async () => {
  const root = await fixtureRoot()
  try {
    for (const name of ['.happyhome-file-manifest.sha256', '.happyhome-release.json']) {
      await writeFile(join(root, name), 'user-owned')
      await assert.rejects(() => createDeterministicFileManifest(root), /reserved path/i)
      await rm(join(root, name))
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('miniprogram receipt reuse requires exact run, digest, version and description', async () => {
  const artifact = { runId: 'run-1', contentDigest: 'digest', version: '1.2.3', desc: 'release' }
  const normalizedReceipt = { method: 'devtools-cli', receipt: { success: true, ticket: 'receipt-content' } }
  const expectedReceiptId = createMiniprogramReceiptIdentity({ receipt: normalizedReceipt, runId: 'run-1', packageDigest: 'digest', version: '1.2.3', desc: 'release' })
  const exact = attestMiniprogramReceipt({ artifact, receipt: normalizedReceipt, expectedReceiptId })
  assert.equal(exact.status, 'uploaded')
  for (const field of ['runId', 'contentDigest', 'version', 'desc']) {
    const changedArtifact = { ...artifact, [field]: 'wrong' }
    assert.equal(attestMiniprogramReceipt({ artifact: changedArtifact, receipt: normalizedReceipt, expectedReceiptId }).shouldUpload, true, field)
  }
  assert.equal(attestMiniprogramReceipt({ artifact, receipt: { ...normalizedReceipt, receipt: { success: true, ticket: 'changed' } }, expectedReceiptId }).shouldUpload, true)
})

test('structured artifact summary reports component statuses and deploy/skip totals', () => {
  const summary = summarizeArtifactOutcomes([
    { component: 'cloud:admin', status: 'attested', skipReason: 'fresh exact match' },
    { component: 'cloud:post', status: 'deployed', skipReason: '' },
    { component: 'admin-web', status: 'verified', skipReason: '' },
    { component: 'miniprogram', status: 'uploaded', skipReason: 'receipt exact match' },
  ])
  assert.deepEqual(summary.counts, { deployed: 1, skipped: 2, verified: 1, uploaded: 1, total: 4 })
  assert.equal(summary.components['cloud:admin'].skipReason, 'fresh exact match')
})

async function preparedCloudRun(count = 10) {
  const root = await fixtureRoot()
  const mutableCloudRoot = join(root, 'cloud', 'dist')
  const functions = Array.from({ length: count }, (_, index) => `fn-${index}`)
  for (const [index, functionName] of functions.entries()) {
    const fnRoot = join(mutableCloudRoot, functionName)
    await mkdir(fnRoot, { recursive: true })
    await writeFile(join(fnRoot, '__release.info.json'), JSON.stringify({
      buildId: `build-${functionName}`, functionName, probeToken: String(index).repeat(64).slice(0, 64),
      response: { buildId: `build-${functionName}`, functionName, sourceSha: 'abcdef' }, sourceSha: 'abcdef',
    }))
    await writeFile(join(fnRoot, 'index.js'), `prepared-${functionName}`)
  }
  const plan = { targets: { cloud: { functions }, adminWeb: false, miniprogram: false } }
  const snapshots = await createImmutableArtifactSnapshots({ root, runId: 'run-1', plan, paths: { cloudRoot: mutableCloudRoot } })
  const manifest = await createReleaseArtifactManifest({
    root, runId: 'run-1', gitSha: 'abcdef', envId: 'env-1', version: '1', desc: 'd', plan,
    toolchain: { node: 'v24' }, paths: snapshots,
  })
  return { functions, manifest, mutableCloudRoot, root, snapshots }
}

test('cloud orchestration skips ten exact snapshots, deploys only remote mismatches, and verifies every planned function', async () => {
  const run = await preparedCloudRun()
  try {
    const deployed = []
    const verified = []
    const exact = await orchestrateCloudArtifactRelease({
      root: run.root, manifest: run.manifest, timeoutMs: 50,
      attest: async ({ artifact }) => ({ functionName: artifact.functionName, buildId: artifact.buildId, sourceSha: artifact.sourceSha }),
      deploy: async (input) => deployed.push(input),
      verify: async ({ functionName }) => verified.push(functionName),
    })
    assert.equal(deployed.length, 0)
    assert.equal(exact.attestations.filter((item) => item.status === 'attested').length, 10)
    assert.deepEqual(verified.sort(), [...run.functions].sort())

    verified.length = 0
    const mismatch = await orchestrateCloudArtifactRelease({
      root: run.root, manifest: run.manifest, timeoutMs: 50,
      attest: async ({ artifact }) => artifact.functionName === 'fn-4'
        ? { functionName: artifact.functionName, buildId: 'wrong', sourceSha: artifact.sourceSha }
        : { functionName: artifact.functionName, buildId: artifact.buildId, sourceSha: artifact.sourceSha },
      deploy: async ({ functionName, artifactRoot }) => deployed.push({ functionName, artifactRoot }),
      verify: async ({ functionName }) => verified.push(functionName),
    })
    assert.deepEqual(mismatch.deployFunctions, ['fn-4'])
    assert.equal(deployed.at(-1).functionName, 'fn-4')
    assert.match(deployed.at(-1).artifactRoot, /\.codex-local[\\/]release-artifacts[\\/]run-1/)
    assert.deepEqual(verified.sort(), [...run.functions].sort())
  } finally {
    await rm(run.root, { recursive: true, force: true })
  }
})

test('immutable snapshot creation supports a miniprogram-only release plan', async () => {
  const root = await fixtureRoot()
  try {
    const paths = await createImmutableArtifactSnapshots({
      root,
      runId: 'mini-only-run',
      plan: { targets: { cloud: { functions: [] }, adminWeb: false, miniprogram: true } },
      paths: { miniprogramRoot: join(root, 'miniprogram-dist') },
    })
    assert.equal(paths.miniprogramRoot, join(root, 'miniprogram-dist'))
    assert.equal((await stat(join(root, '.codex-local', 'release-artifacts', 'mini-only-run'))).isDirectory(), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cloud orchestration never deploys mutable dist and hard-blocks a changed immutable snapshot', async () => {
  const run = await preparedCloudRun(1)
  try {
    await writeFile(join(run.mutableCloudRoot, 'fn-0', 'index.js'), 'tampered-mutable-dist')
    const deployedRoots = []
    await orchestrateCloudArtifactRelease({
      root: run.root, manifest: run.manifest, timeoutMs: 50,
      attest: async ({ artifact }) => ({ functionName: artifact.functionName, buildId: 'remote-old', sourceSha: artifact.sourceSha }),
      deploy: async ({ artifactRoot }) => deployedRoots.push(artifactRoot),
      verify: async () => {},
    })
    assert.equal(deployedRoots.length, 1)
    assert.notEqual(resolve(deployedRoots[0]), resolve(run.mutableCloudRoot, 'fn-0'))
    assert.equal(await readFile(join(deployedRoots[0], 'index.js'), 'utf8'), 'prepared-fn-0')

    await writeFile(join(deployedRoots[0], 'index.js'), 'tampered-snapshot')
    let deployCount = 0
    await assert.rejects(() => orchestrateCloudArtifactRelease({
      root: run.root, manifest: run.manifest, timeoutMs: 50,
      attest: async () => ({}), deploy: async () => { deployCount += 1 }, verify: async () => {},
    }), /immutable cloud artifact digest mismatch/i)
    assert.equal(deployCount, 0)
  } finally {
    await rm(run.root, { recursive: true, force: true })
  }
})

test('cloud orchestration rejects a digest-matching path outside the run snapshot before read or deploy', async () => {
  const run = await preparedCloudRun(1)
  try {
    const outside = join(run.root, 'outside-cloud', 'fn-0')
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, '__release.info.json'), await readFile(join(run.snapshots.cloudRoot, 'fn-0', '__release.info.json')))
    await writeFile(join(outside, 'index.js'), 'prepared-fn-0')
    run.manifest.artifacts.cloud['fn-0'].artifactPath = outside
    run.manifest.artifacts.cloud['fn-0'].contentDigest = await computeDirectoryDigest(outside)
    let readCount = 0
    let deployCount = 0
    await assert.rejects(() => orchestrateCloudArtifactRelease({
      root: run.root,
      manifest: run.manifest,
      attest: async () => { readCount += 1 },
      deploy: async () => { deployCount += 1 },
      verify: async () => { readCount += 1 },
    }), /immutable cloud .*artifact path is invalid/i)
    assert.deepEqual({ readCount, deployCount }, { readCount: 0, deployCount: 0 })
  } finally {
    await rm(run.root, { recursive: true, force: true })
  }
})

test('cloud deploy attempt guard rechecks digest after the fence and before the CLI runner', async () => {
  const run = await preparedCloudRun(1)
  try {
    const artifactRoot = join(run.snapshots.cloudRoot, 'fn-0')
    const expectedDigest = run.manifest.artifacts.cloud['fn-0'].contentDigest
    let deployCount = 0
    const tamperedGuard = createPinnedCloudDeployAttemptGuard({
      artifactRoot,
      expectedDigest,
      functionName: 'fn-0',
      beforeFence: async () => await writeFile(join(artifactRoot, 'index.js'), 'tampered-after-auth-setup'),
    })
    await assert.rejects(async () => {
      await tamperedGuard()
      deployCount += 1
    }, /immutable cloud artifact digest mismatch/i)
    assert.equal(deployCount, 0)

    await writeFile(join(artifactRoot, 'index.js'), 'prepared-fn-0')
    const exactGuard = createPinnedCloudDeployAttemptGuard({ artifactRoot, expectedDigest, functionName: 'fn-0', beforeFence: async () => {} })
    await exactGuard()
    deployCount += 1
    assert.equal(deployCount, 1)
  } finally {
    await rm(run.root, { recursive: true, force: true })
  }
})

test('cloud orchestration waits for child close and token payload cleanup before timeout can deploy', async () => {
  const run = await preparedCloudRun(2)
  try {
    let payloadRemoved = false
    const result = await orchestrateCloudArtifactRelease({
      root: run.root, manifest: run.manifest, timeoutMs: 10, cleanupGraceMs: 50,
      attest: async ({ artifact, signal }) => {
        if (artifact.functionName !== 'fn-1') return { functionName: artifact.functionName, buildId: artifact.buildId, sourceSha: artifact.sourceSha }
        try {
          await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('child closed')), { once: true }))
        } finally {
          payloadRemoved = true
        }
      },
      deploy: async () => assert.equal(payloadRemoved, true), verify: async () => {},
    })
    assert.equal(payloadRemoved, true)
    assert.deepEqual(result.deployFunctions, ['fn-1'])
    assert.match(result.attestations[1].skipReason, /timed out/i)
  } finally {
    await rm(run.root, { recursive: true, force: true })
  }
})

test('cloud orchestration hard-blocks when an aborted operation never settles', async () => {
  const run = await preparedCloudRun(1)
  try {
    let deployCount = 0
    await assert.rejects(() => orchestrateCloudArtifactRelease({
      root: run.root, manifest: run.manifest, timeoutMs: 5, cleanupGraceMs: 5,
      attest: () => new Promise(() => {}),
      deploy: async () => { deployCount += 1 }, verify: async () => {},
    }), (error) => error.code === 'ERR_RELEASE_ATTESTATION_ABORT_CLEANUP')
    assert.equal(deployCount, 0)
  } finally {
    await rm(run.root, { recursive: true, force: true })
  }
})

function controllableProcess(pid) {
  const child = new EventEmitter()
  child.pid = pid
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.killCalls = []
  child.kill = (signal) => {
    child.killCalls.push(signal || 'default')
    setTimeout(() => child.emit('close', null, signal || null), 0)
    return true
  }
  return child
}

test('abortable Windows capture waits for child close after successful taskkill', async () => {
  const child = controllableProcess(101)
  const killer = controllableProcess(202)
  const controller = new AbortController()
  let childClosed = false
  child.on('close', () => { childClosed = true })
  const capture = runAbortableShellCapture('fake command', { signal: controller.signal, silentOutput: true, terminationGraceMs: 50 }, {
    platform: 'win32',
    spawn: (command) => {
      if (command === 'taskkill') {
        setTimeout(() => {
          killer.emit('close', 0)
          setTimeout(() => child.emit('close', 1), 0)
        }, 0)
        return killer
      }
      return child
    },
  })
  controller.abort()
  const result = await capture
  assert.equal(childClosed, true)
  assert.equal(result.aborted, true)
  assert.deepEqual(child.killCalls, [])
})

test('abortable Windows capture falls back to child.kill but fails closed when taskkill exits nonzero', async () => {
  const child = controllableProcess(303)
  const killer = controllableProcess(404)
  const controller = new AbortController()
  const capture = runAbortableShellCapture('fake command', { signal: controller.signal, silentOutput: true, terminationGraceMs: 50 }, {
    platform: 'win32',
    spawn: (command) => {
      if (command === 'taskkill') {
        setTimeout(() => killer.emit('close', 1), 0)
        return killer
      }
      return child
    },
  })
  controller.abort()
  await assert.rejects(capture, (error) => error.code === 'ERR_RELEASE_ATTESTATION_ABORT_CLEANUP')
  assert.deepEqual(child.killCalls, ['default'])
})

test('abortable Windows capture reports fatal cleanup when the child never closes', async () => {
  const child = controllableProcess(505)
  child.kill = () => true
  const killer = controllableProcess(606)
  const controller = new AbortController()
  const capture = runAbortableShellCapture('fake command', { signal: controller.signal, silentOutput: true, terminationGraceMs: 5 }, {
    platform: 'win32',
    spawn: (command) => {
      if (command === 'taskkill') {
        setTimeout(() => killer.emit('close', 0), 0)
        return killer
      }
      return child
    },
  })
  controller.abort()
  await assert.rejects(capture, (error) => error.code === 'ERR_RELEASE_ATTESTATION_ABORT_CLEANUP')
})

test('abortable retry backoff settles immediately on abort', async () => {
  const controller = new AbortController()
  const startedAt = Date.now()
  const delay = abortableDelay(1_000, controller.signal)
  controller.abort()
  await assert.rejects(delay, /aborted during retry backoff/i)
  assert.ok(Date.now() - startedAt < 100)
})

test('miniprogram receipt identity hashes normalized receipt content and every release binding', () => {
  const base = { receipt: { size: { total: 1 }, success: true }, runId: 'run-1', packageDigest: 'digest', version: '1', desc: 'd' }
  const identity = createMiniprogramReceiptIdentity(base)
  assert.match(identity, /^[a-f0-9]{64}$/)
  for (const [field, value] of [['runId', 'run-2'], ['packageDigest', 'other'], ['version', '2'], ['desc', 'other']]) {
    assert.notEqual(createMiniprogramReceiptIdentity({ ...base, [field]: value }), identity)
  }
  assert.notEqual(createMiniprogramReceiptIdentity({ ...base, receipt: { size: { total: 2 }, success: true } }), identity)
  assert.equal(createMiniprogramReceiptIdentity({ ...base, receipt: { success: true, size: { total: 1 } } }), identity)
})

test('miniprogram-ci receipt identity uses the actual returned upload receipt', () => {
  const normalized = normalizeMiniprogramUploadReceipt({
    method: 'miniprogram-ci',
    receipt: { subPackageInfo: [{ name: 'main', size: 42 }], pluginInfo: [] },
  })
  assert.deepEqual(normalized, {
    method: 'miniprogram-ci',
    receipt: { subPackageInfo: [{ name: 'main', size: 42 }], pluginInfo: [] },
  })
})

test('cloud orchestration and public production identity never expose the known probe token value', async () => {
  const run = await preparedCloudRun(1)
  try {
    const probeToken = JSON.parse(await readFile(join(run.snapshots.cloudRoot, 'fn-0', '__release.info.json'), 'utf8')).probeToken
    const result = await orchestrateCloudArtifactRelease({
      root: run.root, manifest: run.manifest, timeoutMs: 50,
      attest: async () => { throw new Error(`remote echoed ${probeToken}`) },
      deploy: async () => {}, verify: async () => {},
    })
    assert.doesNotMatch(JSON.stringify(result), new RegExp(probeToken))
    assert.match(result.attestations[0].skipReason, /REDACTED_PROBE_TOKEN/)
    const publicIdentity = toPublicCloudArtifactIdentity({ ...run.manifest.artifacts.cloud['fn-0'], probeToken, error: probeToken })
    assert.doesNotMatch(JSON.stringify(publicIdentity), new RegExp(probeToken))
    assert.deepEqual(Object.keys(publicIdentity).sort(), ['buildId', 'componentDigest', 'contentDigest', 'functionName', 'probeTokenHash', 'runtimeDigest', 'sourceSha'])
  } finally {
    await rm(run.root, { recursive: true, force: true })
  }
})
