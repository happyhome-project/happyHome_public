import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

import { assertNoSymbolicLinkPath } from './filesystem-path-integrity.mjs'
import { computeDirectoryDigest } from './release-run-ledger.mjs'
import { assertSafeReleasePathSegment } from './release-artifact-attestation.mjs'

const unavailable = () => ({ available: false, reason: 'prior immutable cloud attestation proof is unavailable' })
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

export async function loadPriorCloudAttestationProbe({ root, functionName, productionComponent, registerSecrets } = {}) {
  try {
    const runId = String(productionComponent?.artifactRunId || '')
    assertSafeReleasePathSegment(runId, 'artifactRunId')
    assertSafeReleasePathSegment(functionName, 'cloud function name')
    for (const field of ['componentDigest', 'contentDigest', 'probeTokenHash', 'runtimeDigest']) {
      if (!/^[a-f0-9]{64}$/i.test(String(productionComponent?.[field] || ''))) return unavailable()
    }
    if (productionComponent.functionName !== functionName) return unavailable()

    const artifactsRoot = resolve(root, '.codex-local', 'release-artifacts')
    const artifactRoot = resolve(artifactsRoot, runId, 'cloud', functionName)
    await assertNoSymbolicLinkPath(artifactRoot, 'prior immutable cloud artifact path is invalid')
    const canonicalArtifactsRoot = await realpath(artifactsRoot)
    const canonicalRoot = await realpath(artifactRoot)
    const confined = relative(canonicalArtifactsRoot, canonicalRoot).replace(/\\/g, '/')
    const expected = `${runId}/cloud/${functionName}`
    if (confined.toLowerCase() !== expected.toLowerCase() || confined.startsWith('../')) return unavailable()
    if (await computeDirectoryDigest(artifactRoot) !== productionComponent.contentDigest) return unavailable()

    const probe = JSON.parse(await readFile(resolve(artifactRoot, '__release.info.json'), 'utf8'))
    const probeToken = String(probe?.probeToken || '')
    if (!probeToken || sha256(probeToken) !== productionComponent.probeTokenHash ||
      probe.functionName !== functionName || probe.componentDigest !== productionComponent.componentDigest ||
      probe.runtimeDigest !== productionComponent.runtimeDigest) return unavailable()
    registerSecrets?.([probeToken])
    return {
      available: true,
      artifactRoot,
      probeToken,
      publicEvidence: {
        artifactRunId: runId,
        componentDigest: productionComponent.componentDigest,
        contentDigest: productionComponent.contentDigest,
        functionName,
        probeTokenHash: productionComponent.probeTokenHash,
        runtimeDigest: productionComponent.runtimeDigest,
      },
    }
  } catch {
    return unavailable()
  }
}

export async function attestCloudWithCurrentOrPrior({ input, invokeCurrent, loadPrior, invokePrior } = {}) {
  if (![invokeCurrent, loadPrior, invokePrior].every((value) => typeof value === 'function')) {
    throw new Error('cloud attestation fallback requires current prior-loader and prior invokers')
  }
  try {
    return await invokeCurrent(input)
  } catch (error) {
    const fatalCode = new Set(['ERR_RELEASE_ATTESTATION_ABORT_CLEANUP', 'ERR_RELEASE_ATTESTATION_TIMEOUT']).has(error?.code)
    if (input?.signal?.aborted || error?.name === 'AbortError' || fatalCode) throw error
    const prior = await loadPrior(input)
    if (!prior?.available) throw new Error('prior immutable cloud attestation proof is unavailable')
    return await invokePrior(input, prior)
  }
}
