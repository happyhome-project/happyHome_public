import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { attestCloudWithCurrentOrPrior, loadPriorCloudAttestationProbe } from './release-prior-cloud-attestation.mjs'
import { computeDirectoryDigest } from './release-run-ledger.mjs'

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

async function priorFixture() {
  const root = await mkdtemp(join(tmpdir(), 'happyhome-prior-probe-'))
  const runId = 'prior-run'
  const functionName = 'post'
  const artifactRoot = join(root, '.codex-local', 'release-artifacts', runId, 'cloud', functionName)
  await mkdir(artifactRoot, { recursive: true })
  const probeToken = 'prior-secret-token-value'
  const componentDigest = 'a'.repeat(64)
  const runtimeDigest = 'b'.repeat(64)
  await writeFile(join(artifactRoot, '__release.info.json'), JSON.stringify({
    buildId: 'prior-build', componentDigest, functionName, probeToken, runtimeDigest,
    response: { buildId: 'prior-build', componentDigest, functionName, runtimeDigest, runtimeVerified: true, sourceSha: 'prior-sha' },
    sourceSha: 'prior-sha',
  }))
  await writeFile(join(artifactRoot, 'index.js'), 'prior wrapper')
  return {
    root, artifactRoot, functionName, probeToken,
    productionComponent: {
      artifactRunId: runId,
      componentDigest,
      contentDigest: await computeDirectoryDigest(artifactRoot),
      functionName,
      probeTokenHash: sha256(probeToken),
      runtimeDigest,
    },
  }
}

test('prior token lookup derives the canonical snapshot from guarded production binding and registers the secret', async () => {
  const fixture = await priorFixture()
  const registered = []
  const result = await loadPriorCloudAttestationProbe({
    root: fixture.root,
    functionName: fixture.functionName,
    productionComponent: fixture.productionComponent,
    registerSecrets: (values) => registered.push(...values),
  })
  assert.equal(result.available, true)
  assert.equal(result.probeToken, fixture.probeToken)
  assert.equal(result.artifactRoot, fixture.artifactRoot)
  assert.deepEqual(registered, [fixture.probeToken])
  assert.doesNotMatch(JSON.stringify(result.publicEvidence), new RegExp(fixture.probeToken))
})

test('missing legacy or tampered prior bindings become unattestable without exposing the token', async () => {
  const fixture = await priorFixture()
  await writeFile(join(fixture.artifactRoot, 'index.js'), 'tampered wrapper')
  const tampered = await loadPriorCloudAttestationProbe({
    root: fixture.root,
    functionName: fixture.functionName,
    productionComponent: fixture.productionComponent,
  })
  assert.deepEqual(tampered, { available: false, reason: 'prior immutable cloud attestation proof is unavailable' })
  assert.doesNotMatch(JSON.stringify(tampered), new RegExp(fixture.probeToken))

  const legacy = await loadPriorCloudAttestationProbe({ root: fixture.root, functionName: 'post', productionComponent: {} })
  assert.deepEqual(legacy, { available: false, reason: 'prior immutable cloud attestation proof is unavailable' })

  for (const artifactRunId of ['.', '..', 'run.', 'run ', 'CON', 'LPT1.txt']) {
    const unsafe = await loadPriorCloudAttestationProbe({
      root: fixture.root, functionName: 'post', productionComponent: { ...fixture.productionComponent, artifactRunId },
    })
    assert.equal(unsafe.available, false, artifactRunId)
  }
})

test('same-run current token attestation wins before prior production fallback', async () => {
  const calls = []
  const current = await attestCloudWithCurrentOrPrior({
    input: { functionName: 'post' },
    invokeCurrent: async () => { calls.push('current'); return { proof: 'current' } },
    loadPrior: async () => { calls.push('load-prior'); return { available: true, probeToken: 'prior' } },
    invokePrior: async () => { calls.push('prior'); return { proof: 'prior' } },
  })
  assert.deepEqual(current, { proof: 'current' })
  assert.deepEqual(calls, ['current'])

  calls.length = 0
  const prior = await attestCloudWithCurrentOrPrior({
    input: { functionName: 'post' },
    invokeCurrent: async () => { calls.push('current'); throw new Error('current missing') },
    loadPrior: async () => { calls.push('load-prior'); return { available: true, probeToken: 'prior' } },
    invokePrior: async () => { calls.push('prior'); return { proof: 'prior' } },
  })
  assert.deepEqual(prior, { proof: 'prior' })
  assert.deepEqual(calls, ['current', 'load-prior', 'prior'])
})

test('abort and fatal cleanup errors never fall through to a prior token', async () => {
  for (const error of [
    Object.assign(new Error('aborted'), { name: 'AbortError' }),
    Object.assign(new Error('cleanup unconfirmed'), { code: 'ERR_RELEASE_ATTESTATION_ABORT_CLEANUP' }),
    Object.assign(new Error('timed out'), { code: 'ERR_RELEASE_ATTESTATION_TIMEOUT' }),
  ]) {
    let priorCalls = 0
    await assert.rejects(() => attestCloudWithCurrentOrPrior({
      input: { functionName: 'post' },
      invokeCurrent: async () => { throw error },
      loadPrior: async () => { priorCalls += 1; return { available: true } },
      invokePrior: async () => { priorCalls += 1; return { proof: 'prior' } },
    }), (actual) => actual === error)
    assert.equal(priorCalls, 0)
  }

  const controller = new AbortController()
  controller.abort()
  let priorCalls = 0
  await assert.rejects(() => attestCloudWithCurrentOrPrior({
    input: { functionName: 'post', signal: controller.signal },
    invokeCurrent: async () => { throw new Error('runner stopped') },
    loadPrior: async () => { priorCalls += 1; return { available: true } },
    invokePrior: async () => { priorCalls += 1; return { proof: 'prior' } },
  }), /runner stopped/)
  assert.equal(priorCalls, 0)
})
