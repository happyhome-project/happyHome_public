import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { isDevtoolsLoginSigningFailure, shouldFallbackAfterDevtoolsFailure } from './release-policy.mjs'
import * as releasePolicyModule from './release-policy.mjs'

test('root DevTools project config points manual cloud deploys at the built function tree', () => {
  const config = JSON.parse(readFileSync(new URL('../../project.config.json', import.meta.url), 'utf8'))
  assert.equal(config.cloudfunctionRoot, 'cloud/dist/')
})

test('H5 runtime uses CloudBase Web SDK instead of the historical gateway or shared token', () => {
  const source = readFileSync(new URL('../../miniprogram/src/api/cloud.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /happyhome-admin-2024/)
  assert.doesNotMatch(source, /app\.tcloudbase\.com\/http-gateway/)
  assert.match(source, /const IS_H5 = !_wx\?\.cloud\?\.callFunction/)
  assert.match(source, /import\('\.\/web-cloudbase'\)/)
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
  assert.match(ensureIndexesScript, /rag_community_versions/)
  for (const collection of ['post_rag_outbox', 'post_rag_index_state_v2', 'post_rag_index_versions', 'post_rag_worker_timer_evidence']) {
    assert.match(ensureIndexesScript, new RegExp(collection))
  }
  assert.match(runCloudSmokeBody, /ensure:indexes/)
  assert(runCloudSmokeBody.indexOf('ensure:indexes') < runCloudSmokeBody.indexOf('runCloudReleaseSmoke'))
  assert.match(runCloudSmokeBody, /options\.ensureIndexes\s*!==\s*false/)
})

test('mutation boundaries fetch once while repeated ordinary invoke and log fences stay local and exact-SHA bound', async () => {
  const events = []
  const state = validPublicReleaseState({ headSha: 'release-sha', originMainSha: 'release-sha' })
  const fences = releasePolicyModule.createFormalReleaseMutationFences({
    expectedGitSha: 'release-sha',
    fetchOriginMain: async () => events.push('fetch'),
    readGitState: () => { events.push('read'); return { ...state } },
    releaseStrategy: 'full-current',
    fullCurrentExplicit: true,
    beforeRemoteMutation: async (stage) => events.push(`guard:${stage}`),
  })
  await fences.remoteBoundary('cloud:post')
  await fences.localExactShaFence('invoke:post')
  await fences.localExactShaFence('log:post')
  assert.deepEqual(events, [
    'fetch', 'read', 'guard:cloud:post',
    'read', 'guard:invoke:post',
    'read', 'guard:log:post',
  ])
})

test('local exact-SHA fence rejects drift without fetching or advancing the remote mutation guard', async () => {
  const events = []
  const fences = releasePolicyModule.createFormalReleaseMutationFences({
    expectedGitSha: 'release-sha',
    fetchOriginMain: async () => events.push('fetch'),
    readGitState: () => validPublicReleaseState({ headSha: 'drifted', originMainSha: 'drifted' }),
    releaseStrategy: 'full-current',
    fullCurrentExplicit: true,
    beforeRemoteMutation: async () => events.push('guard'),
  })
  await assert.rejects(() => fences.localExactShaFence('invoke:post'), /exact release SHA/i)
  assert.deepEqual(events, [])
})

test('bounded fetch does not weaken the production token fence on the next local mutation', async () => {
  let fetches = 0
  let guards = 0
  const fences = releasePolicyModule.createFormalReleaseMutationFences({
    expectedGitSha: 'release-sha',
    fetchOriginMain: async () => { fetches += 1 },
    readGitState: () => validPublicReleaseState({ headSha: 'release-sha', originMainSha: 'release-sha' }),
    releaseStrategy: 'full-current', fullCurrentExplicit: true,
    beforeRemoteMutation: async () => { guards += 1; if (guards === 3) throw new Error('production token invalidated') },
  })
  await fences.remoteBoundary('subset')
  await fences.localExactShaFence('cloud:first')
  await assert.rejects(() => fences.localExactShaFence('cloud:second'), /token invalidated/)
  assert.equal(fetches, 1)
  assert.equal(guards, 3)
})

test('timer probe waits on a bounded deadline instead of a fixed attempt count', () => {
  const source = readFileSync(new URL('./post-rag-timer-probe-runner.mjs', import.meta.url), 'utf8')
  assert.match(source, /resolveTimerProbeTimeoutMs/)
  assert.match(source, /runtime\.now\(\)\s*<\s*deadlineMs/)
  assert.doesNotMatch(source, /attempt\s*<\s*20/)
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

test('formal release git state treats Windows slash styles as the same canonical workspace', () => {
  assert.doesNotThrow(() => releasePolicyModule.assertFormalReleaseGitState({
    ...validPublicReleaseState(), cwd: 'C:/Project/Claude/happyHome_public',
  }))
  assert.throws(() => releasePolicyModule.assertFormalReleaseGitState({
    ...validPublicReleaseState(), cwd: 'C:/Project/Claude/happyHome_public_other',
  }), /canonical main workspace/i)
})

test('formal release git state accepts the canonical workspace with a Windows extended path prefix', () => {
  assert.doesNotThrow(() => releasePolicyModule.assertFormalReleaseGitState({
    ...validPublicReleaseState(), cwd: '\\\\?\\C:\\Project\\Claude\\happyHome_public',
  }))
  assert.throws(() => releasePolicyModule.assertFormalReleaseGitState({
    ...validPublicReleaseState(), cwd: '\\\\?\\C:\\Project\\Claude\\happyHome_public_other',
  }), /canonical main workspace/i)
  assert.throws(() => releasePolicyModule.assertFormalReleaseGitState({
    ...validPublicReleaseState(), cwd: '\\\\server\\share\\happyHome_public',
  }), /canonical main workspace/i)
  assert.throws(() => releasePolicyModule.assertFormalReleaseGitState({
    ...validPublicReleaseState(), cwd: '.\\happyHome_public',
  }), /canonical main workspace/i)
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

test('formal mutation revalidation refuses Git drift before invoking the production fence', async () => {
  let state = validPublicReleaseState()
  const events = []
  const revalidate = releasePolicyModule.createFormalReleaseMutationRevalidator({
    fetchOriginMain: async () => events.push('fetch'),
    readGitState: () => state,
    releaseStrategy: 'full-current',
    fullCurrentExplicit: true,
    beforeRemoteMutation: async (stage) => events.push(`fence:${stage}`),
  })

  await revalidate('cloud:user')
  assert.deepEqual(events, ['fetch', 'fence:cloud:user'])

  state = { ...state, changedPaths: ['cloud/functions/user/index.ts'] }
  await assert.rejects(() => revalidate('cloud:user'), /clean/i)
  assert.deepEqual(events, ['fetch', 'fence:cloud:user', 'fetch'])
})

test('formal mutation revalidation preserves the narrow publish-resume build-info exception', async () => {
  const events = []
  const revalidate = releasePolicyModule.createFormalReleaseMutationRevalidator({
    fetchOriginMain: async () => events.push('fetch'),
    readGitState: () => validPublicReleaseState({
      changedPaths: ['miniprogram/src/generated/build-info.ts'],
      publishOnly: true,
      generatedBuildInfoMatches: true,
    }),
    releaseStrategy: 'full-current',
    fullCurrentExplicit: true,
    beforeRemoteMutation: async (stage) => events.push(`fence:${stage}`),
  })

  await revalidate('miniprogram-upload')
  assert.deepEqual(events, ['fetch', 'fence:miniprogram-upload'])
})

test('formal mutation revalidation serializes concurrent Git fetch and fence checks', async () => {
  let active = 0
  let maxActive = 0
  const revalidate = releasePolicyModule.createFormalReleaseMutationRevalidator({
    fetchOriginMain: async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setImmediate(resolve))
      active -= 1
    },
    readGitState: () => validPublicReleaseState(),
    releaseStrategy: 'full-current',
    fullCurrentExplicit: true,
    beforeRemoteMutation: async () => {},
  })

  await Promise.all([revalidate('cloud:user'), revalidate('cloud:post')])
  assert.equal(maxActive, 1)
})

test('one-shot formal release allows only its matching release-owned build-info after a successful build', async () => {
  let buildPrepared = false
  let matches = true
  const state = () => validPublicReleaseState({
    changedPaths: buildPrepared ? ['miniprogram/src/generated/build-info.ts'] : [],
    allowReleaseBuildInfo: buildPrepared,
    generatedBuildInfoMatches: matches,
  })
  const revalidate = releasePolicyModule.createFormalReleaseMutationRevalidator({
    fetchOriginMain: async () => {},
    readGitState: state,
    releaseStrategy: 'full-current',
    fullCurrentExplicit: true,
    beforeRemoteMutation: async () => {},
  })

  await revalidate('artifact-build:miniprogram')
  buildPrepared = true
  await revalidate('cloud:user')

  matches = false
  await assert.rejects(() => revalidate('cloud:post'), /build-info/i)
  matches = true
  buildPrepared = false
  assert.throws(() => releasePolicyModule.assertFormalReleaseGitState({
    ...state(),
    changedPaths: ['miniprogram/src/generated/build-info.ts'],
  }), /clean/i)
  assert.throws(() => releasePolicyModule.assertFormalReleaseGitState({
    ...state(),
    allowReleaseBuildInfo: true,
    changedPaths: ['miniprogram/src/generated/build-info.ts', 'cloud/functions/user/index.ts'],
  }), /unexpected/i)
})

test('one-shot build-info allowance is enabled after build evidence and before downstream release mutations', () => {
  const deployScript = readFileSync(new URL('../deploy.mjs', import.meta.url), 'utf8')
  const release = extractFunctionBlock(deployScript, 'async function runFormalRelease')
  const buildIndex = release.indexOf('await buildAndGateMiniprogramUpload')
  const evidenceIndex = release.indexOf('await collectMiniprogramBuildGateEvidence', buildIndex)
  const allowanceIndex = release.indexOf('oneShotBuildInfoPrepared = true')
  const operationsIndex = release.indexOf("'release-operations'")
  const uploadIndex = release.indexOf('await uploadBuiltMiniprogram')

  assert(buildIndex >= 0)
  assert(evidenceIndex > buildIndex)
  assert(allowanceIndex > evidenceIndex)
  assert(allowanceIndex < operationsIndex)
  assert(allowanceIndex < uploadIndex)
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
  assert.match(releaseBlock, /executeReleaseOperations\(\{[\s\S]*?manifests:\s*formalPlan\.manifests/)
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
  assert.match(releaseBlock, /releaseGuard\.acquire\(\)/)
  assert.match(releaseBlock, /runLedgerStage\(releaseLedger,\s*'release-preflight'[\s\S]*?runReleaseNpmScript\('release:preflight'/)
  assert.match(releaseBlock, /timerCheck\?\.cleanup\s*!==\s*'passed'/)
  assert.match(releaseBlock, /ensure-release-control-plane\.mjs --verify-only/)
  assert.doesNotMatch(releaseBlock, /node scripts\/ensure-release-control-plane\.mjs['\"]/)
  assert.match(deployScript, /Formal release publish requires --use-tcb/)
  assert.match(releaseBlock, /deployCloud\(\{[\s\S]*?requireCloudBaseCli:\s*true/)
  assert.match(deployScript, /requireCloudBaseCli/)
  assert.match(deployScript, /Formal release CloudBase CLI\/COS deploy failed/)
  assert.match(releaseBlock, /runLedgerStage\(releaseLedger,\s*'miniprogram-build-gate'/)
  assert.match(releaseBlock, /mustReuse: publishOnly/)
  assert.match(releaseBlock, /runLedgerStage\(releaseLedger,\s*'cloud-deploy'/)
  assert.match(releaseBlock, /runLedgerStage\(releaseLedger,\s*'cloud-deploy-rag-bootstrap'/)
  assert.match(releaseBlock, /runLedgerStage\(releaseLedger,\s*'cloud-deploy-remaining'/)
  assert.match(releaseBlock, /runLedgerStage\(releaseLedger,\s*'cloud-version-probes'/)
  assert.match(releaseBlock, /runLedgerStage\(releaseLedger,\s*'cloud-smoke'/)
  assert.match(releaseBlock, /runCloudSmoke\(releaseCloudSmokeFunctions,\s*releaseLedger\.runId/)
  assert.match(releaseBlock, /runLedgerStage\(releaseLedger,\s*'admin-web-deploy'/)
  assert.match(releaseBlock, /runLedgerStage\(releaseLedger,\s*'miniprogram-upload'/)
  assert.match(releaseBlock, /preparedPackageDigest/)
  assert.match(releaseBlock, /completeProductionReleaseWithRemoteConfirmation\(\{/)
  assert.match(deployScript, /inspectReleaseStageReuse/)
  assert.match(releaseBlock, /reuseCheck/)

  const orderedReleaseMarkers = [
    "runLedgerStage(releaseLedger, 'release-preflight'",
    'ensure-release-control-plane.mjs --verify-only',
    'releaseGuard.acquire()',
    'executeReleaseOperations({',
    "runLedgerStage(releaseLedger, 'admin-web-deploy'",
    "runLedgerStage(releaseLedger, 'miniprogram-upload'",
    'completeProductionReleaseWithRemoteConfirmation({',
  ]
  const orderedReleaseIndexes = orderedReleaseMarkers.map((marker) => releaseBlock.indexOf(marker))
  assert(orderedReleaseIndexes.every((index) => index >= 0), 'formal release is missing a required release stage or call')
  for (let index = 1; index < orderedReleaseIndexes.length; index += 1) {
    assert(orderedReleaseIndexes[index - 1] < orderedReleaseIndexes[index], `${orderedReleaseMarkers[index - 1]} must precede ${orderedReleaseMarkers[index]}`)
  }
})

test('formal release derives explicit full-current strategy before opening resume state and binds it everywhere', () => {
  const deployScript = readFileSync(new URL('../deploy.mjs', import.meta.url), 'utf8')
  const release = extractFunctionBlock(deployScript, 'async function runFormalRelease')
  const strategyIndex = release.indexOf("const fullCurrentExplicit = hasFlag('full-current')")
  const resumeIndex = release.indexOf('await getResumeRunState')

  assert(strategyIndex >= 0)
  assert(strategyIndex < resumeIndex)
  assert.match(release, /const releaseStrategy = fullCurrentExplicit \? 'full-current' : 'main'/)
  assert.match(release, /getFormalReleaseGitState\(\{[\s\S]*?releaseStrategy,[\s\S]*?fullCurrentExplicit/)
  assert.match(release, /const releaseContext = \{[\s\S]*?releaseStrategy,/)
  assert.match(release, /const releaseContext = \{[\s\S]*?forceRedeployCurrent,/)
  assert.match(release, /createReleaseRunLedger\(\{[\s\S]*?releaseStrategy,/)
  assert.match(release, /createReleasePlanAfterResumeIdentityCheck\(\{[\s\S]*?resumeRunState,[\s\S]*?gitSha: releaseContext\.gitSha,[\s\S]*?releaseStrategy,[\s\S]*?createPlan:/)
  assert.match(release, /createFormalReleaseMutationFences\(\{[\s\S]*?expectedGitSha:\s*releaseContext\.gitSha,[\s\S]*?releaseStrategy,[\s\S]*?fullCurrentExplicit,/)
})

test('formal release planner uses the selected mode and validates the exact strategy-bound plan', () => {
  const deployScript = readFileSync(new URL('../deploy.mjs', import.meta.url), 'utf8')
  const planner = extractFunctionBlock(deployScript, 'function createFormalReleasePlan')
  const planCli = readFileSync(new URL('../release-plan.mjs', import.meta.url), 'utf8')

  assert.match(planner, /function createFormalReleasePlan\(gitSha, releaseStrategy, publishResume, forceRedeployCurrent = false\)/)
  assert.match(planner, /`--mode=\$\{releaseStrategy\}`/)
  assert.match(planner, /`--head=\$\{gitSha\}`/)
  assert.match(planner, /--publish-resume/)
  assert.match(planner, /--version=/)
  assert.match(planner, /--desc=/)
  assert.match(planner, /--force-redeploy-current/)
  assert.match(planCli, /publishOnly:\s*hasOption\('publish-resume'\)/)
  assert.match(planCli, /generatedBuildInfoMatches:/)
  assert.match(planner, /plan\.mode !== releaseStrategy/)
  assert.match(planner, /plan\.planningStrategy !== expectedPlanningStrategy/)
  assert.match(planner, /plan\.headSha !== gitSha/)
  assert.match(planner, /plan\.forceRedeployCurrent !== forceRedeployCurrent/)
  assert.match(planner, /!plan\.releaseRequired/)
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
