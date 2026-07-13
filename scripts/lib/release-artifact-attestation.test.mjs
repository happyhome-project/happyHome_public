import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import {
  attestAdminWebArtifact,
  attestCloudArtifacts,
  attestMiniprogramReceipt,
  createImmutableArtifactSnapshots,
  createMiniprogramReceiptIdentity,
  createReleaseArtifactManifest,
  orchestrateCloudArtifactRelease,
  summarizeArtifactOutcomes,
  toPublicCloudArtifactIdentity,
} from './release-artifact-attestation.mjs'
import { normalizeMiniprogramUploadReceipt } from './miniprogram-receipt-identity.mjs'

async function fixtureRoot() {
  const root = join(tmpdir(), `happyhome-artifacts-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await mkdir(root, { recursive: true })
  return root
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

test('admin exact match attests while mismatch and unreadable remote state deploy fail closed', async () => {
  const artifact = { contentDigest: 'digest', runId: 'run-1', versionId: 'release-1' }
  assert.equal((await attestAdminWebArtifact({ artifact, inspectRemote: async () => ({ contentDigest: 'digest', runId: 'run-1', versionId: 'release-1' }) })).status, 'attested')
  assert.equal((await attestAdminWebArtifact({ artifact, inspectRemote: async () => ({ contentDigest: 'other', runId: 'run-1', versionId: 'release-1' }) })).status, 'deploy-required')
  assert.equal((await attestAdminWebArtifact({ artifact, inspectRemote: async () => ({ contentDigest: 'digest', runId: 'other-run', versionId: 'release-1' }) })).status, 'deploy-required')
  const unknown = await attestAdminWebArtifact({ artifact, inspectRemote: async () => { throw new Error('ssh unavailable') } })
  assert.equal(unknown.status, 'unattestable')
  assert.equal(unknown.shouldDeploy, true)
})

test('admin attestation rejects a changed local artifact before trusting remote identity', async () => {
  const root = await fixtureRoot()
  try {
    const artifactRoot = join(root, 'admin-web')
    await mkdir(artifactRoot, { recursive: true })
    await writeFile(join(artifactRoot, 'index.html'), 'prepared')
    const manifest = await createReleaseArtifactManifest({
      root, runId: 'run-1', gitSha: 'abcdef', envId: 'env', version: '1', desc: 'd',
      plan: { targets: { cloud: { functions: [] }, adminWeb: true, miniprogram: false } },
      paths: { adminWebRoot: artifactRoot },
    })
    await writeFile(join(artifactRoot, 'index.html'), 'changed')
    await assert.rejects(() => attestAdminWebArtifact({
      root, artifact: manifest.artifacts.adminWeb, inspectRemote: async () => manifest.artifacts.adminWeb,
    }), /immutable admin-web artifact digest mismatch/i)
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

test('cloud orchestration bounds a never-resolving invoke, aborts it, and deploys only that function', async () => {
  const run = await preparedCloudRun(2)
  try {
    let aborted = false
    const result = await orchestrateCloudArtifactRelease({
      root: run.root, manifest: run.manifest, timeoutMs: 10,
      attest: ({ artifact, signal }) => artifact.functionName === 'fn-1'
        ? new Promise(() => signal.addEventListener('abort', () => { aborted = true }, { once: true }))
        : Promise.resolve({ functionName: artifact.functionName, buildId: artifact.buildId, sourceSha: artifact.sourceSha }),
      deploy: async () => {}, verify: async () => {},
    })
    assert.equal(aborted, true)
    assert.deepEqual(result.deployFunctions, ['fn-1'])
    assert.match(result.attestations[1].skipReason, /timed out/i)
  } finally {
    await rm(run.root, { recursive: true, force: true })
  }
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
    assert.deepEqual(Object.keys(publicIdentity).sort(), ['buildId', 'contentDigest', 'functionName', 'probeTokenHash', 'sourceSha'])
  } finally {
    await rm(run.root, { recursive: true, force: true })
  }
})
