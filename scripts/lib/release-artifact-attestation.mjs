import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'

import { computeDirectoryDigest } from './release-run-ledger.mjs'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function localPath(root, path) {
  return relative(resolve(root), resolve(path)).replace(/\\/g, '/')
}

function absolutePath(root, path) {
  return isAbsolute(path) ? path : resolve(root, path)
}

function assertIdentity(value, name) {
  if (!String(value || '').trim()) throw new Error(`release artifact manifest requires ${name}`)
}

export async function createReleaseArtifactManifest({ root, runId, gitSha, envId, version, desc, plan, toolchain = {}, paths = {} } = {}) {
  for (const [name, value] of Object.entries({ root, runId, gitSha, envId, version, desc, plan })) assertIdentity(value, name)
  const cloudFunctions = [...(plan.targets?.cloud?.functions || [])]
  const artifacts = { cloud: {}, adminWeb: null, miniprogram: null }
  for (const functionName of cloudFunctions) {
    const artifactRoot = join(paths.cloudRoot, functionName)
    const probe = JSON.parse(await readFile(join(artifactRoot, '__release.info.json'), 'utf8'))
    if (probe.functionName !== functionName || probe.sourceSha !== gitSha || !probe.buildId || !/^[a-f0-9]{64}$/i.test(String(probe.probeToken || ''))) {
      throw new Error(`cloud artifact identity is invalid for ${functionName}`)
    }
    artifacts.cloud[functionName] = {
      artifactPath: localPath(root, artifactRoot),
      buildId: probe.buildId,
      contentDigest: await computeDirectoryDigest(artifactRoot),
      functionName,
      probeTokenHash: sha256(probe.probeToken),
      sourceSha: gitSha,
    }
  }
  if (plan.targets?.adminWeb) {
    const contentDigest = await computeDirectoryDigest(paths.adminWebRoot)
    artifacts.adminWeb = {
      artifactPath: localPath(root, paths.adminWebRoot),
      contentDigest,
      runId,
      sourceSha: gitSha,
      versionId: `admin-${runId}-${gitSha.slice(0, 12)}-${contentDigest.slice(0, 12)}`,
    }
  }
  if (plan.targets?.miniprogram) {
    const contentDigest = await computeDirectoryDigest(paths.miniprogramRoot)
    artifacts.miniprogram = {
      artifactPath: localPath(root, paths.miniprogramRoot),
      contentDigest,
      desc,
      runId,
      sourceSha: gitSha,
      version,
    }
  }
  return {
    schemaVersion: 1,
    runId, gitSha, envId, version, desc,
    toolchain: { ...toolchain },
    targets: { cloudFunctions, adminWeb: Boolean(plan.targets?.adminWeb), miniprogram: Boolean(plan.targets?.miniprogram) },
    artifacts,
  }
}

export async function attestCloudArtifacts({ root, manifest, invoke } = {}) {
  const attestations = []
  const deployFunctions = []
  for (const functionName of manifest.targets?.cloudFunctions || []) {
    const artifact = manifest.artifacts?.cloud?.[functionName]
    let skipReason = ''
    try {
      if (!artifact) throw new Error('artifact manifest entry is missing')
      const artifactRoot = absolutePath(root, artifact.artifactPath)
      const digest = await computeDirectoryDigest(artifactRoot)
      if (digest !== artifact.contentDigest) throw new Error(`local artifact digest mismatch: expected ${artifact.contentDigest}, got ${digest}`)
      const probe = JSON.parse(await readFile(join(artifactRoot, '__release.info.json'), 'utf8'))
      if (sha256(String(probe.probeToken || '')) !== artifact.probeTokenHash) throw new Error('local probe token hash mismatch')
      const response = await invoke({ artifact, functionName, probeToken: probe.probeToken })
      if (response?.functionName !== artifact.functionName || response?.buildId !== artifact.buildId || response?.sourceSha !== artifact.sourceSha) {
        throw new Error('fresh probe response does not match artifact identity')
      }
      attestations.push({ component: `cloud:${functionName}`, functionName, status: 'attested', skipReason: 'fresh remote probe matched immutable local artifact' })
      continue
    } catch (error) {
      skipReason = error?.message || String(error)
    }
    deployFunctions.push(functionName)
    attestations.push({ component: `cloud:${functionName}`, functionName, status: 'deploy-required', skipReason })
  }
  return { attestations, deployFunctions }
}

export async function attestAdminWebArtifact({ root, artifact, inspectRemote } = {}) {
  try {
    if (root && artifact?.artifactPath) {
      const localDigest = await computeDirectoryDigest(absolutePath(root, artifact.artifactPath))
      if (localDigest !== artifact.contentDigest) {
        return { component: 'admin-web', status: 'deploy-required', shouldDeploy: true, skipReason: 'local artifact digest does not match the pinned manifest' }
      }
    }
    const remote = await inspectRemote()
    if (!remote || !remote.contentDigest || !remote.runId || !remote.versionId) {
      return { component: 'admin-web', status: 'unattestable', shouldDeploy: true, skipReason: 'remote publication identity is unreadable' }
    }
    if (remote.contentDigest === artifact.contentDigest && remote.runId === artifact.runId && remote.versionId === artifact.versionId) {
      return { component: 'admin-web', status: 'attested', shouldDeploy: false, skipReason: 'fresh remote version and content digest matched' }
    }
    return { component: 'admin-web', status: 'deploy-required', shouldDeploy: true, skipReason: 'remote version or content digest mismatch' }
  } catch (error) {
    return { component: 'admin-web', status: 'unattestable', shouldDeploy: true, skipReason: error?.message || String(error) }
  }
}

export function attestMiniprogramReceipt({ artifact, receipt } = {}) {
  const exact = receipt?.success === true &&
    receipt.releaseRunId === artifact.runId && receipt.packageDigest === artifact.contentDigest &&
    receipt.version === artifact.version && receipt.desc === artifact.desc && Boolean(receipt.receiptId)
  return exact
    ? { component: 'miniprogram', status: 'uploaded', shouldUpload: false, skipReason: 'fresh upload receipt matched immutable package' }
    : { component: 'miniprogram', status: 'upload-required', shouldUpload: true, skipReason: 'upload receipt does not exactly match immutable package identity' }
}

export function summarizeArtifactOutcomes(outcomes = []) {
  const counts = { deployed: 0, skipped: 0, verified: 0, uploaded: 0, total: outcomes.length }
  const components = {}
  for (const outcome of outcomes) {
    components[outcome.component] = { status: outcome.status, skipReason: outcome.skipReason || '' }
    if (outcome.status === 'deployed') counts.deployed += 1
    if (outcome.status === 'attested' || (outcome.status === 'uploaded' && outcome.skipReason)) counts.skipped += 1
    if (outcome.status === 'verified') counts.verified += 1
    if (outcome.status === 'uploaded') counts.uploaded += 1
  }
  return { counts, components }
}
