import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { computeDirectoryDigest } from './release-run-ledger.mjs'
import { createMiniprogramReceiptIdentity } from './miniprogram-receipt-identity.mjs'
export { createMiniprogramReceiptIdentity } from './miniprogram-receipt-identity.mjs'

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

export async function createImmutableArtifactSnapshots({ root, runId, plan, paths = {} } = {}) {
  assertIdentity(root, 'root')
  if (!/^[a-zA-Z0-9._-]+$/.test(String(runId || ''))) throw new Error('release artifact snapshot requires a safe runId')
  const destination = resolve(root, '.codex-local', 'release-artifacts', runId)
  const temporary = resolve(dirname(destination), `.${runId}.tmp-${process.pid}-${Date.now()}`)
  await mkdir(dirname(destination), { recursive: true })
  await rm(temporary, { recursive: true, force: true })
  try {
    await mkdir(temporary, { recursive: true })
    for (const functionName of plan.targets?.cloud?.functions || []) {
      await cp(join(paths.cloudRoot, functionName), join(temporary, 'cloud', functionName), { recursive: true, errorOnExist: true })
    }
    if (plan.targets?.adminWeb) await cp(paths.adminWebRoot, join(temporary, 'admin-web'), { recursive: true, errorOnExist: true })
    await rename(temporary, destination)
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    throw new Error(`immutable release artifact snapshot failed: ${error?.message || error}`)
  }
  return {
    cloudRoot: join(destination, 'cloud'),
    adminWebRoot: join(destination, 'admin-web'),
    miniprogramRoot: paths.miniprogramRoot,
  }
}

export function sanitizeKnownSecrets(value, secrets = []) {
  const known = secrets.map(String).filter(Boolean).sort((a, b) => b.length - a.length)
  const sanitizeText = (text) => known.reduce((result, secret) => result.split(secret).join('[REDACTED_PROBE_TOKEN]'), String(text))
  if (typeof value === 'string') return sanitizeText(value)
  if (Array.isArray(value)) return value.map((item) => sanitizeKnownSecrets(item, known))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitizeKnownSecrets(child, known)]))
  }
  return value
}

export function toPublicCloudArtifactIdentity(artifact = {}) {
  return {
    buildId: artifact.buildId || '',
    contentDigest: artifact.contentDigest || '',
    functionName: artifact.functionName || '',
    probeTokenHash: artifact.probeTokenHash || '',
    sourceSha: artifact.sourceSha || '',
  }
}

async function validatePinnedCloudArtifacts({ root, manifest }) {
  const pinned = []
  for (const functionName of manifest.targets?.cloudFunctions || []) {
    const artifact = manifest.artifacts?.cloud?.[functionName]
    if (!artifact) throw new Error(`immutable cloud artifact is missing from manifest for ${functionName}`)
    const artifactRoot = absolutePath(root, artifact.artifactPath)
    const expectedRoot = resolve(root, '.codex-local', 'release-artifacts', manifest.runId, 'cloud', functionName)
    if (resolve(artifactRoot) !== expectedRoot) throw new Error(`immutable cloud artifact path is invalid for ${functionName}`)
    let digest
    try { digest = await computeDirectoryDigest(artifactRoot) } catch { throw new Error(`immutable cloud artifact is missing for ${functionName}`) }
    if (digest !== artifact.contentDigest) throw new Error(`immutable cloud artifact digest mismatch for ${functionName}`)
    const probe = JSON.parse(await readFile(join(artifactRoot, '__release.info.json'), 'utf8'))
    if (probe.functionName !== functionName || probe.buildId !== artifact.buildId || probe.sourceSha !== artifact.sourceSha ||
      sha256(String(probe.probeToken || '')) !== artifact.probeTokenHash) {
      throw new Error(`immutable cloud probe identity mismatch for ${functionName}`)
    }
    pinned.push({ artifact, artifactRoot, functionName, probeToken: probe.probeToken })
  }
  return pinned
}

async function boundedOperation(operation, timeoutMs) {
  const controller = new AbortController()
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new Error(`operation timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function orchestrateCloudArtifactRelease({ root, manifest, timeoutMs = 30_000, attest, deploy, verify, onSecrets } = {}) {
  if (![attest, deploy, verify].every((value) => typeof value === 'function')) throw new Error('cloud artifact orchestration requires attest, deploy, and verify')
  const pinned = await validatePinnedCloudArtifacts({ root, manifest })
  const secrets = pinned.map((item) => item.probeToken)
  onSecrets?.(secrets)
  const attestations = []
  const deployFunctions = []
  for (const item of pinned) {
    try {
      const response = await boundedOperation((signal) => attest({ ...item, signal }), timeoutMs)
      if (response?.functionName !== item.artifact.functionName || response?.buildId !== item.artifact.buildId || response?.sourceSha !== item.artifact.sourceSha) {
        throw new Error('fresh probe response does not match artifact identity')
      }
      attestations.push({ component: `cloud:${item.functionName}`, functionName: item.functionName, status: 'attested', skipReason: 'fresh remote probe matched immutable snapshot' })
    } catch (error) {
      deployFunctions.push(item.functionName)
      attestations.push({
        component: `cloud:${item.functionName}`,
        functionName: item.functionName,
        status: 'deploy-required',
        skipReason: sanitizeKnownSecrets(error?.message || String(error), [item.probeToken]),
      })
    }
  }
  for (const functionName of deployFunctions) {
    const item = pinned.find((candidate) => candidate.functionName === functionName)
    const digest = await computeDirectoryDigest(item.artifactRoot)
    if (digest !== item.artifact.contentDigest) throw new Error(`immutable cloud artifact digest changed before deploy for ${functionName}`)
    await deploy(item)
  }
  const verified = []
  for (const item of pinned) {
    const digest = await computeDirectoryDigest(item.artifactRoot)
    if (digest !== item.artifact.contentDigest) throw new Error(`immutable cloud artifact digest changed before verify for ${item.functionName}`)
    try {
      await boundedOperation((signal) => verify({ ...item, signal }), timeoutMs)
    } catch (error) {
      throw new Error(sanitizeKnownSecrets(error?.message || String(error), secrets))
    }
    verified.push(item.functionName)
  }
  return { attestations, deployFunctions, verified }
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
  if (root && artifact?.artifactPath) {
    let localDigest
    try { localDigest = await computeDirectoryDigest(absolutePath(root, artifact.artifactPath)) } catch {
      throw new Error('immutable admin-web artifact is missing')
    }
    if (localDigest !== artifact.contentDigest) throw new Error('immutable admin-web artifact digest mismatch')
  }
  try {
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

export function attestMiniprogramReceipt({ artifact, receipt, expectedReceiptId } = {}) {
  const actualReceiptId = receipt && createMiniprogramReceiptIdentity({
    receipt,
    runId: artifact?.runId,
    packageDigest: artifact?.contentDigest,
    version: artifact?.version,
    desc: artifact?.desc,
  })
  const exact = Boolean(expectedReceiptId) && actualReceiptId === expectedReceiptId
  return exact
    ? { component: 'miniprogram', status: 'uploaded', shouldUpload: false, receiptId: actualReceiptId, skipReason: 'fresh normalized upload receipt matched immutable package' }
    : { component: 'miniprogram', status: 'upload-required', shouldUpload: true, receiptId: actualReceiptId || '', skipReason: 'upload receipt does not exactly match expected receipt identity' }
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
