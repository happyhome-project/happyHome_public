import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { isDevtoolsLoginSigningFailure, shouldFallbackAfterDevtoolsFailure } from './release-policy.mjs'
import * as releasePolicyModule from './release-policy.mjs'

test('root DevTools project config points manual cloud deploys at the built function tree', () => {
  const config = JSON.parse(readFileSync(new URL('../../project.config.json', import.meta.url), 'utf8'))
  assert.equal(config.cloudfunctionRoot, 'cloud/dist/')
})

test('H5 runtime does not bundle the historical production gateway or shared token', () => {
  const source = readFileSync(new URL('../../miniprogram/src/api/cloud.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /happyhome-admin-2024/)
  assert.doesNotMatch(source, /app\.tcloudbase\.com\/http-gateway/)
  assert.match(source, /H5 gateway is opt-in/)
})

test('remote release stages are always revalidated instead of trusted from local ledger state', () => {
  assert.equal(releasePolicyModule.mustRevalidateRemoteReleaseStage('cloud-deploy'), true)
  assert.equal(releasePolicyModule.mustRevalidateRemoteReleaseStage('cloud-smoke'), true)
  assert.equal(releasePolicyModule.mustRevalidateRemoteReleaseStage('admin-web-deploy'), true)
  assert.equal(releasePolicyModule.mustRevalidateRemoteReleaseStage('miniprogram-build-gate'), false)
})

function extractFunctionBlock(source, signature) {
  const start = source.indexOf(signature)
  assert.notEqual(start, -1, `Missing function signature: ${signature}`)

  const paramsStart = source.indexOf('(', start)
  assert.notEqual(paramsStart, -1, `Missing function params: ${signature}`)

  let paramsDepth = 0
  let paramsEnd = -1
  for (let index = paramsStart; index < source.length; index += 1) {
    if (source[index] === '(') paramsDepth += 1
    if (source[index] === ')') {
      paramsDepth -= 1
      if (paramsDepth === 0) {
        paramsEnd = index
        break
      }
    }
  }
  assert.notEqual(paramsEnd, -1, `Could not parse function params: ${signature}`)

  const bodyStart = source.indexOf('{', paramsEnd)
  assert.notEqual(bodyStart, -1, `Missing function body: ${signature}`)

  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }

  assert.fail(`Could not extract function block: ${signature}`)
}

test('blocks fallback when DevTools login or signing state is bad', () => {
  assert.equal(isDevtoolsLoginSigningFailure('Cloud API signed-header failure'), true)
  assert.equal(isDevtoolsLoginSigningFailure('getCloudAPISignedHeader failed ret=41002'), true)
  assert.equal(shouldFallbackAfterDevtoolsFailure({
    target: 'cloud',
    reason: 'Cloud API signed-header failure',
  }), false)
})

test('blocks miniprogram upload fallback unless explicitly forced', () => {
  assert.equal(shouldFallbackAfterDevtoolsFailure({
    target: 'miniprogram-upload',
    reason: 'DevTools CLI unavailable',
  }), false)
  assert.equal(shouldFallbackAfterDevtoolsFailure({
    target: 'miniprogram-upload',
    reason: 'DevTools CLI unavailable',
    forceCi: true,
  }), true)
})

test('allows non-upload fallback for non-login DevTools failures', () => {
  assert.equal(shouldFallbackAfterDevtoolsFailure({
    target: 'cloud',
    reason: 'DevTools CLI not found',
  }), true)
})

test('release cloud smoke ensures required database collections before invoking fixtures', () => {
  const deployScript = readFileSync(new URL('../deploy.mjs', import.meta.url), 'utf8')
  const ensureIndexesScript = readFileSync(new URL('../ensure-indexes.mjs', import.meta.url), 'utf8')
  const runCloudSmokeBody = extractFunctionBlock(deployScript, 'async function runCloudSmoke')

  assert.match(ensureIndexesScript, /content_audit_tasks/)
  assert.match(ensureIndexesScript, /admin_notification_subscriptions/)
  assert.match(ensureIndexesScript, /admin_notifications/)
  assert.match(runCloudSmokeBody, /ensure:indexes/)
  assert(runCloudSmokeBody.indexOf('ensure:indexes') < runCloudSmokeBody.indexOf('runCloudReleaseSmoke'))
})

const PUBLIC_CANONICAL_WORKSPACE = 'C:\\Project\\Claude\\happyHome_public'
const PUBLIC_ORIGIN_URL = 'https://github.com/happyhome-project/happyHome_public.git'

function validPublicReleaseState(overrides = {}) {
  return {
    cwd: PUBLIC_CANONICAL_WORKSPACE,
    originUrl: PUBLIC_ORIGIN_URL,
    releaseStrategy: 'full-current',
    fullCurrentExplicit: true,
    branch: 'main',
    headSha: 'a',
    originMainSha: 'a',
    changedPaths: [],
    ...overrides,
  }
}

test('formal release git state accepts an explicit full-current release from synchronized public main', () => {
  assert.doesNotThrow(() => releasePolicyModule.assertFormalReleaseGitState(validPublicReleaseState()))
})

test('formal release git state rejects private cwd, wrong origin, feature, dirty, stale, and implicit full-current sources', () => {
  assert.throws(() => releasePolicyModule.assertFormalReleaseGitState({
    ...validPublicReleaseState(), cwd: 'C:\\Project\\Claude\\happyHome',
  }), /canonical main workspace/i)
  assert.throws(() => releasePolicyModule.assertFormalReleaseGitState({
    ...validPublicReleaseState(), originUrl: 'git@github.com:happyhome-project/happyHome_public.git',
  }), /origin/i)
  assert.throws(() => releasePolicyModule.assertFormalReleaseGitState({
    ...validPublicReleaseState(), branch: 'feature',
  }), /main/)
  assert.throws(() => releasePolicyModule.assertFormalReleaseGitState({
    ...validPublicReleaseState(), changedPaths: ['cloud/functions/admin/index.ts'],
  }), /clean/i)
  assert.throws(() => releasePolicyModule.assertFormalReleaseGitState({
    ...validPublicReleaseState(), originMainSha: 'b',
  }), /origin\/main/)
  assert.throws(() => releasePolicyModule.assertFormalReleaseGitState({
    ...validPublicReleaseState(), fullCurrentExplicit: false,
  }), /explicit/i)
})

test('publish resume allows only its matching generated build-info change', () => {
  assert.doesNotThrow(() => releasePolicyModule.assertFormalReleaseGitState({
    ...validPublicReleaseState(),
    changedPaths: ['miniprogram/src/generated/build-info.ts'],
    publishOnly: true,
    generatedBuildInfoMatches: true,
  }))
  assert.throws(() => releasePolicyModule.assertFormalReleaseGitState({
    ...validPublicReleaseState(),
    changedPaths: ['miniprogram/src/generated/build-info.ts', 'cloud/functions/admin/index.ts'],
    publishOnly: true,
    generatedBuildInfoMatches: true,
  }), /unexpected/i)
  assert.throws(() => releasePolicyModule.assertFormalReleaseGitState({
    ...validPublicReleaseState(),
    changedPaths: ['miniprogram/src/generated/build-info.ts'],
    publishOnly: true,
    generatedBuildInfoMatches: false,
  }), /build-info/i)
})

test('publish resume preserves public origin and full-current release intent', () => {
  const deployScript = readFileSync(new URL('../deploy.mjs', import.meta.url), 'utf8')
  const gitState = extractFunctionBlock(deployScript, 'function getFormalReleaseGitState')
  assert.match(gitState, /originUrl:/)
  assert.match(gitState, /releaseStrategy/)
  assert.match(gitState, /fullCurrentExplicit/)
  assert.match(deployScript, /getFormalReleaseGitState\(\{[\s\S]*?releaseStrategy:[\s\S]*?\}\)/)
})

test('full-current planner fetches and validates exact public main HEAD before producing a plan', () => {
  const planner = readFileSync(new URL('../release-plan.mjs', import.meta.url), 'utf8')
  const fullCurrentBranch = planner.slice(planner.indexOf("mode === 'full-current'"))
  const fetchIndex = fullCurrentBranch.indexOf("git(['fetch', '--quiet', 'origin', 'main']")
  const headCheckIndex = fullCurrentBranch.indexOf('workspaceHead')
  const policyIndex = fullCurrentBranch.indexOf('assertFormalReleaseGitState')
  const changesIndex = fullCurrentBranch.indexOf('const changes =')
  assert(fetchIndex >= 0)
  assert(headCheckIndex > fetchIndex)
  assert(policyIndex > headCheckIndex)
  assert(changesIndex > policyIndex)
  assert.match(fullCurrentBranch, /headSha[^\n]*workspaceHead|workspaceHead[^\n]*headSha/)
  assert.match(fullCurrentBranch, /fullCurrentExplicit:\s*true/)
})

test('CloudBase CLI retry treats its known includes TypeError as transient', () => {
  const deployScript = readFileSync(new URL('../deploy.mjs', import.meta.url), 'utf8')
  const retryClassifier = extractFunctionBlock(deployScript, 'function isTransientCloudBaseCliFailure')

  assert.match(retryClassifier, /_a\\\.includes is not a function/)
  assert.match(retryClassifier, /e\\\.message\\\.includes is not a function/)
})

test('formal release path records resumable ledger stages before upload', () => {
  const deployScript = readFileSync(new URL('../deploy.mjs', import.meta.url), 'utf8')
  const releaseBlock = extractFunctionBlock(deployScript, 'async function runFormalRelease')

  assert.match(deployScript, /release-run-ledger\.mjs/)
  assert.match(deployScript, /completeProductionReleaseWithRemoteConfirmation/)
  assert.match(deployScript, /target === 'release-prepare'/)
  assert.match(deployScript, /target === 'release-publish'/)
  assert.match(deployScript, /function getExplicitReleaseRunId/)
  assert.match(deployScript, /function assertNoFormalReleaseOnlyFilter/)
  assert.match(releaseBlock, /assertNoFormalReleaseOnlyFilter\(\)/)
  assert.match(deployScript, /Formal release does not support --only/)
  assert.match(releaseBlock, /publishOnly && !getExplicitReleaseRunId\(\)/)
  assert.match(deployScript, /release-publish requires an explicit --release-run-id/)
  assert.match(deployScript, /function assertFormalReleaseCloudBasePath/)
  assert.match(releaseBlock, /assertFormalReleaseCloudBasePath\(\{ prepareOnly }\)/)
  assert.match(deployScript, /Formal release publish requires --use-tcb/)
  assert.match(releaseBlock, /deployCloud\(\{[\s\S]*?requireCloudBaseCli:\s*true/)
  assert.match(deployScript, /requireCloudBaseCli/)
  assert.match(deployScript, /Formal release CloudBase CLI\/COS deploy failed/)
  assert.match(releaseBlock, /runLedgerStage\(releaseLedger,\s*'miniprogram-build-gate'/)
  assert.match(releaseBlock, /mustReuse: publishOnly/)
  assert.match(releaseBlock, /runLedgerStage\(releaseLedger,\s*'cloud-deploy'/)
  assert.match(releaseBlock, /runLedgerStage\(releaseLedger,\s*'cloud-smoke'/)
  assert.match(releaseBlock, /runLedgerStage\(releaseLedger,\s*'admin-web-deploy'/)
  assert.match(releaseBlock, /runLedgerStage\(releaseLedger,\s*'miniprogram-upload'/)
  assert.match(deployScript, /inspectReleaseStageReuse/)
  assert.match(releaseBlock, /reuseCheck/)

  assert(releaseBlock.indexOf("'cloud-smoke'") < releaseBlock.indexOf("'admin-web-deploy'"))
  assert(releaseBlock.indexOf("'admin-web-deploy'") < releaseBlock.indexOf("'miniprogram-upload'"))
  assert(releaseBlock.indexOf("'miniprogram-upload'") < releaseBlock.indexOf("complete('passed')"))
})

test('every direct production deployment is fenced to the canonical clean main workspace', () => {
  const deployScript = readFileSync(new URL('../deploy.mjs', import.meta.url), 'utf8')
  const dispatch = deployScript.slice(deployScript.lastIndexOf("const target = process.argv[2] || 'all'"))
  const cloud = extractFunctionBlock(deployScript, 'async function deployCloud(options')
  const miniprogram = extractFunctionBlock(deployScript, 'async function deployMiniprogram(options')
  const upload = extractFunctionBlock(deployScript, 'async function uploadBuiltMiniprogram({')
  const uploadEntry = extractFunctionBlock(deployScript, 'async function uploadMiniprogram(options')
  const adminCloudBase = extractFunctionBlock(deployScript, 'async function deployAdminWebToCloudBase(options')
  const adminAliyun = extractFunctionBlock(deployScript, 'async function deployAdminWebToAliyun(options')
  const cloudBaseRetry = extractFunctionBlock(deployScript, 'async function runCloudBaseCliCaptureWithRetry(')
  const cloudBaseDeploy = extractFunctionBlock(deployScript, 'async function deployCloudViaCloudBaseCli(')

  assert.match(deployScript, /function assertDirectProductionDeployWorkspace\(/)
  assert.match(dispatch, /assertDirectProductionDeployWorkspace\(\)/)
  assert.match(dispatch, /beforeRemoteMutation:\s*assertDirectProductionDeployWorkspace/)
  assert.match(dispatch, /beforeFunctionDeploy:\s*assertDirectProductionDeployWorkspace/)
  assert.match(dispatch, /deployCloud\(directMutationOptions\)/)
  assert.match(dispatch, /beforeEnsureIndexes:\s*assertDirectProductionDeployWorkspace/)
  assert.match(dispatch, /beforeSmokeCommand:\s*assertDirectProductionDeployWorkspace/)
  assert.match(dispatch, /deployMiniprogram\(directMutationOptions\)/)
  assert.match(dispatch, /uploadMiniprogram\(directMutationOptions\)/)
  assert.match(dispatch, /deployAdminWeb\(directMutationOptions\)/)
  assert.match(cloud, /runOptionalDirectRemoteMutation/)
  assert.match(miniprogram, /runOptionalDirectRemoteMutation/)
  assert.match(upload, /runOptionalDirectRemoteMutation/)
  assert.match(uploadEntry, /publishOnly:\s*true/)
  assert.match(adminCloudBase, /runOptionalDirectRemoteMutation/)
  assert.match(adminAliyun, /runOptionalDirectRemoteMutation/)
  assert.match(cloudBaseRetry, /beforeAttempt[\s\S]*runShellCapture/)
  assert.match(cloudBaseDeploy, /beforeAttempt:[\s\S]*async \(\) => await options\.beforeFunctionDeploy\(fn\)/)
})

test('package exposes a release status command for the latest ledger', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.equal(packageJson.scripts['release:status'], 'node scripts/release-status.mjs')
  assert.equal(packageJson.scripts['release:reconcile'], 'node scripts/release-reconcile.mjs')
})
