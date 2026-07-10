import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ALL_CLOUD_FUNCTIONS,
  classifyReleaseImpact,
  createReleasePlan,
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
  for (const changedPath of ['D\tcloud/lib/db.ts', 'cloud/build.mjs', 'cloud/package-lock.json', 'cloud/tsconfig.json']) {
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
})

test('main plans use production state base and bootstrap safely when it is unavailable', () => {
  const plan = createReleasePlan({
    baseSha: '', headSha: 'head', changedPaths: ['docs/guide.md'], allFunctions: ['post'], functionInputs: {}, manifests: [], mode: 'main',
  })
  assert.equal(plan.bootstrap, true)
  assert.equal(plan.targets.cloud.mode, 'all')
  assert.equal(plan.baseSha, null)
})
