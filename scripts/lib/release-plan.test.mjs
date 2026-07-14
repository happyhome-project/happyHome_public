import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ALL_CLOUD_FUNCTIONS,
  classifyReleaseImpact,
  createReleasePlan,
  selectChangeManifests,
  selectChangeManifestsForDiff,
  validateChangeManifests,
} from './release-plan.mjs'

test('direct cloud function changes deploy only that function', () => {
  const impact = classifyReleaseImpact({
    changedPaths: ['cloud/functions/post/index.ts'],
    allFunctions: ALL_CLOUD_FUNCTIONS,
    functionInputs: {},
  })
  assert.deepEqual(impact.cloud, { functions: ['post'], mode: 'exact', reasons: ['direct:post'] })
})

test('shared inputs use the dependency map and unknown mappings fall back to all functions', () => {
  const mapped = classifyReleaseImpact({
    changedPaths: ['cloud/lib/db.ts'],
    allFunctions: ['post', 'user'],
    functionInputs: { post: ['cloud/lib/db.ts'], user: ['cloud/lib/db.ts'] },
  })
  assert.deepEqual(mapped.cloud, { functions: ['post', 'user'], mode: 'exact', reasons: ['shared:cloud/lib/db.ts'] })

  const unknown = classifyReleaseImpact({
    changedPaths: ['cloud/lib/new-runtime-file.ts'],
    allFunctions: ['post', 'user'],
    functionInputs: { post: [], user: [] },
  })
  assert.equal(unknown.cloud.mode, 'all')
  assert.match(unknown.cloud.reasons[0], /unmapped/i)
})

test('deletions and build configuration changes conservatively deploy all cloud functions', () => {
  for (const changedPath of ['D\tcloud/lib/db.ts', 'R100\tcloud/lib/old.ts\tcloud/lib/new.ts', 'cloud/build.mjs', 'cloud/package-lock.json', 'cloud/tsconfig.json']) {
    const impact = classifyReleaseImpact({ changedPaths: [changedPath], allFunctions: ['post', 'user'], functionInputs: {} })
    assert.equal(impact.cloud.mode, 'all')
  }
})

test('frontend-only changes leave cloud deployment empty', () => {
  const impact = classifyReleaseImpact({
    changedPaths: ['miniprogram/src/pages/search/index.vue', 'admin-web/src/App.vue'],
    allFunctions: ['post'],
    functionInputs: {},
  })
  assert.equal(impact.cloud.mode, 'none')
  assert.equal(impact.miniprogram, true)
  assert.equal(impact.adminWeb, true)
})

test('release plans exclude RAG workers and actions by default', () => {
  const plan = createReleasePlan({
    baseSha: '',
    headSha: 'head',
    changedPaths: [],
    allFunctions: ALL_CLOUD_FUNCTIONS,
    functionInputs: {},
    manifests: [{
      schemaVersion: 1,
      changeId: 'default-off',
      actions: ['configure-rag-workers', 'ensure-indexes', 'verify-post-rag-timer'],
      migrations: [],
      smokeSuites: ['post-rag', 'business-smoke'],
    }],
    mode: 'full-current',
  })
  assert.equal(plan.targets.cloud.functions.includes('post-rag-worker'), false)
  assert.equal(plan.targets.cloud.functions.includes('post-video-rag-worker'), false)
  assert.deepEqual(plan.manifests[0].actions, ['ensure-indexes'])
  assert.deepEqual(plan.manifests[0].smokeSuites, ['business-smoke'])
  assert.deepEqual(plan.operationKinds.verification, [])
})

test('explicit includeRag keeps RAG workers and actions in the plan', () => {
  const plan = createReleasePlan({
    baseSha: '',
    headSha: 'head',
    changedPaths: [],
    allFunctions: ALL_CLOUD_FUNCTIONS,
    functionInputs: {},
    includeRag: true,
    manifests: [{
      schemaVersion: 1,
      changeId: 'rag-explicit-on',
      actions: ['configure-rag-workers'],
      migrations: [],
      smokeSuites: ['post-rag'],
    }],
    mode: 'full-current',
  })
  assert.equal(plan.targets.cloud.functions.includes('post-rag-worker'), true)
  assert.deepEqual(plan.manifests[0].actions, ['configure-rag-workers'])
  assert.deepEqual(plan.manifests[0].smokeSuites, ['post-rag'])
})

test('RAG-only manifests do not require a release by default', () => {
  const plan = createReleasePlan({
    baseSha: 'base',
    headSha: 'head',
    changedPaths: [],
    allFunctions: ALL_CLOUD_FUNCTIONS,
    functionInputs: {},
    manifests: [{ schemaVersion: 1, changeId: 'rag-only', actions: ['configure-rag-workers'], migrations: [], smokeSuites: ['post-rag'] }],
    mode: 'main',
  })
  assert.equal(plan.releaseRequired, false)
  assert.deepEqual(plan.changeIds, [])
  assert.deepEqual(plan.manifests, [])
})

test('RAG manifests with generic index actions are removed by identity', () => {
  const plan = createReleasePlan({
    baseSha: 'base',
    headSha: 'head',
    changedPaths: [],
    allFunctions: ALL_CLOUD_FUNCTIONS,
    functionInputs: {},
    manifests: [{ schemaVersion: 1, changeId: 'rag-community-version-collection', actions: ['ensure-indexes'], migrations: [], smokeSuites: [] }],
    mode: 'main',
  })
  assert.equal(plan.releaseRequired, false)
  assert.deepEqual(plan.changeIds, [])
})

test('change manifests reject unknown actions, duplicate ids, and missing declarations for external changes', () => {
  assert.throws(() => validateChangeManifests([{ schemaVersion: 1, changeId: 'a', actions: ['shell-anything'], migrations: [], smokeSuites: [] }]), /unknown action/i)
  assert.throws(() => validateChangeManifests([
    { schemaVersion: 1, changeId: 'a', actions: [], migrations: [], smokeSuites: [] },
    { schemaVersion: 1, changeId: 'a', actions: [], migrations: [], smokeSuites: [] },
  ]), /duplicate changeId/i)
  assert.throws(() => createReleasePlan({
    baseSha: 'base', headSha: 'head', changedPaths: ['scripts/ensure-indexes.mjs'],
    allFunctions: ['post'], functionInputs: {}, manifests: [], mode: 'pr',
  }), /release\/changes/i)
  assert.throws(() => validateChangeManifests([
    { schemaVersion: 1, changeId: 'migration', actions: [], migrations: [{ id: 'missing-module' }], smokeSuites: [] },
  ]), /id and module/i)
  assert.throws(() => validateChangeManifests([
    { schemaVersion: 1, changeId: 'traversal', actions: [], migrations: [{ id: 'escape', inputDigest: 'a'.repeat(64), module: 'release/migrations/../../escape.mjs' }], smokeSuites: [] },
  ]), /confined/i)
  assert.throws(() => validateChangeManifests([
    { schemaVersion: 1, changeId: 'encoded-traversal', actions: [], migrations: [{ id: 'escape', inputDigest: 'a'.repeat(64), module: 'release/migrations/%2e%2e/escape.mjs' }], smokeSuites: [] },
  ]), /confined/i)
})

test('main plans use production state base and bootstrap safely when it is unavailable', () => {
  const plan = createReleasePlan({
    baseSha: '', headSha: 'head', changedPaths: ['docs/guide.md'], allFunctions: ['post'], functionInputs: {}, manifests: [], mode: 'main',
  })
  assert.equal(plan.bootstrap, true)
  assert.equal(plan.targets.cloud.mode, 'all')
  assert.equal(plan.baseSha, null)
})

test('full-current plans explicitly publish every current runtime target and retain manifests', () => {
  const manifests = [
    { schemaVersion: 1, changeId: 'indexes', actions: ['ensure-indexes'], migrations: [], smokeSuites: [] },
    { schemaVersion: 1, changeId: 'network', actions: ['configure-rag-network'], migrations: [], smokeSuites: [] },
  ]
  const plan = createReleasePlan({
    baseSha: 'unexpected-base',
    headSha: 'head',
    changedPaths: ['docs/guide.md'],
    allFunctions: ['post', 'user'],
    functionInputs: {},
    manifests,
    includeRag: true,
    mode: 'full-current',
  })

  assert.equal(plan.baseSha, null)
  assert.equal(plan.bootstrap, false)
  assert.equal(plan.planningStrategy, 'full-current')
  assert.equal(plan.releaseRequired, true)
  assert.deepEqual(plan.targets.cloud, {
    functions: ['post', 'user'],
    mode: 'all',
    reasons: ['full-current:explicit'],
  })
  assert.equal(plan.targets.adminWeb, true)
  assert.equal(plan.targets.miniprogram, true)
  assert.deepEqual(plan.manifests, manifests)
  assert.deepEqual(plan.changeIds, ['indexes', 'network'])
  assert.deepEqual(plan.operationKinds, {
    'desired-state': ['configure-rag-network', 'ensure-indexes'],
    migration: [],
    verification: [],
  })
})

test('shared root build inputs target every component whose digest depends on them', () => {
  const lockImpact = classifyReleaseImpact({ changedPaths: ['package-lock.json'], allFunctions: ['post', 'user'], functionInputs: {} })
  assert.equal(lockImpact.cloud.mode, 'all')
  assert.equal(lockImpact.adminWeb, true)
  assert.equal(lockImpact.miniprogram, true)

  const projectImpact = classifyReleaseImpact({ changedPaths: ['project.config.json'], allFunctions: ['post'], functionInputs: {} })
  assert.equal(projectImpact.cloud.mode, 'all')
  assert.equal(projectImpact.adminWeb, true)
  assert.equal(projectImpact.miniprogram, true)

  const probeImpact = classifyReleaseImpact({ changedPaths: ['scripts/lib/cloud-release-probe.mjs'], allFunctions: ['post', 'user'], functionInputs: {} })
  assert.equal(probeImpact.cloud.mode, 'all')
  assert.equal(probeImpact.adminWeb, false)
  assert.equal(probeImpact.miniprogram, false)
})

test('force-redeploy-current is valid only for explicit full-current and is pinned in the plan', () => {
  assert.throws(() => createReleasePlan({
    baseSha: 'base', forceRedeployCurrent: true, headSha: 'head', manifests: [], mode: 'main',
  }), /force-redeploy-current.*full-current/i)
  const plan = createReleasePlan({ forceRedeployCurrent: true, headSha: 'head', manifests: [], mode: 'full-current' })
  assert.equal(plan.forceRedeployCurrent, true)
})

test('normal main plans remain incremental and classify only changed runtime targets', () => {
  const plan = createReleasePlan({
    baseSha: 'production-base',
    headSha: 'head',
    changedPaths: ['admin-web/src/App.vue'],
    allFunctions: ['post'],
    functionInputs: {},
    manifests: [],
    mode: 'main',
  })

  assert.equal(plan.planningStrategy, 'incremental')
  assert.equal(plan.targets.adminWeb, true)
  assert.equal(plan.targets.miniprogram, false)
  assert.equal(plan.targets.cloud.mode, 'none')
})

test('release plan selects only manifests changed in the production diff', () => {
  const manifests = [
    { changeId: 'historical', source: 'release/changes/20260701-historical.json' },
    { changeId: 'current', source: 'release/changes/20260711-current.json' },
  ]
  assert.deepEqual(
    selectChangeManifestsForDiff(manifests, ['M\trelease/changes/20260711-current.json', 'docs/README.md']),
    [manifests[1]],
  )
  assert.deepEqual(selectChangeManifestsForDiff(manifests, ['docs/README.md']), [])
})

test('manifest selection includes all manifests only for full-current plans', () => {
  const manifests = [
    { changeId: 'historical', source: 'release/changes/20260701-historical.json' },
    { changeId: 'current', source: 'release/changes/20260711-current.json' },
  ]
  const changedPaths = ['M\trelease/changes/20260711-current.json']

  const selected = selectChangeManifests('full-current', manifests, changedPaths)
  assert.deepEqual(selected, manifests)
  assert.notEqual(selected, manifests)
  assert.deepEqual(selectChangeManifests('main', manifests, changedPaths), [manifests[1]])
})

test('documentation and release-tooling changes do not require production publication', () => {
  for (const changedPath of ['docs/README.md', 'README.md', 'scripts/release-plan.mjs']) {
    const plan = createReleasePlan({
      baseSha: 'base',
      headSha: 'head',
      changedPaths: [changedPath],
      allFunctions: ['post'],
      functionInputs: {},
      manifests: [],
      mode: 'main',
    })
    assert.equal(plan.planningStrategy, 'incremental', changedPath)
    assert.equal(plan.releaseRequired, false, changedPath)
  }

  const manifestPlan = createReleasePlan({
    baseSha: 'base',
    headSha: 'head',
    changedPaths: ['release/changes/20260711-current.json'],
    allFunctions: ['post'],
    functionInputs: {},
    manifests: [{ schemaVersion: 1, changeId: 'current', actions: ['ensure-indexes'], migrations: [], smokeSuites: [] }],
    mode: 'main',
  })
  assert.equal(manifestPlan.releaseRequired, true)
})
