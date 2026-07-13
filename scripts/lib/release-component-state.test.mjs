import assert from 'node:assert/strict'
import test from 'node:test'

import { mergeReleaseComponents, selectCloudProductionBindings, selectStableProductionBinding } from './release-component-state.mjs'

const artifact = (runId, digest = 'same') => ({
  artifactPath: `.codex-local/release-artifacts/${runId}/cloud/post`,
  buildId: `${runId}-build`, componentDigest: digest, contentDigest: `${runId}-content`,
  functionName: 'post', probeTokenHash: `${runId}-token-hash`, runtimeDigest: 'runtime', sourceSha: `${runId}-sha`,
})

test('attested B and C releases retain deployed A provenance while force deployment advances it', () => {
  const deployedA = { ...artifact('A'), artifactRunId: 'A' }
  const skippedB = selectCloudProductionBindings({
    artifactManifest: { runId: 'B', artifacts: { cloud: { post: artifact('B') } } },
    deployedFunctions: [], plannedFunctions: ['post'], priorFunctions: { post: deployedA },
  })
  assert.deepEqual(skippedB.post, deployedA)
  const skippedC = selectCloudProductionBindings({
    artifactManifest: { runId: 'C', artifacts: { cloud: { post: artifact('C') } } },
    deployedFunctions: [], plannedFunctions: ['post'], priorFunctions: skippedB,
  })
  assert.deepEqual(skippedC.post, deployedA)

  const forcedB = selectCloudProductionBindings({
    artifactManifest: { runId: 'B', artifacts: { cloud: { post: artifact('B') } } },
    deployedFunctions: ['post'], plannedFunctions: ['post'], priorFunctions: { post: deployedA },
  })
  assert.equal(forcedB.post.artifactRunId, 'B')
  assert.equal(forcedB.post.probeTokenHash, 'B-token-hash')
  const resumedB = selectCloudProductionBindings({
    artifactManifest: { runId: 'B', artifacts: { cloud: { post: artifact('B') } } },
    currentBoundFunctions: ['post'], deployedFunctions: [], plannedFunctions: ['post'], priorFunctions: { post: deployedA },
  })
  assert.equal(resumedB.post.artifactRunId, 'B')
})

test('skip requires exact prior stable identity and incremental merge preserves untouched components', () => {
  assert.throws(() => selectCloudProductionBindings({
    artifactManifest: { runId: 'B', artifacts: { cloud: { post: artifact('B') } } },
    deployedFunctions: [], plannedFunctions: ['post'], priorFunctions: {},
  }), /prior deployed binding/i)
  assert.throws(() => selectCloudProductionBindings({
    artifactManifest: { runId: 'B', artifacts: { cloud: { post: artifact('B', 'new') } } },
    deployedFunctions: [], plannedFunctions: ['post'], priorFunctions: { post: { ...artifact('A', 'old'), artifactRunId: 'A' } },
  }), /stable digest/i)

  const previous = { adminWeb: { componentDigest: 'admin-old' }, cloud: { functions: { post: { componentDigest: 'post-old' }, user: { componentDigest: 'user-old' } } }, miniprogram: { componentDigest: 'mini-old' } }
  const merged = mergeReleaseComponents(previous, { cloud: { functions: { post: { componentDigest: 'post-new' } } } })
  assert.equal(merged.cloud.functions.post.componentDigest, 'post-new')
  assert.equal(merged.cloud.functions.user.componentDigest, 'user-old')
  assert.equal(merged.adminWeb.componentDigest, 'admin-old')
  assert.equal(merged.miniprogram.componentDigest, 'mini-old')
})

test('admin skip preserves prior provenance while mutation records the current artifact run', () => {
  const prior = { artifactRunId: 'A', componentDigest: 'same', contentDigest: 'old-output', versionId: 'old' }
  const current = { artifactPath: 'secret-local-path', componentDigest: 'same', contentDigest: 'new-output', versionId: 'new' }
  assert.deepEqual(selectStableProductionBinding({ component: 'admin-web', current, mutated: false, prior, runId: 'B' }), prior)
  const deployed = selectStableProductionBinding({ component: 'admin-web', current, mutated: true, prior, runId: 'B' })
  assert.equal(deployed.artifactRunId, 'B')
  assert.equal(deployed.componentDigest, 'same')
  assert.equal(Object.hasOwn(deployed, 'artifactPath'), false)
})
