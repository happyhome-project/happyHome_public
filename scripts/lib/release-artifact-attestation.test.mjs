import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  attestAdminWebArtifact,
  attestCloudArtifacts,
  attestMiniprogramReceipt,
  createReleaseArtifactManifest,
  summarizeArtifactOutcomes,
} from './release-artifact-attestation.mjs'

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
    const result = await attestAdminWebArtifact({
      root,
      artifact: manifest.artifacts.adminWeb,
      inspectRemote: async () => manifest.artifacts.adminWeb,
    })
    assert.equal(result.status, 'deploy-required')
    assert.match(result.skipReason, /local artifact digest/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('miniprogram receipt reuse requires exact run, digest, version and description', async () => {
  const artifact = { runId: 'run-1', contentDigest: 'digest', version: '1.2.3', desc: 'release' }
  const exact = attestMiniprogramReceipt({ artifact, receipt: { success: true, releaseRunId: 'run-1', packageDigest: 'digest', version: '1.2.3', desc: 'release', receiptId: 'r1' } })
  assert.equal(exact.status, 'uploaded')
  for (const field of ['releaseRunId', 'packageDigest', 'version', 'desc']) {
    const receipt = { success: true, releaseRunId: 'run-1', packageDigest: 'digest', version: '1.2.3', desc: 'release', receiptId: 'r1', [field]: 'wrong' }
    assert.equal(attestMiniprogramReceipt({ artifact, receipt }).shouldUpload, true, field)
  }
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
