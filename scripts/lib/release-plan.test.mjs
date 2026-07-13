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

test('cloud test-only files never create runtime cloud targets across path styles', () => {
  for (const changedPath of [
    'cloud/lib/__tests__/handoff.test.ts',
    'cloud/functions/admin/index.test.ts',
    'cloud/__tests__/integration/full-flow.integration.test.ts',
    'M\tcloud\\functions\\post\\__tests__\\post.test.ts',
    'D\tcloud/lib/__tests__/removed.test.ts',
  ]) {
    const impact = classifyReleaseImpact({
      changedPaths: [changedPath],
      allFunctions: ['admin', 'post'],
      functionInputs: {},
    })
    assert.deepEqual(impact.cloud, { functions: [], mode: 'none', reasons: [] }, changedPath)
  }
})

test('renames preserve both endpoints when deciding cloud runtime impact', () => {
  const testOnlyUnix = 'cloud/lib/__tests__/handoff.test.ts'
  const runtimeUnix = 'cloud/lib/community-approval-handoff.ts'
  const testOnlyWindows = 'cloud\\functions\\admin\\__tests__\\admin.test.ts'
  const runtimeWindows = 'cloud\\functions\\admin\\index.ts'

  for (const changedPath of [
    `R100\t${testOnlyUnix}\tcloud/lib/__tests__/renamed.test.ts`,
    `R095\t${testOnlyWindows}\tcloud\\functions\\admin\\__tests__\\renamed.test.ts`,
  ]) {
    const impact = classifyReleaseImpact({ changedPaths: [changedPath], allFunctions: ['admin', 'post'], functionInputs: {} })
    assert.deepEqual(impact.cloud, { functions: [], mode: 'none', reasons: [] }, changedPath)
  }

  for (const changedPath of [
    `R100\t${runtimeUnix}\t${testOnlyUnix}`,
    `R100\t${testOnlyUnix}\t${runtimeUnix}`,
    `R100\t${runtimeUnix}\tcloud/lib/renamed-runtime.ts`,
    `R100\t${runtimeUnix}\tdocs/retired-handoff.md`,
    `R100\tdocs/new-handoff.md\t${runtimeUnix}`,
    `R100\t${runtimeWindows}\t${testOnlyWindows}`,
    `R100\t${testOnlyWindows}\t${runtimeWindows}`,
  ]) {
    const impact = classifyReleaseImpact({ changedPaths: [changedPath], allFunctions: ['admin', 'post'], functionInputs: {} })
    assert.equal(impact.cloud.mode, 'all', changedPath)
  }
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
